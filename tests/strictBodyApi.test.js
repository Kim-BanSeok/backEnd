import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import sharp from 'sharp';
import { createApp } from '../src/app.js';
import { signToken } from '../src/services/auth.service.js';
import { setProvider } from '../src/ai/index.js';
import { aiSessionsStore } from '../src/dao/aiSessions.dao.js';
import { bulkSheetTemplate } from '../src/services/bulkSheet.service.js';
import XLSX from '../src/spreadsheets/sheetjs.js';
import { db, resetDb, makeUser, makeStore, makeFabric } from './helpers.js';
import { bodyCases, noBodyCases, extraField, sessionId, fabricBody, listingBody } from './strictBodyFixtures.js';

let server, origin, actors, aiCalls;
before(async () => {
  await new Promise(resolve => { server = createApp().listen(0, '127.0.0.1', resolve); });
  origin = `http://127.0.0.1:${server.address().port}/api/v1`;
});
beforeEach(async () => {
  await resetDb();
  await aiSessionsStore.clear();
  actors = {
    BUYER: await makeUser({ email: 'buyer@strict.test' }),
    SELLER: await makeUser({ role: 'SELLER', seller_approval_status: 'APPROVED' }),
    ADMIN: await makeUser({ role: 'ADMIN' }),
  };
  aiCalls = 0;
  const called = () => { aiCalls++; };
  setProvider({
    name: 'strict-body-test', model: 'fake',
    extract: async () => { called(); return { values: {} }; },
    describeImage: async () => { called(); return { values: {} }; },
    describeProduct: async () => { called(); return { values: {} }; },
    draftPattern: async () => { called(); return { parts: [] }; },
  });
});
after(async () => { setProvider(); await new Promise(resolve => server.close(resolve)); await db.sequelize.close(); });

async function api(path, { method = 'POST', actor = actors.BUYER, body, raw } = {}) {
  const response = await fetch(origin + path, {
    method,
    headers: { ...(actor && { Authorization: `Bearer ${signToken(actor)}` }), ...(!(body instanceof FormData) && { 'Content-Type': 'application/json' }) },
    body: raw ?? (body instanceof FormData ? body : body === undefined ? undefined : JSON.stringify(body)),
  });
  return { status: response.status, json: await response.json() };
}
const unknownError = response => {
  assert.equal(response.status, 400, JSON.stringify(response.json));
  assert.equal(response.json.success, false);
  assert.equal(response.json.error.code, 'VALIDATION_ERROR');
  assert.ok(response.json.error.details.some(detail => typeof detail.field === 'string' && detail.message.includes(extraField)), JSON.stringify(response.json));
};
async function fingerprint() {
  const tables = Object.values(db).filter(model => model.tableName);
  return Object.fromEntries(await Promise.all(tables.map(async model => {
    const rows = (await model.findAll({ raw: true })).map(row => JSON.stringify(row)).sort();
    return [model.tableName, createHash('sha256').update(JSON.stringify(rows)).digest('hex')];
  })));
}

for (const item of bodyCases.filter(item => !item.multipart)) {
  test(`API ${item.label}: 정상 필드에 섞인 추가 필드를 400으로 거절한다`, async () => {
    const response = await api(item.path, { method: item.method ?? 'POST', actor: item.role === null ? null : actors[item.role ?? 'BUYER'], body: { ...item.input(), [extraField]: 'DROP_ME_SECRET' } });
    unknownError(response);
    assert.doesNotMatch(JSON.stringify(response.json), /DROP_ME_SECRET/);
    assert.equal(aiCalls, 0);
    assert.equal(await db.User.count(), 3);
  });
}
for (const item of noBodyCases) {
  test(`본문 없는 API ${item.label}: 임의 필드를 받지 않는다`, async () => {
    unknownError(await api(item.path, { method: item.method ?? 'POST', actor: actors[item.role ?? 'BUYER'], body: { [extraField]: true } }));
    assert.equal(aiCalls, 0);
  });
}

