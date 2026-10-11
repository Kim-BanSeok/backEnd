import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import { createApp } from '../src/app.js';
import { env } from '../src/config/env.js';
import { signToken } from '../src/services/auth.service.js';
import { db, resetDb, makeUser, makeStore, makeFabric } from './helpers.js';

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

// 회원을 만들고 로그인한 것과 같은 토큰을 바로 만든다.
const tokenOf = async (role = 'BUYER') =>
  signToken(await makeUser({ role, seller_approval_status: role === 'SELLER' ? 'APPROVED' : null }));

// 게시 중인 원단과 그 판매자. 상태를 바꿔 만들려면 { status } 를 넘긴다.
async function makePostedFabric(overrides = {}) {
  const { seller, store } = await makeStore();
  const fabric = await makeFabric(store.store_id, { status: 'POSTED', ...overrides });
  return { seller, fabric };
}

const NOT_FOUND = { code: 'NOT_FOUND', message: '찾을 수 없어요' };

// ---- 42. 문의 작성

test('문의 작성 성공: 201 { inquiryId, status: WAITING } 과 DB 저장', async () => {
  const { seller, fabric } = await makePostedFabric();
  const buyer = await makeUser();

  const { status, json } = await call('POST', `/fabrics/${fabric.fabric_id}/inquiries`, {
    token: signToken(buyer),
    body: { content: '세탁하면 많이 줄어드나요?', is_private: false },
  });
  assert.equal(status, 201);
  assert.deepEqual(json, { success: true, data: { inquiryId: json.data.inquiryId, status: 'WAITING' } });
  assert.equal(typeof json.data.inquiryId, 'number');

  const saved = await db.Inquiry.findByPk(json.data.inquiryId);
  assert.equal(saved.fabric_id, fabric.fabric_id);
  assert.equal(saved.buyer_id, buyer.user_id);
  assert.equal(saved.seller_id, seller.user_id);
  assert.equal(saved.content, '세탁하면 많이 줄어드나요?');
  assert.equal(saved.is_private, false);
  assert.equal(saved.status, 'WAITING');
  assert.equal(saved.answer, null);
  assert.equal(saved.answered_at, null);
});

test('is_private 를 보내지 않으면 false, true 를 보내면 비공개로 저장', async () => {
  const { fabric } = await makePostedFabric();
  const token = await tokenOf();
  const path = `/fabrics/${fabric.fabric_id}/inquiries`;

  const open = await call('POST', path, { token, body: { content: '공개 문의' } });
  assert.equal((await db.Inquiry.findByPk(open.json.data.inquiryId)).is_private, false);

  const secret = await call('POST', path, { token, body: { content: '비공개 문의', is_private: true } });
  assert.equal(secret.status, 201);
  assert.equal((await db.Inquiry.findByPk(secret.json.data.inquiryId)).is_private, true);
});

test('내용은 앞뒤 공백을 지워 저장하고, 1000자는 통과한다', async () => {
  const { fabric } = await makePostedFabric();
  const token = await tokenOf();
  const path = `/fabrics/${fabric.fabric_id}/inquiries`;

  const trimmed = await call('POST', path, { token, body: { content: '  안녕하세요  ' } });
  assert.equal((await db.Inquiry.findByPk(trimmed.json.data.inquiryId)).content, '안녕하세요');

  const longest = await call('POST', path, { token, body: { content: '가'.repeat(1000) } });
  assert.equal(longest.status, 201);
});

test('같은 구매자가 같은 원단에 여러 번 문의할 수 있다', async () => {
  const { fabric } = await makePostedFabric();
  const token = await tokenOf();
  const path = `/fabrics/${fabric.fabric_id}/inquiries`;

  const first = await call('POST', path, { token, body: { content: '첫 번째' } });
  const second = await call('POST', path, { token, body: { content: '두 번째' } });
  assert.equal(first.status, 201);
  assert.equal(second.status, 201);
  assert.notEqual(first.json.data.inquiryId, second.json.data.inquiryId);
});

test('문의 작성 권한: 토큰 없음, 잘못된 토큰, 만료된 토큰은 401 UNAUTHORIZED', async () => {
  const { fabric } = await makePostedFabric();
  const expired = jwt.sign({ role: 'BUYER' }, env.jwtSecret, { subject: '1', expiresIn: -10 });
  for (const token of [undefined, 'garbage', expired]) {
    const { status, json } = await call('POST', `/fabrics/${fabric.fabric_id}/inquiries`, {
      token,
      body: { content: '문의' },
    });
    assert.equal(status, 401);
    assert.equal(json.error.code, 'UNAUTHORIZED');
  }
  assert.equal(await db.Inquiry.count(), 0);
});

