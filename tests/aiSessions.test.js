import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { signToken } from '../src/services/auth.service.js';
import { setProvider } from '../src/ai/index.js';
import { LISTING_QUESTION } from '../src/ai/flow.js';
import { aiSessionsStore } from '../src/dao/aiSessions.dao.js';
import { db, resetDb, makeUser, makeStore } from './helpers.js';

let server;
let base;

before(async () => {
  await resetDb();
  server = createApp().listen(0);
  base = `http://localhost:${server.address().port}/api/v1`;
});
beforeEach(async () => {
  await resetDb();
  await aiSessionsStore.clear();
  setProvider(); // 가짜 AI 로 되돌린다
});
after(async () => {
  setProvider();
  server.close();
  await db.sequelize.close();
});

async function call(method, path, { body, token } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: { ...(body !== undefined && { 'Content-Type': 'application/json' }), ...(token && { Authorization: `Bearer ${token}` }) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: await res.json() };
}

// ---- 도우미

const approvedSeller = async () => {
  const { seller } = await makeStore();
  return { seller, token: signToken(seller) };
};
const start = (token) => call('POST', '/ai-sessions', { token });
const answer = (id, token, body) => call('POST', `/ai-sessions/${id}/answers`, { token, body });
const get = (id, token) => call('GET', `/ai-sessions/${id}`, { token });
const confirm = (id, token, body) => call('POST', `/ai-sessions/${id}/confirm`, { token, body });
const abort = (id, token) => call('POST', `/ai-sessions/${id}/abort`, { token });

async function startOk(token) {
  const { status, json } = await start(token);
  assert.equal(status, 201, JSON.stringify(json));
  return json.data;
}

const fabricBody = (overrides = {}) => ({
  sale_type: 'SCRAP', title: '네이비 면 20수', price: 3000, remaining_length_cm: null,
  detail: { material: 'COTTON', thickness: 'THIN', color_family: 'NAVY', width_cm: 50, length_cm: 70, has_defect: false, sheet_count: 1 },
  ...overrides,
});

const SCRAP_MEMO = '네이비 면 20수, 자투리 한 장, 가로 50 세로 70, 얇아요, 남색, 3000원';

// 자투리 한 벌을 한 줄 설명으로 채운다. 돌려주는 값: 마지막 응답 데이터
async function fillScrap(id, token) {
  return (await answer(id, token, { answer: SCRAP_MEMO })).json.data;
}

// ==== 17. AI 등록 시작

test('시작 성공: 201, 진행 중, 첫 질문은 원단 설명, 빈 초안 (명세서 17번)', async () => {
  const { token } = await approvedSeller();
  const { status, json } = await start(token);
  assert.equal(status, 201);
  assert.equal(json.success, true);
  assert.deepEqual(Object.keys(json.data).sort(), ['ai_draft', 'is_complete', 'next_question', 'sessionId', 'session_status', 'unconfirmed_fields']);
  assert.match(json.data.sessionId, /^[0-9a-f]{24}$/);
  assert.equal(json.data.session_status, 'IN_PROGRESS');
  assert.deepEqual(json.data.next_question, LISTING_QUESTION);
  assert.deepEqual([json.data.ai_draft, json.data.unconfirmed_fields, json.data.is_complete], [{}, [], false]);
});

test('시작 권한: 로그인 안 함 401, 구매자·운영팀 403', async () => {
  assert.equal((await start()).status, 401);
  for (const role of ['BUYER', 'ADMIN']) {
    const { status, json } = await start(signToken(await makeUser({ role })));
    assert.equal(status, 403, role);
    assert.equal(json.error.code, 'FORBIDDEN');
  }
});

test('승인 전·거절된 판매자는 SELLER_NOT_APPROVED, 승인된 판매자라도 매장이 없으면 STORE_REQUIRED, 승인을 먼저 확인한다', async () => {
  for (const approval of ['PENDING', 'REJECTED']) {
    const { seller } = await makeStore();
    await seller.update({ seller_approval_status: approval });
    const { status, json } = await start(signToken(seller));
    assert.equal(status, 403, approval);
    assert.equal(json.error.code, 'SELLER_NOT_APPROVED');
  }
  const noStore = await makeUser({ role: 'SELLER', seller_approval_status: 'APPROVED' });
  assert.equal((await start(signToken(noStore))).json.error.code, 'STORE_REQUIRED');

  const both = await makeUser({ role: 'SELLER', seller_approval_status: 'PENDING' }); // 승인도 매장도 없음
  assert.equal((await start(signToken(both))).json.error.code, 'SELLER_NOT_APPROVED');
});

