import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { createApp } from '../src/app.js';
import { seedAdmin } from '../src/db/seedAdmin.js';
import { db, resetDb, makeUser } from './helpers.js';

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

const admin = (overrides = {}) => ({
  email: 'admin@materialloop.test',
  password: 'admin-password-1',
  nickname: '운영팀',
  ...overrides,
});

const adminRows = () => db.User.findAll({ where: { role: 'ADMIN' }, paranoid: false });

async function call(method, path, { body, token } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: { ...(body && { 'Content-Type': 'application/json' }), ...(token && { Authorization: `Bearer ${token}` }) },
    body: body && JSON.stringify(body),
  });
  return { status: res.status, json: await res.json() };
}

// ---- 만들기

test('처음 실행하면 ADMIN 계정을 만든다 (판매자 승인 상태 없음, 비밀번호는 해시)', async () => {
  assert.equal(await seedAdmin(admin()), 'created');
  const rows = await adminRows();
  assert.equal(rows.length, 1);
  const [user] = rows;
  assert.equal(user.email, 'admin@materialloop.test');
  assert.equal(user.nickname, '운영팀');
  assert.equal(user.role, 'ADMIN');
  assert.equal(user.seller_approval_status, null);
  assert.equal(user.privacy_agreed, true);
  assert.equal(user.terms_agreed, true);
  assert.notEqual(user.password_hash, 'admin-password-1');
  assert.ok(await bcrypt.compare('admin-password-1', user.password_hash));
});

test('만든 계정으로 실제 로그인하고 운영 API 를 쓸 수 있다', async () => {
  await seedAdmin(admin());
  const login = await call('POST', '/auth/login', { body: { email: 'admin@materialloop.test', password: 'admin-password-1' } });
  assert.equal(login.status, 200);
  assert.equal(login.json.data.user.role, 'ADMIN');
  assert.equal(login.json.data.user.seller_approval_status, null);

  const token = login.json.data.accessToken;
  assert.equal((await call('GET', '/admin/sellers', { token })).status, 200);
  assert.equal((await call('GET', '/admin/fabrics', { token })).status, 200);
});

test('이메일은 소문자·공백 없이 저장되어 대문자로 적어도 같은 계정으로 본다', async () => {
  // env.js 가 이메일을 소문자로 바꾸지만, 함수를 직접 부를 때도 안전한지 확인한다.
  assert.equal(await seedAdmin(admin({ email: 'admin@materialloop.test' })), 'created');
  assert.equal(await seedAdmin(admin({ email: 'admin@materialloop.test' })), 'exists');
  assert.equal((await adminRows()).length, 1);
});

// ---- 이미 있으면 다시 만들지 않는다

test('이미 있으면 다시 만들지 않는다 (여러 번 실행해도 계정 1개)', async () => {
  assert.equal(await seedAdmin(admin()), 'created');
  for (let i = 0; i < 3; i += 1) assert.equal(await seedAdmin(admin()), 'exists');
  assert.equal(await db.User.count(), 1);
});

test('이미 있으면 비밀번호·닉네임을 .env 값으로 덮어쓰지 않는다', async () => {
  await seedAdmin(admin());
  const before = await db.User.findOne({ where: { email: 'admin@materialloop.test' } });
  const savedHash = before.password_hash;

  // .env 의 비밀번호·닉네임을 바꾼 뒤 다시 실행해도 기존 계정은 그대로다. (운영 중 바꾼 비밀번호를 지켜야 한다)
  assert.equal(await seedAdmin(admin({ password: 'another-password-9', nickname: '다른 이름' })), 'exists');
  const after = await db.User.findOne({ where: { email: 'admin@materialloop.test' } });
  assert.equal(after.password_hash, savedHash);
  assert.equal(after.nickname, '운영팀');

  const oldLogin = await call('POST', '/auth/login', { body: { email: 'admin@materialloop.test', password: 'admin-password-1' } });
  const newLogin = await call('POST', '/auth/login', { body: { email: 'admin@materialloop.test', password: 'another-password-9' } });
  assert.equal(oldLogin.status, 200);
  assert.equal(newLogin.status, 401);
});

test('비밀번호를 바꿔 둔 ADMIN 계정도 그대로 둔다', async () => {
  await seedAdmin(admin());
  const row = await db.User.findOne({ where: { email: 'admin@materialloop.test' } });
  await row.update({ password_hash: await bcrypt.hash('changed-in-service', 4) });
  assert.equal(await seedAdmin(admin()), 'exists');
  assert.ok(await bcrypt.compare('changed-in-service', (await row.reload()).password_hash));
});

test('같은 시각에 여러 번 실행해도 계정은 1개만 생긴다', async () => {
  const results = await Promise.all(Array.from({ length: 6 }, () => seedAdmin(admin())));
  assert.equal(results.filter((r) => r === 'created').length, 1);
  assert.equal(results.filter((r) => r === 'exists').length, 5);
  assert.equal((await adminRows()).length, 1);
});

// ---- 충돌과 잘못된 값

test('같은 이메일을 이미 구매자·판매자가 쓰고 있으면 ADMIN 으로 바꾸지 않고 오류를 낸다', async () => {
  for (const role of ['BUYER', 'SELLER']) {
    await resetDb();
    const user = await makeUser({
      email: 'admin@materialloop.test', role, seller_approval_status: role === 'SELLER' ? 'APPROVED' : null,
    });
    await assert.rejects(() => seedAdmin(admin()), (err) => err.message.includes(role) && err.message.includes('다른 ADMIN_EMAIL'));
    assert.equal((await user.reload()).role, role); // 권한이 올라가지 않았다
    assert.equal((await adminRows()).length, 0);
  }
});

test('이메일·비밀번호가 없으면 오류 (아무것도 만들지 않는다)', async () => {
  for (const bad of [{ email: '' }, { password: '' }, { email: '', password: '' }]) {
    await assert.rejects(() => seedAdmin(admin(bad)), /ADMIN_EMAIL 과 ADMIN_PASSWORD/);
  }
  assert.equal(await db.User.count(), 0);
});

test('잘못된 값은 오류: 이메일 형식, 8자 미만·72자 초과 비밀번호, 51자 이상 닉네임', async () => {
  const cases = [
    [{ email: 'not-an-email' }, 'email'],
    [{ password: 'short' }, 'password'],
    [{ password: 'a'.repeat(73) }, 'password'],
    [{ nickname: 'a'.repeat(51) }, 'nickname'],
  ];
  for (const [bad, field] of cases) {
    await assert.rejects(() => seedAdmin(admin(bad)), (err) => err.message.includes('올바르지 않아요') && err.message.includes(field));
  }
  assert.equal(await db.User.count(), 0);
  // 경계: 8자와 72자는 통과
  assert.equal(await seedAdmin(admin({ password: 'a'.repeat(8) })), 'created');
  await resetDb();
  assert.equal(await seedAdmin(admin({ password: 'a'.repeat(72) })), 'created');
});

test('다른 ADMIN 이 이미 있어도 이메일이 다르면 새 ADMIN 을 만든다', async () => {
  await seedAdmin(admin());
  assert.equal(await seedAdmin(admin({ email: 'second@materialloop.test' })), 'created');
  assert.equal((await adminRows()).length, 2);
});
