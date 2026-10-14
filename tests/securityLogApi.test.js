import { test, before, beforeEach, afterEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import express from 'express';
import sharp from 'sharp';
import { createApp } from '../src/app.js';
import { env } from '../src/config/env.js';
import { hashPassword, signToken } from '../src/services/auth.service.js';
import { setProvider } from '../src/ai/index.js';
import { aiSessionsStore } from '../src/dao/aiSessions.dao.js';
import { startAiSessionMaintenance } from '../src/services/aiSessionMaintenance.service.js';
import { createSecurityLogger, setSecurityLogger } from '../src/utils/securityLog.js';
import { securityRequestLog } from '../src/middlewares/securityRequestLog.js';
import { errorHandler } from '../src/middlewares/errorHandler.js';
import { createAuthLimiter } from '../src/middlewares/rateLimiters.js';
import { db, resetDb, makeUser, makeStore, makeFabric } from './helpers.js';

let server, origin, logger, lines;
const defaults = structuredClone({ call: env.ai.callLimits, session: env.ai.sessionLimits });
const SECRET = 'SECRET-MARKER';
const rows = () => lines.map(line => JSON.parse(line));
before(() => {
  server = createApp().listen(0);
  origin = `http://localhost:${server.address().port}`;
});
beforeEach(async () => {
  await resetDb(); await aiSessionsStore.clear(); setProvider();
  Object.assign(env.ai.callLimits, defaults.call); Object.assign(env.ai.sessionLimits, defaults.session);
  lines = [];
  const stream = new EventEmitter();
  stream.write = line => { lines.push(line); return true; };
  logger = createSecurityLogger({ stream, key: Buffer.alloc(32, 1) });
  setSecurityLogger(logger);
});
afterEach(() => {
  setSecurityLogger(); logger.close(); setProvider();
  Object.assign(env.ai.callLimits, defaults.call); Object.assign(env.ai.sessionLimits, defaults.session);
  assert.ok(!lines.join('').includes(SECRET), '로그에 비밀 마커가 남았습니다.');
});
after(async () => { server.close(); await db.sequelize.close(); });

async function call(method, path, { body, token, form, headers = {}, raw } = {}) {
  const response = await fetch(origin + path, {
    method, headers: { ...(body !== undefined && { 'Content-Type': 'application/json' }), ...(token && { Authorization: `Bearer ${token}` }), ...headers },
    body: form ?? raw ?? (body !== undefined ? JSON.stringify(body) : undefined),
  });
  return { status: response.status, id: response.headers.get('x-request-id'), json: await response.json() };
}
const api = (method, path, options) => call(method, '/api/v1' + path, options);
async function account(role = 'BUYER') {
  const user = await makeUser({ role, password_hash: await hashPassword(SECRET + '-password') });
  return { user, token: signToken(user) };
}
async function patternContext() {
  const { store } = await makeStore();
  const fabric = await makeFabric(store.store_id, { status: 'POSTED' });
  await db.FabricDetail.create({ fabric_id: fabric.fabric_id, width_cm: 80, length_cm: 60, sheet_count: 1,
    material: 'COTTON', thickness: 'NORMAL', color_family: 'BLUE' });
  const { token } = await account();
  return { fabric, token, body: { fabric_id: fabric.fabric_id, item_name: '파우치', note: SECRET } };
}

test('가입·로그인·로그아웃은 요청마다 한 번 기록하고 응답 ID·검증한 사용자와 연결한다', async () => {
  const input = { email: `${SECRET}@example.invalid`, password: SECRET + '-password', nickname: SECRET,
    role: 'BUYER', terms_agreed: true, privacy_agreed: true };
  const signup = await api('POST', '/auth/signup', { body: input, headers: { 'X-Request-Id': SECRET, Cookie: SECRET } });
  assert.equal(signup.status, 201);
  const login = await api('POST', '/auth/login', { body: { email: input.email, password: input.password } });
  assert.equal(login.status, 200);
  const token = login.json.data.accessToken;
  const logout = await api('POST', '/auth/logout', { token });
  assert.equal(logout.status, 200);
  assert.deepEqual(rows().map(row => row.event), ['auth.signup.success', 'auth.login.success', 'auth.logout.success']);
  assert.deepEqual(rows().map(row => row.request_id), [signup.id, login.id, logout.id]);
  assert.equal(new Set(rows().map(row => row.request_id)).size, 3);
  for (const row of rows()) {
    assert.equal(row.actor_id, signup.json.data.userId);
    assert.equal(row.actor_role, 'BUYER');
    assert.equal(row.method, 'POST');
    assert.match(row.ip_hash, /^[a-f0-9]{64}$/);
  }
  assert.ok(!lines.join('').includes(token));
});

test('틀린 비밀번호·없는 계정은 동일한 실패 이벤트이고 입력 계정을 검증된 사용자로 기록하지 않는다', async () => {
  const { user } = await account();
  for (const email of [user.email, `${SECRET}@example.invalid`]) {
    const response = await api('POST', '/auth/login', { body: { email, password: SECRET + '-wrong' } });
    assert.equal(response.status, 401);
    const row = rows().at(-1);
    assert.equal(row.event, 'auth.login.failed');
    assert.equal(row.error_code, 'LOGIN_FAILED');
    assert.equal(row.request_id, response.id);
    assert.ok(!('actor_id' in row));
  }
});

test('위조·폐기된 JWT의 인증 거절은 토큰·payload를 남기지 않는다', async () => {
  const { token } = await account();
  assert.equal((await api('GET', '/users/me', { token: SECRET })).status, 401);
  assert.equal((await api('POST', '/auth/logout', { token })).status, 200);
  assert.equal((await api('GET', '/users/me', { token })).status, 401);
  const denied = rows().filter(row => row.event === 'auth.denied');
  assert.equal(denied.length, 2);
  assert.ok(denied.every(row => row.error_code === 'UNAUTHORIZED' && !('actor_id' in row)));
  assert.ok(!lines.join('').includes(token));
});

test('역할 거절은 JWT가 주장한 역할 대신 DB에서 검증한 사용자를 기록한다', async () => {
  const { user } = await account();
  const spoofedRole = signToken({ ...user.toJSON(), role: 'ADMIN' });
  const response = await api('GET', '/admin/sellers', { token: spoofedRole });
  assert.equal(response.status, 403);
  assert.deepEqual(rows().map(row => [row.event, row.actor_id, row.actor_role, row.error_code]),
    [['permission.denied', user.user_id, 'BUYER', 'FORBIDDEN']]);
});

test('다른 판매자의 원단 소유권 거절도 사용자·템플릿 경로만 기록한다', async () => {
  const { store } = await makeStore();
  const fabric = await makeFabric(store.store_id);
  const { seller } = await makeStore();
  const response = await api('DELETE', `/fabrics/${fabric.fabric_id}`, { token: signToken(seller) });
  assert.equal(response.status, 403);
  const row = rows()[0];
  assert.equal(row.event, 'permission.denied');
  assert.equal(row.actor_id, seller.user_id);
  assert.equal(row.route, '/api/v1/fabrics/:fabricId');
});

test('입력 오류·깨진 JSON·미등록 경로는 본문·필드명·query·URL을 기록하지 않는다', async () => {
  assert.equal((await api('POST', '/auth/login', { body: { email: 'test@example.invalid', password: SECRET, [SECRET]: SECRET } })).status, 400);
  assert.equal((await api('POST', '/auth/login', { headers: { 'Content-Type': 'application/json' }, raw: '{' + SECRET })).status, 400);
  assert.equal((await api('GET', `/${SECRET}?signature=${SECRET}`)).status, 404);
  assert.deepEqual(rows().map(row => row.event), ['validation.failed', 'validation.failed', 'request.rejected']);
  assert.equal(rows()[2].route, '/api/v1/[unmatched]');
});

test('사진 거절은 파일 경로·서명·쿠키를 제외하고 접근 거절로 기록한다', async () => {
  const response = await call('GET', `/uploads/${SECRET}.jpg?signature=${SECRET}`, { headers: { Cookie: SECRET } });
  assert.equal(response.status, 404);
  assert.equal(rows()[0].event, 'image.access.denied');
  assert.equal(rows()[0].route, '/uploads/[file]');
  assert.equal(rows()[0].request_id, response.id);
});

test('예상 밖 DB 오류는 원시 메시지·SQL·stack 대신 안전한 종류와 500만 남긴다', async (t) => {
  const { token } = await account();
  const error = new Error(SECRET + ' postgres://user:password@remote.invalid/db');
  error.name = 'SequelizeDatabaseError'; error.sql = SECRET; error.stack = SECRET;
  error.toJSON = () => { assert.fail('원시 오류 직렬화'); };
  t.mock.method(db.User, 'findByPk', async () => { throw error; });
  const response = await api('GET', '/users/me', { token });
  assert.equal(response.status, 500);
  assert.equal(response.json.error.code, 'INTERNAL_ERROR');
  assert.equal(rows()[0].event, 'request.failed');
  assert.equal(rows()[0].error_type, 'SequelizeDatabaseError');
  assert.equal(rows()[0].error_code, 'INTERNAL_ERROR');
});

test('로그 수집기 실패가 정상 로그인·토큰 발급을 변경하지 않는다', async () => {
  const { user } = await account();
  setSecurityLogger({ log() { throw new Error(SECRET); } });
  const response = await api('POST', '/auth/login', { body: { email: user.email, password: SECRET + '-password' } });
  assert.equal(response.status, 200);
  assert.ok(response.json.data.accessToken);
});

test('관리자 사용과 엑셀 다운로드는 검증한 역할과 경로로 기록한다', async () => {
  const admin = await account('ADMIN');
  assert.equal((await api('GET', '/admin/sellers', { token: admin.token })).status, 200);
  const { seller } = await makeStore();
  const response = await fetch(origin + '/api/v1/sellers/me/fabric-sheet', { headers: { Authorization: `Bearer ${signToken(seller)}` } });
  assert.equal(response.status, 200); await response.arrayBuffer();
  assert.deepEqual(rows().map(row => row.event), ['admin.action', 'data.export.success']);
  assert.equal(rows()[0].actor_role, 'ADMIN');
  assert.equal(rows()[1].actor_id, seller.user_id);
});

test('정상 사진 업로드는 파일명·사진 데이터·서명 URL을 기록하지 않는다', async () => {
  const { seller, store } = await makeStore();
  const fabric = await makeFabric(store.store_id);
  const bytes = await sharp({ create: { width: 32, height: 32, channels: 3, background: '#446699' } }).png().toBuffer();
  const form = new FormData(); form.append('file', new Blob([bytes], { type: 'image/png' }), SECRET + '.png');
  const response = await api('POST', `/fabrics/${fabric.fabric_id}/images`, { token: signToken(seller), form });
  assert.equal(response.status, 201);
  assert.equal(rows()[0].event, 'file.upload.success');
  assert.equal(rows()[0].route, '/api/v1/fabrics/:fabricId/images');
  assert.ok(!lines.join('').includes(new URL(response.json.data.image_url).searchParams.get('signature')));
});

const listingBody = { material_text: '면 원단', thickness: 'NORMAL', thickness_label: '보통', width_cm: 100,
  length_cm: 200, sale_type: 'ROLL', memo: SECRET, images: [{ media_type: 'image/png', data: 'dGVzdA==' }] };
for (const operation of ['listing', 'dialogue', 'photo', 'pattern']) {
  test(`AI ${operation} 실패의 안전한 진단과 HTTP 결과를 같은 요청 ID로 연결한다`, async () => {
    const { seller } = await makeStore();
    const token = signToken(seller);
    const throwing = async () => { throw new Error(SECRET + ' token=secret&prompt=private'); };
    setProvider({ describeProduct: throwing, extract: throwing, describeImage: throwing, draftPattern: throwing });
    let response;
    if (operation === 'listing') response = await api('POST', '/ai-sessions/listings', { token, body: listingBody });
    else if (operation === 'dialogue') {
      const session = await api('POST', '/ai-sessions', { token });
      assert.equal(session.status, 201);
      response = await api('POST', `/ai-sessions/${session.json.data.sessionId}/answers`, { token, body: { answer: SECRET } });
    } else if (operation === 'photo') {
      const bytes = await sharp({ create: { width: 32, height: 32, channels: 3, background: '#446699' } }).png().toBuffer();
      const form = new FormData(); form.append('file', new Blob([bytes], { type: 'image/png' }), SECRET + '.png');
      response = await api('POST', '/ai/fabric-photo', { token, form });
    } else {
      const ctx = await patternContext();
      response = await api('POST', '/pattern-drafts', { token: ctx.token, body: ctx.body });
    }
    assert.equal(response.status, 503, JSON.stringify(response.json));
    const diagnostics = rows().filter(row => row.event === 'ai.provider.failed');
    assert.equal(diagnostics.length, 1);
    assert.equal(diagnostics[0].operation, operation);
    assert.equal(diagnostics[0].error_type, 'Error');
    assert.equal(diagnostics[0].request_id, response.id);
    const outcome = rows().find(row => row.event === 'ai.unavailable');
    assert.equal(outcome.request_id, response.id);
    assert.equal(diagnostics[0].route, outcome.route);
    assert.equal(outcome.error_code, 'AI_UNAVAILABLE');
  });
}

test('AI 세션·호출 한도 초과는 각각의 범위를 기록하고 실제 429를 유지한다', async () => {
  const { seller } = await makeStore();
  const token = signToken(seller);
  env.ai.sessionLimits.userConcurrent = 1;
  assert.equal((await api('POST', '/ai-sessions', { token })).status, 201);
  assert.equal((await api('POST', '/ai-sessions', { token })).status, 429);
  assert.equal(rows().at(-1).limit_scope, 'ai_session');
  env.ai.callLimits.userHourly = 1;
  const ctx = await patternContext();
  setProvider({ draftPattern: async () => ({ title: '파우치', parts: [{ part_name: '몸판', width_cm: 20, height_cm: 30, quantity: 2 }] }) });
  assert.equal((await api('POST', '/pattern-drafts', { token: ctx.token, body: ctx.body })).status, 201);
  assert.equal((await api('POST', '/pattern-drafts', { token: ctx.token, body: ctx.body })).status, 429);
  assert.equal(rows().at(-1).event, 'rate_limit.exceeded');
  assert.equal(rows().at(-1).limit_scope, 'ai_call');
});

test('API 기본 제한과 인증 전용 제한의 범위를 구분한다', async (t) => {
  const max = env.apiRateLimit.max;
  env.apiRateLimit.max = 1;
  const another = createApp().listen(0);
  env.apiRateLimit.max = max;
  t.after(() => another.close());
  const url = `http://localhost:${another.address().port}/api/v1/health`;
  assert.equal((await fetch(url)).status, 200);
  assert.equal((await fetch(url)).status, 429);
  assert.equal(rows().at(-1).limit_scope, 'api');
  const app = express();
  app.use('/api/v1', securityRequestLog);
  app.post('/api/v1/auth/login', createAuthLimiter({ max: 1 }), (_req, res) => res.sendStatus(200));
  app.use(errorHandler);
  const authServer = app.listen(0); t.after(() => authServer.close());
  const authUrl = `http://localhost:${authServer.address().port}/api/v1/auth/login`;
  assert.equal((await fetch(authUrl, { method: 'POST' })).status, 200);
  assert.equal((await fetch(authUrl, { method: 'POST' })).status, 429);
  assert.equal(rows().at(-1).limit_scope, 'auth');
});

test('백그라운드 정리 오류도 원시 메시지 없이 기록하고 다음 정리는 계속한다', async () => {
  let finish;
  const pending = new Promise(resolve => { finish = resolve; });
  const stop = startAiSessionMaintenance({ store: { cleanup() { finish(); throw new Error(SECRET); } } });
  await pending; await stop();
  assert.equal(rows()[0].event, 'ai.maintenance.failed');
  assert.equal(rows()[0].operation, 'cleanup');
  assert.equal(rows()[0].error_type, 'Error');
  assert.ok(!('request_id' in rows()[0]));
});

test('응답 전 연결 종료도 한 번 기록하고 정상 응답 close를 중복 기록하지 않는다', async (t) => {
  let entered;
  const started = new Promise(resolve => { entered = resolve; });
  let closed;
  const ended = new Promise(resolve => { closed = resolve; });
  const app = express();
  app.use('/api/v1', securityRequestLog);
  app.get('/api/v1/slow', (_req, res) => { res.on('close', closed); entered(); });
  const slow = app.listen(0); t.after(() => slow.close());
  const controller = new AbortController();
  const pending = fetch(`http://localhost:${slow.address().port}/api/v1/slow?token=${SECRET}`, { signal: controller.signal });
  pending.catch(() => {});
  await started; controller.abort(); await assert.rejects(pending, { name: 'AbortError' }); await ended;
  assert.equal(rows().length, 1);
  assert.equal(rows()[0].event, 'request.aborted');
  assert.ok(!('status_code' in rows()[0]));
});
