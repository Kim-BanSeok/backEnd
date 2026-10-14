import sequelize from '../db/connection.js';
import { fail } from '../utils/errors.js';
import { toKstIso } from '../utils/response.js';
import * as fabricsDao from '../dao/fabrics.dao.js';
import * as imagesDao from '../dao/images.dao.js';
import * as patternsDao from '../dao/patterns.dao.js';
import * as reservationsDao from '../dao/reservations.dao.js';
import * as storesDao from '../dao/stores.dao.js';
import { scrapStock } from './sheetStock.js';
import { signedImageUrl } from './imageAccess.service.js';

const ROLL_UNIT_CM = 90; // 롤은 1마(90cm) 단위로 사고판다
const INT_MAX = 2147483647;
const SOLD_OUT_REASON = '판매 완료';
const ACTIVE_RESERVATION_INDEX = 'reservations_buyer_fabric_active_unique';

const pageOf = ({ rows, count }, page, size, toItem) => ({
  content: rows.map(toItem),
  page,
  size,
  totalElements: count,
  totalPages: Math.ceil(count / size),
});

// ==== 25. 예약 요청

// 재고는 확보하지 않는다. 판매자가 수락해야 확보된다. 원단 행을 잠근 채로 확인하고 만들어서,
// 같은 구매자가 동시에 눌러도 하나만 만들어지고 다른 요청이 재고를 바꾸는 중에 읽지도 않는다.
export async function createReservation(userId, input) {
  return sequelize.transaction(async (transaction) => {
    const fabric = await fabricsDao.lockById(input.fabric_id, { transaction });
    if (!fabric) throw fail('NOT_FOUND');
    if (fabric.status !== 'POSTED') throw fail('FABRIC_NOT_AVAILABLE');

    if (input.pattern_id !== null) {
      const pattern = await patternsDao.findByIdWithParts(input.pattern_id, { transaction });
      if (!pattern || !pattern.is_active) throw fail('NOT_FOUND'); // 사용 중인 도안만 고를 수 있다
    }

    const requested = input.requested_length_cm;
    let requestedSheets = null;
    if (fabric.sale_type === 'SCRAP') {
      if (requested !== null) {
        throw fail('VALIDATION_ERROR', [{ field: 'requested_length_cm', message: '자투리는 구매할 길이를 보내지 않아요' }]);
      }
      requestedSheets = input.requested_sheet_count ?? 1;
    } else if (input.requested_sheet_count !== null && input.requested_sheet_count !== undefined) {
      throw fail('VALIDATION_ERROR', [{ field: 'requested_sheet_count', message: '롤은 구매할 장수를 보내지 않아요' }]);
    } else {
      if (requested === null) {
        throw fail('VALIDATION_ERROR', [{ field: 'requested_length_cm', message: '롤은 구매할 길이(cm)를 보내 주세요' }]);
      }
      if (requested % ROLL_UNIT_CM !== 0) throw fail('LENGTH_NOT_MULTIPLE_OF_90');
    }

    // 내가 이미 요청·수락된 예약을 갖고 있으면 재고보다 먼저 알려 준다.
    if (await reservationsDao.existsActiveByBuyer(userId, fabric.fabric_id, { transaction })) {
      throw fail('DUPLICATE_RESERVATION');
    }

    let estimatedPrice;
    if (fabric.sale_type === 'SCRAP') {
      const detail = await fabricsDao.findDetailByFabric(fabric.fabric_id, { transaction });
      const stock = scrapStock(fabric, detail);
      if (requestedSheets > stock.available) throw fail(stock.available < 1 ? 'SCRAP_ALREADY_RESERVED' : 'INSUFFICIENT_SHEETS');
      estimatedPrice = fabric.price * requestedSheets;
      if (estimatedPrice > INT_MAX) {
        throw fail('VALIDATION_ERROR', [{ field: 'requested_sheet_count', message: '예상 금액이 너무 커요' }]);
      }
    } else {
      const available = fabric.remaining_length_cm - fabric.reserved_length_cm; // 구매 가능 길이
      if (requested > available) throw fail('INSUFFICIENT_LENGTH');
      // 예상 금액 = 90cm당 가격 x 마 수. 요청 시점의 가격으로 고정되어, 판매자가 나중에 가격을 바꿔도 변하지 않는다.
      estimatedPrice = fabric.price * (requested / ROLL_UNIT_CM);
      if (estimatedPrice > INT_MAX) {
        throw fail('VALIDATION_ERROR', [{ field: 'requested_length_cm', message: '예상 금액이 너무 커요' }]);
      }
    }

    const store = await storesDao.findById(fabric.store_id, { transaction });
    const reservation = await reservationsDao.insert(
      {
        fabric_id: fabric.fabric_id,
        buyer_id: userId,
        seller_id: store.user_id, // 조회 편의용 (원단의 판매자)
        pattern_id: input.pattern_id,
        requested_length_cm: requested,
        requested_sheet_count: requestedSheets,
        estimated_price: estimatedPrice,
        pickup_at: input.pickup_at,
        memo: input.memo,
      },
      { transaction },
    );
    return {
      reservationId: reservation.reservation_id,
      status: reservation.status,
      estimated_price: reservation.estimated_price,
    };
  }).catch((error) => {
    // 트랜잭션 롤백이 끝난 뒤 이 인덱스의 충돌만 기존 중복 예약 응답으로 바꾼다.
    const violation = error.original ?? error.parent;
    if (violation?.code === '23505' && violation.constraint === ACTIVE_RESERVATION_INDEX) {
      throw fail('DUPLICATE_RESERVATION');
    }
    throw error;
  });
}

