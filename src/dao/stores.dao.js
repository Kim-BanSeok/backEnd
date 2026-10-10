import db from '../models/index.js';

// 없으면 null 을 돌려준다. options 로 { transaction } 을 받는다.
export const findById = (storeId, options = {}) => db.Store.findByPk(storeId, options);

export const findByUserId = (userId, options = {}) => db.Store.findOne({ where: { user_id: userId }, ...options });

export const insert = (values, options = {}) => db.Store.create(values, options);

export const update = (store, values, options = {}) => store.update(values, options);
