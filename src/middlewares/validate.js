import { z } from 'zod';
import { fail } from '../utils/errors.js';
import { emptyBodySchema } from '../validators/common.schema.js';

// 입력 검사 메시지를 한국어로 낸다.
z.config(z.locales.ko());

// 사용: validate({ params, query, body }) — 각 값은 zod 스키마. 통과한 값은 req.valid 에 담는다.
// 오류는 명세서 모양 details: [{ field, message }] 로 알린다.
// body 스키마가 없는 API도 본문을 생략/빈 객체로만 받아 모르는 필드를 조용히 버리지 않는다.
export const validate = (schemas) => (req, res, next) => {
  const valid = {};
  const details = [];
  for (const key of ['params', 'query', 'body']) {
    const schema = schemas[key] ?? (key === 'body' ? emptyBodySchema : null);
    if (!schema) continue;
    // JSON/multipart가 아닌 본문을 파서가 읽지 않은 경우도 "본문 없음"으로 통과시키지 않는다.
    const hasPayload = Number(req.headers?.['content-length'] ?? 0) > 0 || Boolean(req.headers?.['transfer-encoding']);
    if (key === 'body' && req.body === undefined && hasPayload && !req.is?.('application/json')) {
      details.push({ field: 'body', message: '본문은 JSON 또는 지정된 파일 업로드 형식으로 보내 주세요' });
      continue;
    }
    const result = schema.safeParse(req[key]);
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
