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

// 판매자가 받은 문의를 최근 문의가 먼저 오게 한 페이지만 읽는다. { rows, count } 를 돌려준다.
// status 가 있으면 그 상태만, 없으면 모두. 삭제한 문의는 자동으로 빠진다. 탈퇴한 구매자는 buyer 가 null 로 온다.
// includeDeletedFabric 이 true 면 삭제된 원단도 함께 읽어 제목을 채운다. 보여 줄지는 services 가 정한다.
export const findPageBySeller = ({ sellerId, status, includeDeletedFabric, limit, offset }, options = {}) => {
  const where = { seller_id: sellerId };
  if (status) where.status = status;
  return db.Inquiry.findAndCountAll({
    where,
    include: [
      { model: db.User, as: 'buyer', attributes: ['user_id', 'nickname'] },
      { model: db.Fabric, as: 'fabric', attributes: ['fabric_id', 'title'], paranoid: !includeDeletedFabric },
    ],
    order: [['created_at', 'DESC'], ['inquiry_id', 'DESC']],
    limit,
    offset,
    ...options,
  });
};

// 삭제한 문의는 찾지 않는다 (null). 누구의 문의인지는 services 가 확인한다.
export const findById = (inquiryId, options = {}) => db.Inquiry.findByPk(inquiryId, options);

export const update = (inquiry, values, options = {}) => inquiry.update(values, options);

// 삭제 표시(deleted_at)만 한다. 행은 지우지 않는다.
export const remove = (inquiry, options = {}) => inquiry.destroy(options);