// ==== 18. 세션 조회

test('조회: 대화 기록과 fabric_id(확정 전 null)가 함께 오고, 첫 질문이 대화에 남아 있다', async () => {
  const { token } = await approvedSeller();
  const created = await startOk(token);
  const { status, json } = await get(created.sessionId, token);
  assert.equal(status, 200);
  assert.deepEqual(Object.keys(json.data).sort(), ['ai_draft', 'fabric_id', 'is_complete', 'messages', 'next_question', 'sessionId', 'session_status', 'unconfirmed_fields']);
  assert.equal(json.data.fabric_id, null);
  assert.deepEqual(json.data.messages.map((m) => [m.role, m.content]), [['assistant', LISTING_QUESTION.text]]);
  assert.match(json.data.messages[0].created_at, /\+09:00$/);
  assert.deepEqual(json.data.next_question, created.next_question); // 저장된 값이 아니라 지금 상태로 계산한 값
});

test('조회 권한: 본인 세션만 (남의 세션 403), 없는 세션 404, 번호 형식이 틀리면 400, 로그인 안 함 401', async () => {
  const mine = await approvedSeller();
  const other = await approvedSeller();
  const { sessionId } = await startOk(mine.token);

  assert.equal((await get(sessionId)).status, 401);
  const forbidden = await get(sessionId, other.token);
  assert.equal(forbidden.status, 403);
  assert.equal(forbidden.json.error.code, 'FORBIDDEN');
  const missing = await get('0'.repeat(24), mine.token);
  assert.equal(missing.status, 404);
  assert.equal(missing.json.error.code, 'NOT_FOUND');
  for (const bad of ['abc', '12345', 'g'.repeat(24), 'A'.repeat(24)]) {
    const { status, json } = await get(bad, mine.token);
    assert.equal(status, 400, bad);
    assert.ok(json.error.details.some((d) => d.field === 'sessionId'));
  }
  assert.equal((await get(sessionId, signToken(await makeUser({ role: 'BUYER' })))).status, 403);
});

// ==== 19. 답변

test('첫 질문은 선택 버튼이 없어서 selected 를 거절하고 AI 를 부르지 않는다', async () => {
  const { token } = await approvedSeller();
  const { sessionId } = await startOk(token);
  let calls = 0;
  setProvider({ model: 'spy', extract: async () => { calls += 1; throw new Error('호출되면 안 돼요'); } });

  const { status, json } = await answer(sessionId, token, { selected: 'SCRAP' });
  assert.equal(status, 400);
  assert.equal(json.error.code, 'VALIDATION_ERROR');
  assert.equal(calls, 0);
  assert.deepEqual((await get(sessionId, token)).json.data.ai_draft, {});
});

test('자투리라고 짧게 적으면 판매 형태와 소개글을 채우고 질문을 끝낸다', async () => {
  const { token } = await approvedSeller();
  const { sessionId } = await startOk(token);
  const { status, json } = await answer(sessionId, token, { answer: '자투리 한 장이에요' });
  assert.equal(status, 200);
  assert.equal(json.data.ai_draft.sale_type, 'SCRAP');
  assert.match(json.data.ai_draft.description, /자투리 한 장/);
  assert.equal(json.data.next_question, null);
  assert.equal(json.data.is_complete, true);
});

