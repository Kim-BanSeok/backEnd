import { z } from 'zod';

// 빈 문자열(?keyword=)은 보내지 않은 것으로 본다.
const optionalText = (max) =>
  z.string().trim().max(max).optional().transform((v) => v || undefined);

export const patternIdSchema = {
  params: z.object({
    patternId: z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  }),
};

export const listPatternsSchema = {
  query: z.object({
    category: optionalText(50),
    keyword: optionalText(100),
    page: z.coerce.number().int().min(0).max(Number.MAX_SAFE_INTEGER).default(0),
    size: z.coerce.number().int().min(1).max(50).default(20),
  }),
};
