import { AppError, ERRORS } from '../utils/errors.js';
import { setSecurityError } from '../utils/securityLog.js';

const send = (res, code, details) => {
  const error = { code, message: ERRORS[code].message };
  if (details) error.details = details;
  return res.status(ERRORS[code].status).json({ success: false, error });
};

// 모든 오류를 { success: false, error: { code, message } } 모양으로 바꾼다.
// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  if (err instanceof AppError) {
    setSecurityError(err.code, err);
    return send(res, err.code, err.details);
  }
  if (err.type === 'entity.parse.failed') {
    setSecurityError('VALIDATION_ERROR');
    return send(res, 'VALIDATION_ERROR', [{ field: 'body', message: 'JSON 형식이 올바르지 않아요' }]);
  }
  // 원시 오류에는 SQL·접속 정보·사용자 입력이 있을 수 있어 메시지와 스택을 기록하지 않는다.
  setSecurityError('INTERNAL_ERROR', err);
  return send(res, 'INTERNAL_ERROR');
}
