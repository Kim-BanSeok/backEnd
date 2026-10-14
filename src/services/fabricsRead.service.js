import { fail } from '../utils/errors.js';
import { toKstIso } from '../utils/response.js';
import * as fabricsReadDao from '../dao/fabricsRead.dao.js';
import * as storesDao from '../dao/stores.dao.js';
import { scrapStock } from './sheetStock.js';
import { signedImageUrl } from './imageAccess.service.js';

const LISTED_STATUS = 'POSTED'; // 목록에 보여 주는 원단 상태
const RESERVING_STATUS = 'ACCEPTED'; // 자투리를 "예약 중"으로 만드는 예약 상태
const ACTIVE_RESERVATION_STATUSES = ['REQUESTED', 'ACCEPTED']; // 아직 진행 중인 예약 상태

// 원단 목록 항목 (명세서 10번).
// 롤의 length_cm 은 DB 값(NULL)을 그대로 null 로 준다. 롤의 길이는 available_length_cm(남은 길이 - 확보 길이)가 알려 준다.
// is_reserved 는 자투리에 수락된 예약이 있을 때만 true 다. 롤에는 "예약 중" 표시가 없어서 항상 false 다.
// 대표 사진이 없으면 thumbnail_url 은 null 이다.
export const toFabricSummary = (fabric) => {
  const isScrap = fabric.sale_type === 'SCRAP';
  const sheets = isScrap ? scrapStock(fabric, fabric.detail, fabric.reservations.length) : null;
  return {
    fabricId: fabric.fabric_id,
    title: fabric.title,
    sale_type: fabric.sale_type,
    price: fabric.price,
    material: fabric.detail.material,
    thickness: fabric.detail.thickness,
    color_family: fabric.detail.color_family,
    width_cm: fabric.detail.width_cm,
    length_cm: fabric.detail.length_cm,
    available_length_cm: isScrap ? null : fabric.remaining_length_cm - fabric.reserved_length_cm,
    is_reserved: Boolean(sheets?.isReserved),
    has_defect: fabric.detail.has_defect,
    thumbnail_url: signedImageUrl(fabric.images[0]?.thumbnail_url, fabric.status),
    store_name: fabric.store.store_name,
  };
};

// 게시 중인 원단만 보여 준다. 판매 완료·게시 대기·반려·삭제된 원단은 나오지 않는다.
export async function listFabrics({ sale_type, material, thickness, color_family, keyword, sort, page, size }) {
  const { rows, count } = await fabricsReadDao.findPage({
    status: LISTED_STATUS,
    reservationStatus: RESERVING_STATUS,
    saleType: sale_type,
    material,
    thickness,
    colorFamily: color_family,
    keyword,
    sort,
    limit: size,
    offset: page * size,
  });
  return {
    content: rows.map(toFabricSummary),
    page,
    size,
    totalElements: count,
    totalPages: Math.ceil(count / size),
  };
}

// 원단 상세 (명세서 11번). 롤의 availability 는 구매 가능 길이와 확보 길이를 주고, 자투리는 is_reserved 만 값이 있다.
// reject_reason 과 remaining_length_cm 은 판매자 본인과 운영팀에게만 주고, 다른 사람에게는 키 자체를 넣지 않는다. (위치는 명세서에 없어서 최상위로 정했다)
// 사진이 없으면 images 는 빈 배열이다.
export const toFabricDetail = (fabric, canSeeInternal) => {
  const isScrap = fabric.sale_type === 'SCRAP';
  const sheets = isScrap ? scrapStock(fabric, fabric.detail, fabric.reservations.length) : null;
  const { detail, store } = fabric;
  return {
    fabricId: fabric.fabric_id,
    title: fabric.title,
    sale_type: fabric.sale_type,
    price: fabric.price,
    status: fabric.status,
    ...(canSeeInternal && { reject_reason: fabric.reject_reason, remaining_length_cm: fabric.remaining_length_cm }),
    detail: {
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
      image_url: signedImageUrl(image.image_url, fabric.status),
      thumbnail_url: signedImageUrl(image.thumbnail_url, fabric.status),
      image_type: image.image_type,
      sort_order: image.sort_order,
    })),
    store: {
      storeId: store.store_id,
      store_name: store.store_name,
      store_address: store.store_address,
      store_phone: store.store_phone,
      closed_days: store.closed_days,
      pickup_guide: store.pickup_guide,
    },
    availability: {
      is_reserved: Boolean(sheets?.isReserved),
      available_length_cm: isScrap ? null : fabric.remaining_length_cm - fabric.reserved_length_cm,
      reserved_length_cm: isScrap ? null : fabric.reserved_length_cm,
      available_sheet_count: sheets ? sheets.available : null,
      reserved_sheet_count: sheets ? sheets.held : null,
    },
    created_at: toKstIso(fabric.created_at),
  };
};

// viewer 는 로그인하지 않았으면 undefined 다.
// 게시 중이 아닌 원단은 그 원단의 판매자(매장 주인)와 운영팀만 볼 수 있고, 나머지는 NOT_FOUND 다. 삭제된 원단과 없는 원단은 누구에게나 NOT_FOUND 다.
// 원단상세가 없는 원단은 보여 줄 내용이 없어서 목록(10번)처럼 없는 원단으로 본다.
export async function getFabric(viewer, fabricId) {
  const fabric = await fabricsReadDao.findDetailById(fabricId, { reservationStatus: RESERVING_STATUS });
  if (!fabric || !fabric.detail) throw fail('NOT_FOUND');
  const canSeeInternal = viewer?.role === 'ADMIN' || viewer?.userId === fabric.store.user_id;
  if (fabric.status !== LISTED_STATUS && !canSeeInternal) throw fail('NOT_FOUND');
  return toFabricDetail(fabric, canSeeInternal);
}

// 내 원단 목록 (명세서 14번). 원단 목록(10번) 항목에 status, reject_reason, active_reservation_count 를 더한다.
// reject_reason 은 반려된 원단에만 값이 있고 나머지는 null 이다.
// 매장을 아직 등록하지 않은 판매자는 빈 목록이다. (14번 오류 표에 매장이 없을 때 쓸 코드가 없어서 정했다)
export async function listMyFabrics(userId, { status, page, size }) {
  const store = await storesDao.findByUserId(userId);
  const { rows, count, activeCounts } = store
    ? await fabricsReadDao.findPageByStore({
      storeId: store.store_id,
      status,
      reservationStatus: RESERVING_STATUS,
      activeStatuses: ACTIVE_RESERVATION_STATUSES,
      limit: size,
      offset: page * size,
    })
    : { rows: [], count: 0, activeCounts: {} };
  return {
    content: rows.map((fabric) => ({
      ...toFabricSummary(fabric),
      status: fabric.status,
      reject_reason: fabric.reject_reason,
      active_reservation_count: activeCounts[fabric.fabric_id] ?? 0,
    })),
    page,
    size,
    totalElements: count,
    totalPages: Math.ceil(count / size),
  };
}
