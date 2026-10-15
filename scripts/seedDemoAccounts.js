import { hashPassword } from '../src/services/auth.service.js';
import * as usersDao from '../src/dao/users.dao.js';

const demoAccounts = [
  {
    email: 'loop@example.com',
    password: 'loop1234',
    nickname: '김루프',
    role: 'BUYER',
    seller_approval_status: null,
  },
  {
    email: 'seller@example.com',
    password: 'seller1234',
    nickname: '이정원',
    role: 'SELLER',
    seller_approval_status: 'APPROVED',
  },
];

export async function seedDemoAccounts() {
  const results = [];
  for (const account of demoAccounts) {
    const existing = await usersDao.findByEmail(account.email);
    if (existing) {
      results.push(account.email + ':exists');
      continue;
    }
    await usersDao.insert({
      email: account.email,
      password_hash: await hashPassword(account.password),
      password_byte_length: Buffer.byteLength(account.password, 'utf8'),
      nickname: account.nickname,
      role: account.role,
      seller_approval_status: account.seller_approval_status,
      privacy_agreed: true,
      terms_agreed: true,
    });
    results.push(account.email + ':created');
  }
  return results;
}
