import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import express from 'express';
import { createApp } from '../src/app.js';
import { env } from '../src/config/env.js';
import { createApiLimiter, createAuthLimiter } from '../src/middlewares/rateLimiters.js';
import { errorHandler } from '../src/middlewares/errorHandler.js';
import { fail } from '../src/utils/errors.js';
import routes from '../src/routes/index.js';
import { signToken } from '../src/services/auth.service.js';
import { getProvider } from '../src/ai/index.js';
import { db } from './helpers.js';

after(() => db.sequelize.close());

function serve(t, app) {
  const server = app.listen(0, '127.0.0.1');
  const listening = new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  return async (path, options) => {
    await listening;
    return fetch(`http://127.0.0.1:${server.address().port}${path}`, options);
  };
}

function limitedApp(t, { max = 3, windowMs = 60000, trustedProxyCidrs = [] } = {}) {
  const previous = { ...env.apiRateLimit };
  const proxies = env.trustedProxyCidrs;
  try {
    Object.assign(env.apiRateLimit, { max, windowMs });
    env.trustedProxyCidrs = trustedProxyCidrs;
    return serve(t, createApp());
  } finally {
    Object.assign(env.apiRateLimit, previous);
    env.trustedProxyCidrs = proxies;
  }
}
async function assertBlocked(response, { head = false } = {}) {
  assert.equal(response.status, 429);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.ok(Number(response.headers.get('retry-after')) > 0);
  assert.match(response.headers.get('ratelimit'), /"api"/);
  assert.ok(!response.headers.has('x-ratelimit-limit'));
  if (!head) {
    assert.deepEqual(await response.json(), {
      success: false, error: { code: 'TOO_MANY_REQUESTS', message: '요청이 너무 많아요. 잠시 후 다시 시도해 주세요' },
    });
  }
}

test('전체 API: 경로·메서드·query·토큰을 바꿔도 같은 IP의 사용량을 합산한다', async (t) => {
  const call = limitedApp(t);
  assert.equal((await call('/api/v1/health')).status, 200);
  assert.equal((await call('/api/v1/users/me', { method: 'PATCH' })).status, 401);
  assert.equal((await call('/api/v1/없는경로?unused=1', { method: 'DELETE' })).status, 404);
  await assertBlocked(await call('/api/v1/health?different=2', { headers: { Authorization: 'Bearer fake' } }));
});

function collectRoutes(router) {
  return router.stack.flatMap(layer => layer.route
    ? Object.keys(layer.route.methods).map(method => [method.toUpperCase(), layer.route.path.replace(/:\w+/g, '1')])
    : layer.handle?.stack ? collectRoutes(layer.handle) : []);
}