test('구매자가 아니면 403 FORBIDDEN: 판매자(그 원단의 주인 포함)와 운영팀', async () => {
  const { seller, fabric } = await makePostedFabric();
  const path = `/fabrics/${fabric.fabric_id}/inquiries`;
  for (const token of [signToken(seller), await tokenOf('SELLER'), await tokenOf('ADMIN')]) {
    const { status, json } = await call('POST', path, { token, body: { content: '문의' } });
    assert.equal(status, 403);
    assert.deepEqual(json, { success: false, error: { code: 'FORBIDDEN', message: '권한이 없어요' } });
  }
  assert.equal(await db.Inquiry.count(), 0);
});

test('문의 작성 입력 오류: VALIDATION_ERROR 와 항목별 details', async () => {
  const { fabric } = await makePostedFabric();
  const token = await tokenOf();
  const path = `/fabrics/${fabric.fabric_id}/inquiries`;

  for (const [field, body] of [
    ['content', {}],
    ['content', { content: '' }],
    ['content', { content: '   ' }],
    ['content', { content: '가'.repeat(1001) }],
    ['content', { content: 123 }],
    ['content', { content: null }],
    ['is_private', { content: '문의', is_private: 'true' }],
    ['is_private', { content: '문의', is_private: 1 }],
    ['is_private', { content: '문의', is_private: null }],
  ]) {
    const { status, json } = await call('POST', path, { token, body });
    assert.equal(status, 400, JSON.stringify(body));
    assert.equal(json.error.code, 'VALIDATION_ERROR');
    assert.ok(
      json.error.details.some((d) => d.field === field && d.message),
      `${field}: ${JSON.stringify(body)} → ${JSON.stringify(json.error.details)}`,
    );
  }
  assert.equal(await db.Inquiry.count(), 0);
});

test('문의 작성 입력 오류: 원단 번호가 숫자가 아니거나 1 보다 작으면 400, 깨진 본문도 400', async () => {
  const token = await tokenOf();
  for (const id of ['abc', '0', '-1', '1.5', '99999999999999999999']) {
    const { status, json } = await call('POST', `/fabrics/${id}/inquiries`, { token, body: { content: '문의' } });
    assert.equal(status, 400, id);
    assert.equal(json.error.code, 'VALIDATION_ERROR');
    assert.ok(json.error.details.some((d) => d.field === 'fabricId' && d.message), `${id}: ${JSON.stringify(json.error.details)}`);
  }

  const { fabric } = await makePostedFabric();
  const res = await fetch(`${base}/fabrics/${fabric.fabric_id}/inquiries`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: '[]',
  });
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error.code, 'VALIDATION_ERROR');
});

test('게시 중이 아닌 원단, 삭제된 원단, 없는 원단은 404 NOT_FOUND 이고 저장되지 않는다', async () => {
  const pending = (await makePostedFabric({ status: 'PENDING' })).fabric;
  const soldOut = (await makePostedFabric({ status: 'SOLD_OUT' })).fabric;
  const deleted = (await makePostedFabric()).fabric;
  await deleted.destroy();
  const token = await tokenOf();

  for (const id of [pending.fabric_id, soldOut.fabric_id, deleted.fabric_id, 99999]) {
    const { status, json } = await call('POST', `/fabrics/${id}/inquiries`, { token, body: { content: '문의' } });
    assert.equal(status, 404, `fabric ${id}`);
    assert.deepEqual(json, { success: false, error: NOT_FOUND });
  }
  assert.equal(await db.Inquiry.count(), 0);
});

// ---- 43. 원단 문의 목록

// 문의를 DB 에 바로 만든다. (작성 API 는 42번 테스트에서 따로 확인한다)
const makeInquiry = (fabric, buyer, seller, overrides = {}) =>
  db.Inquiry.create({
    fabric_id: fabric.fabric_id,
    buyer_id: buyer.user_id,
    seller_id: seller.user_id,
    content: '세탁하면 많이 줄어드나요?',
    ...overrides,
  });

const listPath = (fabric, query = {}) => `/fabrics/${fabric.fabric_id}/inquiries?${new URLSearchParams(query)}`;
const ITEM_KEYS = [
  'answer', 'answered_at', 'buyer_nickname', 'content', 'created_at', 'fabricId', 'fabric_title',
  'inquiryId', 'is_private', 'status',
];
const PAGE_KEYS = ['content', 'page', 'size', 'totalElements', 'totalPages'];
const PRIVATE_TEXT = '비공개 문의입니다';