test('말하듯 쓴 답(answer)을 AI 가 읽어 초안에 정리한다: 전체 흐름 끝까지', async () => {
  const { token } = await approvedSeller();
  const { sessionId } = await startOk(token);
  const last = await fillScrap(sessionId, token);

  assert.equal(last.ai_draft.sale_type, 'SCRAP');
  assert.equal(last.ai_draft.title, '네이비 면 20수');
  assert.deepEqual([last.ai_draft.width_cm, last.ai_draft.length_cm, last.ai_draft.material, last.ai_draft.thickness, last.ai_draft.color_family, last.ai_draft.has_defect, last.ai_draft.price], [50, 70, 'COTTON', 'THIN', 'NAVY', false, 3000]);
  assert.match(last.ai_draft.description, /네이비 면 20수/);
  assert.deepEqual([last.is_complete, last.next_question, last.unconfirmed_fields], [true, null, []]);

  const { json } = await get(sessionId, token);
  assert.equal(json.data.messages.length, 3); // 안내, 판매자 설명, 정리 완료
  assert.deepEqual(json.data.messages.slice(0, 3).map((m) => m.role), ['assistant', 'user', 'assistant']);
  assert.equal(json.data.messages[1].content, SCRAP_MEMO);
  assert.match(json.data.messages.at(-1).content, /모두 확인했어요/);
});

test('"모름"이라고 적으면 비워 두고 소재는 UNKNOWN, 확인이 필요한 항목으로 남긴다', async () => {
  const { token } = await approvedSeller();
  const { sessionId } = await startOk(token);
  const data = (await answer(sessionId, token, { answer: '소재는 잘 모르겠어요' })).json.data;
  assert.equal(data.ai_draft.material, 'UNKNOWN');
  assert.equal('thickness' in data.ai_draft, false);
  assert.ok(data.unconfirmed_fields.includes('material'));
  assert.ok(data.unconfirmed_fields.includes('thickness'));
  assert.equal(data.next_question, null);
  assert.equal(data.is_complete, true);
});

test('판매 형태를 알아듣지 못하면 같은 질문을 반복하지 않고 확인 항목으로 남긴다', async () => {
  const { token } = await approvedSeller();
  const { sessionId } = await startOk(token);
  const { json } = await answer(sessionId, token, { answer: '글쎄요 뭐라고 해야 할지' });
  assert.equal(json.data.next_question, null);
  assert.equal(json.data.is_complete, true);
  assert.ok(json.data.unconfirmed_fields.includes('sale_type'));
  assert.match(json.data.ai_draft.description, /글쎄요/);
});

test('마 단위 설명은 cm 로 바꿔 저장한다 (3마 → 270)', async () => {
  const { token } = await approvedSeller();
  const { sessionId } = await startOk(token);
  const { json } = await answer(sessionId, token, { answer: '린넨 롤, 폭 150에 3마, 9,900원' });
  assert.equal(json.data.ai_draft.sale_type, 'ROLL');
  assert.deepEqual([json.data.ai_draft.width_cm, json.data.ai_draft.remaining_length_cm], [150, 270]);
  assert.equal('length_cm' in json.data.ai_draft, false);
});

test('자투리 길이는 90cm 를 넘거나 30cm 보다 짧아도 그대로 받는다', async () => {
  const { token } = await approvedSeller();
  for (const [title, answerText, length] of [['긴 원단', '가로 100 세로 120', 120], ['짧은 원단', '가로 50 세로 20', 20]]) {
    const sessionId = (await startOk(token)).sessionId;
    const data = (await answer(sessionId, token, { answer: `${title}, 자투리 한 장, ${answerText}` })).json.data;
    assert.equal(data.ai_draft.sale_type, 'SCRAP');
    assert.equal(data.ai_draft.length_cm, length);
    assert.equal(data.is_complete, true);
  }
});

test('finish 는 더 묻지 않고 지금까지의 초안을 보여 준다 (is_complete true), 답과 함께 보낼 수도 있다', async () => {
  const { token } = await approvedSeller();
  const { sessionId } = await startOk(token);
  const { status, json } = await answer(sessionId, token, { finish: true });
  assert.equal(status, 200);
  assert.deepEqual([json.data.is_complete, json.data.next_question, json.data.ai_draft], [true, null, {}]);

  const second = (await startOk(token)).sessionId;
  const withAnswer = (await answer(second, token, { answer: '롤 원단', finish: true })).json.data;
  assert.equal(withAnswer.ai_draft.sale_type, 'ROLL');
  assert.equal(withAnswer.is_complete, true);
});

