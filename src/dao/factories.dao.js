import db from '../models/index.js';

// 공장 전체를 등록 순으로 읽는다. 업종 분류는 컬럼이 아니라 생산품 문장으로 정하므로, 거르는 일은 service 가 한다.
export const findAll = (options = {}) => db.Factory.findAll({ order: [['factory_id', 'ASC']], ...options });