test('원단 문의 목록 성공: 로그인 없이 200, 명세서 항목 그대로, 최근 문의가 먼저', async () => {
  const { seller, fabric } = await makePostedFabric({ title: '네이비 면 20수' });
  const buyer = await makeUser({ nickname: '재봉러' });
  const first = await makeInquiry(fabric, buyer, seller, { content: '첫 문의' });
  const second = await makeInquiry(fabric, buyer, seller, {
    content: '두 번째 문의', status: 'ANSWERED', answer: '조금 줄어요', answered_at: new Date('2026-10-12T00:00:00Z'),
  });

  const { status, json } = await call('GET', listPath(fabric));
  assert.equal(status, 200);
  assert.deepEqual(Object.keys(json.data).sort(), PAGE_KEYS);
  assert.deepEqual(
    { page: json.data.page, size: json.data.size, totalElements: json.data.totalElements, totalPages: json.data.totalPages },
    { page: 0, size: 20, totalElements: 2, totalPages: 1 },
  );
  assert.deepEqual(json.data.content.map((i) => i.inquiryId), [second.inquiry_id, first.inquiry_id]);

  const [answered, waiting] = json.data.content;
  assert.deepEqual(Object.keys(answered).sort(), ITEM_KEYS);
  assert.deepEqual(answered, {
    inquiryId: second.inquiry_id,
    fabricId: fabric.fabric_id,
    fabric_title: '네이비 면 20수',
    buyer_nickname: '재봉러',
    is_private: false,
    status: 'ANSWERED',
    content: '두 번째 문의',
    answer: '조금 줄어요',
    answered_at: '2026-10-12T09:00:00+09:00',
    created_at: answered.created_at,
  });
  assert.match(answered.created_at, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\+09:00$/);
  assert.equal(waiting.status, 'WAITING');
  assert.equal(waiting.answer, null);
  assert.equal(waiting.answered_at, null);
});

test('원단 문의 목록: 문의가 없으면 빈 목록이고, 다른 원단의 문의는 섞이지 않는다', async () => {
  const { seller, fabric } = await makePostedFabric();
  const other = (await makePostedFabric()).fabric;
  const buyer = await makeUser();
  await makeInquiry(other, buyer, seller);

  const { json } = await call('GET', listPath(fabric));
  assert.deepEqual(json.data, { content: [], page: 0, size: 20, totalElements: 0, totalPages: 0 });
});

test('비공개 문의: 작성자·그 원단의 판매자·운영팀만 내용과 답변을 본다', async () => {
  const { seller, fabric } = await makePostedFabric();
  const buyer = await makeUser({ nickname: '작성자' });
  await makeInquiry(fabric, buyer, seller, {
    content: '비밀 내용', is_private: true, status: 'ANSWERED', answer: '비밀 답변', answered_at: new Date(),
  });
  const otherBuyer = await makeUser();
  const otherSeller = (await makeStore()).seller;
  const admin = await makeUser({ role: 'ADMIN' });

  for (const [name, token] of [
    ['비로그인', undefined],
    ['다른 구매자', signToken(otherBuyer)],
    ['다른 판매자', signToken(otherSeller)],
  ]) {
    const { status, json } = await call('GET', listPath(fabric), { token });
    assert.equal(status, 200, name);
    const [item] = json.data.content;
    assert.equal(item.content, PRIVATE_TEXT, name);
    assert.equal(item.answer, null, name);
    // 가리는 것은 content 와 answer 뿐이다. 나머지는 그대로 보인다.
    assert.equal(item.is_private, true, name);
    assert.equal(item.status, 'ANSWERED', name);
    assert.equal(item.buyer_nickname, '작성자', name);
  }

  for (const [name, token] of [
    ['작성자', signToken(buyer)],
    ['그 원단의 판매자', signToken(seller)],
    ['운영팀', signToken(admin)],
  ]) {
    const { json } = await call('GET', listPath(fabric), { token });
    assert.equal(json.data.content[0].content, '비밀 내용', name);
    assert.equal(json.data.content[0].answer, '비밀 답변', name);
  }
});

test('공개 문의는 누구에게나 내용과 답변이 보인다', async () => {
  const { seller, fabric } = await makePostedFabric();
  await makeInquiry(fabric, await makeUser(), seller, { content: '공개 내용', status: 'ANSWERED', answer: '공개 답변' });
  const { json } = await call('GET', listPath(fabric), { token: await tokenOf('SELLER') });
  assert.equal(json.data.content[0].content, '공개 내용');
  assert.equal(json.data.content[0].answer, '공개 답변');
});

test('삭제한 문의는 나오지 않고 개수에도 세지 않는다', async () => {
  const { seller, fabric } = await makePostedFabric();
  const buyer = await makeUser();
  const kept = await makeInquiry(fabric, buyer, seller, { content: '남은 문의' });
  const removed = await makeInquiry(fabric, buyer, seller, { content: '지운 문의' });
  await removed.destroy();

  const { json } = await call('GET', listPath(fabric));
  assert.deepEqual(json.data.content.map((i) => i.inquiryId), [kept.inquiry_id]);
  assert.equal(json.data.totalElements, 1);
});

