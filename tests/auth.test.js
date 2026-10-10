import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import { createApp } from '../src/app.js';
import { env } from '../src/config/env.js';
import { db, resetDb, makeStore } from './helpers.js';

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

const signupBody = (overrides = {}) => ({
  email: 'Buyer@Test.com ',
  password: 'password123',
  nickname: '구매자',
  role: 'BUYER',
  privacy_agreed: true,
  terms_agreed: true,
  ...overrides,
});

const signupAndLogin = async (overrides) => {
  const body = signupBody(overrides);
  await call('POST', '/auth/signup', { body });
  const { json } = await call('POST', '/auth/login', { body: { email: body.email, password: body.password } });
  return json.data.accessToken;
};

test('회원가입 성공: 응답은 { userId, role } 뿐이고 이메일은 소문자로 저장', async () => {
  const { status, json } = await call('POST', '/auth/signup', { body: signupBody() });
  assert.equal(status, 201);
  assert.equal(json.success, true);
  assert.deepEqual(Object.keys(json.data).sort(), ['role', 'userId']);
  assert.equal(typeof json.data.userId, 'number');
  assert.equal(json.data.role, 'BUYER');

  const saved = await db.User.findByPk(json.data.userId);
  assert.equal(saved.email, 'buyer@test.com');
  assert.equal(saved.seller_approval_status, null);
});

test('판매자 가입은 승인 상태가 PENDING', async () => {
  const { json } = await call('POST', '/auth/signup', { body: signupBody({ role: 'SELLER' }) });
  assert.equal(json.data.role, 'SELLER');
  const saved = await db.User.findByPk(json.data.userId);
  assert.equal(saved.seller_approval_status, 'PENDING');
});

test('비밀번호는 평문이 아닌 해시로 저장된다', async () => {
  await call('POST', '/auth/signup', { body: signupBody() });
  const user = await db.User.findOne({ where: { email: 'buyer@test.com' } });
  assert.notEqual(user.password_hash, 'password123');
  assert.match(user.password_hash, /^\$2[aby]\$/);
});

test('회원가입 입력 오류는 VALIDATION_ERROR 와 항목별 details { field, message }', async () => {
  for (const [field, bad] of [
    ['role', { role: 'ADMIN' }],
    ['password', { password: 'short' }],
    ['email', { email: 'not-an-email' }],
    ['nickname', { nickname: '' }],
    ['privacy_agreed', { privacy_agreed: 'yes' }],
  ]) {
    const { status, json } = await call('POST', '/auth/signup', { body: signupBody(bad) });
    assert.equal(status, 400, JSON.stringify(bad));
    assert.equal(json.error.code, 'VALIDATION_ERROR');
    assert.equal(json.error.message, '입력값을 확인해 주세요');
    assert.ok(json.error.details.some((d) => d.field === field && d.message), `${field}: ${JSON.stringify(json.error.details)}`);
  }
});

test('동의하지 않으면 AGREEMENT_REQUIRED', async () => {
  for (const bad of [{ privacy_agreed: false }, { terms_agreed: false }]) {
    const { status, json } = await call('POST', '/auth/signup', { body: signupBody(bad) });
    assert.equal(status, 400);
    assert.equal(json.error.code, 'AGREEMENT_REQUIRED');
  }
  assert.equal(await db.User.count(), 0);
});

test('같은 이메일로 다시 가입하면 EMAIL_DUPLICATED (대소문자 무관)', async () => {
  await call('POST', '/auth/signup', { body: signupBody() });
  const { status, json } = await call('POST', '/auth/signup', { body: signupBody({ email: 'BUYER@test.com' }) });
  assert.equal(status, 409);
  assert.equal(json.error.code, 'EMAIL_DUPLICATED');
  assert.equal(json.error.message, '이미 가입한 이메일이에요');
});

test('동시에 같은 이메일로 가입하면 한 건만 성공한다', async () => {
  const results = await Promise.all(
    Array.from({ length: 5 }, () => call('POST', '/auth/signup', { body: signupBody() })),
  );
  assert.equal(results.filter((r) => r.status === 201).length, 1);
  assert.ok(results.filter((r) => r.status !== 201).every((r) => r.json.error.code === 'EMAIL_DUPLICATED'));
});

test('로그인 성공: accessToken, expiresIn(86400), user(hasStore 포함)', async () => {
  await call('POST', '/auth/signup', { body: signupBody({ role: 'SELLER', nickname: '양주원단' }) });
  const { status, json } = await call('POST', '/auth/login', {
    body: { email: 'buyer@test.com', password: 'password123' },
  });
  assert.equal(status, 200);
  assert.equal(json.data.expiresIn, 86400);
  assert.deepEqual(Object.keys(json.data.user).sort(), [
    'hasStore', 'nickname', 'role', 'seller_approval_status', 'userId',
  ]);
  assert.equal(json.data.user.seller_approval_status, 'PENDING');
  assert.equal(json.data.user.hasStore, false);

  const payload = jwt.verify(json.data.accessToken, env.jwtSecret);
  assert.equal(payload.role, 'SELLER');
});

