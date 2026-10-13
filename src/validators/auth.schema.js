import { z } from 'zod';

const email = z.string().trim().toLowerCase().pipe(z.email().max(255));
// Reject oversize UTF-8 inputs before bcrypt can silently truncate them.
const withinBcryptLimit = value => Buffer.byteLength(value, 'utf8') <= 72;
const byteLimit = '비밀번호는 UTF-8 기준 72바이트 이하여야 해요';
const password = z.string().min(8).max(72).refine(withinBcryptLimit, { error: byteLimit });

export const signupSchema = {
  body: z.object({
    email,
    password,
    nickname: z.string().trim().min(1).max(50),
    phone_number: z.string().trim().max(20).nullish(),
    role: z.enum(['SELLER', 'BUYER']), // ADMIN 은 가입 API 로 만들 수 없다.
    // 값이 true 인지는 services 가 확인해서 AGREEMENT_REQUIRED 로 알린다. 여기서는 true/false 형식만 본다.
    privacy_agreed: z.boolean(),
    terms_agreed: z.boolean(),
  }),
};

export const loginSchema = {
  body: z.object({
    email,
    password: z.string().min(1).max(72).refine(withinBcryptLimit, { error: byteLimit }),
  }),
};
