import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import sharp from 'sharp';
import bcrypt from 'bcryptjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createApp } from '../src/app.js';
import { env } from '../src/config/env.js';
import { db, resetDb, makeUser, makeStore } from './helpers.js';
import { hashPassword, signToken } from '../src/services/auth.service.js';
import { setProvider } from '../src/ai/index.js';
import { createClaudeProvider } from '../src/ai/claudeProvider.js';
import { createDatabaseAiSessionStore } from '../src/dao/aiSessions.database.js';
import { seedAdmin } from '../src/db/seedAdmin.js';

let server, origin;
const defaults = structuredClone({ call: env.ai.callLimits, session: env.ai.sessionLimits });
before(() => { server = createApp().listen(0); origin = `http://localhost:${server.address().port}`; });
beforeEach(async () => {
  await resetDb(); setProvider();
  Object.assign(env.ai.callLimits, defaults.call); Object.assign(env.ai.sessionLimits, defaults.session);
});
after(async () => { setProvider(); Object.assign(env.ai.callLimits, defaults.call); Object.assign(env.ai.sessionLimits, defaults.session); server.close(); await db.sequelize.close(); });
const api = async (method, path, { token, body, form } = {}) => {
  const response = await fetch(origin + '/api/v1' + path, { method, headers: { ...(token && { Authorization: `Bearer ${token}` }), ...(body && { 'Content-Type': 'application/json' }) }, body: form ?? (body && JSON.stringify(body)) });
  return { status: response.status, json: await response.json() };
};
const signup = password => ({ email: `${Math.random()}@example.invalid`, password, nickname: 'audit', role: 'BUYER', privacy_agreed: true, terms_agreed: true });
const png = () => sharp({ create: { width: 64, height: 48, channels: 3, background: '#446699' } }).png().toBuffer();
async function photo(token, bytes) { const form = new FormData(); form.append('file', new Blob([bytes], { type: 'image/png' }), 'test.png'); return api('POST', '/ai/fabric-photo', { token, form }); }
const sellerAccount = async () => { const { seller } = await makeStore(); return { seller, token: signToken(seller) }; };

test('UTF-8 72바이트 경계를 지켜 가입·로그인하며 legacy 접미사 충돌 입력을 거절한다', async () => {
  for (const password of ['가'.repeat(24) + 'A', '😀'.repeat(18) + 'A']) assert.equal((await api('POST', '/auth/signup', { body: signup(password) })).status, 400);
  const allowed = signup('가'.repeat(24));
  assert.equal((await api('POST', '/auth/signup', { body: allowed })).status, 201);
  assert.equal((await api('POST', '/auth/login', { body: { email: allowed.email, password: allowed.password } })).status, 200);
  const legacy = await makeUser({ password_hash: await bcrypt.hash('가'.repeat(24) + 'A', 4) });
  assert.equal((await api('POST', '/auth/login', { body: { email: legacy.email, password: '가'.repeat(24) + 'B' } })).status, 400);
  assert.equal((await api('POST', '/auth/login', { body: { email: legacy.email, password: '가'.repeat(24) } })).status, 401);
  const shortLegacy = await makeUser({ password_hash: await bcrypt.hash('Legacy-valid-123', 4) });
  assert.equal((await api('POST', '/auth/login', { body: { email: shortLegacy.email, password: 'Legacy-valid-123' } })).status, 200);
  assert.throws(() => hashPassword('가'.repeat(24) + 'A'), { code: 'VALIDATION_ERROR' });
  await assert.rejects(seedAdmin({ email: 'seed@example.invalid', password: '가'.repeat(24) + 'A', nickname: 'audit' }), /72바이트/);
});

test('로그아웃 후 JWT 재사용을 다른 app에서도 차단하고 새 로그인 토큰은 독립적이다', async () => {
  const user = await makeUser(); const token = signToken(user), nextToken = signToken(user);
  assert.notEqual(token, nextToken);
  assert.equal((await api('GET', '/users/me', { token })).status, 200);
  assert.equal((await api('POST', '/auth/logout', { token })).status, 200);
  assert.equal((await api('GET', '/users/me', { token })).status, 401);
  assert.equal((await api('GET', '/users/me', { token: nextToken })).status, 200);
  const saved = await db.RevokedToken.findAll();
  assert.equal(saved.length, 1); assert.equal(saved[0].token_hash.length, 64); assert.ok(!JSON.stringify(saved).includes(token));
  const another = createApp().listen(0);
  try { assert.equal((await fetch(`http://localhost:${another.address().port}/api/v1/users/me`, { headers: { Authorization: `Bearer ${token}` } })).status, 401); }
  finally { another.close(); }
});

