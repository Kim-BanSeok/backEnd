import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { env } from '../src/config/env.js';
import { setProvider } from '../src/ai/index.js';
import { aiSessionsStore } from '../src/dao/aiSessions.dao.js';
import { signToken } from '../src/services/auth.service.js';
import { db, resetDb, makeUser, makeStore, makeFabric } from './helpers.js';

let server, origin;
const defaults = structuredClone({ call: env.ai.callLimits, session: env.ai.sessionLimits });
before(() => {
  server = createApp().listen(0);
  origin = `http://localhost:${server.address().port}/api/v1`;
});
beforeEach(async () => {
  await resetDb();
  await aiSessionsStore.clear();
  setProvider();
  Object.assign(env.ai.callLimits, defaults.call);
  Object.assign(env.ai.sessionLimits, defaults.session);
});
after(async () => {
  setProvider();
  Object.assign(env.ai.callLimits, defaults.call);
  Object.assign(env.ai.sessionLimits, defaults.session);
  server.close();
  await db.sequelize.close();
});

async function api(path, { token, body } = {}) {
  const response = await fetch(origin + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }) },
    body: body && JSON.stringify(body),
  });
  return { status: response.status, json: await response.json() };
}
const listingBody = {
  material_text: '면 원단', thickness: 'NORMAL', thickness_label: '보통',
  width_cm: 100, length_cm: 200, sale_type: 'ROLL',
  images: [{ media_type: 'image/png', data: 'dGVzdA==' }],
};
const listingResult = { values: { title: '면 원단', description: '테스트 소개글', color_family: 'BLUE' } };
const patternResult = { title: '파우치', parts: [{ part_name: '몸판', width_cm: 20, height_cm: 30, quantity: 2 }] };

function provider(work = async () => {}) {
  const calls = { listing: 0, pattern: 0, extract: 0 };
  setProvider({
    name: 'test-counter', model: 'fake',
    describeProduct: async () => { calls.listing++; await work(); return listingResult; },
    draftPattern: async () => { calls.pattern++; await work(); return patternResult; },
    extract: async () => { calls.extract++; return { values: { material: 'COTTON' } }; },
  });
  return calls;
}

async function fixture(kind) {
  const { seller, store } = await makeStore();
  if (kind === 'listing') return { user: seller, token: signToken(seller), path: '/ai-sessions/listings', body: listingBody };
  const buyer = await makeUser();
  const fabric = await makeFabric(store.store_id, { status: 'POSTED' });
  await db.FabricDetail.create({ fabric_id: fabric.fabric_id, width_cm: 100, length_cm: 100, sheet_count: 1, thickness: 'NORMAL', color_family: 'BLUE' });
  return { user: buyer, token: signToken(buyer), fabric, path: '/pattern-drafts', body: { fabric_id: fabric.fabric_id, item_name: '파우치' } };
}
const request = item => api(item.path, item);
const quotaError = response => {
  assert.equal(response.status, 429);
  assert.equal(response.json.error.code, 'TOO_MANY_REQUESTS');
};

for (const [kind, label] of [['listing', '상품 소개'], ['pattern', '도안 생성']]) {
  test(`${label}: 사용자·전체 시간당 호출 한도를 넘으면 AI를 호출하지 않는다`, async () => {
    Object.assign(env.ai.callLimits, { userHourly: 2, globalHourly: 3 });
    const account = await fixture(kind), other = await fixture(kind);
    const calls = provider();
    const first = await request(account);
    assert.equal(first.status, 201);
    if (kind === 'listing') assert.equal(first.json.data.ai_draft.description, listingResult.values.description);
    else { assert.equal(first.json.data.saved, false); assert.equal(first.json.data.parts.length, 1); }
    assert.equal((await request(account)).status, 201);
    quotaError(await request(account));
    assert.equal(calls[kind], 2);
    assert.equal((await request(other)).status, 201);
    quotaError(await request(other));
    assert.equal(calls[kind], 3);
    assert.equal(await db.AiUsageLease.count({ where: { kind: 'CALL' } }), 0);
    if (kind === 'pattern') assert.equal(await db.Pattern.count(), 0);
  });

  test(`${label}: 사용자·전체 동시 호출 한도를 지키고 완료 후 슬롯을 반환한다`, { timeout: 10000 }, async () => {
    Object.assign(env.ai.callLimits, { userConcurrent: 1, globalConcurrent: 2 });
    const account = await fixture(kind), other = await fixture(kind), third = await fixture(kind);
    let release, started, nextStarted;
    const gate = new Promise(resolve => { release = resolve; });
    const firstStarted = new Promise(resolve => { started = resolve; });
    const secondStarted = new Promise(resolve => { nextStarted = resolve; });
    let entered = 0;
    const calls = provider(async () => { entered++; (entered === 1 ? started : nextStarted)(); await gate; });
    const first = request(account);
    let second;
    try {
      await firstStarted;
      quotaError(await request(account));
      assert.equal(calls[kind], 1);
      second = request(other);
      await secondStarted;
      quotaError(await request(third));
      assert.equal(calls[kind], 2);
    } finally {
      release();
      assert.equal((await first).status, 201);
      if (second) assert.equal((await second).status, 201);
    }
    assert.equal((await request(account)).status, 201);
    assert.equal(calls[kind], 3);
    assert.equal(await db.AiUsageLease.count({ where: { kind: 'CALL' } }), 0);
  });

  test(`${label}: 제공자 오류는 503이며 호출 슬롯과 실패한 소개 세션 슬롯을 반환한다`, async () => {
    Object.assign(env.ai.callLimits, { userConcurrent: 1 });
    Object.assign(env.ai.sessionLimits, { userConcurrent: 1 });
    const account = await fixture(kind);
    const calls = provider(async () => { throw new Error('test provider failure'); });
    const failed = await request(account);
    assert.equal(failed.status, 503);
    assert.equal(failed.json.error.code, 'AI_UNAVAILABLE');
    assert.equal(calls[kind], 1);
    assert.equal(await db.AiUsageLease.count(), 0);
    const recovered = provider();
    assert.equal((await request(account)).status, 201);
    assert.equal(recovered[kind], 1);
  });

  test(`${label}: 권한·입력·상태 오류는 AI와 호출 한도를 사용하지 않는다`, async () => {
    const account = await fixture(kind);
    const calls = provider();
    assert.equal((await api(account.path, { body: account.body })).status, 401);
    const wrongRole = kind === 'listing' ? await makeUser() : (await makeStore()).seller;
    assert.equal((await api(account.path, { token: signToken(wrongRole), body: account.body })).status, 403);
    assert.equal((await api(account.path, { token: account.token, body: {} })).status, 400);
    if (kind === 'listing') {
      await account.user.update({ seller_approval_status: 'PENDING' });
      assert.equal((await request(account)).status, 403);
    } else {
      await account.fabric.update({ status: 'PENDING' });
      assert.equal((await request(account)).status, 404);
    }
    assert.equal(calls[kind], 0);
    assert.equal(await db.AiUsageBucket.count(), 0);
    assert.equal(await db.AiUsageLease.count(), 0);
  });
}