test('입력 오류: answer·selected·finish 가 모두 없거나 형식이 틀리면 VALIDATION_ERROR', async () => {
  const { token } = await approvedSeller();
  const { sessionId } = await startOk(token);
  for (const body of [{}, { finish: false }, { answer: '' }, { answer: '   ' }, { answer: 'a'.repeat(1001) }, { selected: '' }, { selected: 'a'.repeat(51) }, { answer: 1 }, { finish: 'yes' }]) {
    const { status, json } = await answer(sessionId, token, body);
    assert.equal(status, 400, JSON.stringify(body).slice(0, 40));
    assert.equal(json.error.code, 'VALIDATION_ERROR');
  }
  assert.equal((await call('POST', `/ai-sessions/${sessionId}/answers`, { token })).status, 400); // 본문 없음
  assert.equal((await answer(sessionId, token, { answer: 'a'.repeat(1000) })).status, 200); // 경계
});

test('선택 목록에 없는 selected 는 VALIDATION_ERROR, 선택 버튼이 없는 질문에 selected 를 보내도 마찬가지', async () => {
  const { token } = await approvedSeller();
  const { sessionId } = await startOk(token);
  const bad = await answer(sessionId, token, { selected: 'BOX' });
  assert.equal(bad.status, 400);
  assert.equal(bad.json.error.details[0].field, 'selected');
  assert.deepEqual((await get(sessionId, token)).json.data.ai_draft, {}); // 아무것도 바뀌지 않았다

  assert.equal((await answer(sessionId, token, { selected: '네이비 면' })).status, 400); // 설명 질문에도 선택 목록이 없다
});

test('끝까지 답한 뒤 더 답하면 VALIDATION_ERROR (물어볼 것이 없다)', async () => {
  const { token } = await approvedSeller();
  const { sessionId } = await startOk(token);
  await fillScrap(sessionId, token);
  const { status, json } = await answer(sessionId, token, { answer: '더 있어요' });
  assert.equal(status, 400);
  assert.equal(json.error.code, 'VALIDATION_ERROR');
});

test('답변 권한: 남의 세션 403, 없는 세션 404, 로그인 안 함 401, 구매자 403', async () => {
  const mine = await approvedSeller();
  const other = await approvedSeller();
  const { sessionId } = await startOk(mine.token);
  assert.equal((await answer(sessionId, undefined, { selected: 'SCRAP' })).status, 401);
  assert.equal((await answer(sessionId, other.token, { selected: 'SCRAP' })).json.error.code, 'FORBIDDEN');
  assert.equal((await answer('0'.repeat(24), mine.token, { selected: 'SCRAP' })).status, 404);
  assert.equal((await answer(sessionId, signToken(await makeUser({ role: 'BUYER' })), { selected: 'SCRAP' })).status, 403);
  assert.deepEqual((await get(sessionId, mine.token)).json.data.ai_draft, {}); // 남이 보낸 답은 반영되지 않았다
});

// ---- 19. AI 실패와 재시도

test('AI 가 한 번 실패하면 서버가 1회 다시 시도해서 성공한다', async () => {
  const { token } = await approvedSeller();
  const { sessionId } = await startOk(token);
  let calls = 0;
  setProvider({
    model: 'flaky',
    extract: async () => {
      calls += 1;
      if (calls === 1) throw new Error('일시적 오류');
      return { values: { sale_type: 'ROLL' }, usage: { input_tokens: 100, output_tokens: 10 } };
    },
  });
  const { status, json } = await answer(sessionId, token, { answer: '롤이요' });
  assert.equal(status, 200);
  assert.equal(calls, 2);
  assert.equal(json.data.ai_draft.sale_type, 'ROLL');
});

test('AI 가 계속 실패하면 503 AI_UNAVAILABLE 이고, 그때까지의 초안은 그대로 남는다', async () => {
  const { token } = await approvedSeller();
  const { sessionId } = await startOk(token);
  let calls = 0;
  setProvider({ model: 'down', extract: async () => { calls += 1; throw new Error('시간 초과'); } });

  const { status, json } = await answer(sessionId, token, { answer: '네이비 면' });
  assert.equal(status, 503);
  assert.equal(json.error.code, 'AI_UNAVAILABLE');
  assert.equal(json.error.message, 'AI 연결이 어려워요. 직접 입력으로 계속해 주세요');
  assert.equal(calls, 2); // 처음 + 다시 시도 1회 (그 이상 되풀이하지 않는다)

  setProvider(); // AI 가 복구되었다고 보고 같은 세션을 이어서
  const after = await get(sessionId, token);
  assert.deepEqual(after.json.data.ai_draft, {});
  assert.equal(after.json.data.session_status, 'IN_PROGRESS');
  assert.equal(after.json.data.messages.length, 1); // 실패한 답은 대화에 남지 않는다
  assert.equal((await answer(sessionId, token, { answer: '네이비 면 자투리' })).status, 200);
});