test('API 중첩 필드: 원단 detail·AI 확정 detail·이미지 배열의 추가 필드도 거절한다', async () => {
  for (const [path, method] of [['/fabrics', 'POST'], ['/fabrics/1', 'PATCH'], [`/ai-sessions/${sessionId}/confirm`, 'POST']]) {
    const body = fabricBody();
    const response = await api(path, { method, actor: actors.SELLER, body: { ...body, detail: { ...body.detail, [extraField]: true } } });
    unknownError(response);
    assert.ok(response.json.error.details.some(detail => detail.field === 'detail'));
  }
  const body = listingBody();
  const response = await api('/ai-sessions/listings', { actor: actors.SELLER, body: { ...body, images: [body.images[0], { ...body.images[0], [extraField]: true }] } });
  unknownError(response);
  assert.ok(response.json.error.details.some(detail => detail.field === 'images.1'));
  assert.equal(aiCalls, 0);
  assert.equal(await db.AiUsageBucket.count(), 0);
  assert.equal(await db.AiUsageLease.count(), 0);
  assert.equal(await db.AiSession.count(), 0);
});

test('API 프로토타입 키: JSON의 __proto__·constructor 필드도 400으로 거절한다', async () => {
  for (const raw of ['{"nickname":"새 이름","__proto__":{"role":"ADMIN"}}', '{"nickname":"새 이름","constructor":{"prototype":{"role":"ADMIN"}}}']) {
    const response = await api('/users/me', { method: 'PATCH', raw });
    assert.equal(response.status, 400);
    assert.equal(response.json.error.code, 'VALIDATION_ERROR');
  }
  assert.equal({}.role, undefined);
  assert.equal((await db.User.findByPk(actors.BUYER.user_id)).role, 'BUYER');
});

test('거절된 요청은 계정·원단·예약·승인 상태를 바꾸지 않는다', async () => {
  const { seller, store } = await makeStore();
  const posted = await makeFabric(store.store_id, { status: 'POSTED' });
  await db.FabricDetail.create({ fabric_id: posted.fabric_id, width_cm: 50, length_cm: 70, sheet_count: 2, thickness: 'NORMAL', color_family: 'BLUE' });
  const pending = await makeFabric(store.store_id);
  const before = await fingerprint();
  const requests = [
    ['/users/me', { method: 'PATCH', body: { nickname: '새 이름', [extraField]: true } }],
    [`/fabrics/${posted.fabric_id}`, { method: 'PATCH', actor: seller, body: { title: '새 제목', [extraField]: true } }],
    ['/reservations', { body: { fabric_id: posted.fabric_id, requested_sheet_count: 1, pickup_at: new Date(Date.now() + 86_400_000).toISOString(), [extraField]: true } }],
    [`/admin/fabrics/${pending.fabric_id}/approve`, { actor: actors.ADMIN, body: { [extraField]: true } }],
    [`/fabrics/${pending.fabric_id}`, { method: 'DELETE', actor: seller, body: { [extraField]: true } }],
  ];
  for (const [path, options] of requests) unknownError(await api(path, options));
  assert.deepEqual(await fingerprint(), before);
});

