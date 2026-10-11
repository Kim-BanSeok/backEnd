import { z } from 'zod';
import { SALE_TYPES, FABRIC_STATUSES, MATERIALS, THICKNESSES, COLOR_FAMILIES } from '../utils/codes.js';
import { idParam } from './common.schema.js';

// 쉼표로 이은 코드값(예: COTTON,LINEN)을 목록으로 바꾼다. 각 항목은 코드값 목록 안에 있어야 한다.
// 보내지 않으면 undefined(조건 없음). 빈 항목(COTTON,,LINEN)과 목록 밖의 값은 오류다.
// 오류 위치가 material.0 처럼 나가지 않고 항목 이름(material)으로 나가게, 목록 전체를 한 번에 검사한다.
const csvOf = (values) =>
  z
    .string()
    .transform((text, ctx) => {
      const items = text.split(',').map((item) => item.trim());
      if (!items.every((item) => values.includes(item))) {
        ctx.issues.push({ code: 'custom', input: text, message: `${values.join(', ')} 중에서 쉼표로 이어서 골라 주세요` });
        return z.NEVER;
      }
      return items;
    })
    .optional();

export const listFabricsSchema = {
  query: z.object({
    sale_type: z.enum(SALE_TYPES).default('SCRAP'),
    material: csvOf(MATERIALS),
    thickness: csvOf(THICKNESSES),
    color_family: csvOf(COLOR_FAMILIES),
    keyword: z.string().trim().min(1).max(100).optional(),
    sort: z.enum(['latest', 'price_asc', 'price_desc']).default('latest'),
    page: z.coerce.number().int().min(0).max(Number.MAX_SAFE_INTEGER).default(0),
    size: z.coerce.number().int().min(1).max(50).default(20),
  }),
};

export const fabricIdSchema = {
  params: z.object({ fabricId: idParam }),
};

export const listMyFabricsSchema = {
  query: z.object({
    status: z.enum(FABRIC_STATUSES).optional(),
    page: z.coerce.number().int().min(0).max(Number.MAX_SAFE_INTEGER).default(0),
    size: z.coerce.number().int().min(1).max(50).default(20),
  }),
};