// ==== 26, 27. 예약 목록

const coversOf = (rows) => imagesDao.findCoversByFabrics([...new Set(rows.map((row) => row.fabric_id))]);

export async function listMyReservations(userId, { status, page, size }) {
  const result = await reservationsDao.listByBuyer({ buyerId: userId, status, limit: size, offset: page * size });
  const covers = await coversOf(result.rows);

  return pageOf(result, page, size, (r) => ({
    reservationId: r.reservation_id,
    status: r.status,
    pickup_at: toKstIso(r.pickup_at),
    requested_length_cm: r.requested_length_cm,
    requested_sheet_count: r.requested_sheet_count,
    estimated_price: r.estimated_price,
    reject_reason: r.reject_reason,
    fabricId: r.fabric_id,
    title: r.fabric.title,
    thumbnail_url: r.fabric.deleted_at ? null : signedImageUrl(covers[r.fabric_id]?.thumbnail_url, r.fabric.status),
    store_name: r.fabric.store.store_name,
    // 수락된 예약에는 픽업 장소와 안내가 함께 온다.
    ...(r.status === 'ACCEPTED' && {
      store_address: r.fabric.store.store_address,
      pickup_guide: r.fabric.store.pickup_guide,
    }),
  }));
}

// 구매자의 전화번호는 주지 않고 닉네임만 보여 준다.
export async function listReceivedReservations(userId, { status, fabric_id: fabricId, page, size }) {
  const result = await reservationsDao.listBySeller({ sellerId: userId, status, fabricId, limit: size, offset: page * size });
  return pageOf(result, page, size, (r) => ({
    reservationId: r.reservation_id,
    status: r.status,
    pickup_at: toKstIso(r.pickup_at),
    memo: r.memo,
    requested_length_cm: r.requested_length_cm,
    requested_sheet_count: r.requested_sheet_count,
    estimated_price: r.estimated_price,
    fabricId: r.fabric_id,
    title: r.fabric.title,
    buyer_nickname: r.buyer.nickname,
  }));
}

// ==== 28. 예약 상세

