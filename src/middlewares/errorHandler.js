import { AppError, ERRORS } from '../utils/errors.js';
import { env } from '../config/env.js';

const send = (res, code, details) => {
  const error = { code, message: ERRORS[code].message };
  if (details) error.details = details;
  return res.status(ERRORS[code].status).json({ success: false, error });
};

// 모든 오류를 { success: false, error: { code, message } } 모양으로 바꾼다.
// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  if (err instanceof AppError) return send(res, err.code, err.details);
  if (err.type === 'entity.parse.failed') {
    return send(res, 'VALIDATION_ERROR', [{ field: 'body', message: 'JSON 형식이 올바르지 않아요' }]);
  }
  // 그 밖의 오류(DB 제약 위반 포함)는 services 가 미리 막았어야 하는 버그라서 500 으로 알리고 서버에만 남긴다.
  if (!env.isTest) console.error(err);
  return send(res, 'INTERNAL_ERROR');
}
