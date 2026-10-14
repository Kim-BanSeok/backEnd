import { rateLimit } from 'express-rate-limit';
import { env } from '../config/env.js';
import { fail } from '../utils/errors.js';
import { setSecurityLimitScope } from '../utils/securityLog.js';

const onLimit = (req, res, next) => {
  setSecurityLimitScope(req.apiRateLimit?.used > req.apiRateLimit?.limit ? 'api' : 'auth');
  res.set('Cache-Control', 'no-store');
  next(fail('TOO_MANY_REQUESTS'));
};

// API·사진 조회의 모든 경로에서 같은 IP의 사용량을 합산한다. 인증·본문 처리 전에 실행한다.
export const createApiLimiter = ({ windowMs = env.apiRateLimit.windowMs, max = env.apiRateLimit.max, store } = {}) =>
  rateLimit({
    windowMs,
    limit: max,
    ...(store && { store }),
    ipv6Subnet: 56,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    identifier: 'api',
    requestPropertyName: 'apiRateLimit',
    skip: req => req.method === 'OPTIONS',
    passOnStoreError: false,
    handler: onLimit,
  });

// 같은 주소에서 15분에 20번까지만 시도할 수 있다. (명세서: 회원가입, 로그인)
// 가입과 로그인은 하나의 limiter 를 함께 쓰므로 횟수를 같이 센다.
// 테스트는 같은 주소에서 많이 호출하므로 기본 한도를 크게 둔다. (제한 동작은 tests/rateLimit.test.js 에서 확인)
export const createAuthLimiter = ({ windowMs = 15 * 60 * 1000, max = env.isTest ? 10000 : 20 } = {}) =>
  rateLimit({
    windowMs,
    limit: max,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    identifier: 'auth',
    requestPropertyName: 'authRateLimit',
    handler: onLimit,
  });

export const authLimiter = createAuthLimiter();
