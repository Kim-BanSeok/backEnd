import db from '../models/index.js';

// options 로 { transaction } 을 받는다. 원단과 원단상세를 한 트랜잭션으로 저장할 때 같은 transaction 을 넘긴다.
export const insertFabric = (values, options = {}) => db.Fabric.create(values, options);

export const insertDetail = (values, options = {}) => db.FabricDetail.create(values, options);

// 삭제된 원단은 찾지 않는다 (null).
export const findById = (fabricId, options = {}) => db.Fabric.findByPk(fabricId, options);

// 운영팀 목록용: 상태가 같은 원단을 오래된 순(만든 시각, 같으면 번호)으로 한 페이지 읽고, 상세·사진·매장 이름을 함께 붙인다.
// { rows, count } 를 돌려준다. 삭제된 원단은 빠진다.
// 목록 "개수"가 사진 수에 흔들리지 않게, 번호만 먼저 한 페이지 고른 뒤 그 번호로 상세를 읽는다.
export const findAdminPage = async ({ status, limit, offset }, options = {}) => {
  const { rows: ids, count } = await db.Fabric.findAndCountAll({
    where: { status },
    attributes: ['fabric_id'],
    order: [['created_at', 'ASC'], ['fabric_id', 'ASC']],
    limit,
    offset,
    ...options,
  });
  if (ids.length === 0) return { rows: [], count };

  const rows = await db.Fabric.findAll({
    where: { fabric_id: ids.map((row) => row.fabric_id) },
    include: [
      { model: db.Store, as: 'store', attributes: ['store_name'] },
      { model: db.FabricDetail, as: 'detail' },
      { model: db.FabricImage, as: 'images' },
    ],
    order: [
      ['created_at', 'ASC'],
      ['fabric_id', 'ASC'],
      [{ model: db.FabricImage, as: 'images' }, 'sort_order', 'ASC'],
    ],
    ...options,
  });
  return { rows, count };
};

export const update = (fabric, values, options = {}) => fabric.update(values, options);

// 원단 행을 잠근다 (SELECT ... FOR UPDATE). 같은 원단을 동시에 바꾸는 요청을 한 줄로 세운다. 트랜잭션 안에서만 쓴다.
export const lockById = (fabricId, { transaction }) =>
  db.Fabric.findByPk(fabricId, { transaction, lock: transaction.LOCK.UPDATE });