test('탈퇴한 구매자의 문의는 남고 buyer_nickname 은 null 이다', async () => {
  const { seller, fabric } = await makePostedFabric();
  const buyer = await makeUser({ nickname: '탈퇴할 회원' });
  await makeInquiry(fabric, buyer, seller, { content: '남은 문의' });
  await buyer.destroy();

  const { status, json } = await call('GET', listPath(fabric));
  assert.equal(status, 200);
  assert.equal(json.data.content[0].content, '남은 문의');
  assert.equal(json.data.content[0].buyer_nickname, null);
});

test('원단 문의 목록 페이지 나누기: page·size 와 범위 밖 페이지', async () => {
  const { seller, fabric } = await makePostedFabric();
  const buyer = await makeUser();
  const ids = [];
  for (let i = 0; i < 5; i += 1) ids.push((await makeInquiry(fabric, buyer, seller, { content: `문의${i}` })).inquiry_id);

  const second = await call('GET', listPath(fabric, { page: 1, size: 2 }));
  assert.deepEqual(second.json.data.content.map((i) => i.inquiryId), [ids[2], ids[1]]);
  assert.equal(second.json.data.totalElements, 5);
  assert.equal(second.json.data.totalPages, 3);

  const beyond = await call('GET', listPath(fabric, { page: 9, size: 2 }));
  assert.deepEqual(beyond.json.data.content, []);
});

test('원단 문의 목록 권한: 공개 API 라도 잘못된 토큰·만료된 토큰은 401', async () => {
  const { fabric } = await makePostedFabric();
  const expired = jwt.sign({ role: 'BUYER' }, env.jwtSecret, { subject: '1', expiresIn: -10 });
  for (const token of ['garbage', expired]) {
    const { status, json } = await call('GET', listPath(fabric), { token });
    assert.equal(status, 401);
    assert.equal(json.error.code, 'UNAUTHORIZED');
  }
});

test('원단 문의 목록 입력 오류: VALIDATION_ERROR 와 항목별 details', async () => {
  const { fabric } = await makePostedFabric();
  for (const [field, path] of [
    ['page', listPath(fabric, { page: -1 })],
    ['page', listPath(fabric, { page: 'abc' })],
    ['page', listPath(fabric, { page: 1.5 })],
    ['size', listPath(fabric, { size: 0 })],
    ['size', listPath(fabric, { size: 51 })],
    ['fabricId', '/fabrics/abc/inquiries'],
    ['fabricId', '/fabrics/0/inquiries'],
    ['fabricId', '/fabrics/-1/inquiries'],
    ['fabricId', '/fabrics/1.5/inquiries'],
  ]) {
    const { status, json } = await call('GET', path);
    assert.equal(status, 400, path);
    assert.equal(json.error.code, 'VALIDATION_ERROR');
    assert.ok(json.error.details.some((d) => d.field === field && d.message), `${path}: ${JSON.stringify(json.error.details)}`);
  }
});

test('게시 중이 아닌 원단: 비로그인·구매자·다른 판매자는 404, 그 원단의 판매자와 운영팀은 볼 수 있다', async () => {
  const { seller, fabric } = await makePostedFabric({ status: 'PENDING' });
  const buyer = await makeUser();
  await makeInquiry(fabric, buyer, seller, { content: '승인 전 문의' });
  const otherSeller = (await makeStore()).seller;
  const admin = await makeUser({ role: 'ADMIN' });

  for (const [name, token] of [
    ['비로그인', undefined],
    ['구매자', signToken(buyer)],
    ['다른 판매자', signToken(otherSeller)],
  ]) {
    const { status, json } = await call('GET', listPath(fabric), { token });
    assert.equal(status, 404, name);
    assert.deepEqual(json, { success: false, error: NOT_FOUND }, name);
  }
  for (const [name, token] of [['그 원단의 판매자', signToken(seller)], ['운영팀', signToken(admin)]]) {
    const { status, json } = await call('GET', listPath(fabric), { token });
    assert.equal(status, 200, name);
    assert.equal(json.data.content[0].content, '승인 전 문의', name);
  }
});

test('판매 완료 원단도 게시 중이 아니라서 구매자에게는 404 이다', async () => {
  const { fabric } = await makePostedFabric({ status: 'SOLD_OUT' });
  const { status } = await call('GET', listPath(fabric), { token: await tokenOf() });
  assert.equal(status, 404);
});

test('삭제된 원단과 없는 원단은 누구에게나 404 이다 (판매자·운영팀 포함)', async () => {
  const { seller, fabric } = await makePostedFabric();
  await fabric.destroy();
  const admin = await makeUser({ role: 'ADMIN' });

  for (const token of [undefined, signToken(seller), signToken(admin)]) {
    assert.equal((await call('GET', listPath(fabric), { token })).status, 404);
    assert.equal((await call('GET', '/fabrics/99999/inquiries', { token })).status, 404);
  }
});
