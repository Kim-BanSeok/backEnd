import { rateLimit } from 'express-rate-limit';
import { env } from '../config/env.js';
import { fail } from '../utils/errors.js';

// 같은 주소에서 15분에 20번까지만 시도할 수 있다. (명세서: 회원가입, 로그인)
// 가입과 로그인은 하나의 limiter 를 함께 쓰므로 횟수를 같이 센다.
// 테스트는 같은 주소에서 많이 호출하므로 기본 한도를 크게 둔다. (제한 동작은 tests/rateLimit.test.js 에서 확인)
export const createAuthLimiter = ({ windowMs = 15 * 60 * 1000, max = env.isTest ? 10000 : 20 } = {}) =>
  rateLimit({
    windowMs,
    limit: max,
    standardHeaders: false,
    legacyHeaders: false,
    handler: (req, res, next) => next(fail('TOO_MANY_REQUESTS')),
  });

export const authLimiter = createAuthLimiter();
