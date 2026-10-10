import { z } from 'zod';

const email = z.string().trim().toLowerCase().pipe(z.email().max(255));
// bcrypt 는 72바이트까지만 해시하므로 72자로 제한한다.
const password = z.string().min(8).max(72);

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
    password: z.string().min(1).max(72),
  }),
};
