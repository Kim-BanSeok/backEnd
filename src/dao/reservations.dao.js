import { Op } from 'sequelize';
import db from '../models/index.js';

const ACTIVE = ['REQUESTED', 'ACCEPTED']; // 진행 중인 예약

// options 로 { transaction } 을 받는다. 없으면 null 을 돌려준다.

// 진행 중인 예약(요청됨·수락됨)의 개수. 원단을 삭제해도 되는지 확인할 때 쓴다.
export const countActiveByFabric = (fabricId, options = {}) =>
  db.Reservation.count({ where: { fabric_id: fabricId, status: { [Op.in]: ACTIVE } }, ...options });

export const findById = (reservationId, options = {}) => db.Reservation.findByPk(reservationId, options);

export const insert = (values, options = {}) => db.Reservation.create(values, options);

export const update = (reservation, values, options = {}) => reservation.update(values, options);

// 같은 구매자가 같은 원단에 요청됨·수락됨 예약을 이미 갖고 있는지
export const existsActiveByBuyer = async (buyerId, fabricId, options = {}) =>
  (await db.Reservation.count({
    where: { buyer_id: buyerId, fabric_id: fabricId, status: { [Op.in]: ACTIVE } },
    ...options,
  })) > 0;

// 그 원단에 이미 수락된 예약이 있는지 (자투리는 수락된 예약이 있는 동안 "예약 중")
export const existsAcceptedByFabric = async (fabricId, options = {}) =>
  (await db.Reservation.count({ where: { fabric_id: fabricId, status: 'ACCEPTED' }, ...options })) > 0;

// 판매 완료가 된 원단에 남은 요청됨 예약을 모두 거절한다. 거절한 개수를 돌려준다.
export const rejectRequestedByFabric = async (fabricId, reason, options = {}) => {
  const [count] = await db.Reservation.update(
    { status: 'REJECTED', reject_reason: reason },
    { where: { fabric_id: fabricId, status: 'REQUESTED' }, ...options },
  );
  return count;
};

// 목록용: 원단(삭제된 원단도 기록으로 남기므로 paranoid: false)과 매장, 구매자를 함께 읽는다. 최근 요청부터. { rows, count } 를 돌려준다.
const listIncludes = [
  { model: db.Fabric, as: 'fabric', paranoid: false, include: [{ model: db.Store, as: 'store' }] },
  { model: db.User, as: 'buyer', attributes: ['user_id', 'nickname'] },
];
const newestFirst = [['created_at', 'DESC'], ['reservation_id', 'DESC']];

export const listByBuyer = ({ buyerId, status, limit, offset }, options = {}) =>
  db.Reservation.findAndCountAll({
    where: { buyer_id: buyerId, ...(status && { status }) },
    include: listIncludes,
    order: newestFirst,
    limit,
    offset,
    ...options,
  });

export const listBySeller = ({ sellerId, status, fabricId, limit, offset }, options = {}) =>
  db.Reservation.findAndCountAll({
    where: { seller_id: sellerId, ...(status && { status }), ...(fabricId && { fabric_id: fabricId }) },
    include: listIncludes,
    order: newestFirst,
    limit,
    offset,
    ...options,
  });

// 상세용: 원단 요약, 매장 픽업 정보, 구매자 닉네임, 도안 이름을 함께 읽는다.
export const findDetail = (reservationId, options = {}) =>
  db.Reservation.findByPk(reservationId, {
    include: [
      ...listIncludes,
      { model: db.Pattern, as: 'pattern', attributes: ['pattern_id', 'pattern_name'] },
    ],
    ...options,
  });
