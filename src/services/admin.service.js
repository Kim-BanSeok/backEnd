import sequelize from '../db/connection.js';
import { fail } from '../utils/errors.js';
import { toKstIso } from '../utils/response.js';
import * as fabricsDao from '../dao/fabrics.dao.js';
import * as imagesDao from '../dao/images.dao.js';
import * as usersDao from '../dao/users.dao.js';
import { toStoreResponse } from './stores.service.js';

const pageOf = ({ rows, count }, page, size, toItem) => ({
  content: rows.map(toItem),
  page,
  size,
  totalElements: count,
  totalPages: Math.ceil(count / size),
});

// ---- 원단 게시 심사 (33~35번)

// 운영팀 원단 목록 항목 (명세서 33번). 상세·사진·매장 이름을 함께 준다. 상세의 내부 번호(fabric_detail_id)는 넣지 않는다.
const toAdminFabric = (fabric) => {
  const { detail } = fabric;
  return {
    fabricId: fabric.fabric_id,
    title: fabric.title,
    sale_type: fabric.sale_type,
    price: fabric.price,
    remaining_length_cm: fabric.remaining_length_cm,
    status: fabric.status,
    store_name: fabric.store?.store_name ?? null,
    detail: detail && {
      material: detail.material,
      thickness: detail.thickness,
      color_family: detail.color_family,
      color_detail: detail.color_detail,
      width_cm: detail.width_cm,
      length_cm: detail.length_cm,
      has_defect: detail.has_defect,
      defect_note: detail.defect_note,
      blend_ratio: detail.blend_ratio,
      weave: detail.weave,
      grain_direction: detail.grain_direction,
      description: detail.description,
      sheet_count: detail.sheet_count,
    },
    images: fabric.images.map((image) => ({
      imageId: image.image_id,
      image_url: image.image_url,
      thumbnail_url: image.thumbnail_url,
      image_type: image.image_type,
      sort_order: image.sort_order,
    })),
    created_at: toKstIso(fabric.created_at),
  };
};

export async function listFabrics({ status, page, size }) {
  const result = await fabricsDao.findAdminPage({ status, limit: size, offset: page * size });
  return pageOf(result, page, size, toAdminFabric);
}

// 심사할 원단을 잠근 채로 읽는다. 승인·반려가 동시에 들어오거나 사진을 지우는 중이어도 한 줄로 세운다.
// 없거나 삭제된 원단은 NOT_FOUND, 게시 대기(PENDING)가 아니면 INVALID_STATUS.
async function lockPendingFabric(fabricId, transaction) {
  const fabric = await fabricsDao.lockById(fabricId, { transaction });
  if (!fabric) throw fail('NOT_FOUND');
  if (fabric.status !== 'PENDING') throw fail('INVALID_STATUS');
  return fabric;
}

export async function approveFabric(fabricId) {
  return sequelize.transaction(async (transaction) => {
    const fabric = await lockPendingFabric(fabricId, transaction);
    // 사진이 1장 이상 있어야 게시할 수 있다. 사진 삭제도 같은 원단 행을 잠그므로, 확인하고 바꾸는 사이에 사진이 사라지지 않는다.
    if ((await imagesDao.countByFabric(fabricId, { transaction })) === 0) throw fail('IMAGE_REQUIRED');
    await fabricsDao.update(fabric, { status: 'POSTED', reject_reason: null }, { transaction });
    return { fabricId: fabric.fabric_id, status: fabric.status };
  });
}

export async function rejectFabric(fabricId, reason) {
  return sequelize.transaction(async (transaction) => {
    const fabric = await lockPendingFabric(fabricId, transaction);
    await fabricsDao.update(fabric, { status: 'REJECTED', reject_reason: reason }, { transaction });
    return { fabricId: fabric.fabric_id, status: fabric.status };
  });
}

// ---- 판매자 승인 (36~38번)

// 판매자 목록 항목 (명세서 36번). 매장을 아직 등록하지 않았으면 store 는 null.
const toAdminSeller = (user) => ({
  userId: user.user_id,
  email: user.email,
  nickname: user.nickname,
  phone_number: user.phone_number,
  seller_approval_status: user.seller_approval_status,
  created_at: toKstIso(user.created_at),
  store: user.store ? toStoreResponse(user.store) : null,
});

export async function listSellers({ status, page, size }) {
  const result = await usersDao.findSellerPage({ status, limit: size, offset: page * size });
  return pageOf(result, page, size, toAdminSeller);
}

// 판매자의 승인 상태를 바꾼다. allowedFrom 에 없는 상태에서는 INVALID_STATUS (명세서 6.5).
// 판매자가 아니거나 탈퇴한 회원은 NOT_FOUND. 같은 판매자를 동시에 처리해도 한 줄로 세운다.
async function changeSellerStatus(userId, allowedFrom, next) {
  return sequelize.transaction(async (transaction) => {
    const seller = await usersDao.lockSellerById(userId, { transaction });
    if (!seller) throw fail('NOT_FOUND');
    if (!allowedFrom.includes(seller.seller_approval_status)) throw fail('INVALID_STATUS');
    await usersDao.update(seller, { seller_approval_status: next }, { transaction });
    return { userId: seller.user_id, seller_approval_status: seller.seller_approval_status };
  });
}

// 승인 대기(PENDING)나 거절(REJECTED)된 판매자를 승인할 수 있다. 이미 승인된 판매자는 INVALID_STATUS.
export const approveSeller = (userId) => changeSellerStatus(userId, ['PENDING', 'REJECTED'], 'APPROVED');

// 승인 대기(PENDING)인 판매자만 거절할 수 있다.
export const rejectSeller = (userId) => changeSellerStatus(userId, ['PENDING'], 'REJECTED');
