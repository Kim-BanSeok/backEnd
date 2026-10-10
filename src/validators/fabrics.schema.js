import { z } from 'zod';
import { SALE_TYPES, MATERIALS, THICKNESSES, COLOR_FAMILIES } from '../utils/codes.js';

const INT_MAX = 2147483647; // PostgreSQL INTEGER 의 최댓값. 넘으면 DB 오류가 나므로 입력 단계에서 막는다.

// 선택 문자열: 공백을 지우고, 비어 있거나 보내지 않으면 null 로 저장한다.
const optionalText = (max) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => v || null);

const detailSchema = z.object({
  material: z
    .enum(MATERIALS)
    .nullish()
    .transform((v) => v ?? 'UNKNOWN'), // 소재를 모르면 보내지 않거나 UNKNOWN
  thickness: z.enum(THICKNESSES),
  color_family: z.enum(COLOR_FAMILIES),
  color_detail: optionalText(100),
  width_cm: z.number().int().min(1).max(1000),
  // 자투리 30~90, 롤은 보내지 않음은 값 범위가 아니라 판매 형태에 따른 규칙이라 services 가 검사한다.
  length_cm: z.number().int().min(-INT_MAX).max(INT_MAX).nullish().transform((v) => v ?? null),
  has_defect: z.boolean().default(false),
  defect_note: optionalText(255),
  blend_ratio: optionalText(100),
  weave: optionalText(50),
  grain_direction: optionalText(50),
  description: optionalText(5000),
});

export const createFabricSchema = {
  body: z.object({
    sale_type: z.enum(SALE_TYPES),
    title: z.string().trim().min(1).max(100),
    price: z.number().int().min(1).max(INT_MAX),
    // 롤은 90 이상: ROLL_LENGTH_REQUIRED 로 알려야 해서 services 가 검사한다.
    remaining_length_cm: z.number().int().min(-INT_MAX).max(INT_MAX).nullish().transform((v) => v ?? null),
    detail: detailSchema,
  }),
};
