import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import { createApp } from '../src/app.js';
import { env } from '../src/config/env.js';
import { signToken } from '../src/services/auth.service.js';
import { db, resetDb, makeUser, makeStore } from './helpers.js';

let server;
let base;

before(async () => {
  await resetDb();
  server = createApp().listen(0);
  base = `http://localhost:${server.address().port}/api/v1`;
});
beforeEach(resetDb);
after(async () => {
  server.close();
  await db.sequelize.close();
});

async function call(method, path, { body, token } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token && { Authorization: `Bearer ${token}` }),
    },
    body: body && JSON.stringify(body),
  });
  return { status: res.status, json: await res.json() };
}

// 회원을 만들고 로그인한 것과 같은 토큰을 바로 만든다.
const sellerToken = async (overrides) =>
  signToken(await makeUser({ role: 'SELLER', seller_approval_status: 'APPROVED', ...overrides }));
const tokenOf = async (role) =>
  signToken(await makeUser({ role, seller_approval_status: role === 'SELLER' ? 'APPROVED' : null }));

const storeBody = (overrides = {}) => ({
  store_name: '양주원단상회',
  store_address: '경기도 양주시 어딘가로 12',
  store_phone: '031-123-4567',
  closed_days: '매주 일요일',
  pickup_guide: '평일 10~18시, 1층 카운터에서 말씀해 주세요',
  ...overrides,
});

const STORE_KEYS = ['closed_days', 'pickup_guide', 'storeId', 'store_address', 'store_name', 'store_phone'];

// ---- 5. 매장 등록

test('매장 등록 성공: 201 { storeId }, 선택 항목은 null 로 저장', async () => {
  const token = await sellerToken();
  const { status, json } = await call('POST', '/stores', { token, body: storeBody() });
  assert.equal(status, 201);
  assert.deepEqual(json, { success: true, data: { storeId: json.data.storeId } });
  assert.equal(typeof json.data.storeId, 'number');

  const minimal = await sellerToken();
  const second = await call('POST', '/stores', {
    token: minimal,
    body: { store_name: 'b', store_address: 'b', store_phone: 'b' },
  });
  assert.equal(second.status, 201);
  const saved = await db.Store.findByPk(second.json.data.storeId);
  assert.equal(saved.closed_days, null);
  assert.equal(saved.pickup_guide, null);
});

test('매장 등록 권한: 로그인 안 함 401, 구매자·운영팀 403', async () => {
  const noToken = await call('POST', '/stores', { body: storeBody() });
  assert.equal(noToken.status, 401);
  assert.equal(noToken.json.error.code, 'UNAUTHORIZED');

  for (const role of ['BUYER', 'ADMIN']) {
    const { status, json } = await call('POST', '/stores', { token: await tokenOf(role), body: storeBody() });
    assert.equal(status, 403, role);
    assert.equal(json.error.code, 'FORBIDDEN');
  }
  assert.equal(await db.Store.count(), 0);
});

test('매장 등록 입력 오류: VALIDATION_ERROR 와 항목별 details', async () => {
  const token = await sellerToken();
  const cases = [
    ['store_name', { store_name: undefined }],
    ['store_name', { store_name: '   ' }],
    ['store_name', { store_name: 'a'.repeat(101) }],
    ['store_address', { store_address: '' }],
    ['store_phone', { store_phone: 'a'.repeat(21) }],
    ['closed_days', { closed_days: 'a'.repeat(101) }],
    ['pickup_guide', { pickup_guide: 'a'.repeat(5001) }],
    ['store_name', { store_name: 123 }],
  ];
  for (const [field, bad] of cases) {
    const { status, json } = await call('POST', '/stores', { token, body: storeBody(bad) });
    assert.equal(status, 400, JSON.stringify(bad).slice(0, 60));
    assert.equal(json.error.code, 'VALIDATION_ERROR');
    assert.ok(json.error.details.some((d) => d.field === field), `${field}: ${JSON.stringify(json.error.details)}`);
  }
  assert.equal(await db.Store.count(), 0);
});

test('이미 매장이 있으면 STORE_ALREADY_EXISTS (409)', async () => {
  const token = await sellerToken();
  assert.equal((await call('POST', '/stores', { token, body: storeBody() })).status, 201);
  const { status, json } = await call('POST', '/stores', { token, body: storeBody({ store_name: '다른 매장' }) });
  assert.equal(status, 409);
  assert.equal(json.error.code, 'STORE_ALREADY_EXISTS');
  assert.equal(await db.Store.count(), 1);
});

test('동시에 여러 번 등록해도 매장은 1개만 생긴다', async () => {
  const token = await sellerToken();
  const results = await Promise.all(Array.from({ length: 5 }, () => call('POST', '/stores', { token, body: storeBody() })));
  assert.equal(results.filter((r) => r.status === 201).length, 1);
  assert.ok(results.filter((r) => r.status !== 201).every((r) => r.json.error.code === 'STORE_ALREADY_EXISTS'));
  assert.equal(await db.Store.count(), 1);
});

// ---- 6. 내 매장 조회

test('내 매장 조회 성공: 명세서 항목 그대로', async () => {
  const { seller } = await makeStore({ store_name: '내 매장', closed_days: '매주 일요일', pickup_guide: '안내' });
  const { status, json } = await call('GET', '/stores/me', { token: signToken(seller) });
  assert.equal(status, 200);
  assert.deepEqual(Object.keys(json.data).sort(), STORE_KEYS);
  assert.equal(json.data.store_name, '내 매장');
  assert.equal(json.data.closed_days, '매주 일요일');
});

