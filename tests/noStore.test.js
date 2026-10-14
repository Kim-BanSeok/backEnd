import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createApp } from '../src/app.js';
import { env } from '../src/config/env.js';
import { noStore } from '../src/middlewares/noStore.js';
import { signToken } from '../src/services/auth.service.js';
import { aiSessionsStore } from '../src/dao/aiSessions.dao.js';
import { setProvider } from '../src/ai/index.js';
import { db, resetDb, makeUser, makeStore, makeFabric } from './helpers.js';

beforeEach(async () => { await resetDb(); await aiSessionsStore.clear(); setProvider(); });
after(async () => { setProvider(); await db.sequelize.close(); });

async function serve(t, app = createApp()) {
  // Windows에서 임시 포트가 fetch 금지 포트(예: 10080)가 되는 경우를 피한다.
  let server;
  for (let port = 49152; port < 49172; port += 1) {
    server = app.listen(port, '127.0.0.1');
    const error = await new Promise(resolve => { server.once('listening', () => resolve(null)); server.once('error', resolve); });
    if (!error) break;
    if (error.code !== 'EADDRINUSE' || port === 49171) throw error;
  }
  t.after(() => new Promise(resolve => server.close(resolve)));
  return async (path, { token, body, rawBody, headers, ...options } = {}) => fetch(`http://127.0.0.1:${server.address().port}${path}`, {
    ...options,
    headers: { ...(token && { Authorization: `Bearer ${token}` }), ...(body !== undefined && { 'Content-Type': 'application/json' }), ...headers },
    ...(rawBody !== undefined ? { body: rawBody } : body !== undefined && { body: JSON.stringify(body) }),
  });
}
function protectedResponse(response, status) {
  assert.equal(response.status, status);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('pragma'), 'no-cache');
  assert.equal(response.headers.get('expires'), '0');
  assert.equal(response.headers.get('etag'), null);
  assert.equal(response.headers.get('last-modified'), null);
}

test('가입·로그인 토큰·개인정보·로그아웃·폐기 토큰 실패 모두 저장하지 않는다', async t => {
  const call = await serve(t);
  const credentials = { email: 'cache@example.invalid', password: 'Cache-local-123' };
  protectedResponse(await call('/api/v1/auth/signup', { method: 'POST', body: { ...credentials, nickname: '캐시 검증', role: 'BUYER', privacy_agreed: true, terms_agreed: true } }), 201);
  const login = await call('/api/v1/auth/login', { method: 'POST', body: credentials });
  protectedResponse(login, 200);
  const token = (await login.json()).data.accessToken;
  assert.ok(token);
  const me = await call('/api/v1/users/me', { token });
  protectedResponse(me, 200);
  assert.equal((await me.json()).data.email, credentials.email);
  protectedResponse(await call('/api/v1/users/me', { token, method: 'HEAD' }), 200);
  protectedResponse(await call('/api/v1/auth/logout', { token, method: 'POST' }), 200);
  protectedResponse(await call('/api/v1/users/me', { token }), 401);
});

test('구매자·판매자·관리자의 목록과 매장 응답을 보호한다', async t => {
  const call = await serve(t);
  const buyer = await makeUser(), { seller } = await makeStore(), admin = await makeUser({ role: 'ADMIN' });
  for (const [user, paths] of [
    [buyer, ['/users/me', '/favorites/me', '/reservations/me', '/buyers/me/inquiries']],
    [seller, ['/stores/me', '/sellers/me/fabrics', '/sellers/me/inquiries', '/sellers/me/reservations', '/sellers/me/fabric-sheet']],
    [admin, ['/admin/fabrics?status=PENDING', '/admin/sellers?status=PENDING']],
  ]) {
    for (const path of paths) protectedResponse(await call('/api/v1' + path, { token: signToken(user) }), 200);
  }
});