test('연결된 모든 API·사진 조회를 제한하고 초과 요청은 인증·DB·AI에 진입하지 않는다', async (t) => {
  const call = limitedApp(t, { max: 1 });
  assert.equal((await call('/api/v1/health')).status, 200);
  const queries = t.mock.method(db.sequelize, 'query', async () => { assert.fail('차단된 요청이 DB를 호출했습니다.'); });
  const providerCalls = Object.entries(getProvider()).filter(([, value]) => typeof value === 'function')
    .map(([name]) => t.mock.method(getProvider(), name, async () => { assert.fail('차단된 요청이 AI를 호출했습니다.'); }));
  const token = signToken({ user_id: 1, role: 'SELLER' });
  const endpoints = collectRoutes(routes);
  assert.ok(endpoints.length >= 55);
  for (const [method, path] of endpoints) {
    await assertBlocked(await call(`/api/v1${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(method !== 'GET' && { 'Content-Type': 'application/json' }) },
      ...(method !== 'GET' && { body: '{invalid JSON' }),
    }));
  }
  await assertBlocked(await call('/uploads/no-such-image.jpg?signature=bad', { headers: { Authorization: `Bearer ${token}` } }));
  await assertBlocked(await call('/uploads/no-such-image.jpg', { method: 'HEAD' }), { head: true });
  assert.equal(queries.mock.callCount(), 0);
  for (const method of providerCalls) assert.equal(method.mock.callCount(), 0);
});

test('같은 IP의 구매자·판매자·관리자 토큰 교체는 한도를 초기화하지 않는다', async (t) => {
  const call = limitedApp(t, { max: 1 });
  assert.equal((await call('/api/v1/health')).status, 200);
  for (const [index, role] of ['BUYER', 'SELLER', 'ADMIN'].entries()) {
    await assertBlocked(await call('/api/v1/users/me', {
      headers: { Authorization: `Bearer ${signToken({ user_id: index + 1, role })}` },
    }));
  }
});

test('JSON 파싱 전에 제한한다: 잘못된 JSON도 세며 초과한 큰 본문은 429다', async (t) => {
  const call = limitedApp(t, { max: 1 });
  const bad = await call('/api/v1/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{broken' });
  assert.equal(bad.status, 400);
  assert.equal((await bad.json()).error.code, 'VALIDATION_ERROR');
  await assertBlocked(await call('/api/v1/auth/signup', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' + 'x'.repeat(8 * 1024 * 1024),
  }));
});

test('multipart 업로드도 파서·파일 저장 전에 초과 요청을 거절한다', async (t) => {
  const call = limitedApp(t, { max: 1 });
  await call('/api/v1/health');
  for (const path of ['/api/v1/ai/fabric-photo', '/api/v1/fabrics/1/images', '/api/v1/sellers/me/fabric-sheet']) {
    const form = new FormData();
    form.append('file', new Blob(['invalid file']), 'test.bin');
    await assertBlocked(await call(path, { method: 'POST', body: form }));
  }
});

test('사진 URL과 API는 한도를 공유한다 (404 사진 요청도 센다)', async (t) => {
  const call = limitedApp(t, { max: 2 });
  assert.equal((await call('/uploads/no-such-image.jpg')).status, 404);
  assert.equal((await call('/api/v1/health')).status, 200);
  await assertBlocked(await call('/uploads/different.jpg'));
  await assertBlocked(await call('/api/v1/health'));
});

test('동시에 온 요청도 정확히 한도까지만 통과한다', async (t) => {
  const call = limitedApp(t, { max: 3 });
  const responses = await Promise.all(Array.from({ length: 12 }, () => call('/api/v1/health')));
  assert.equal(responses.filter(response => response.status === 200).length, 3);
  assert.equal(responses.filter(response => response.status === 429).length, 9);
});

test('시간 창이 만료되면 같은 IP가 다시 요청할 수 있다', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
  const call = limitedApp(t, { max: 1, windowMs: 60000 });
  assert.equal((await call('/api/v1/health')).status, 200);
  await assertBlocked(await call('/api/v1/health'));
  t.mock.timers.tick(60001);
  assert.equal((await call('/api/v1/health')).status, 200);
});

test('브라우저 preflight와 Swagger는 API 한도를 사용하지 않는다', async (t) => {
  const call = limitedApp(t, { max: 1 });
  for (let index = 0; index < 3; index++) {
    assert.equal((await call('/api/v1/fabrics', {
      method: 'OPTIONS', headers: { Origin: env.corsOrigins[0], 'Access-Control-Request-Method': 'POST' },
    })).status, 204);
    assert.equal((await call('/api-docs.json')).status, 200);
  }
  assert.equal((await call('/api/v1/health')).status, 200);
  await assertBlocked(await call('/api/v1/health'));
  assert.equal((await call('/api-docs.json')).status, 200);
});

test('429와 정상 응답에 제한 헤더·CORS 노출·보안 헤더를 유지한다', async (t) => {
  const call = limitedApp(t, { max: 1 });
  const headers = { Origin: env.corsOrigins[0] };
  const response = await call('/api/v1/health', { headers });
  assert.match(response.headers.get('ratelimit-policy'), /"api"; q=1; w=60/);
  assert.match(response.headers.get('ratelimit'), /r=0/);
  assert.equal(response.headers.get('retry-after'), null);
  const blocked = await call('/api/v1/health', { headers });
  await assertBlocked(blocked);
  assert.equal(blocked.headers.get('access-control-allow-origin'), env.corsOrigins[0]);
  assert.equal(blocked.headers.get('access-control-expose-headers'), 'RateLimit,RateLimit-Policy,Retry-After,X-Request-Id');
  assert.equal(blocked.headers.get('x-content-type-options'), 'nosniff');
});

test('신뢰하지 않는 전달 헤더를 바꿔도 직접 연결 IP의 한도를 우회하지 못한다', async (t) => {
  // 라이브러리가 미설정 프록시의 전달 헤더에 남기는 경고도 예상한 종류인지 확인한다.
  const warnings = t.mock.method(console, 'error', () => {});
  const call = limitedApp(t, { max: 1 });
  assert.equal((await call('/api/v1/health', { headers: { 'X-Forwarded-For': '198.51.100.1', Forwarded: 'for=198.51.100.1' } })).status, 200);
  await assertBlocked(await call('/api/v1/health', { headers: { 'X-Forwarded-For': '198.51.100.2', Forwarded: 'for=198.51.100.2' } }));
  for (const invocation of warnings.mock.calls) {
    assert.ok(['ERR_ERL_UNEXPECTED_X_FORWARDED_FOR', 'ERR_ERL_FORWARDED_HEADER'].includes(invocation.arguments[0].code));
  }
});

test('명시한 프록시만 신뢰하면 서로 다른 IPv4 주소는 한도가 분리된다', async (t) => {
  const call = limitedApp(t, { max: 1, trustedProxyCidrs: ['127.0.0.1/32'] });
  assert.equal((await call('/api/v1/health', { headers: { 'X-Forwarded-For': '198.51.100.1' } })).status, 200);
  await assertBlocked(await call('/api/v1/health', { headers: { 'X-Forwarded-For': '198.51.100.1' } }));
  assert.equal((await call('/api/v1/health', { headers: { 'X-Forwarded-For': '198.51.100.2' } })).status, 200);
});

test('신뢰 프록시 뒤에서도 가장 가까운 비신뢰 주소 앞의 위조 주소는 무시한다', async (t) => {
  const call = limitedApp(t, { max: 1, trustedProxyCidrs: ['127.0.0.1/32'] });
  const response = await call('/api/v1/health', { headers: { 'X-Forwarded-For': '198.51.100.1, 203.0.113.9' } });
  assert.equal(response.status, 200);
  await assertBlocked(await call('/api/v1/health', { headers: { 'X-Forwarded-For': '198.51.100.2, 203.0.113.9' } }));
});

test('IPv6 /56 안의 주소 교체와 IPv4-mapped 표현으로 한도를 우회하지 못한다', async (t) => {
  const call = limitedApp(t, { max: 1, trustedProxyCidrs: ['127.0.0.1/32'] });
  assert.equal((await call('/api/v1/health', { headers: { 'X-Forwarded-For': '2001:db8:1234:5601::1' } })).status, 200);
  await assertBlocked(await call('/api/v1/health', { headers: { 'X-Forwarded-For': '2001:db8:1234:56ff::2' } }));
  assert.equal((await call('/api/v1/health', { headers: { 'X-Forwarded-For': '2001:db8:1234:5701::1' } })).status, 200);
  assert.equal((await call('/api/v1/health', { headers: { 'X-Forwarded-For': '198.51.100.1' } })).status, 200);
  await assertBlocked(await call('/api/v1/health', { headers: { 'X-Forwarded-For': '::ffff:198.51.100.1' } }));
});

test('기존 가입·로그인 15분 20회 제한은 API 기본 한도보다 먼저 도달하며 둘 다 안내한다', async (t) => {
  const app = express();
  app.use(createApiLimiter({ max: 100 }));
  const limiter = createAuthLimiter({ max: 20 });
  app.post(['/auth/login', '/auth/signup'], limiter, (_req, _res, next) => next(fail('VALIDATION_ERROR')));
  app.use(errorHandler);
  const call = serve(t, app);
  for (let index = 0; index < 20; index++) {
    assert.equal((await call(index % 2 ? '/auth/signup' : '/auth/login', { method: 'POST' })).status, 400);
  }
  const response = await call('/auth/login', { method: 'POST' });
  assert.equal(response.status, 429);
  assert.equal((await response.json()).error.code, 'TOO_MANY_REQUESTS');
  assert.match(response.headers.get('ratelimit'), /"api"/);
  assert.match(response.headers.get('ratelimit'), /"auth"/);
  assert.match(response.headers.get('ratelimit-policy'), /"auth"; q=20; w=900/);
  assert.ok(Number(response.headers.get('retry-after')) > 0);
});

test('횟수 저장에 실패해도 본문 처리로 통과시키지 않는다', async (t) => {
  let reached = false;
  const store = {
    init() {},
    increment() { throw new Error('test unavailable count store'); },
    decrement() {}, resetKey() {},
  };
  const app = express();
  app.use(createApiLimiter({ max: 3, store }));
  app.get('/test', (_req, res) => { reached = true; res.sendStatus(200); });
  app.use(errorHandler);
  const response = await serve(t, app)('/test');
  assert.equal(response.status, 500);
  assert.equal((await response.json()).error.code, 'INTERNAL_ERROR');
  assert.equal(reached, false);
});

function config(overrides = {}) {
  const source = `const { env } = await import(${JSON.stringify(new URL('../src/config/env.js', import.meta.url).href)}); console.log(JSON.stringify({ limit: env.apiRateLimit, proxies: env.trustedProxyCidrs }));`;
  return spawnSync(process.execPath, ['--input-type=module', '--eval', source], {
    env: { ...process.env, NODE_ENV: 'test', API_RATE_LIMIT_MAX_REQUESTS: '', API_RATE_LIMIT_WINDOW_MS: '', TRUSTED_PROXY_CIDRS: '', ...overrides },
    encoding: 'utf8', windowsHide: true,
  });
}

test('실제 기본값은 1분 300회이고 테스트의 확장 설정과 분리된다', () => {
  const child = config();
  assert.equal(child.status, 0, child.stderr);
  assert.deepEqual(JSON.parse(child.stdout), { limit: { max: 300, windowMs: 60000 }, proxies: [] });
});

test('설정값을 반영하고 잘못된 한도·무조건적인 프록시 신뢰 설정은 시작을 거절한다', () => {
  const child = config({ API_RATE_LIMIT_MAX_REQUESTS: '50', API_RATE_LIMIT_WINDOW_MS: '1500', TRUSTED_PROXY_CIDRS: '127.0.0.1/32, ::1/128' });
  assert.equal(child.status, 0, child.stderr);
  assert.deepEqual(JSON.parse(child.stdout), { limit: { max: 50, windowMs: 1500 }, proxies: ['127.0.0.1/32', '::1/128'] });
  for (const key of ['API_RATE_LIMIT_MAX_REQUESTS', 'API_RATE_LIMIT_WINDOW_MS']) {
    for (const value of ['0', '-1', '1.5', 'bad', 'Infinity', '2147483648']) {
      const invalid = config({ [key]: value });
      assert.notEqual(invalid.status, 0);
      assert.match(invalid.stderr, new RegExp(`${key} must be a positive integer`));
    }
  }
  for (const value of ['true', '1', 'false', '0.0.0.0/0', '::/0', '127.0.0.1/33', '::1/129', '127.0.0.1/32,', 'invalid']) {
    const invalid = config({ TRUSTED_PROXY_CIDRS: value });
    assert.notEqual(invalid.status, 0);
    assert.match(invalid.stderr, /TRUSTED_PROXY_CIDRS must contain explicit proxy IPs or CIDRs/);
  }
});
