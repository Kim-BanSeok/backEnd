import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { fail } from '../utils/errors.js';
import * as usersDao from '../dao/users.dao.js';

// Authorization: Bearer 토큰을 확인하고 req.user = { userId, role } 를 채운다.
// 토큰이 유효해도 회원이 탈퇴했으면(DB 에서 조회되지 않으면) 거절한다.
async function authenticate(req) {
  const [scheme, token] = (req.headers.authorization || '').split(' ');
  if (scheme !== 'Bearer' || !token) return null;

  let payload;
  try {
    payload = jwt.verify(token, env.jwtSecret, { algorithms: ['HS256'] });
  } catch {
    return null; // 만료, 변조 모두 로그인 안 한 것으로 본다.
  }
  const user = await usersDao.findById(Number(payload.sub));
  return user ? { userId: user.user_id, role: user.role } : null;
}

// 로그인 필수. 역할을 주면 그 역할만 통과한다: requireAuth('SELLER'), requireAuth('SELLER', 'ADMIN')
export const requireAuth =
  (...roles) =>
  async (req, res, next) => {
    const user = await authenticate(req);
    if (!user) return next(fail('UNAUTHORIZED'));
    if (roles.length && !roles.includes(user.role)) return next(fail('FORBIDDEN'));
    req.user = user;
    next();
  };

// 공개 API 용. 로그인해도 되고 안 해도 되며, 로그인했으면 req.user 를 채운다.
// 토큰을 보냈는데 잘못됐거나 만료됐다면 공개 API 라도 401 이다. (명세서 2.3)
export const optionalAuth = async (req, res, next) => {
  if (!req.headers.authorization) return next();
  const user = await authenticate(req);
  if (!user) return next(fail('UNAUTHORIZED'));
  req.user = user;
  next();
};