test('상품 소개·도안 생성·기존 대화 등록은 전체 호출 한도를 공유한다', async () => {
  Object.assign(env.ai.callLimits, { globalHourly: 2 });
  const seller = await fixture('listing'), buyer = await fixture('pattern');
  const calls = provider();
  assert.equal((await request(seller)).status, 201);
  assert.equal((await request(buyer)).status, 201);
  const session = await api('/ai-sessions', { token: seller.token });
  assert.equal(session.status, 201);
  quotaError(await api(`/ai-sessions/${session.json.data.sessionId}/answers`, { token: seller.token, body: { answer: '면' } }));
  assert.deepEqual(calls, { listing: 1, pattern: 1, extract: 0 });
  assert.equal(await db.AiUsageLease.count({ where: { kind: 'CALL' } }), 0);
});

test('상품 소개는 기존 등록과 활성 세션 한도를 공유하고 중단하면 슬롯을 반환한다', async () => {
  Object.assign(env.ai.sessionLimits, { userConcurrent: 1 });
  const account = await fixture('listing');
  const calls = provider();
  const existing = await api('/ai-sessions', { token: account.token });
  assert.equal(existing.status, 201);
  quotaError(await request(account));
  assert.equal(calls.listing, 0);
  assert.equal((await api(`/ai-sessions/${existing.json.data.sessionId}/abort`, { token: account.token })).status, 200);
  const listing = await request(account);
  assert.equal(listing.status, 201);
  quotaError(await request(account));
  assert.equal(calls.listing, 1);
  assert.equal((await api(`/ai-sessions/${listing.json.data.sessionId}/abort`, { token: account.token })).status, 200);
  assert.equal((await api('/ai-sessions', { token: account.token })).status, 201);
});

test('상품 소개는 사용자·전체 시간당 세션 한도를 AI 호출 전에 확인한다', async () => {
  Object.assign(env.ai.sessionLimits, { userHourly: 1, globalHourly: 2 });
  const accounts = await Promise.all([fixture('listing'), fixture('listing'), fixture('listing')]);
  const calls = provider();
  for (const account of accounts.slice(0, 2)) {
    const response = await request(account);
    assert.equal(response.status, 201);
    assert.equal((await api(`/ai-sessions/${response.json.data.sessionId}/abort`, { token: account.token })).status, 200);
    quotaError(await request(account));
  }
  quotaError(await request(accounts[2]));
  assert.equal(calls.listing, 2);
  assert.equal(await db.AiUsageLease.count(), 0);
});

test('상품 소개는 다른 판매자의 활성 세션까지 합산해 전체 세션 한도를 지킨다', async () => {
  Object.assign(env.ai.sessionLimits, { globalConcurrent: 1 });
  const account = await fixture('listing'), other = await fixture('listing');
  const calls = provider();
  const first = await request(account);
  assert.equal(first.status, 201);
  quotaError(await request(other));
  assert.equal(calls.listing, 1);
  assert.equal((await api(`/ai-sessions/${first.json.data.sessionId}/abort`, { token: account.token })).status, 200);
  assert.equal((await request(other)).status, 201);
  assert.equal(calls.listing, 2);
});

test('상품 소개의 응답 형식 오류와 저장 실패는 세션 슬롯을 남기지 않는다', async t => {
  const account = await fixture('listing');
  setProvider({ name: 'invalid', model: 'fake', describeProduct: async () => ({ values: null }) });
  assert.equal((await request(account)).status, 503);
  assert.equal(await db.AiUsageLease.count(), 0);
  provider();
  const insert = t.mock.method(aiSessionsStore, 'insert', async () => { throw new Error('test insert failure'); });
  assert.equal((await request(account)).status, 500);
  assert.equal(await db.AiUsageLease.count(), 0);
  insert.mock.restore();
  assert.equal((await request(account)).status, 201);
});
