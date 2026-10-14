import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createApp } from '../src/app.js';
import { newSession } from '../src/ai/flow.js';
import { SESSION_TTL_MS, CONFIRMED_HISTORY_TTL_MS } from '../src/ai/sessionRetention.js';
import { createDatabaseAiSessionStore } from '../src/dao/aiSessions.database.js';
import { createMemoryAiSessionStore } from '../src/dao/aiSessions.memory.js';
import { aiSessionsStore } from '../src/dao/aiSessions.dao.js';
import { withAiSessionLock, closeAiSessionLocks } from '../src/dao/security.dao.js';
import { startAiSessionMaintenance } from '../src/services/aiSessionMaintenance.service.js';
import { signToken } from '../src/services/auth.service.js';
import { setProvider } from '../src/ai/index.js';
import { db, resetDb, makeStore, makeFabric } from './helpers.js';

let server, origin, clock;
before(async () => {
  server = createApp().listen(0, '127.0.0.1');
  await once(server, 'listening');
  origin = `http://127.0.0.1:${server.address().port}/api/v1/ai-sessions`;
});
beforeEach(async () => { await resetDb(); await aiSessionsStore.clear(); setProvider(); clock = Date.now(); });
after(async () => {
  setProvider();
  await new Promise(resolve => server.close(resolve));
  await closeAiSessionLocks();
  await db.sequelize.close();
});
const store = () => createDatabaseAiSessionStore({ now: () => clock });
function sample(sellerId, status = 'IN_PROGRESS', age = 0) {
  const time = new Date(clock - age);
  return {
    ...newSession({ sellerId, now: time, model: 'fake' }), session_status: status,
    messages: [{ role: 'user', content: 'private-history-marker', created_at: time }],
    ai_draft: { title: 'private-history-marker' }, flags: { size_hint: 'private-history-marker' },
    call_count: 2, input_tokens: 80, output_tokens: 12,
    final_data: status === 'CONFIRMED' ? { title: '판매자가 확정한 원단' } : null,
  };
}
async function api(method, suffix, token, body) {
  const response = await fetch(origin + suffix, {
    method, headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }) },
    body: body && JSON.stringify(body),
  });
  return { status: response.status, json: await response.json() };
}
const finalInput = { sale_type: 'ROLL', title: '확정 원단', price: 5000, remaining_length_cm: 270, detail: { width_cm: 150, material: 'COTTON', thickness: 'NORMAL', color_family: 'BLUE' } };

test('DB 저장소를 새로 만들어도 세션·대화·날짜·사용량이 복구된다', async () => {
  const { seller } = await makeStore();
  const saved = await store().insert(sample(seller.user_id));
  const restored = await store().findById(saved._id);
  assert.equal(restored.seller_id, seller.user_id);
  assert.ok(restored.started_at instanceof Date);
  assert.ok(restored.messages[0].created_at instanceof Date);
  assert.equal(restored.call_count, 2);
  assert.deepEqual(restored.ai_draft, saved.ai_draft);
  restored.messages[0].content = '복사본 수정';
  assert.equal((await store().findById(saved._id)).messages[0].content, 'private-history-marker');
});

