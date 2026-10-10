import db from '../src/models/index.js';
import { env } from '../src/config/env.js';

// 테스트는 _test DB 에서만 돈다. (env.js 도 막지만 한 번 더 확인한다)
if (!env.isTest || !env.db.database.endsWith('_test')) {
  throw new Error('테스트는 NODE_ENV=test 와 _test DB 에서만 실행합니다.');
}

// 모든 테이블을 비운다. (id 도 처음부터)
export async function resetDb() {
  const tables = Object.values(db)
    .filter((m) => m.tableName)
    .map((m) => `"${m.tableName}"`)
    .join(', ');
  await db.sequelize.query(`TRUNCATE ${tables} RESTART IDENTITY CASCADE`);
}

export const makeUser = (overrides = {}) =>
  db.User.create({
    email: `user${Math.random().toString(36).slice(2)}@test.com`,
    password_hash: 'hash',
    nickname: '테스터',
    role: 'BUYER',
    privacy_agreed: true,
    terms_agreed: true,
    ...overrides,
  });

export async function makeStore(overrides = {}) {
  const seller = await makeUser({ role: 'SELLER', seller_approval_status: 'APPROVED' });
  const store = await db.Store.create({
    user_id: seller.user_id,
    store_name: '테스트 매장',
    store_address: '경기도 양주시',
    store_phone: '031-000-0000',
    ...overrides,
  });
  return { seller, store };
}

export const makeFabric = (storeId, overrides = {}) =>
  db.Fabric.create({
    store_id: storeId,
    title: '면 원단',
    sale_type: 'SCRAP',
    price: 3000,
    ...overrides,
  });

export { db };
