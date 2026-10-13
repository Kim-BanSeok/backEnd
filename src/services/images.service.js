import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import sequelize from '../db/connection.js';
import { fail } from '../utils/errors.js';
import { storage } from '../storage/index.js';
import * as fabricsDao from '../dao/fabrics.dao.js';
import * as imagesDao from '../dao/images.dao.js';
import { assertFabricOwner } from './fabricAccess.js';
import { signedImageUrl } from './imageAccess.service.js';

const MAX_IMAGES = 3;
const THUMBNAIL_WIDTH = 400;
// 확장자가 아니라 파일 내용으로 판별한 형식 → 저장할 확장자
const ALLOWED_FORMATS = { jpeg: 'jpg', png: 'png', webp: 'webp' };

// 원단이 있고 내 원단인지 확인한다. 없으면 404, 남의 원단이면 403.
async function assertOwnFabric(userId, fabricId) {
  const fabric = await fabricsDao.findById(fabricId);
  if (!fabric) throw fail('NOT_FOUND');
  await assertFabricOwner(userId, fabric);
  return fabric;
}

// 파일 내용을 실제로 읽어서 jpg·png·webp 인지 확인하고 썸네일(가로 400px webp)을 만든다.
// 이미지가 아니거나 깨진 파일이면 IMAGE_TOO_LARGE (명세서: 5MB 초과이거나 jpg·png·webp 가 아님).
async function inspectImage(buffer) {
  try {
    const image = sharp(buffer, { limitInputPixels: 40_000_000 });
    const { format } = await image.metadata();
    const ext = ALLOWED_FORMATS[format];
    if (!ext) throw new Error(`허용하지 않는 형식: ${format}`);
    const thumbnail = await image
      .clone()
      .rotate() // 사진에 기록된 방향대로 세운다
      .resize({ width: THUMBNAIL_WIDTH, withoutEnlargement: true })
      .webp()
      .toBuffer();
    const cleanOriginal = await image.clone().rotate().toFormat(format).toBuffer();
    return { ext, thumbnail, cleanOriginal };
  } catch {
    throw fail('IMAGE_TOO_LARGE');
  }
}

export async function addImage(userId, fabricId, { buffer, imageType }) {
  const fabric = await assertOwnFabric(userId, fabricId);
  // 3장이면 파일을 처리하기 전에 빨리 거절한다. (아래 트랜잭션 안에서 한 번 더 확인한다)
  if ((await imagesDao.countByFabric(fabricId)) >= MAX_IMAGES) throw fail('IMAGE_LIMIT_EXCEEDED');

  const { ext, thumbnail, cleanOriginal } = await inspectImage(buffer);
  const id = randomUUID();
  const imageKey = `fabrics/${fabricId}/${id}.${ext}`;
  const thumbnailKey = `fabrics/${fabricId}/thumbs/${id}.webp`;

  try {
    const imageUrl = await storage.put(imageKey, cleanOriginal);
    const thumbnailUrl = await storage.put(thumbnailKey, thumbnail);

    const image = await sequelize.transaction(async (transaction) => {
      // 같은 원단에 동시에 올려도 한 줄로 세워서, 3장을 넘거나 순서가 겹치지 않게 한다.
      if (!(await fabricsDao.lockById(fabricId, { transaction }))) throw fail('NOT_FOUND');
      const count = await imagesDao.countByFabric(fabricId, { transaction });
      if (count >= MAX_IMAGES) throw fail('IMAGE_LIMIT_EXCEEDED');
      return imagesDao.insert(
        {
          fabric_id: fabricId,
          image_url: imageUrl,
          thumbnail_url: thumbnailUrl,
          image_type: imageType ?? null,
          sort_order: count, // 올린 순서 (0부터, 0번이 대표 사진)
        },
        { transaction },
      );
    });

    return {
      imageId: image.image_id,
      image_url: signedImageUrl(image.image_url, fabric.status),
      thumbnail_url: signedImageUrl(image.thumbnail_url, fabric.status),
      sort_order: image.sort_order,
    };
  } catch (err) {
    // DB 에 저장하지 못했으면 이미 올린 파일이 남지 않게 지운다.
    await Promise.allSettled([storage.remove(imageKey), storage.remove(thumbnailKey)]);
    throw err;
  }
}

export async function removeImage(userId, fabricId, imageId) {
  await assertOwnFabric(userId, fabricId);

  const removed = await sequelize.transaction(async (transaction) => {
    if (!(await fabricsDao.lockById(fabricId, { transaction }))) throw fail('NOT_FOUND');
    const image = await imagesDao.findOne(fabricId, imageId, { transaction });
    if (!image) throw fail('NOT_FOUND');
    await imagesDao.destroy(image, { transaction });

    // 남은 사진의 순서를 0부터 다시 매긴다. (작은 번호부터 바꾸므로 순서 중복이 생기지 않는다)
    const rest = await imagesDao.listByFabric(fabricId, { transaction });
    for (const [index, item] of rest.entries()) {
      if (item.sort_order !== index) await imagesDao.updateSortOrder(item, index, { transaction });
    }
    return image;
  });

  // DB 가 기준이다. 파일을 지우지 못해도 응답은 성공이고, 서버 기록에만 남긴다.
  for (const url of [removed.image_url, removed.thumbnail_url]) {
    const key = storage.keyOf(url);
    if (key) await storage.remove(key).catch((err) => console.error('사진 파일 삭제 실패', key, err));
  }
  return null;
}