test('실제 서버 재시작 후 세션이 유지되고 요청 없이도 시작 시 만료·보관 정리가 실행된다', { timeout: 15000 }, async () => {
  const { seller } = await makeStore(), token = signToken(seller);
  const started = await api('POST', '', token);
  assert.equal(started.status, 201);
  const id = started.json.data.sessionId;
  const expired = await store().insert(sample(seller.user_id, 'ABORTED', SESSION_TTL_MS + 1000));
  const confirmed = await store().insert(sample(seller.user_id, 'CONFIRMED', CONFIRMED_HISTORY_TTL_MS + 1000));
  const backend = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const script = `await import(${JSON.stringify(pathToFileURL(path.join(backend, 'src/server.js')).href)}); process.on('message', command => { if (command === 'verify-stop') process.emit('SIGTERM'); });`;
  for (let restart = 0; restart < 2; restart++) {
    const child = spawn(process.execPath, ['--input-type=module', '-e', script], {
      cwd: backend, env: { ...process.env, NODE_ENV: 'test', AI_PROVIDER: 'fake', AI_SESSION_STORE: 'database', PORT: '0' },
      windowsHide: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    });
    let output = '', errors = '', port;
    child.stdout.on('data', chunk => { output += chunk.toString(); port = Number(output.match(/Server running on http:\/\/localhost:(\d+)/)?.[1]); });
    child.stderr.on('data', chunk => { errors += chunk.toString(); });
    const exited = once(child, 'exit');
    try {
      for (let attempt = 0; attempt < 200; attempt++) {
        if (child.exitCode !== null) assert.fail(`Local server exited early: ${errors}`);
        if (port && !(await db.AiSession.findByPk(expired._id)) && (await db.AiSession.findByPk(confirmed._id)).payload.history_redacted_at) break;
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      assert.ok(port, errors);
      assert.equal(await db.AiSession.findByPk(expired._id), null);
      assert.deepEqual((await db.AiSession.findByPk(confirmed._id)).payload.messages, []);
      const response = await fetch(`http://127.0.0.1:${port}/api/v1/ai-sessions/${id}`, { headers: { Authorization: `Bearer ${token}` } });
      assert.equal(response.status, 200);
      const restored = (await response.json()).data;
      assert.equal(restored.sessionId, id);
      assert.equal(restored.session_status, 'IN_PROGRESS');
      assert.equal(restored.messages.length, 1);
    } finally {
      if (child.connected) child.send('verify-stop');
      const timer = setTimeout(() => child.kill(), 4000);
      const [code] = await exited;
      clearTimeout(timer);
      assert.equal(code, 0, errors);
    }
  }
});

test('24시간 경계에서 진행·중단 세션과 그 소유자의 세션 슬롯만 삭제한다', async () => {
  const { seller, store: shop } = await makeStore();
  const fabric = await makeFabric(shop.store_id);
  const beforeFabric = (await fabric.reload()).toJSON();
  const expired = [];
  for (const status of ['IN_PROGRESS', 'ABORTED']) {
    const session = sample(seller.user_id, status, SESSION_TTL_MS);
    session.securityLeaseId = randomUUID();
    await db.AiUsageLease.create({ lease_id: session.securityLeaseId, kind: 'SESSION', user_id: seller.user_id, expires_at: new Date(clock + SESSION_TTL_MS) });
    expired.push(await store().insert(session));
  }
  const recent = await store().insert(sample(seller.user_id, 'IN_PROGRESS', SESSION_TTL_MS - 1));
  const callLease = await db.AiUsageLease.create({ lease_id: randomUUID(), kind: 'CALL', user_id: seller.user_id, expires_at: new Date(clock + SESSION_TTL_MS) });
  assert.deepEqual(await store().cleanup(), { deleted: 2, redacted: 0, skipped: 0 });
  for (const session of expired) assert.equal(await db.AiSession.findByPk(session._id), null);
  assert.ok(await store().findById(recent._id));
  assert.equal(await db.AiUsageLease.count({ where: { kind: 'SESSION' } }), 0);
  assert.ok(await db.AiUsageLease.findByPk(callLease.lease_id));
  assert.deepEqual((await fabric.reload()).toJSON(), beforeFabric);
});

test('확정 기록은 남기고 정확히 30일 후 대화·AI 초안·임시 입력만 비운다', async () => {
  const { seller, store: shop } = await makeStore();
  const fabric = await makeFabric(shop.store_id);
  const beforeFabric = fabric.toJSON();
  const session = sample(seller.user_id, 'CONFIRMED', CONFIRMED_HISTORY_TTL_MS - 1);
  session.fabric_id = fabric.fabric_id;
  const saved = await store().insert(session);
  assert.equal((await store().findById(saved._id)).messages.length, 1);
  clock++;
  assert.deepEqual(await store().cleanup(), { deleted: 0, redacted: 1, skipped: 0 });
  const retained = await store().findById(saved._id);
  assert.equal(retained.session_status, 'CONFIRMED');
  assert.equal(retained.fabric_id, fabric.fabric_id);
  assert.equal(retained.last_updated_at.getTime(), saved.last_updated_at.getTime());
  assert.deepEqual(retained.final_data, session.final_data);
  assert.deepEqual([retained.call_count, retained.input_tokens, retained.output_tokens], [2, 80, 12]);
  assert.deepEqual(retained.messages, []);
  assert.deepEqual(retained.ai_draft, {});
  assert.ok(retained.history_redacted_at);
  assert.equal(JSON.stringify((await db.AiSession.findByPk(saved._id)).payload).includes('private-history-marker'), false);
  assert.deepEqual((await fabric.reload()).toJSON(), beforeFabric);
  assert.deepEqual(await store().cleanup(), { deleted: 0, redacted: 0, skipped: 0 });
});

test('조회 시에도 만료·보관 정책을 적용하며 다른 세션을 지우지 않는다', async () => {
  const { seller } = await makeStore();
  const expired = await store().insert(sample(seller.user_id, 'IN_PROGRESS', SESSION_TTL_MS));
  const other = await store().insert(sample(seller.user_id, 'ABORTED', SESSION_TTL_MS));
  const confirmed = await store().insert(sample(seller.user_id, 'CONFIRMED', CONFIRMED_HISTORY_TTL_MS));
  assert.equal(await store().findById(expired._id), null);
  assert.ok(await db.AiSession.findByPk(other._id));
  assert.deepEqual((await store().findById(confirmed._id)).messages, []);
});

test('정리 작업은 제한된 묶음으로 처리하며 비운 확정 기록 때문에 다음 묶음이 막히지 않는다', async () => {
  const { seller } = await makeStore();
  await store().insert(sample(seller.user_id, 'CONFIRMED', CONFIRMED_HISTORY_TTL_MS));
  for (let i = 0; i < 2; i++) await store().insert(sample(seller.user_id, 'ABORTED', SESSION_TTL_MS));
  assert.equal((await store().cleanup({ limit: 1 })).redacted, 1);
  assert.equal((await store().cleanup({ limit: 1 })).deleted, 1);
  assert.equal((await store().cleanup({ limit: 1 })).deleted, 1);
  assert.equal(await db.AiSession.count(), 1);
});

test('여러 DB 저장소가 동시에 정리해도 한 번만 삭제·비우기를 처리한다', async () => {
  const { seller } = await makeStore();
  await store().insert(sample(seller.user_id, 'CONFIRMED', CONFIRMED_HISTORY_TTL_MS));
  for (let i = 0; i < 2; i++) await store().insert(sample(seller.user_id, 'IN_PROGRESS', SESSION_TTL_MS));
  const results = await Promise.all([store().cleanup(), store().cleanup()]);
  assert.equal(results.reduce((n, item) => n + item.deleted, 0), 2);
  assert.equal(results.reduce((n, item) => n + item.redacted, 0), 1);
  assert.equal(await db.AiSession.count(), 1);
});

test('답변·확정 잠금을 잡은 세션은 정리기가 건너뛰고 최신 갱신 시각을 다시 확인한다', async () => {
  const { seller } = await makeStore();
  const saved = await store().insert(sample(seller.user_id, 'IN_PROGRESS', SESSION_TTL_MS - 1));
  await withAiSessionLock(saved._id, async () => {
    const active = await store().findById(saved._id);
    clock += 2;
    assert.deepEqual(await store().cleanup(), { deleted: 0, redacted: 0, skipped: 1 });
    active.last_updated_at = new Date(clock);
    assert.ok(await store().save(active));
  });
  assert.deepEqual(await store().cleanup(), { deleted: 0, redacted: 0, skipped: 0 });
  assert.ok(await store().findById(saved._id));
});

test('이미 만료 삭제한 세션을 오래된 복사본으로 다시 저장할 수 없다', async () => {
  const { seller } = await makeStore();
  const old = await store().insert(sample(seller.user_id, 'ABORTED', SESSION_TTL_MS));
  await store().cleanup();
  old.last_updated_at = new Date(clock);
  assert.equal(await store().save(old), null);
  assert.equal(await db.AiSession.count(), 0);
});

test('잘못 연결된 다른 판매자의 사용 슬롯은 만료 정리에서 삭제하지 않는다', async () => {
  const { seller } = await makeStore(), { seller: other } = await makeStore();
  const lease = await db.AiUsageLease.create({ lease_id: randomUUID(), kind: 'SESSION', user_id: other.user_id, expires_at: new Date(clock + SESSION_TTL_MS) });
  const session = sample(seller.user_id, 'ABORTED', SESSION_TTL_MS);
  session.securityLeaseId = lease.lease_id;
  await store().insert(session);
  await store().cleanup();
  assert.ok(await db.AiUsageLease.findByPk(lease.lease_id));
});

test('확정·중단 직후 서버가 꺼져 남은 슬롯도 정리하되 기록과 대화 보관 시각을 유지한다', async () => {
  const { seller } = await makeStore();
  const sessions = [];
  for (const status of ['CONFIRMED', 'ABORTED']) {
    const session = sample(seller.user_id, status);
    session.securityLeaseId = randomUUID();
    await db.AiUsageLease.create({ lease_id: session.securityLeaseId, kind: 'SESSION', user_id: seller.user_id, expires_at: new Date(clock + SESSION_TTL_MS) });
    sessions.push(await store().insert(session));
  }
  await store().cleanup();
  assert.equal(await db.AiUsageLease.count(), 0);
  for (const session of sessions) {
    const retained = await store().findById(session._id);
    assert.equal(retained.session_status, session.session_status);
    assert.equal(retained.last_updated_at.getTime(), session.last_updated_at.getTime());
    assert.equal(retained.messages.length, 1);
    assert.equal(retained.securityLeaseId, null);
  }
});

test('슬롯 회수와 기록 갱신 중 실패하면 트랜잭션을 되돌리고 다음 정리에서 다시 처리한다', async t => {
  const { seller } = await makeStore();
  const session = sample(seller.user_id, 'CONFIRMED');
  session.securityLeaseId = randomUUID();
  await db.AiUsageLease.create({ lease_id: session.securityLeaseId, kind: 'SESSION', user_id: seller.user_id, expires_at: new Date(clock + SESSION_TTL_MS) });
  const saved = await store().insert(session);
  const update = t.mock.method(db.AiSession.prototype, 'update', async () => { throw new Error('test update failure'); });
  await assert.rejects(store().cleanup(), /test update failure/);
  assert.ok(await db.AiUsageLease.findByPk(session.securityLeaseId));
  assert.equal((await db.AiSession.findByPk(saved._id)).payload.securityLeaseId, session.securityLeaseId);
  update.mock.restore();
  await store().cleanup();
  assert.equal(await db.AiUsageLease.findByPk(session.securityLeaseId), null);
  assert.ok(await db.AiSession.findByPk(saved._id));
});

test('API는 만료 세션에 404를 반환하며 확정 요청으로 원단을 만들지 않는다', async () => {
  const { seller } = await makeStore();
  const saved = await store().insert(sample(seller.user_id, 'IN_PROGRESS', SESSION_TTL_MS + 1000));
  const token = signToken(seller);
  for (const [method, suffix, body] of [['GET', '', null], ['POST', '/answers', { answer: '면' }], ['POST', '/confirm', finalInput], ['POST', '/abort', null]]) {
    const response = await api(method, `/${saved._id}${suffix}`, token, body);
    assert.equal(response.status, 404);
    assert.equal(response.json.error.code, 'NOT_FOUND');
  }
  assert.equal(await db.Fabric.count(), 0);
});

test('30일 지난 확정 세션은 원단 연결과 소유권을 유지하며 대화·초안 없이 조회된다', async () => {
  const { seller, store: shop } = await makeStore(), { seller: other } = await makeStore();
  const fabric = await makeFabric(shop.store_id);
  const session = sample(seller.user_id, 'CONFIRMED', CONFIRMED_HISTORY_TTL_MS + 1000);
  session.fabric_id = fabric.fabric_id;
  const saved = await store().insert(session), token = signToken(seller);
  const response = await api('GET', `/${saved._id}`, token);
  assert.equal(response.status, 200);
  assert.equal(response.json.data.fabric_id, fabric.fabric_id);
  assert.deepEqual(response.json.data.messages, []);
  assert.deepEqual(response.json.data.ai_draft, {});
  assert.equal((await api('GET', `/${saved._id}`, signToken(other))).status, 403);
  assert.equal((await api('POST', `/${saved._id}/confirm`, token, finalInput)).json.error.code, 'AI_SESSION_CLOSED');
  assert.deepEqual((await db.AiSession.findByPk(saved._id)).payload.final_data, session.final_data);
  assert.equal(await db.Fabric.count(), 1);
});

test('저장 직전에 세션이 사라졌다면 성공 응답을 반환하지 않고 사용 슬롯을 해제한다', async () => {
  const { seller } = await makeStore(), token = signToken(seller);
  const started = await api('POST', '', token);
  assert.equal(started.status, 201);
  const id = started.json.data.sessionId;
  setProvider({ name: 'fake', model: 'fake', extract: async () => {
    await db.AiSession.destroy({ where: { session_id: id } });
    return { values: { material: 'COTTON' } };
  } });
  const response = await api('POST', `/${id}/answers`, token, { answer: '면 원단' });
  assert.equal(response.status, 404);
  assert.equal(response.json.error.code, 'NOT_FOUND');
  assert.equal(await db.AiUsageLease.count(), 0);
});

test('개발 실험용 메모리 저장소도 같은 24시간·30일 정책을 적용한다', async () => {
  const memory = createMemoryAiSessionStore({ now: () => clock });
  const expired = await memory.insert(sample(1, 'ABORTED', SESSION_TTL_MS));
  const confirmed = await memory.insert(sample(1, 'CONFIRMED', CONFIRMED_HISTORY_TTL_MS));
  assert.deepEqual(await memory.cleanup(), { deleted: 1, redacted: 1, skipped: 0 });
  assert.equal(await memory.findById(expired._id), null);
  assert.deepEqual((await memory.findById(confirmed._id)).messages, []);
});

test('설정은 개발·운영 DB를 기본으로 사용하고 운영의 memory 선택을 거절한다', () => {
  const backend = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const isolatedCwd = path.resolve(backend, '../.local-runtime/ai-session-retention-20261014/config-only');
  fs.mkdirSync(isolatedCwd, { recursive: true });
  const script = `const {env} = await import(${JSON.stringify(pathToFileURL(path.join(backend, 'src/config/env.js')).href)}); console.log(env.ai.sessionStore);`;
  for (const [mode, setting, expected] of [['production', null, 'database'], ['production', 'database', 'database'], ['development', null, 'database'], ['development', 'memory', 'memory'], ['test', null, 'memory'], ['production', 'memory', null]]) {
    const childEnv = { ...process.env, NODE_ENV: mode, AI_PROVIDER: 'openai', OPENAI_API_KEY: 'test-only', ANTHROPIC_API_KEY: '', JWT_SECRET: 'a'.repeat(32) };
    if (setting) childEnv.AI_SESSION_STORE = setting; else delete childEnv.AI_SESSION_STORE;
    const child = spawnSync(process.execPath, ['--input-type=module', '-e', script], { cwd: isolatedCwd, env: childEnv, encoding: 'utf8', timeout: 5000 });
    if (expected) { assert.equal(child.status, 0, child.stderr); assert.equal(child.stdout.trim(), expected); }
    else { assert.notEqual(child.status, 0); assert.match(child.stderr, /AI_SESSION_STORE=database/); }
  }
});

const settle = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); };
test('요청이 없어도 정리기는 시작 시점과 매 분 실행되고 종료 뒤에는 실행하지 않는다', async t => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  let calls = 0;
  const stop = startAiSessionMaintenance({ store: { cleanup: async () => { calls++; } } });
  await settle();
  assert.equal(calls, 1);
  t.mock.timers.tick(60_000);
  await settle();
  assert.equal(calls, 2);
  await stop();
  t.mock.timers.tick(120_000);
  await settle();
  assert.equal(calls, 2);
});

test('느린 정리 작업은 겹치지 않으며 종료는 진행 중 작업의 완료를 기다린다', async t => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  let calls = 0, release;
  const gate = new Promise(resolve => { release = resolve; });
  const stop = startAiSessionMaintenance({ store: { cleanup: async () => { calls++; await gate; } } });
  await settle();
  t.mock.timers.tick(300_000);
  await settle();
  assert.equal(calls, 1);
  let stopped = false;
  const pendingStop = stop().then(() => { stopped = true; });
  await settle();
  assert.equal(stopped, false);
  release();
  await pendingStop;
  assert.equal(stopped, true);
});

test('정리 실패를 처리한 뒤 다음 주기에 다시 시도한다', async t => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  let calls = 0;
  const errors = [];
  const stop = startAiSessionMaintenance({ store: { cleanup: async () => { calls++; if (calls === 1) throw new Error('test failure'); } }, onError: error => errors.push(error.message) });
  await settle();
  assert.deepEqual(errors, ['test failure']);
  t.mock.timers.tick(60_000);
  await settle();
  assert.equal(calls, 2);
  await stop();
});
