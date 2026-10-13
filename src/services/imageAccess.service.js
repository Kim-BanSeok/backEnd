import { createHmac, timingSafeEqual } from 'node:crypto';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import sharp from 'sharp';
import { env } from '../config/env.js';
import { storage } from '../storage/index.js';
import { fail } from '../utils/errors.js';
import * as fabricsDao from '../dao/fabrics.dao.js';
import * as imagesDao from '../dao/images.dao.js';
import * as storesDao from '../dao/stores.dao.js';

export const IMAGE_LINK_TTL_SECONDS = 300;
const signature = (key, expires) => createHmac('sha256', env.jwtSecret).update(`image-v1\n${key}\n${expires}`).digest('hex');
export function signedImageUrl(url, status) {
  if (!url) return null;
  // Public links carry no private access grant, so unpublishing takes effect immediately.
  if (status === 'POSTED') return url;
  const key = storage.keyOf(url);
  if (!key) return url;
  const expires = Math.floor(Date.now() / 1000) + IMAGE_LINK_TTL_SECONDS;
  const result = new URL(url);
  result.searchParams.set('expires', String(expires));
  result.searchParams.set('signature', signature(key, expires));
  return result.href;
}
function validSignature(key, query) {
  const { expires, signature: supplied } = query;
  if (typeof expires !== 'string' || !/^\d+$/.test(expires) || typeof supplied !== 'string' || !/^[a-f0-9]{64}$/.test(supplied)) return false;
  const seconds = Number(expires), now = Math.floor(Date.now() / 1000);
  if (!Number.isSafeInteger(seconds) || seconds <= now || seconds > now + IMAGE_LINK_TTL_SECONDS) return false;
  return timingSafeEqual(Buffer.from(supplied, 'hex'), Buffer.from(signature(key, seconds), 'hex'));
}
export async function authorizeImage(viewer, key, query) {
  const match = /^fabrics\/([1-9]\d*)\/(?:thumbs\/)?[a-f0-9-]{36}\.(?:jpg|png|webp)$/.exec(key);
  if (!match) throw fail('NOT_FOUND');
  const fabric = await fabricsDao.findById(Number(match[1]));
  if (!fabric) throw fail('NOT_FOUND');
  const images = await imagesDao.listByFabric(fabric.fabric_id);
  if (!images.some(image => [image.image_url, image.thumbnail_url].some(url => url && storage.keyOf(url) === key))) throw fail('NOT_FOUND');
  if (fabric.status === 'POSTED') return key;
  if (validSignature(key, query)) return key;
  if (viewer?.role === 'ADMIN') return key;
  if (viewer) {
    const store = await storesDao.findById(fabric.store_id);
    if (store?.user_id === viewer.userId) return key;
  }
  throw fail('NOT_FOUND');
}

// Historical uploads may still contain EXIF. Never transmit that metadata, even for public photos.
export async function sanitizedLegacyImage(key) {
  const full = path.resolve(env.uploadDir, key);
  if (!full.startsWith(env.uploadDir + path.sep)) throw fail('NOT_FOUND');
  try {
    const image = sharp(await readFile(full), { limitInputPixels: 40_000_000 });
    const metadata = await image.metadata();
    if (!['jpeg', 'png', 'webp'].includes(metadata.format)) throw new Error('Unsupported stored image');
    if (!metadata.exif && !metadata.xmp && !metadata.iptc && !metadata.icc && !metadata.comments?.length) return null;
    return { buffer: await image.rotate().toFormat(metadata.format).toBuffer(), type: `image/${metadata.format}` };
  } catch { throw fail('NOT_FOUND'); }
}
