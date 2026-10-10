import { z } from 'zod';
import { fail } from '../utils/errors.js';

// 입력 검사 메시지를 한국어로 낸다.
z.config(z.locales.ko());

// 사용: validate({ params, query, body }) — 각 값은 zod 스키마. 통과한 값은 req.valid 에 담는다.
// 오류는 명세서 모양 details: [{ field, message }] 로 알린다.
export const validate = (schemas) => (req, res, next) => {
  const valid = {};
  const details = [];
  for (const key of ['params', 'query', 'body']) {
    if (!schemas[key]) continue;
    const result = schemas[key].safeParse(req[key]);
    if (result.success) {
      valid[key] = result.data;
    } else {
      for (const issue of result.error.issues) {
        details.push({ field: issue.path.join('.') || key, message: issue.message });
      }
    }
  }
  if (details.length) return next(fail('VALIDATION_ERROR', details));
  req.valid = valid;
  next();
};