test('로그아웃: 추가 필드가 있으면 토큰을 폐기하지 않고, 정상 빈 본문은 성공한다', async () => {
  const token = signToken(actors.BUYER);
  const send = body => fetch(origin + '/auth/logout', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const failed = await send({ [extraField]: true });
  unknownError({ status: failed.status, json: await failed.json() });
  assert.equal(await db.RevokedToken.count(), 0);
  assert.equal((await fetch(origin + '/users/me', { headers: { Authorization: `Bearer ${token}` } })).status, 200);
  assert.equal((await send({})).status, 200);
  assert.equal(await db.RevokedToken.count(), 1);
  assert.equal((await fetch(origin + '/users/me', { headers: { Authorization: `Bearer ${token}` } })).status, 401);
});

test('AI 시작: 추가 필드는 슬롯·세션 생성 전에 거절하고, 생략·빈 객체는 허용한다', async () => {
  const { seller } = await makeStore();
  const before = await fingerprint();
  unknownError(await api('/ai-sessions', { actor: seller, body: { [extraField]: true } }));
  assert.deepEqual(await fingerprint(), before);
  assert.equal((await api('/ai-sessions', { actor: seller })).status, 201);
  assert.equal((await api('/ai-sessions', { actor: seller, body: {} })).status, 201);
  assert.equal(await db.AiSession.count(), 2);
  assert.equal(aiCalls, 0);
});

const png = () => sharp({ create: { width: 2, height: 2, channels: 3, background: '#112233' } }).png().toBuffer();
function form(buffer, filename, fields) {
  const data = new FormData();
  data.append('file', new Blob([buffer]), filename);
  for (const [key, value] of Object.entries(fields ?? {})) data.append(key, value);
  return data;
}

test('사진 업로드: 허용된 image_type만 받고 추가 텍스트가 있으면 파일을 등록하지 않는다', async () => {
  const { seller, store } = await makeStore();
  const fabric = await makeFabric(store.store_id);
  const bytes = await png();
  const before = await fingerprint();
  unknownError(await api(`/fabrics/${fabric.fabric_id}/images`, { actor: seller, body: form(bytes, 'fabric.png', { image_type: 'FULL', [extraField]: '임의 값' }) }));
  assert.deepEqual(await fingerprint(), before);
  assert.equal((await api(`/fabrics/${fabric.fabric_id}/images`, { actor: seller, body: form(bytes, 'fabric.png', { image_type: '' }) })).status, 201);
  assert.equal(await db.FabricImage.count(), 1);
});

test('AI 사진: 추가 텍스트는 AI 호출 전에 거절하고 정상 파일은 분석한다', async () => {
  const { seller } = await makeStore();
  const bytes = await png();
  const before = await fingerprint();
  unknownError(await api('/ai/fabric-photo', { actor: seller, body: form(bytes, 'fabric.png', { [extraField]: '임의 값' }) }));
  assert.deepEqual(await fingerprint(), before);
  assert.equal(aiCalls, 0);
  assert.equal((await api('/ai/fabric-photo', { actor: seller, body: form(bytes, 'fabric.png') })).status, 200);
  assert.equal(aiCalls, 1);
});

test('엑셀 업로드: 추가 텍스트를 거절하며 정상 파일 업로드는 유지한다', async () => {
  const { seller } = await makeStore();
  const workbook = XLSX.read(bulkSheetTemplate(), { type: 'buffer' });
  XLSX.utils.sheet_add_aoa(workbook.Sheets['입력'], [['롤', '면 롤', '면', '중간 두께', '네이비', 150, 270, '', 5000]], { origin: 'A3' });
  const bytes = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
  const before = await fingerprint();
  unknownError(await api('/sellers/me/fabric-sheet', { actor: seller, body: form(bytes, 'fabrics.xlsx', { [extraField]: '임의 값' }) }));
  assert.deepEqual(await fingerprint(), before);
  assert.equal((await api('/sellers/me/fabric-sheet', { actor: seller, body: form(bytes, 'fabrics.xlsx') })).status, 200);
});

test('인증 우선순위: 추가 필드가 있어도 로그인·역할 오류가 먼저 나온다', async () => {
  const body = { ...fabricBody(), [extraField]: true };
  assert.equal((await api('/fabrics', { actor: null, body })).status, 401);
  assert.equal((await api('/fabrics', { body })).status, 403);
  assert.equal((await api('/ai-sessions', { actor: null, body: { [extraField]: true } })).status, 401);
  assert.equal(aiCalls, 0);
});

test('배열·깨진 JSON도 400이며 오류에 입력값을 반사하지 않는다', async () => {
  for (const raw of ['[]', '{"nickname":']) {
    const response = await api('/users/me', { method: 'PATCH', raw });
    assert.equal(response.status, 400);
    assert.equal(response.json.error.code, 'VALIDATION_ERROR');
  }
});

test('읽지 않는 Content-Type 본문도 본문 생략으로 취급하지 않고 부작용 없이 거절한다', async () => {
  const before = await fingerprint();
  for (const type of ['text/plain', 'application/x-www-form-urlencoded']) {
    const response = await fetch(origin + '/auth/logout', {
      method: 'POST', headers: { Authorization: `Bearer ${signToken(actors.BUYER)}`, 'Content-Type': type },
      body: `${extraField}=DROP_ME_SECRET`,
    });
    const json = await response.json();
    assert.equal(response.status, 400);
    assert.equal(json.error.code, 'VALIDATION_ERROR');
    assert.doesNotMatch(JSON.stringify(json), /DROP_ME_SECRET/);
  }
  assert.deepEqual(await fingerprint(), before);
});

test('본문 없는 읽기 API도 추가 JSON을 거절한다 (실제 HTTP GET)', async () => {
  const body = JSON.stringify({ [extraField]: true });
  const response = await new Promise((resolve, reject) => {
    const request = httpRequest(origin + '/health', { method: 'GET', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => resolve({ status: response.statusCode, json: JSON.parse(Buffer.concat(chunks).toString()) }));
    });
    request.on('error', reject);
    request.end(body);
  });
  unknownError(response);
  assert.equal((await fetch(origin + '/health')).status, 200);
});
