import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { fail } from '../utils/errors.js';
import * as usersDao from '../dao/users.dao.js';
import * as storesDao from '../dao/stores.dao.js';

const SALT_ROUNDS = env.isTest ? 4 : 10; // 테스트는 빠르게

// 없는 이메일로 로그인해도 해시 비교 시간이 같도록, 가짜 해시와도 비교한다.
const DUMMY_HASH = bcrypt.hashSync('dummy-password', SALT_ROUNDS);

// 비밀번호는 평문이 아닌 bcrypt 해시로만 저장한다. (가입과 ADMIN 시드가 같은 방식을 쓴다)
export const hashPassword = (password) => bcrypt.hash(password, SALT_ROUNDS);

export const signToken = (user) =>
  jwt.sign({ role: user.role }, env.jwtSecret, {
    algorithm: 'HS256',
    subject: String(user.user_id),
    expiresIn: env.jwtExpiresIn,
  });

export async function signup(input) {
  if (!input.privacy_agreed || !input.terms_agreed) throw fail('AGREEMENT_REQUIRED');
  if (await usersDao.findByEmail(input.email)) throw fail('EMAIL_DUPLICATED');

  const password_hash = await hashPassword(input.password);
  try {
    const user = await usersDao.insert({
      email: input.email,
      password_hash,
      nickname: input.nickname,
      phone_number: input.phone_number ?? null,
      role: input.role,
      // 판매자는 운영팀 승인 전까지 PENDING, 구매자는 NULL
      seller_approval_status: input.role === 'SELLER' ? 'PENDING' : null,
      privacy_agreed: true,
      terms_agreed: true,
    });
    return { userId: user.user_id, role: user.role };
  } catch (err) {
    // 동시에 같은 이메일로 가입하면 위의 확인을 둘 다 통과하므로, DB 의 UNIQUE 가 마지막으로 막는다.
    if (err.name === 'SequelizeUniqueConstraintError') throw fail('EMAIL_DUPLICATED');
    throw err;
  }
}

export async function login({ email, password }) {
  const user = await usersDao.findByEmail(email);
  const matched = await bcrypt.compare(password, user ? user.password_hash : DUMMY_HASH);
  if (!user || !matched) throw fail('LOGIN_FAILED');

  const accessToken = signToken(user);
  const { iat, exp } = jwt.decode(accessToken);
  return {
    accessToken,
    expiresIn: exp - iat, // 초 단위 (24시간 = 86400)
    user: {
      userId: user.user_id,
      nickname: user.nickname,
      role: user.role,
      seller_approval_status: user.seller_approval_status,
      hasStore: (await storesDao.findByUserId(user.user_id)) !== null,
    },
  };
}