test('사진은 서명·소유권·공개 상태를 검사하고 삭제·변조·만료 URL은 거절한다', async () => {
  const owner = await sellerAccount(), other = await sellerAccount();
  const create = await api('POST', '/fabrics', { token: owner.token, body: { sale_type: 'SCRAP', title: 'test', price: 1000, detail: { material: 'COTTON', thickness: 'NORMAL', color_family: 'BLUE', width_cm: 50, length_cm: 60 } } });
  const fabricId = create.json.data.fabricId;
  const image = await sharp(await png()).jpeg().withExif({ IFD0: { Artist: 'PRIVATE-MARKER' } }).toBuffer();
  const form = new FormData(); form.append('file', new Blob([image], { type: 'image/jpeg' }), 'photo.jpg');
  const uploaded = await api('POST', `/fabrics/${fabricId}/images`, { token: owner.token, form });
  assert.equal(uploaded.status, 201);
  const link = new URL(uploaded.json.data.image_url), rawPath = link.pathname, key = rawPath.slice('/uploads/'.length);
  assert.equal((await fetch(origin + rawPath)).status, 404);
  assert.equal((await fetch(origin + rawPath, { headers: { Authorization: `Bearer ${other.token}` } })).status, 404);
  assert.equal((await fetch(origin + rawPath, { headers: { Authorization: `Bearer ${owner.token}` } })).status, 200);
  const signed = await fetch(origin + rawPath + link.search);
  assert.equal(signed.status, 200); assert.equal(signed.headers.get('cache-control'), 'no-store');
  assert.equal((await sharp(Buffer.from(await signed.arrayBuffer())).metadata()).exif, undefined);
  await fs.writeFile(path.join(env.uploadDir, key), image); // Simulate an upload from the previous version.
  assert.ok((await sharp(await fs.readFile(path.join(env.uploadDir, key))).metadata()).exif);
  const legacyDownload = await fetch(origin + rawPath + link.search);
  assert.equal((await sharp(Buffer.from(await legacyDownload.arrayBuffer())).metadata()).exif, undefined);
  const forged = new URL(link); forged.searchParams.set('signature', '0'.repeat(64));
  assert.equal((await fetch(origin + forged.pathname + forged.search)).status, 404);
  const expires = Math.floor(Date.now() / 1000) - 1;
  const signature = createHmac('sha256', env.jwtSecret).update(`image-v1\n${key}\n${expires}`).digest('hex');
  assert.equal((await fetch(`${origin}${rawPath}?expires=${expires}&signature=${signature}`)).status, 404);
  const admin = await makeUser({ role: 'ADMIN' });
  assert.equal((await api('POST', `/admin/fabrics/${fabricId}/approve`, { token: signToken(admin) })).status, 200);
  assert.equal((await fetch(origin + rawPath)).status, 200);
  const buyerToken = signToken(await makeUser());
  assert.equal((await api('POST', '/favorites', { token: buyerToken, body: { target_type: 'FABRIC', fabric_id: fabricId } })).status, 201);
  const publicDetail = await api('GET', `/fabrics/${fabricId}`);
  assert.equal(new URL(publicDetail.json.data.images[0].image_url).search, '');
  await db.Fabric.update({ status: 'PENDING' }, { where: { fabric_id: fabricId } });
  assert.equal((await fetch(origin + rawPath)).status, 404);
  const favorites = await api('GET', '/favorites/me', { token: buyerToken });
  assert.equal(favorites.json.data.content[0].thumbnail_url, null);
  assert.equal((await api('DELETE', `/fabrics/${fabricId}`, { token: owner.token })).status, 200);
  assert.equal((await fetch(origin + rawPath)).status, 404);
  assert.equal((await fetch(origin + rawPath + link.search)).status, 404);
});

test('AI 동시·시간당 한도 초과는 제공자를 호출하지 않고 429로 차단한다', async () => {
  Object.assign(env.ai.callLimits, { userHourly: 2, globalHourly: 3, userConcurrent: 1, globalConcurrent: 2 });
  const account = await sellerAccount(); const bytes = await png();
  let calls = 0, release, started;
  const start = new Promise(resolve => { started = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  setProvider({ name: 'counter', model: 'fake', describeImage: async () => { calls++; started(); await gate; return { values: { title: 'test' } }; } });
  const first = photo(account.token, bytes); await start;
  try { assert.equal((await photo(account.token, bytes)).status, 429); assert.equal(calls, 1); }
  finally { release(); }
  assert.equal((await first).status, 200);
  assert.equal((await photo(account.token, bytes)).status, 200);
  assert.equal((await photo(account.token, bytes)).status, 429);
  assert.equal(calls, 2);
  const other = await sellerAccount();
  assert.equal((await photo(other.token, bytes)).status, 200);
  assert.equal((await photo(other.token, bytes)).status, 429);
  assert.equal(calls, 3); assert.equal(await db.AiUsageLease.count({ where: { kind: 'CALL' } }), 0);
});

test('AI 세션 활성 한도와 DB 복구를 확인하고 중단 후 슬롯을 반환한다', async () => {
  Object.assign(env.ai.sessionLimits, { userConcurrent: 2 });
  const account = await sellerAccount();
  const first = await api('POST', '/ai-sessions', { token: account.token });
  assert.equal(first.status, 201);
  assert.equal((await api('POST', '/ai-sessions', { token: account.token })).status, 201);
  assert.equal((await api('POST', '/ai-sessions', { token: account.token })).status, 429);
  const restored = await createDatabaseAiSessionStore().findById(first.json.data.sessionId);
  assert.equal(restored.seller_id, account.seller.user_id); assert.ok(restored.started_at instanceof Date);
  assert.equal((await api('POST', `/ai-sessions/${restored._id}/abort`, { token: account.token })).status, 200);
  assert.equal((await api('POST', '/ai-sessions', { token: account.token })).status, 201);
});

test('AI 타임아웃은 HTTP 헤더 이후 본문 읽기에도 적용된다', async () => {
  const provider = createClaudeProvider({ apiKey: 'test-only', model: 'fake', timeoutMs: 20, fetchImpl: async (_url, { signal }) => ({ ok: true, json: () => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })) }) });
  await assert.rejects(provider.describeImage({ mediaType: 'image/png', data: '' }), { name: 'AbortError' });
});
