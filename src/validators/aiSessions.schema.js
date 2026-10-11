import { z } from 'zod';
import { createFabricSchema } from './fabrics.schema.js';

// 세션 번호는 24자 16진수다. 형식이 틀리면 VALIDATION_ERROR, 형식은 맞는데 없는 번호면 NOT_FOUND.
const sessionId = z.string().regex(/^[0-9a-f]{24}$/, { error: '세션 번호 형식이 올바르지 않아요' });
const params = z.object({ sessionId });

export const sessionIdSchema = { params };

// 말하듯 쓴 답은 answer, 선택 버튼을 누른 값은 selected, 마무리는 finish. 셋 다 없으면 VALIDATION_ERROR.
export const answerSchema = {
  params,
  body: z
    .object({
      answer: z.string().trim().min(1).max(1000).optional(),
      selected: z.string().trim().min(1).max(50).optional(),
      finish: z.boolean().optional(),
    })
    .refine((body) => body.answer !== undefined || body.selected !== undefined || body.finish === true, {
      error: 'answer, selected, finish 중 하나는 보내 주세요',
    }),
};

// 확정: 요청 본문은 POST /fabrics 와 같다.
export const confirmSchema = { params, body: createFabricSchema.body };
