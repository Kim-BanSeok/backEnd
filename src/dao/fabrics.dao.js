import db from '../models/index.js';

// options 로 { transaction } 을 받는다. 원단과 원단상세를 한 트랜잭션으로 저장할 때 같은 transaction 을 넘긴다.
export const insertFabric = (values, options = {}) => db.Fabric.create(values, options);

export const insertDetail = (values, options = {}) => db.FabricDetail.create(values, options);

// 삭제된 원단은 찾지 않는다 (null).
export const findById = (fabricId, options = {}) => db.Fabric.findByPk(fabricId, options);

// 원단 행을 잠근다 (SELECT ... FOR UPDATE). 같은 원단을 동시에 바꾸는 요청을 한 줄로 세운다. 트랜잭션 안에서만 쓴다.
export const lockById = (fabricId, { transaction }) =>
  db.Fabric.findByPk(fabricId, { transaction, lock: transaction.LOCK.UPDATE });
