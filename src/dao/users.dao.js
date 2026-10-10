import db from '../models/index.js';

// dao 는 SQL(모델 호출)만 한다. "안 된다"는 판단은 services 가 한다. 없으면 null 을 돌려준다.
// options 로 { transaction } 을 받아 services 의 트랜잭션 안에서 쓸 수 있다.
export const findById = (userId, options = {}) => db.User.findByPk(userId, options);

export const findByEmail = (email, options = {}) => db.User.findOne({ where: { email }, ...options });

export const insert = (values, options = {}) => db.User.create(values, options);

export const update = (user, values, options = {}) => user.update(values, options);
