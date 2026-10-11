import { z } from 'zod';
import { env } from '../config/env.js';
import { hashPassword } from '../services/auth.service.js';
import * as usersDao from '../dao/users.dao.js';

const adminSchema = z.object({
  email: z.email().max(255),
  password: z.string().min(8).max(72), // bcrypt 는 72바이트까지만 해시한다.
  nickname: z.string().min(1).max(50),
});

// .env 의 ADMIN_* 값으로 운영팀(ADMIN) 계정을 만든다. 이미 있으면 아무것도 바꾸지 않는다. (비밀번호도 덮어쓰지 않는다)
// 돌려주는 값: 'created' 새로 만듦 / 'exists' 이미 있어서 그대로 둠
// 같은 이메일이 ADMIN 이 아닌 회원(구매자·판매자)이면 그 회원을 ADMIN 으로 바꾸지 않고 오류를 낸다.
export async function seedAdmin(admin = env.admin) {
  if (!admin.email || !admin.password) {
    throw new Error('ADMIN_EMAIL 과 ADMIN_PASSWORD 를 .env 에 적어 주세요.');
  }
  const parsed = adminSchema.safeParse(admin);
  if (!parsed.success) {
    const reasons = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(', ');
    throw new Error(`ADMIN 설정이 올바르지 않아요 (${reasons})`);
  }
  const { email, password, nickname } = parsed.data;

  const found = await usersDao.findByEmail(email);
  if (found) {
    if (found.role !== 'ADMIN') {
      throw new Error(`${email} 은 이미 ${found.role} 회원이 쓰고 있어요. 다른 ADMIN_EMAIL 을 쓰세요.`);
    }
    return 'exists';
  }

  try {
    await usersDao.insert({
      email,
      password_hash: await hashPassword(password),
      nickname,
      role: 'ADMIN',
      seller_approval_status: null, // 판매자만 승인 상태가 있다
      privacy_agreed: true,
      terms_agreed: true,
    });
    return 'created';
  } catch (err) {
    // 동시에 두 번 실행해도 DB 의 이메일 UNIQUE 가 막는다. 먼저 만든 쪽이 있으니 이미 있는 것으로 본다.
    if (err.name === 'SequelizeUniqueConstraintError') return 'exists';
    throw err;
  }
}
