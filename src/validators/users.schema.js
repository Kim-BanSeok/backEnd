import { z } from 'zod';

// 이메일과 역할은 바꿀 수 없다. (strict 로 모르는 필드가 오면 VALIDATION_ERROR)
export const updateMeSchema = {
  body: z
    .strictObject({
      nickname: z.string().trim().min(1).max(50),
      phone_number: z.string().trim().max(20).nullable(),
    })
    .partial()
    .refine((v) => Object.keys(v).length > 0, { error: '수정할 항목을 하나 이상 보내 주세요' }),
};