test('AI 가 형식이 틀린 응답을 주어도 1회 다시 시도하고, 계속 틀리면 503', async () => {
  const { token } = await approvedSeller();
  const { sessionId } = await startOk(token);
  for (const bad of [undefined, null, { values: null }, { values: 'x' }, {}]) {
    setProvider({ model: 'bad', extract: async () => bad });
    const { status, json } = await answer(sessionId, token, { answer: '롤' });
    assert.equal(status, 503, JSON.stringify(bad));
    assert.equal(json.error.code, 'AI_UNAVAILABLE');
  }
});

test('AI 가 목록 밖의 값을 주면 소재는 UNKNOWN, 그 밖의 항목은 비우고 unconfirmed_fields 에 넣는다', async () => {
  const { token } = await approvedSeller();
  const { sessionId } = await startOk(token);
  setProvider({ model: 'odd', extract: async () => ({ values: { material: 'SILK_ROAD', thickness: 'NOT_A_SIZE' }, usage: {} }) });
  const data = (await answer(sessionId, token, { answer: '비단이요' })).json.data;
  assert.equal(data.ai_draft.material, 'UNKNOWN');
  assert.equal('thickness' in data.ai_draft, false);
  assert.ok(data.unconfirmed_fields.includes('material'));
  assert.ok(data.unconfirmed_fields.includes('thickness'));
});

test('AI 호출 횟수와 토큰이 세션에 기록된다 (비용 산정용)', async () => {
  const { token } = await approvedSeller();
  const { sessionId } = await startOk(token);
  setProvider({ model: 'm-9', extract: async () => ({ values: { sale_type: 'SCRAP' }, usage: { input_tokens: 120, output_tokens: 15 } }) });
  await answer(sessionId, token, { answer: '자투리요' });
  assert.equal((await answer(sessionId, token, { answer: '한 번 더' })).status, 400); // 끝난 뒤에는 AI 를 다시 부르지 않는다
  const stored = await aiSessionsStore.findById(sessionId);
  assert.deepEqual([stored.call_count, stored.input_tokens, stored.output_tokens, stored.prompt_version], [1, 120, 15, 'p2']);
  assert.equal(stored.seller_id > 0, true);
});

test('같은 세션에 답변을 동시에 보내도 하나씩 처리되어 서로의 변경을 덮어쓰지 않는다', async () => {
  const { token } = await approvedSeller();
  const { sessionId } = await startOk(token);
  setProvider({
    model: 'slow',
    extract: async () => {
      await new Promise((resolve) => setTimeout(resolve, 60));
      return { values: { sale_type: 'SCRAP', title: '이름' }, usage: {} };
    },
  });
  const [a, b] = await Promise.all([
    answer(sessionId, token, { answer: '자투리요' }),
    answer(sessionId, token, { answer: '이름이에요' }),
  ]);
  assert.deepEqual([a.status, b.status].sort(), [200, 400]);
  const { json } = await get(sessionId, token);
  assert.equal(json.data.ai_draft.sale_type, 'SCRAP');
  assert.equal(json.data.ai_draft.title, '이름');
  assert.equal(json.data.messages.filter((m) => m.role === 'user').length, 1);
});

// ==== 20. 확정

