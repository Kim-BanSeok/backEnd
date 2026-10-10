import db from '../models/index.js';

// options 로 { transaction } 을 받는다. 원단과 원단상세를 한 트랜잭션으로 저장할 때 같은 transaction 을 넘긴다.
export const insertFabric = (values, options = {}) => db.Fabric.create(values, options);

export const insertDetail = (values, options = {}) => db.FabricDetail.create(values, options);
