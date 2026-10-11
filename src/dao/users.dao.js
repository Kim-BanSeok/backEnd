import db from '../models/index.js';

// dao 는 SQL(모델 호출)만 한다. "안 된다"는 판단은 services 가 한다. 없으면 null 을 돌려준다.
// options 로 { transaction } 을 받아 services 의 트랜잭션 안에서 쓸 수 있다.
export const findById = (userId, options = {}) => db.User.findByPk(userId, options);

export const findByEmail = (email, options = {}) => db.User.findOne({ where: { email }, ...options });

export const insert = (values, options = {}) => db.User.create(values, options);

export const update = (user, values, options = {}) => user.update(values, options);

// 운영팀 목록용: 승인 상태가 같은 판매자를 오래된 순으로 한 페이지 읽고, 매장 정보를 함께 붙인다. (매장이 없으면 store 는 null)
// 탈퇴한 회원은 빠진다. { rows, count } 를 돌려준다.
// role 조건은 의도를 드러내는 방어 겹침이다. 구매자·운영팀은 DB 제약(chk_users_seller_status)으로 승인 상태를 가질 수 없어
// 이 조건이 없어도 결과는 같다. (그래서 이 조건만 뺀 코드를 테스트로 구별할 수 없다)
export const findSellerPage = ({ status, limit, offset }, options = {}) =>
  db.User.findAndCountAll({
    where: { role: 'SELLER', seller_approval_status: status },
    include: [{ model: db.Store, as: 'store' }],
    order: [['created_at', 'ASC'], ['user_id', 'ASC']],
    limit,
    offset,
    ...options,
  });

// 판매자만 찾는다 (구매자·운영팀·탈퇴 회원은 null). 트랜잭션 안에서 행을 잠근다. (SELECT ... FOR UPDATE)
// 매장을 함께 읽으면 바깥 조인 때문에 잠글 수 없어서 회원 행만 읽는다.
export const lockSellerById = (userId, { transaction }) =>
  db.User.findOne({ where: { user_id: userId, role: 'SELLER' }, transaction, lock: transaction.LOCK.UPDATE });