// 예약한 구매자와 그 원단의 판매자(당사자)만 볼 수 있다.
export async function getReservation(userId, reservationId) {
  const r = await reservationsDao.findDetail(reservationId);
  if (!r) throw fail('NOT_FOUND');
  if (r.buyer_id !== userId && r.seller_id !== userId) throw fail('FORBIDDEN');

  const covers = await coversOf([r]);
  const { fabric } = r;
  const { store } = fabric;
  return {
    reservationId: r.reservation_id,
    status: r.status,
    pickup_at: toKstIso(r.pickup_at),
    memo: r.memo,
    requested_length_cm: r.requested_length_cm,
    requested_sheet_count: r.requested_sheet_count,
    estimated_price: r.estimated_price,
    reject_reason: r.reject_reason,
    canceled_by: r.canceled_by,
    accepted_at: toKstIso(r.accepted_at),
    picked_up_at: toKstIso(r.picked_up_at),
    canceled_at: toKstIso(r.canceled_at),
    created_at: toKstIso(r.created_at),
    buyer_nickname: r.buyer.nickname,
    pattern_name: r.pattern?.pattern_name ?? null,
    fabric: {
      fabricId: fabric.fabric_id,
      title: fabric.title,
      sale_type: fabric.sale_type,
      status: fabric.status,
      thumbnail_url: fabric.deleted_at ? null : signedImageUrl(covers[fabric.fabric_id]?.thumbnail_url, fabric.status),
    },
    store: {
      store_name: store.store_name,
      store_address: store.store_address,
      store_phone: store.store_phone,
      closed_days: store.closed_days,
      pickup_guide: store.pickup_guide,
    },
  };
}

// ==== 29~32. 상태 전환

// 예약의 당사자인지 확인하고 'BUYER' 나 'SELLER' 를 돌려준다. 당사자가 아니면 FORBIDDEN.
const partyOf = (reservation, userId) => {
  if (reservation.buyer_id === userId) return 'BUYER';
  if (reservation.seller_id === userId) return 'SELLER';
  throw fail('FORBIDDEN');
};
const sellerOnly = (reservation, userId) => {
  if (reservation.seller_id !== userId) throw fail('FORBIDDEN');
  return 'SELLER';
};

// 같은 원단의 예약은 모두 한 줄로 처리한다.
//  ① 예약을 찾고(404) 당사자인지 확인한다(403). 남의 예약의 상태는 알려 주지 않는다.
//  ② 원단 행을 잠근다. 예약 요청·수락·취소·수령, 원단 수정·삭제가 모두 이 잠금을 먼저 잡는다.
//  ③ 잠금을 잡은 뒤 예약을 다시 읽는다. 기다리는 사이에 상태가 바뀌었을 수 있다.
async function transition(userId, reservationId, authorize, work) {
  const initial = await reservationsDao.findById(reservationId);
  if (!initial) throw fail('NOT_FOUND');
  const party = authorize(initial, userId);

  return sequelize.transaction(async (transaction) => {
    // 끝난 예약이 남은 삭제된 원단도 잠글 수 있어야 한다. (그 예약은 상태 때문에 INVALID_STATUS 로 거절된다)
    const fabric = await fabricsDao.lockById(initial.fabric_id, { transaction, paranoid: false });
    const reservation = await reservationsDao.findById(reservationId, { transaction });
    return work({ reservation, fabric, party, transaction });
  });
}

const result = (reservation) => ({ reservationId: reservation.reservation_id, status: reservation.status });

// 29. 예약 수락: 요청됨만. 이때 재고를 확보한다. 요청한 뒤 다른 예약이 먼저 수락됐다면 재고를 다시 확인해서 거절한다.
export const acceptReservation = (userId, reservationId, { pickup_at: pickupAt }) =>
  transition(userId, reservationId, sellerOnly, async ({ reservation, fabric, transaction }) => {
    if (reservation.status !== 'REQUESTED') throw fail('INVALID_STATUS');
    if (fabric.status !== 'POSTED') throw fail('INVALID_STATUS');

    if (fabric.sale_type === 'SCRAP') {
      const detail = await fabricsDao.findDetailByFabric(fabric.fabric_id, { transaction });
      const stock = scrapStock(fabric, detail);
      const sheets = reservation.requested_sheet_count ?? 1;
      if (sheets > stock.available) throw fail(stock.available < 1 ? 'SCRAP_ALREADY_RESERVED' : 'INSUFFICIENT_SHEETS');
      await fabricsDao.update(fabric, { reserved_sheet_count: stock.held + sheets }, { transaction });
    } else {
      const requested = reservation.requested_length_cm;
      if (requested > fabric.remaining_length_cm - fabric.reserved_length_cm) throw fail('INSUFFICIENT_LENGTH');
      await fabricsDao.update(fabric, { reserved_length_cm: fabric.reserved_length_cm + requested }, { transaction });
    }

    await reservationsDao.update(
      reservation,
      { status: 'ACCEPTED', accepted_at: new Date(), ...(pickupAt && { pickup_at: pickupAt }) },
      { transaction },
    );
    return result(reservation);
  });