test('내 매장 조회: 매장 없으면 404, 권한 없으면 401·403', async () => {
  const noStore = await call('GET', '/stores/me', { token: await sellerToken() });
  assert.equal(noStore.status, 404);
  assert.equal(noStore.json.error.code, 'NOT_FOUND');

  assert.equal((await call('GET', '/stores/me')).status, 401);
  const buyer = await call('GET', '/stores/me', { token: await tokenOf('BUYER') });
  assert.equal(buyer.status, 403);
  assert.equal(buyer.json.error.code, 'FORBIDDEN');
});

test('내 매장 조회는 내 매장만 보여 준다', async () => {
  const mine = await makeStore({ store_name: '내 것' });
  await makeStore({ store_name: '남의 것' });
  const { json } = await call('GET', '/stores/me', { token: signToken(mine.seller) });
  assert.equal(json.data.store_name, '내 것');
});

// ---- 7. 내 매장 수정

test('내 매장 수정: 보낸 항목만 바뀌고, null 로 비울 수 있다', async () => {
  const { seller, store } = await makeStore({ closed_days: '매주 일요일', pickup_guide: '안내' });
  const token = signToken(seller);

  const changed = await call('PATCH', '/stores/me', { token, body: { closed_days: '매주 일요일, 공휴일' } });
  assert.equal(changed.status, 200);
  assert.deepEqual(Object.keys(changed.json.data).sort(), STORE_KEYS);
  assert.equal(changed.json.data.storeId, store.store_id);
  assert.equal(changed.json.data.closed_days, '매주 일요일, 공휴일');
  assert.equal(changed.json.data.store_name, '테스트 매장');
  assert.equal(changed.json.data.pickup_guide, '안내');

  const cleared = await call('PATCH', '/stores/me', { token, body: { pickup_guide: null } });
  assert.equal(cleared.json.data.pickup_guide, null);
  assert.equal((await db.Store.findByPk(store.store_id)).pickup_guide, null);
});

test('내 매장 수정 입력 오류: 빈 요청, 모르는 항목, 잘못된 값', async () => {
  const { seller } = await makeStore();
  const token = signToken(seller);
  for (const body of [{}, { user_id: 999 }, { store_id: 5 }, { store_name: '' }, { store_phone: 'a'.repeat(21) }, { store_name: null }]) {
    const { status, json } = await call('PATCH', '/stores/me', { token, body });
    assert.equal(status, 400, JSON.stringify(body));
    assert.equal(json.error.code, 'VALIDATION_ERROR');
  }
});

test('내 매장 수정: 매장 없으면 404, 권한 없으면 401·403', async () => {
  const noStore = await call('PATCH', '/stores/me', { token: await sellerToken(), body: { store_name: 'x' } });
  assert.equal(noStore.status, 404);
  assert.equal(noStore.json.error.code, 'NOT_FOUND');
  assert.equal((await call('PATCH', '/stores/me', { body: { store_name: 'x' } })).status, 401);
  const buyer = await call('PATCH', '/stores/me', { token: await tokenOf('BUYER'), body: { store_name: 'x' } });
  assert.equal(buyer.status, 403);
});

test('내 매장 수정은 남의 매장을 바꾸지 않는다', async () => {
  const mine = await makeStore({ store_name: '내 것' });
  const other = await makeStore({ store_name: '남의 것' });
  await call('PATCH', '/stores/me', { token: signToken(mine.seller), body: { store_name: '바뀜' } });
  assert.equal((await db.Store.findByPk(other.store.store_id)).store_name, '남의 것');
});

// ---- 8. 매장 정보 조회 (공개)

test('매장 정보 조회: 로그인 없이 볼 수 있고, /stores/me 와 구분된다', async () => {
  const { store } = await makeStore({ store_name: '공개 매장' });
  const { status, json } = await call('GET', `/stores/${store.store_id}`);
  assert.equal(status, 200);
  assert.deepEqual(Object.keys(json.data).sort(), STORE_KEYS);
  assert.equal(json.data.storeId, store.store_id);
  assert.equal(json.data.store_name, '공개 매장');

  // 로그인한 구매자도 볼 수 있다
  assert.equal((await call('GET', `/stores/${store.store_id}`, { token: await tokenOf('BUYER') })).status, 200);
});

test('매장 정보 조회 오류: 없는 매장 404, 숫자가 아닌 id 400', async () => {
  const missing = await call('GET', '/stores/99999');
  assert.equal(missing.status, 404);
  assert.equal(missing.json.error.code, 'NOT_FOUND');

  for (const id of ['abc', '0', '-1', '1.5', '99999999999999999999']) {
    const { status, json } = await call('GET', `/stores/${id}`);
    assert.equal(status, 400, id);
    assert.equal(json.error.code, 'VALIDATION_ERROR');
    assert.ok(json.error.details.some((d) => d.field === 'storeId'));
  }
});

test('공개 API 라도 잘못된 토큰이면 401 (명세서 2.3)', async () => {
  const { store } = await makeStore();
  const expired = jwt.sign({ role: 'BUYER' }, env.jwtSecret, { subject: '1', expiresIn: -10 });
  for (const token of ['garbage', expired]) {
    const { status, json } = await call('GET', `/stores/${store.store_id}`, { token });
    assert.equal(status, 401);
    assert.equal(json.error.code, 'UNAUTHORIZED');
  }
});
