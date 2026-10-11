import db from '../models/index.js';

// dao 는 모델 호출만 한다. "안 된다"는 판단은 services 가 한다. 없으면 null 을 돌려준다.
// options 로 { transaction } 을 받는다.
export const insert = (values, options = {}) => db.Favorite.create(values, options);

export const findByUserAndFabric = (userId, fabricId, options = {}) =>
  db.Favorite.findOne({ where: { user_id: userId, fabric_id: fabricId }, ...options });

export const findByUserAndPattern = (userId, patternId, options = {}) =>
  db.Favorite.findOne({ where: { user_id: userId, pattern_id: patternId }, ...options });

// 도안이 있는지만 본다. 사용 중인지(is_active)는 services 가 판단한다.
export const findPatternById = (patternId, options = {}) => db.Pattern.findByPk(patternId, options);

// 내 관심저장을 최근 저장한 순으로 한 페이지만 읽는다. { rows, count } 를 돌려준다.
// 삭제된 원단도 목록에 남아야 해서 paranoid: false 로 함께 읽는다. 사진은 첫 번째(sort_order 순)만 쓴다.
export const findPageByUser = ({ userId, targetType, limit, offset }, options = {}) => {
  const where = { user_id: userId };
  if (targetType) where.target_type = targetType;
  return db.Favorite.findAndCountAll({
    where,
    include: [
      {
        model: db.Fabric,
        as: 'fabric',
        required: false,
        paranoid: false,
        include: [{ model: db.FabricImage, as: 'images', separate: true, order: [['sort_order', 'ASC']] }],
      },
      { model: db.Pattern, as: 'pattern', required: false },
    ],
    order: [['created_at', 'DESC'], ['favorite_id', 'DESC']],
    limit,
    offset,
    distinct: true,
    ...options,
  });
};

export const findById = (favoriteId, options = {}) => db.Favorite.findByPk(favoriteId, options);

export const destroy = (favorite, options = {}) => favorite.destroy(options);
