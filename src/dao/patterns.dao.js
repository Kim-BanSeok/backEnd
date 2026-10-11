import { Op } from 'sequelize';
import db from '../models/index.js';

// LIKE 의 특수 문자(\, %, _)를 글자 그대로 찾도록 바꾼다.
const escapeLike = (text) => text.replace(/[\\%_]/g, '\\$&');

// 도안과 부품을 함께 읽는다. 부품은 등록 순(part_id)이다. 없으면 null 을 돌려준다.
// 사용 중인지(is_active)는 보지 않고 그대로 돌려준다. 보여 줄지는 services 가 정한다.
export const findByIdWithParts = (patternId, options = {}) =>
  db.Pattern.findByPk(patternId, {
    include: [{ model: db.PatternPart, as: 'parts' }],
    order: [[{ model: db.PatternPart, as: 'parts' }, 'part_id', 'ASC']],
    ...options,
  });

// 받은 조건에 맞는 도안을 한 페이지만 읽는다. { rows, count } 를 돌려준다.
// isActive 가 true/false 면 그 상태만, 안 주면 모두. 어떤 도안을 보여 줄지는 services 가 정한다.
// category 는 정확히 같은 값, keyword 는 이름·별칭에 들어 있는 값(대소문자 무관)을 찾는다.
export const findPage = ({ isActive, category, keyword, limit, offset }, options = {}) => {
  const where = {};
  if (isActive !== undefined) where.is_active = isActive;
  if (category) where.category = category;
  if (keyword) {
    const like = { [Op.iLike]: `%${escapeLike(keyword)}%` };
    where[Op.or] = [{ pattern_name: like }, { aliases: like }];
  }
  return db.Pattern.findAndCountAll({ where, order: [['pattern_id', 'ASC']], limit, offset, ...options });
};
