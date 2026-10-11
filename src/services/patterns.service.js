import { fail } from '../utils/errors.js';
import * as patternsDao from '../dao/patterns.dao.js';

// 도안 목록 항목 (명세서 22번). description, reviewed_by, is_active, 날짜는 넣지 않는다.
export const toPatternSummary = (pattern) => ({
  patternId: pattern.pattern_id,
  pattern_name: pattern.pattern_name,
  aliases: pattern.aliases,
  category: pattern.category,
  image_url: pattern.image_url,
  allowed_materials: pattern.allowed_materials,
  allowed_thickness: pattern.allowed_thickness,
});

// 사용 중인 도안만 보여 준다. 정렬은 등록 순(pattern_id 오름차순).
export async function listPatterns({ category, keyword, page, size }) {
  const { rows, count } = await patternsDao.findPage({
    isActive: true,
    category,
    keyword,
    limit: size,
    offset: page * size,
  });
  return {
    content: rows.map(toPatternSummary),
    page,
    size,
    totalElements: count,
    totalPages: Math.ceil(count / size),
  };
}

// 도안 상세 (명세서 23번). 부품은 part_name, width_cm, height_cm, quantity 만 넣는다. (part_id, pattern_id 는 넣지 않는다)
export const toPatternDetail = (pattern) => ({
  patternId: pattern.pattern_id,
  pattern_name: pattern.pattern_name,
  aliases: pattern.aliases,
  category: pattern.category,
  description: pattern.description,
  image_url: pattern.image_url,
  allowed_materials: pattern.allowed_materials,
  allowed_thickness: pattern.allowed_thickness,
  reviewed_by: pattern.reviewed_by,
  parts: pattern.parts.map((part) => ({
    part_name: part.part_name,
    width_cm: part.width_cm,
    height_cm: part.height_cm,
    quantity: part.quantity,
  })),
});

// 없는 도안과 사용 중이 아닌 도안은 똑같이 NOT_FOUND 다. (사용 중이 아닌 도안이 있는지도 알려 주지 않는다)
export async function getPattern(patternId) {
  const pattern = await patternsDao.findByIdWithParts(patternId);
  if (!pattern || !pattern.is_active) throw fail('NOT_FOUND');
  return toPatternDetail(pattern);
}