test('확정 성공: 원단이 만들어지고 PENDING, 세션은 CONFIRMED 가 되며 final_data·fabric_id 가 남고 초안은 그대로다', async () => {
  const { token } = await approvedSeller();
  const { sessionId } = await startOk(token);
  const draft = (await fillScrap(sessionId, token)).ai_draft;

  const { status, json } = await confirm(sessionId, token, fabricBody());
  assert.equal(status, 201);
  assert.deepEqual(json, { success: true, data: { fabricId: json.data.fabricId, status: 'PENDING' } });
  assert.equal((await db.Fabric.findByPk(json.data.fabricId)).status, 'PENDING'); // 확정된 원단도 운영팀 승인이 필요하다

  const stored = await get(sessionId, token);
  assert.equal(stored.json.data.session_status, 'CONFIRMED');
  assert.equal(stored.json.data.fabric_id, json.data.fabricId);
  assert.deepEqual(stored.json.data.ai_draft, draft); // 초안은 그대로 남는다
  assert.equal(stored.json.data.next_question, null);
  const raw = await aiSessionsStore.findById(sessionId);
  assert.deepEqual([raw.final_data.title, raw.final_data.detail.thickness], ['네이비 면 20수', 'THIN']);
});

test('판매자가 초안을 고쳐서 확정할 수 있다 (최종본이 초안과 다르다)', async () => {
  const { token } = await approvedSeller();
  const { sessionId } = await startOk(token);
  await fillScrap(sessionId, token);
  const { json } = await confirm(sessionId, token, fabricBody({ title: '고친 제목', price: 3500 }));
  const fabric = await db.Fabric.findByPk(json.data.fabricId);
  assert.deepEqual([fabric.title, fabric.price], ['고친 제목', 3500]);
  const raw = await aiSessionsStore.findById(sessionId);
  assert.notEqual(raw.final_data.title, raw.ai_draft.title); // 초안과 최종본을 비교할 수 있다
});

test('진행 중에도 아직 다 묻지 않았어도 확정할 수 있다', async () => {
  const { token } = await approvedSeller();
  const { sessionId } = await startOk(token);
  assert.equal((await confirm(sessionId, token, fabricBody())).status, 201);
});

test('두 번 눌러도 원단은 하나만 만들어지고, 두 번째는 AI_SESSION_CLOSED', async () => {
  const { token } = await approvedSeller();
  const { sessionId } = await startOk(token);
  assert.equal((await confirm(sessionId, token, fabricBody())).status, 201);
  const again = await confirm(sessionId, token, fabricBody());
  assert.equal(again.status, 409);
  assert.equal(again.json.error.code, 'AI_SESSION_CLOSED');
  assert.equal(await db.Fabric.count(), 1);
});

test('동시에 여러 번 눌러도 원단은 하나만 만들어진다', async () => {
  const { token } = await approvedSeller();
  const { sessionId } = await startOk(token);
  const results = await Promise.all(Array.from({ length: 6 }, () => confirm(sessionId, token, fabricBody())));
  assert.equal(results.filter((r) => r.status === 201).length, 1, results.map((r) => r.status).join(','));
  assert.ok(results.filter((r) => r.status !== 201).every((r) => r.json.error.code === 'AI_SESSION_CLOSED'));
  assert.equal(await db.Fabric.count(), 1);
  assert.equal(await db.FabricDetail.count(), 1);
});

test('검사에 걸려 실패하면 세션은 계속 진행 중이고 고쳐서 다시 확정할 수 있다', async () => {
  const { token } = await approvedSeller();
  const { sessionId } = await startOk(token);
  const cases = [
    [fabricBody({ detail: { ...fabricBody().detail, length_cm: 0 } }), 'SCRAP_LENGTH_OUT_OF_RANGE'],
    [fabricBody({ detail: { ...fabricBody().detail, has_defect: true } }), 'DEFECT_NOTE_REQUIRED'],
    [fabricBody({ sale_type: 'ROLL', remaining_length_cm: 50 }), 'ROLL_LENGTH_REQUIRED'],
  ];
  for (const [body, code] of cases) {
    const { status, json } = await confirm(sessionId, token, body);
    assert.equal(status, 400, code);
    assert.equal(json.error.code, code);
  }
  const bad = await confirm(sessionId, token, { title: '' }); // 형식 오류
  assert.equal(bad.json.error.code, 'VALIDATION_ERROR');

  assert.equal(await db.Fabric.count(), 0);
  assert.equal((await get(sessionId, token)).json.data.session_status, 'IN_PROGRESS');
  assert.equal((await confirm(sessionId, token, fabricBody())).status, 201); // 고쳐서 다시
});

