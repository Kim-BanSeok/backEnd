import db from '../models/index.js';

// 추천에 쓸 사용 중(is_active)인 도안 전체를 부품과 함께 읽는다. 도안은 등록 순이다. options 로 { transaction } 을 받는다.
export const listActivePatternsWithParts = (options = {}) =>
  db.Pattern.findAll({
    where: { is_active: true },
    include: [{ model: db.PatternPart, as: 'parts' }],
    order: [['pattern_id', 'ASC']],
    ...options,
  });
