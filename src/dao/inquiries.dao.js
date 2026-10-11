import db from '../models/index.js';

// dao 는 모델 호출만 한다. "안 된다"는 판단은 services 가 한다.
// options 로 { transaction } 을 받는다.
export const insert = (values, options = {}) => db.Inquiry.create(values, options);

// 원단의 문의를 최근 문의가 먼저 오게 한 페이지만 읽는다. { rows, count } 를 돌려준다.
// 삭제한 문의는 자동으로 빠진다. 탈퇴한 구매자는 buyer 가 null 로 온다.
export const findPageByFabric = ({ fabricId, limit, offset }, options = {}) =>
  db.Inquiry.findAndCountAll({
    where: { fabric_id: fabricId },
    include: [{ model: db.User, as: 'buyer', attributes: ['user_id', 'nickname'] }],
    order: [['created_at', 'DESC'], ['inquiry_id', 'DESC']],
    limit,
    offset,
    ...options,
  });