test('확정 권한: 승인된 판매자만 (승인 전이면 SELLER_NOT_APPROVED, 세션은 진행 중 유지)', async () => {
  const { seller, token } = await approvedSeller();
  const { sessionId } = await startOk(token);
  await seller.update({ seller_approval_status: 'REJECTED' }); // 세션을 연 뒤 승인이 취소된 경우
  const { status, json } = await confirm(sessionId, token, fabricBody());
  assert.equal(status, 403);
  assert.equal(json.error.code, 'SELLER_NOT_APPROVED');
  assert.equal(await db.Fabric.count(), 0);
  assert.equal((await get(sessionId, token)).json.data.session_status, 'IN_PROGRESS');
});

test('확정 권한: 남의 세션 403, 없는 세션 404, 로그인 안 함 401', async () => {
  const mine = await approvedSeller();
  const other = await approvedSeller();
  const { sessionId } = await startOk(mine.token);
  assert.equal((await confirm(sessionId, undefined, fabricBody())).status, 401);
  assert.equal((await confirm(sessionId, other.token, fabricBody())).json.error.code, 'FORBIDDEN');
  assert.equal((await confirm('0'.repeat(24), mine.token, fabricBody())).status, 404);
  assert.equal(await db.Fabric.count(), 0);
});

// ==== 21. 중단

test('중단 성공: ABORTED 와 지금까지의 초안·unconfirmed_fields 를 돌려준다 (명세서 21번)', async () => {
  const { token } = await approvedSeller();
  const { sessionId } = await startOk(token);
  await answer(sessionId, token, { answer: '롤 원단, 폭 150, 3마, 9,900원' });
  const { status, json } = await abort(sessionId, token);
  assert.equal(status, 200);
  assert.equal(json.data.session_status, 'ABORTED');
  assert.equal(json.data.ai_draft.sale_type, 'ROLL');
  assert.equal((await get(sessionId, token)).json.data.session_status, 'ABORTED');
});

test('중단한 뒤에는 답변·확정·중단을 할 수 없다 (AI_SESSION_CLOSED)', async () => {
  const { token } = await approvedSeller();
  const { sessionId } = await startOk(token);
  await abort(sessionId, token);
  for (const response of [await answer(sessionId, token, { selected: 'SCRAP' }), await confirm(sessionId, token, fabricBody()), await abort(sessionId, token)]) {
    assert.equal(response.status, 409);
    assert.equal(response.json.error.code, 'AI_SESSION_CLOSED');
    assert.equal(response.json.error.message, '이미 끝난 등록이에요');
  }
  assert.equal(await db.Fabric.count(), 0);
});

test('확정된 세션도 답변·확정·중단을 할 수 없다 (AI_SESSION_CLOSED)', async () => {
  const { token } = await approvedSeller();
  const { sessionId } = await startOk(token);
  await confirm(sessionId, token, fabricBody());
  for (const response of [await answer(sessionId, token, { selected: 'SCRAP' }), await abort(sessionId, token)]) {
    assert.equal(response.json.error.code, 'AI_SESSION_CLOSED');
  }
  assert.equal((await get(sessionId, token)).json.data.session_status, 'CONFIRMED'); // 조회는 할 수 있다
});

test('중단 권한: 남의 세션 403, 없는 세션 404, 로그인 안 함 401, 번호 형식 400', async () => {
  const mine = await approvedSeller();
  const other = await approvedSeller();
  const { sessionId } = await startOk(mine.token);
  assert.equal((await abort(sessionId)).status, 401);
  assert.equal((await abort(sessionId, other.token)).json.error.code, 'FORBIDDEN');
  assert.equal((await abort('0'.repeat(24), mine.token)).status, 404);
  assert.equal((await abort('abc', mine.token)).status, 400);
  assert.equal((await get(sessionId, mine.token)).json.data.session_status, 'IN_PROGRESS');
});

