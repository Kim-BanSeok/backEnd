import { Op } from 'sequelize';
import db from '../models/index.js';

// LIKE 의 특수 문자(\, %, _)를 글자 그대로 찾도록 바꾼다.
const escapeLike = (text) => text.replace(/[\\%_]/g, '\\$&');

// 정렬: 같은 값이면 최신순으로 한 번 더 정해서 페이지를 넘겨도 순서가 흔들리지 않게 한다.
const NEWEST = [['created_at', 'DESC'], ['fabric_id', 'DESC']];
const ORDERS = {
  latest: NEWEST,
  price_asc: [['price', 'ASC'], ...NEWEST],
  price_desc: [['price', 'DESC'], ...NEWEST],
};

// 목록 항목에 필요한 것(상세·매장 이름·대표 사진(sort_order 0)·예약)을 붙여 읽고, 받은 번호 순서대로 돌려준다.
// 예약은 reservationStatus 인 것만 읽는다.
const readSummaries = async (fabricIds, reservationStatus, options) => {
  const found = await db.Fabric.findAll({
    where: { fabric_id: fabricIds },
    include: [
      { model: db.Store, as: 'store', attributes: ['store_name'] },
      { model: db.FabricDetail, as: 'detail' },
      { model: db.FabricImage, as: 'images', where: { sort_order: 0 }, required: false },
      { model: db.Reservation, as: 'reservations', where: { status: reservationStatus }, attributes: ['reservation_id'], required: false },
    ],
    ...options,
  });
  const byId = new Map(found.map((fabric) => [fabric.fabric_id, fabric]));
  return fabricIds.map((id) => byId.get(id));
};

// 받은 상태의 원단을 받은 조건으로 걸러 한 페이지만 읽는다. { rows, count } 를 돌려준다. 어떤 상태를 보여 줄지는 services 가 정한다.
// 삭제된 원단은 자동으로 빠진다. 소재·두께·색상 계열은 값 목록 중 하나와 같으면 되고, keyword 는 제목에 들어 있는 값(대소문자 무관)이다.
// 목록 "개수"가 사진·예약 수에 흔들리지 않게, 번호만 먼저 한 페이지 고른 뒤 그 번호로 상세를 읽는다.
export const findPage = async (
  { status, reservationStatus, saleType, material, thickness, colorFamily, keyword, sort, limit, offset },
  options = {},
) => {
  const where = { status, sale_type: saleType };
  if (keyword) where.title = { [Op.iLike]: `%${escapeLike(keyword)}%` };

  const detailWhere = {};
  if (material) detailWhere.material = material;
  if (thickness) detailWhere.thickness = thickness;
  if (colorFamily) detailWhere.color_family = colorFamily;

  const { rows: ids, count } = await db.Fabric.findAndCountAll({
    where,
    include: [{ model: db.FabricDetail, as: 'detail', attributes: [], required: true, where: detailWhere }],
    attributes: ['fabric_id'],
    order: ORDERS[sort],
    limit,
    offset,
    ...options,
  });
  if (ids.length === 0) return { rows: [], count };

  return { rows: await readSummaries(ids.map((row) => row.fabric_id), reservationStatus, options), count };
};

// 원단 한 건을 상세·사진(sort_order 순)·매장·예약과 함께 읽는다. 없거나 삭제된 원단은 null 이다.
// 누구에게 보여 줄지는 services 가 정한다. 예약은 reservationStatus 인 것만 읽는다.
export const findDetailById = (fabricId, { reservationStatus }, options = {}) =>
  db.Fabric.findByPk(fabricId, {
    include: [
      { model: db.Store, as: 'store' },
      { model: db.FabricDetail, as: 'detail' },
      { model: db.FabricImage, as: 'images' },
      { model: db.Reservation, as: 'reservations', where: { status: reservationStatus }, attributes: ['reservation_id'], required: false },
    ],
    order: [
      [{ model: db.FabricImage, as: 'images' }, 'sort_order', 'ASC'],
      [{ model: db.FabricImage, as: 'images' }, 'image_id', 'ASC'],
    ],
    ...options,
  });

// 내 매장의 원단을 최근 등록한 것이 먼저 오게 한 페이지 읽는다. { rows, count, activeCounts } 를 돌려준다.
// status 가 있으면 그 상태만, 없으면 모든 상태다. 삭제된 원단은 빠지고, 원단상세가 없는 원단은 목록(10번)처럼 뺀다.
// reservationStatus 인 예약은 rows 에 붙이고(is_reserved 용), activeStatuses 인 예약은 원단별 개수만 센다. activeCounts 는 { 원단 번호: 개수 } 이다.
export const findPageByStore = async (
  { storeId, status, reservationStatus, activeStatuses, limit, offset },
  options = {},
) => {
  const where = { store_id: storeId };
  if (status) where.status = status;

  const { rows: ids, count } = await db.Fabric.findAndCountAll({
    where,
    include: [{ model: db.FabricDetail, as: 'detail', attributes: [], required: true }],
    attributes: ['fabric_id'],
    order: NEWEST,
    limit,
    offset,
    ...options,
  });
  if (ids.length === 0) return { rows: [], count, activeCounts: {} };

  const fabricIds = ids.map((row) => row.fabric_id);
  const [rows, counted] = await Promise.all([
    readSummaries(fabricIds, reservationStatus, options),
    db.Reservation.count({ where: { fabric_id: fabricIds, status: activeStatuses }, group: ['fabric_id'], ...options }),
  ]);
  const activeCounts = Object.fromEntries(counted.map((row) => [row.fabric_id, Number(row.count)]));
  return { rows, count, activeCounts };
};
