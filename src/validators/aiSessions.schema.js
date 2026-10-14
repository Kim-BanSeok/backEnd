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
    .strictObject({
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

const listingImage = z.strictObject({
  media_type: z.enum(['image/jpeg', 'image/png', 'image/webp']),
  data: z.string().regex(/^[A-Za-z0-9+/]+={0,2}$/, { error: '사진 데이터가 올바르지 않아요' }).max(3_000_000),
});

// 사진과 짧은 입력을 한 번에 받아 소개글을 만든다. 치수는 이 입력값을 유지한다.
export const listingSchema = {
  body: z.strictObject({
    material_text: z.string().trim().min(1).max(100),
    thickness: z.enum(['THIN', 'NORMAL', 'THICK', 'UNKNOWN']),
    thickness_label: z.string().trim().min(1).max(20),
    width_cm: z.number().int().min(1).max(1000),
    length_cm: z.number().int().min(1).max(2147483647),
    sale_type: z.enum(['ROLL', 'SCRAP']).default('SCRAP'),
    sheet_count: z.number().int().min(1).max(9999).optional(),
    feel: z.string().trim().max(200).optional(),
    stretch: z.string().trim().max(40).optional(),
    memo: z.string().trim().max(1000).optional(),
    images: z.array(listingImage).min(1).max(2),
  }).superRefine((body, ctx) => {
    if (body.sale_type === 'ROLL') {
      if (body.sheet_count !== null && body.sheet_count !== undefined) ctx.addIssue({ code: 'custom', message: '롤은 판매 장수를 보내지 않아요', path: ['sheet_count'] });
      if (body.length_cm < 90) ctx.addIssue({ code: 'custom', message: '롤은 남은 길이를 90cm 이상으로 입력해 주세요', path: ['length_cm'] });
      return;
    }
    if (body.sheet_count === null || body.sheet_count === undefined) ctx.addIssue({ code: 'custom', message: '판매 장수는 1장 이상인 정수로 입력해 주세요', path: ['sheet_count'] });
  }),
};