// 30. 예약 거절: 요청됨만. 사유 필수. 재고는 변하지 않는다.
export const rejectReservation = (userId, reservationId, reason) =>
  transition(userId, reservationId, sellerOnly, async ({ reservation, transaction }) => {
    if (reservation.status !== 'REQUESTED') throw fail('INVALID_STATUS');
    await reservationsDao.update(reservation, { status: 'REJECTED', reject_reason: reason }, { transaction });
    return result(reservation);
  });

// 31. 예약 취소: 구매자는 요청됨·수락됨, 판매자는 수락됨만 (요청됨은 거절을 쓴다). 수락된 예약을 취소하면 확보한 재고가 풀린다.
const CANCELABLE = { BUYER: ['REQUESTED', 'ACCEPTED'], SELLER: ['ACCEPTED'] };

export const cancelReservation = (userId, reservationId) =>
  transition(userId, reservationId, partyOf, async ({ reservation, fabric, party, transaction }) => {
    if (!CANCELABLE[party].includes(reservation.status)) throw fail('INVALID_STATUS');

    if (reservation.status === 'ACCEPTED' && fabric.sale_type === 'ROLL') {
      // 확보했던 길이를 돌려준다. (0 아래로 내려가지 않게 한다)
      const released = Math.max(0, fabric.reserved_length_cm - reservation.requested_length_cm);
      await fabricsDao.update(fabric, { reserved_length_cm: released }, { transaction });
    }
    if (reservation.status === 'ACCEPTED' && fabric.sale_type === 'SCRAP') {
      const sheets = reservation.requested_sheet_count ?? 1;
      await fabricsDao.update(fabric, { reserved_sheet_count: Math.max(0, (fabric.reserved_sheet_count || 0) - sheets) }, { transaction });
    }
    await reservationsDao.update(
      reservation,
      { status: 'CANCELED', canceled_by: party, canceled_at: new Date() },
      { transaction },
    );
    return result(reservation);
  });

// 32. 수령 확인: 수락됨만. 이때 재고를 차감한다.
//  자투리는 요청 장수만 줄고, 0장이 되면 판매 완료가 된다. 롤은 남은 길이와 확보 길이가 요청 길이만큼 줄고, 남은 길이가 90cm 미만이면 판매 완료가 된다.
//  판매 완료가 되면 그 원단에 남은 요청됨 예약은 "판매 완료" 사유로 자동 거절된다.
export const confirmPickup = (userId, reservationId) =>
  transition(userId, reservationId, sellerOnly, async ({ reservation, fabric, transaction }) => {
    if (reservation.status !== 'ACCEPTED') throw fail('INVALID_STATUS');

    let soldOut;
    if (fabric.sale_type === 'SCRAP') {
      const detail = await fabricsDao.findDetailByFabric(fabric.fabric_id, { transaction });
      const stock = scrapStock(fabric, detail);
      const sheets = reservation.requested_sheet_count ?? 1;
      const next = stock.total - sheets;
      soldOut = next < 1;
      if (detail && Number.isInteger(detail.sheet_count) && next >= 1) {
        await fabricsDao.updateDetail(detail, { sheet_count: next }, { transaction });
      }
      await fabricsDao.update(
        fabric,
        { reserved_sheet_count: Math.max(0, (fabric.reserved_sheet_count || 0) - sheets), ...(soldOut && { status: 'SOLD_OUT' }) },
        { transaction },
      );
    } else {
      const requested = reservation.requested_length_cm;
      const remaining = fabric.remaining_length_cm - requested;
      soldOut = remaining < ROLL_UNIT_CM;
      await fabricsDao.update(
        fabric,
        {
          remaining_length_cm: remaining,
          reserved_length_cm: Math.max(0, fabric.reserved_length_cm - requested),
          ...(soldOut && { status: 'SOLD_OUT' }),
        },
        { transaction },
      );
    }

    await reservationsDao.update(reservation, { status: 'PICKED_UP', picked_up_at: new Date() }, { transaction });
    if (soldOut) await reservationsDao.rejectRequestedByFabric(fabric.fabric_id, SOLD_OUT_REASON, { transaction });
    return result(reservation);
  });