test('공개 URL의 인증별 원단 응답도 no-store이고 다른 계정으로 이전 캐시를 재사용하지 않는다', async t => {
  const call = await serve(t);
  const { store, seller } = await makeStore();
  const fabric = await makeFabric(store.store_id, { status: 'PENDING' });
  await db.FabricDetail.create({ fabric_id: fabric.fabric_id, width_cm: 100, length_cm: 50, sheet_count: 1, thickness: 'THIN', color_family: 'BLUE' });
  const path = `/api/v1/fabrics/${fabric.fabric_id}`;
  protectedResponse(await call(path, { token: signToken(seller) }), 200);
  protectedResponse(await call(path), 404);
  protectedResponse(await call('/api/v1/fabrics'), 200);
  const first = await makeUser({ nickname: '첫 번째 계정' }), second = await makeUser({ nickname: '두 번째 계정' });
  for (const user of [first, second]) {
    const response = await call('/api/v1/users/me', { token: signToken(user), headers: { 'If-None-Match': 'W/"previous-account-cache"', 'If-Modified-Since': 'Wed, 01 Jan 2099 00:00:00 GMT' } });
    protectedResponse(response, 200);
    assert.equal((await response.json()).data.nickname, user.nickname);
  }
});

test('AI 세션 생성·대화 조회·도안 입력 거절에도 캐시 정책이 유지된다', async t => {
  const call = await serve(t), { seller } = await makeStore(), buyer = await makeUser();
  const token = signToken(seller);
  const started = await call('/api/v1/ai-sessions', { token, method: 'POST' });
  protectedResponse(started, 201);
  const sessionId = (await started.json()).data.sessionId;
  assert.ok(sessionId);
  protectedResponse(await call(`/api/v1/ai-sessions/${sessionId}`, { token }), 200);
  protectedResponse(await call(`/api/v1/ai-sessions/${sessionId}`, { token: signToken(buyer) }), 403);
  protectedResponse(await call('/api/v1/pattern-drafts', { token: signToken(buyer), method: 'POST', body: {} }), 400);
});

test('파싱·입력·인증·권한·미등록 경로·사진 실패와 서버 오류도 저장하지 않는다', async t => {
  const call = await serve(t), buyer = await makeUser(), token = signToken(buyer);
  protectedResponse(await call('/api/v1/auth/login', { method: 'POST', body: {} }), 400);
  const raw = await call('/api/v1/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, rawBody: '{' });
  protectedResponse(raw, 400);
  protectedResponse(await call('/api/v1/users/me'), 401);
  protectedResponse(await call('/api/v1/users/me', { token: 'invalid-token' }), 401);
  protectedResponse(await call('/api/v1/sellers/me/fabrics', { token }), 403);
  protectedResponse(await call('/api/v1/cache-missing'), 404);
  protectedResponse(await call('/uploads/cache-missing.png', { token: 'invalid-token' }), 401);
  protectedResponse(await call('/uploads/cache-missing.png'), 404);
  t.mock.method(db.User, 'findByPk', async () => { throw new Error('synthetic local DB failure'); });
  protectedResponse(await call('/api/v1/users/me', { token }), 500);
});

test('본문 처리 전의 429와 CORS OPTIONS에도 no-store가 있다', async t => {
  const max = env.apiRateLimit.max;
  let app;
  try { env.apiRateLimit.max = 1; app = createApp(); } finally { env.apiRateLimit.max = max; }
  const call = await serve(t, app);
  protectedResponse(await call('/api/v1/auth/login', { method: 'OPTIONS', headers: { Origin: 'http://localhost:5173', 'Access-Control-Request-Method': 'POST' } }), 204);
  protectedResponse(await call('/api/v1/health'), 200);
  protectedResponse(await call('/api/v1/users/me', { method: 'PATCH', body: {} }), 429);
});

test('API의 새 경로에도 자동 적용하고 공개 정적 자원의 캐시에는 관여하지 않는다', async t => {
  const app = express();
  app.use(['/api/v1', '/uploads'], noStore);
  app.get('/api/v1/future-personal', (_req, res) => res.json({ personal: true }));
  app.get('/public.css', (_req, res) => res.set('Cache-Control', 'public, max-age=3600').send('body {}'));
  const call = await serve(t, app);
  assert.equal((await call('/api/v1/future-personal')).headers.get('cache-control'), 'no-store');
  const publicAsset = await call('/public.css');
  assert.equal(publicAsset.headers.get('cache-control'), 'public, max-age=3600');
  assert.equal(publicAsset.headers.get('pragma'), null);
});
