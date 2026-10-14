import { z } from 'zod';
import { FAVORITE_TARGETS } from '../utils/codes.js';

const id = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);

// FABRIC 이면 fabric_id 만, PATTERN 이면 pattern_id 만 보낸다. (명세서 39번 처리 규칙)
// 없거나 다른 쪽 번호를 함께 보내면 VALIDATION_ERROR 로 항목별 details 를 돌려준다.
export const createFavoriteSchema = {
  body: z
    .strictObject({
      target_type: z.enum(FAVORITE_TARGETS),
      fabric_id: id.optional(),
      pattern_id: id.optional(),
    })
    .superRefine((value, ctx) => {
      const [needed, other] =
        value.target_type === 'FABRIC' ? ['fabric_id', 'pattern_id'] : ['pattern_id', 'fabric_id'];
      if (value[needed] === undefined) {
        ctx.addIssue({ code: 'custom', path: [needed], message: `${needed} 를 보내 주세요` });
      }
      if (value[other] !== undefined) {
        ctx.addIssue({
          code: 'custom',
          path: [other],
          message: `${value.target_type} 일 때는 ${other} 를 보내지 않아요`,
        });
      }
    }),
};

// 목록: target_type 으로 원단 또는 도안만 볼 수 있다. page 는 0부터, size 는 1~50 (명세서 2.6)
export const listFavoritesSchema = {
  query: z.object({
    target_type: z.enum(FAVORITE_TARGETS).optional(),
    page: z.coerce.number().int().min(0).max(Number.MAX_SAFE_INTEGER).default(0),
    size: z.coerce.number().int().min(1).max(50).default(20),
  }),
};

export const favoriteIdSchema = {
  params: z.object({
    favoriteId: z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  }),
};
