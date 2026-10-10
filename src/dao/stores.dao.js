import db from '../models/index.js';

// 없으면 null 을 돌려준다. options 로 { transaction } 을 받는다.
export const findByUserId = (userId, options = {}) => db.Store.findOne({ where: { user_id: userId }, ...options });