test('매장이 있는 판매자는 hasStore 가 true', async () => {
  const { seller } = await makeStore();
  await seller.update({ email: 'seller@test.com', password_hash: (await import('bcryptjs')).default.hashSync('password123', 4) });
  const { json } = await call('POST', '/auth/login', { body: { email: 'seller@test.com', password: 'password123' } });
  assert.equal(json.data.user.hasStore, true);
});

test('로그인 실패: 틀린 비밀번호와 없는 이메일은 같은 LOGIN_FAILED', async () => {
  await call('POST', '/auth/signup', { body: signupBody() });
  const wrongPw = await call('POST', '/auth/login', { body: { email: 'buyer@test.com', password: 'wrongwrong' } });
  const noUser = await call('POST', '/auth/login', { body: { email: 'none@test.com', password: 'password123' } });
  for (const r of [wrongPw, noUser]) {
    assert.equal(r.status, 401);
    assert.equal(r.json.error.code, 'LOGIN_FAILED');
    assert.equal(r.json.error.message, '이메일 또는 비밀번호가 맞지 않아요');
  }
});

test('내 정보 조회: 명세서 항목 그대로', async () => {
  const token = await signupAndLogin({ role: 'SELLER', phone_number: '010-1234-5678' });
  const { status, json } = await call('GET', '/users/me', { token });
  assert.equal(status, 200);
  assert.deepEqual(Object.keys(json.data).sort(), [
    'created_at', 'email', 'hasStore', 'nickname', 'phone_number', 'role', 'seller_approval_status', 'userId',
  ]);
  assert.equal(json.data.email, 'buyer@test.com');
  assert.equal(json.data.phone_number, '010-1234-5678');
  assert.match(json.data.created_at, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\+09:00$/);
});

test('내 정보 수정: 보낸 항목만 바뀐다', async () => {
  const token = await signupAndLogin({ phone_number: '010-1111-2222' });
  const nick = await call('PATCH', '/users/me', { token, body: { nickname: '새닉네임' } });
  assert.equal(nick.status, 200);
  assert.equal(nick.json.data.nickname, '새닉네임');
  assert.equal(nick.json.data.phone_number, '010-1111-2222');

  const cleared = await call('PATCH', '/users/me', { token, body: { phone_number: null } });
  assert.equal(cleared.json.data.phone_number, null);
  assert.equal(cleared.json.data.nickname, '새닉네임');
});

test('내 정보 수정: 이메일·역할은 바꿀 수 없고 빈 요청도 VALIDATION_ERROR', async () => {
  const token = await signupAndLogin();
  for (const body of [{ email: 'x@test.com' }, { role: 'ADMIN' }, {}]) {
    const { status, json } = await call('PATCH', '/users/me', { token, body });
    assert.equal(status, 400, JSON.stringify(body));
    assert.equal(json.error.code, 'VALIDATION_ERROR');
  }
});

test('토큰 없음, 잘못된 토큰, 만료된 토큰은 401 UNAUTHORIZED', async () => {
  const expired = jwt.sign({ role: 'BUYER' }, env.jwtSecret, { subject: '1', expiresIn: -10 });
  const forged = jwt.sign({ role: 'ADMIN' }, 'another-secret', { subject: '1' });
  for (const token of [undefined, 'garbage', expired, forged]) {
    const { status, json } = await call('GET', '/users/me', { token });
    assert.equal(status, 401);
    assert.equal(json.error.code, 'UNAUTHORIZED');
    assert.equal(json.error.message, '다시 로그인해 주세요');
  }
});

test('탈퇴한 회원의 토큰은 더 이상 통과하지 못한다', async () => {
  const token = await signupAndLogin();
  await db.User.destroy({ where: { email: 'buyer@test.com' } });
  const { status } = await call('GET', '/users/me', { token });
  assert.equal(status, 401);
  const login = await call('POST', '/auth/login', { body: { email: 'buyer@test.com', password: 'password123' } });
  assert.equal(login.status, 401);
});

test('역할이 다르면 requireAuth(역할)가 FORBIDDEN', async () => {
  const { requireAuth } = await import('../src/middlewares/auth.js');
  const token = await signupAndLogin();
  const run = (...roles) =>
    new Promise((resolve) => {
      const req = { headers: { authorization: `Bearer ${token}` } };
      requireAuth(...roles)(req, {}, (err) => resolve(err?.code ?? 'PASS'));
    });
  assert.equal(await run('SELLER'), 'FORBIDDEN');
  assert.equal(await run('BUYER'), 'PASS');
  assert.equal(await run('SELLER', 'BUYER'), 'PASS');
});

test('깨진 JSON 은 VALIDATION_ERROR 로 오류 형식을 지킨다', async () => {
  const res = await fetch(`${base}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{broken',
  });
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error.code, 'VALIDATION_ERROR');
});