test('답변과 중단이 동시에 와도 어느 순서로 처리되든 결과가 서로 맞는다 (중단된 뒤의 답은 반영되지 않는다)', async () => {
  const { token } = await approvedSeller();
  const { sessionId } = await startOk(token);
  setProvider({ model: 'slow', extract: async () => { await new Promise((r) => setTimeout(r, 60)); return { values: { sale_type: 'ROLL' }, usage: {} }; } });
  const [answered, aborted] = await Promise.all([answer(sessionId, token, { answer: '롤' }), abort(sessionId, token)]);

  const stored = (await get(sessionId, token)).json.data;
  assert.equal(stored.session_status, 'ABORTED'); // 중단은 항상 성공한다
  assert.equal(aborted.status, 200);
  if (answered.status === 200) {
    assert.equal(stored.ai_draft.sale_type, 'ROLL'); // 답변이 먼저 처리되었으면 초안에 반영되고
  } else {
    assert.equal(answered.status, 409); // 중단이 먼저 처리되었으면 답변은 거절되고
    assert.equal(answered.json.error.code, 'AI_SESSION_CLOSED');
    assert.deepEqual(stored.ai_draft, {}); // 초안에도 반영되지 않는다
  }
  // 중단 응답의 초안은 그 시점의 초안과 같다
  assert.deepEqual(aborted.json.data.ai_draft, stored.ai_draft);
});

// ==== 처음부터 끝까지

test('시작 → 답변 → 확정 → 운영팀 승인까지 이어진다', async () => {
  const { token } = await approvedSeller();
  const admin = signToken(await makeUser({ role: 'ADMIN' }));
  const { sessionId } = await startOk(token);
  await fillScrap(sessionId, token);
  const { json } = await confirm(sessionId, token, fabricBody());
  const { fabricId } = json.data;

  const pending = await call('GET', '/admin/fabrics', { token: admin });
  assert.deepEqual(pending.json.data.content.map((f) => f.fabricId), [fabricId]); // 확정된 원단은 승인 대기
  await db.FabricImage.create({ fabric_id: fabricId, image_url: 'http://x/1.png', thumbnail_url: 'http://x/t.webp', sort_order: 0 });
  assert.equal((await call('POST', `/admin/fabrics/${fabricId}/approve`, { token: admin })).status, 200);
});

test('사진과 입력으로 상세설명을 만들면 치수는 입력값을 유지한다', async () => {
  const { token } = await approvedSeller();
  const { status, json } = await call('POST', '/ai-sessions/listings', {
    token,
    body: {
      material_text: '면 혼방 데님',
      thickness: 'THIN',
      thickness_label: '얇음',
      width_cm: 50,
      length_cm: 80,
      sheet_count: 3,
      feel: '매끈함',
      images: [{ media_type: 'image/jpeg', data: 'YQ==' }],
    },
  });
  assert.equal(status, 201, JSON.stringify(json));
  assert.equal(json.data.ai_draft.sale_type, 'SCRAP');
  assert.equal(json.data.ai_draft.width_cm, 50);
  assert.equal(json.data.ai_draft.length_cm, 80);
  assert.equal(json.data.ai_draft.thickness, 'THIN');
  assert.equal(json.data.ai_draft.material, 'BLEND');
  assert.equal(json.data.ai_draft.title, '면 혼방 데님');
  assert.match(json.data.ai_draft.description, /면 혼방 데님/);
  assert.equal(json.data.ai_draft.price, undefined);
  assert.equal(json.data.is_complete, true);
  assert.equal(json.data.next_question, null);
  assert.equal(json.data.messages[0].role, 'user');
  assert.match(json.data.messages[0].content, /폭: 50cm/);
  assert.match(json.data.messages[0].content, /장수: 3장/);
});

test('롤로 상세설명을 만들면 남은 길이를 유지하고 판매 장수는 받지 않는다', async () => {
  const { token } = await approvedSeller();
  const { status, json } = await call('POST', '/ai-sessions/listings', {
    token,
    body: {
      material_text: '린넨',
      thickness: 'NORMAL',
      thickness_label: '보통',
      width_cm: 110,
      length_cm: 270,
      sale_type: 'ROLL',
      images: [{ media_type: 'image/jpeg', data: 'YQ==' }],
    },
  });
  assert.equal(status, 201, JSON.stringify(json));
  assert.equal(json.data.ai_draft.sale_type, 'ROLL');
  assert.equal(json.data.ai_draft.width_cm, 110);
  assert.equal(json.data.ai_draft.remaining_length_cm, 270);
  assert.equal(json.data.ai_draft.length_cm, undefined);
  assert.match(json.data.messages[0].content, /남은 길이: 270cm/);
});
