import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
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
      ...(body !== undefined && { 'Content-Type': 'application/json' }),
      ...(token && { Authorization: `Bearer ${token}` }),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: await res.json() };
}

// ---- 도우미

const DAY = 24 * 60 * 60 * 1000;
const future = (days = 2) => new Date(Date.now() + days * DAY).toISOString();

// 승인된 판매자 + 매장 + 게시 중인 원단. { roll: true } 면 롤(900cm, 90cm당 6000원), 아니면 자투리(장당 3000원).
async function setup({ roll = false, fabric: overrides = {} } = {}) {
  const { seller, store } = await makeStore();
  const fabric = await makeFabric(
    store.store_id,
    roll
      ? { sale_type: 'ROLL', title: '린넨 롤', price: 6000, remaining_length_cm: 900, status: 'POSTED', ...overrides }
      : { title: '네이비 면', price: 3000, status: 'POSTED', ...overrides },
  );
  return { seller, store, fabric, sellerToken: signToken(seller) };
}

const newBuyer = async (overrides = {}) => {
  const buyer = await makeUser({ role: 'BUYER', nickname: '재봉러', ...overrides });
  return { buyer, token: signToken(buyer) };
};

const reserve = (fabric, token, overrides = {}) =>
  call('POST', '/reservations', { token, body: { fabric_id: fabric.fabric_id, pickup_at: future(), ...overrides } });

const accept = (id, token, body) => call('POST', `/reservations/${id}/accept`, { token, body });
const reject = (id, token, reason = '다른 분과 약속이 잡혔어요') => call('POST', `/reservations/${id}/reject`, { token, body: { reason } });
const cancel = (id, token) => call('POST', `/reservations/${id}/cancel`, { token });
const pickup = (id, token) => call('POST', `/reservations/${id}/pickup`, { token });

const stock = async (fabric) => {
  const f = await db.Fabric.findByPk(fabric.fabric_id, { paranoid: false });
  return { remaining: f.remaining_length_cm, reserved: f.reserved_length_cm, status: f.status };
};
const row = (id) => db.Reservation.findByPk(id);

// 요청까지 마친 예약 한 건
async function requested(ctx, { buyerOverrides, ...body } = {}) {
  const { buyer, token } = await newBuyer(buyerOverrides);
  const { json } = await reserve(ctx.fabric, token, body);
  assert.ok(json.data?.reservationId, JSON.stringify(json));
  return { buyer, token, id: json.data.reservationId };
}

// ==== 25. 예약 요청

test('자투리 예약 요청 성공: 201, 장수를 안 보내면 1장, 예상 금액은 장당 가격, 재고는 그대로', async () => {
  const ctx = await setup();
  const { token } = await newBuyer();
  const { status, json } = await reserve(ctx.fabric, token, { memo: '오후 2시쯤 갈게요' });
  assert.equal(status, 201);
  assert.deepEqual(json, { success: true, data: { reservationId: json.data.reservationId, status: 'REQUESTED', estimated_price: 3000 } });

  const saved = await row(json.data.reservationId);
  assert.equal(saved.fabric_id, ctx.fabric.fabric_id);
  assert.equal(saved.seller_id, ctx.seller.user_id); // 원단의 판매자
  assert.equal(saved.memo, '오후 2시쯤 갈게요');
  assert.equal(saved.requested_length_cm, null);
  assert.deepEqual(await stock(ctx.fabric), { remaining: null, reserved: 0, status: 'POSTED' });
});

test('롤 예약 요청 성공: 예상 금액 = 90cm당 가격 x 마 수, 재고는 확보하지 않는다', async () => {
  const ctx = await setup({ roll: true });
  const { token } = await newBuyer();
  const { status, json } = await reserve(ctx.fabric, token, { requested_length_cm: 270 });
  assert.equal(status, 201);
  assert.equal(json.data.estimated_price, 18000); // 6000 x 3마
  assert.deepEqual(await stock(ctx.fabric), { remaining: 900, reserved: 0, status: 'POSTED' });
});

test('픽업 시각은 Z 와 +09:00 모두 받고, 같은 순간으로 저장된다', async () => {
  const ctx = await setup();
  const a = await newBuyer();
  const b = await newBuyer();
  const at = new Date(Date.now() + 2 * DAY);
  const kst = new Date(at.getTime() + 9 * 3600e3).toISOString().replace('Z', '+09:00');
  const one = await reserve(ctx.fabric, a.token, { pickup_at: at.toISOString() });
  const two = await reserve(ctx.fabric, b.token, { pickup_at: kst });
  assert.equal(one.status, 201);
  assert.equal(two.status, 201);
  assert.equal((await row(one.json.data.reservationId)).pickup_at.getTime(), (await row(two.json.data.reservationId)).pickup_at.getTime());
});

test('도안을 골라 예약할 수 있다 (사용 중인 도안만)', async () => {
  const ctx = await setup();
  const pattern = await db.Pattern.create({ pattern_name: '에코백', allowed_materials: ['COTTON'], allowed_thickness: ['NORMAL'] });
  const { token } = await newBuyer();
  const { status, json } = await reserve(ctx.fabric, token, { pattern_id: pattern.pattern_id });
  assert.equal(status, 201);
  assert.equal((await row(json.data.reservationId)).pattern_id, pattern.pattern_id);
});

test('예약 요청: 상태·소유자·금액 추가 필드를 거절하고 정상 요청은 서버가 값을 정한다', async () => {
  const ctx = await setup({ roll: true });
  const { buyer, token } = await newBuyer();
  const other = await makeUser({ role: 'BUYER' });
  const before = await stock(ctx.fabric);
  const invalid = await reserve(ctx.fabric, token, {
    requested_length_cm: 90, status: 'ACCEPTED', buyer_id: other.user_id, seller_id: other.user_id, estimated_price: 1, reject_reason: 'x',
  });
  assert.equal(invalid.status, 400);
  assert.equal(invalid.json.error.code, 'VALIDATION_ERROR');
  assert.equal(await db.Reservation.count(), 0);
  assert.deepEqual(await stock(ctx.fabric), before);
  const valid = await reserve(ctx.fabric, token, { requested_length_cm: 90 });
  assert.equal(valid.status, 201);
  const saved = await row(valid.json.data.reservationId);
  assert.deepEqual(
    [saved.status, saved.buyer_id, saved.seller_id, saved.estimated_price, saved.reject_reason],
    ['REQUESTED', buyer.user_id, ctx.seller.user_id, 6000, null],
  );
});

test('예약 요청 권한: 로그인 안 함 401, 판매자·운영팀 403', async () => {
  const ctx = await setup();
  const none = await reserve(ctx.fabric, undefined);
  assert.equal(none.status, 401);
  assert.equal(none.json.error.code, 'UNAUTHORIZED');
  for (const token of [ctx.sellerToken, signToken(await makeUser({ role: 'ADMIN' }))]) {
    const { status, json } = await reserve(ctx.fabric, token);
    assert.equal(status, 403);
    assert.equal(json.error.code, 'FORBIDDEN');
  }
  assert.equal(await db.Reservation.count(), 0);
});

test('예약 요청 입력 오류: 형식이 틀린 값은 VALIDATION_ERROR 와 항목별 details', async () => {
  const ctx = await setup({ roll: true });
  const { token } = await newBuyer();
  const cases = [
    ['fabric_id', { fabric_id: 'abc' }], ['fabric_id', { fabric_id: 0 }], ['fabric_id', { fabric_id: undefined }],
    ['pickup_at', { pickup_at: undefined }], ['pickup_at', { pickup_at: '2030-01-01' }], ['pickup_at', { pickup_at: '2030-01-01T10:00:00' }],
    ['pickup_at', { pickup_at: 'tomorrow' }], ['pickup_at', { pickup_at: new Date(Date.now() - DAY).toISOString() }],
    ['memo', { memo: 'a'.repeat(501) }], ['memo', { memo: 123 }],
    ['requested_length_cm', { requested_length_cm: 0 }], ['requested_length_cm', { requested_length_cm: -90 }], ['requested_length_cm', { requested_length_cm: 90.5 }],
    ['requested_length_cm', { requested_length_cm: '90' }],
    ['pattern_id', { pattern_id: 0 }], ['pattern_id', { pattern_id: 'x' }],
  ];
  for (const [field, override] of cases) {
    const { status, json } = await reserve(ctx.fabric, token, { requested_length_cm: 90, ...override });
    assert.equal(status, 400, `${field}: ${JSON.stringify(override)}`);
    assert.equal(json.error.code, 'VALIDATION_ERROR');
    assert.ok(json.error.details.some((d) => d.field === field), `${field}: ${JSON.stringify(json.error.details)}`);
  }
  assert.equal(await db.Reservation.count(), 0);
});

test('경계: 지금 바로 직후는 통과, memo 500자는 통과', async () => {
  const ctx = await setup();
  const { token } = await newBuyer();
  const { status } = await reserve(ctx.fabric, token, { pickup_at: new Date(Date.now() + 5000).toISOString(), memo: 'a'.repeat(500) });
  assert.equal(status, 201);
});

test('없거나 삭제된 원단은 404, 게시 중이 아니면 FABRIC_NOT_AVAILABLE', async () => {
  const { token } = await newBuyer();
  const missing = await call('POST', '/reservations', { token, body: { fabric_id: 99999, pickup_at: future() } });
  assert.equal(missing.status, 404);
  assert.equal(missing.json.error.code, 'NOT_FOUND');

  const gone = await setup();
  await gone.fabric.destroy();
  assert.equal((await reserve(gone.fabric, token)).status, 404);

  for (const state of ['PENDING', 'REJECTED', 'SOLD_OUT']) {
    const ctx = await setup({ fabric: { status: state, reject_reason: state === 'REJECTED' ? 'x' : null } });
    const { status, json } = await reserve(ctx.fabric, token);
    assert.equal(status, 409, state);
    assert.equal(json.error.code, 'FABRIC_NOT_AVAILABLE');
    assert.equal(json.error.message, '지금은 구매할 수 없는 원단이에요');
  }
});

test('없거나 사용 중이 아닌 도안은 404', async () => {
  const ctx = await setup();
  const { token } = await newBuyer();
  const inactive = await db.Pattern.create({ pattern_name: '쉬는 도안', allowed_materials: ['COTTON'], allowed_thickness: ['NORMAL'], is_active: false });
  for (const pattern_id of [99999, inactive.pattern_id]) {
    const { status, json } = await reserve(ctx.fabric, token, { pattern_id });
    assert.equal(status, 404, String(pattern_id));
    assert.equal(json.error.code, 'NOT_FOUND');
  }
  assert.equal(await db.Reservation.count(), 0);
});

test('자투리에 길이를 보내면 VALIDATION_ERROR, 롤에 길이가 없으면 VALIDATION_ERROR', async () => {
  const scrap = await setup();
  const roll = await setup({ roll: true });
  const { token } = await newBuyer();

  const a = await reserve(scrap.fabric, token, { requested_length_cm: 90 });
  assert.equal(a.status, 400);
  assert.equal(a.json.error.code, 'VALIDATION_ERROR');
  assert.equal(a.json.error.details[0].field, 'requested_length_cm');

  for (const requested_length_cm of [undefined, null]) {
    const b = await reserve(roll.fabric, token, { requested_length_cm });
    assert.equal(b.status, 400, String(requested_length_cm));
    assert.equal(b.json.error.details[0].field, 'requested_length_cm');
  }
});

test('롤은 90의 배수만: 아니면 LENGTH_NOT_MULTIPLE_OF_90', async () => {
  const ctx = await setup({ roll: true });
  const { token } = await newBuyer();
  for (const requested_length_cm of [1, 89, 91, 100, 180.0 + 1]) {
    const { status, json } = await reserve(ctx.fabric, token, { requested_length_cm });
    assert.equal(status, 400, String(requested_length_cm));
    assert.equal(json.error.code, 'LENGTH_NOT_MULTIPLE_OF_90');
    assert.equal(json.error.message, '1마(90cm) 단위로 골라 주세요');
  }
  assert.equal((await reserve(ctx.fabric, token, { requested_length_cm: 90 })).status, 201);
});

test('구매 가능 길이(남은 길이 - 확보 길이)보다 많으면 INSUFFICIENT_LENGTH, 같으면 통과', async () => {
  const ctx = await setup({ roll: true, fabric: { remaining_length_cm: 900, reserved_length_cm: 360 } }); // 구매 가능 540
  const { token } = await newBuyer();
  const over = await reserve(ctx.fabric, token, { requested_length_cm: 630 });
  assert.equal(over.status, 409);
  assert.equal(over.json.error.code, 'INSUFFICIENT_LENGTH');
  assert.equal((await reserve(ctx.fabric, token, { requested_length_cm: 540 })).status, 201); // 경계
});

test('이미 수락된 예약이 있는 자투리는 SCRAP_ALREADY_RESERVED', async () => {
  const ctx = await setup();
  const first = await requested(ctx);
  assert.equal((await accept(first.id, ctx.sellerToken)).status, 200);

  const { token } = await newBuyer();
  const { status, json } = await reserve(ctx.fabric, token);
  assert.equal(status, 409);
  assert.equal(json.error.code, 'SCRAP_ALREADY_RESERVED');
  assert.equal(json.error.message, '이미 예약 중인 원단이에요');
});

test('요청됨만 있는 자투리에는 여러 구매자가 요청할 수 있다 (수락될 때까지 재고를 확보하지 않는다)', async () => {
  const ctx = await setup();
  for (let i = 0; i < 3; i += 1) await requested(ctx);
  assert.equal(await db.Reservation.count({ where: { status: 'REQUESTED' } }), 3);
});

test('같은 구매자가 같은 원단에 요청됨·수락됨 예약이 있으면 DUPLICATE_RESERVATION, 끝난 뒤에는 다시 요청할 수 있다', async () => {
  const ctx = await setup({ roll: true });
  const { token } = await newBuyer();
  const first = await reserve(ctx.fabric, token, { requested_length_cm: 90 });
  const dup = await reserve(ctx.fabric, token, { requested_length_cm: 90 });
  assert.equal(dup.status, 409);
  assert.equal(dup.json.error.code, 'DUPLICATE_RESERVATION');

  await accept(first.json.data.reservationId, ctx.sellerToken);
  assert.equal((await reserve(ctx.fabric, token, { requested_length_cm: 90 })).json.error.code, 'DUPLICATE_RESERVATION'); // 수락됨도 중복

  await cancel(first.json.data.reservationId, token);
  assert.equal((await reserve(ctx.fabric, token, { requested_length_cm: 90 })).status, 201); // 취소된 뒤에는 가능

  // 다른 원단에는 따로 요청할 수 있다
  const other = await setup({ roll: true });
  assert.equal((await reserve(other.fabric, token, { requested_length_cm: 90 })).status, 201);
});

test('중복 확인이 재고 확인보다 먼저다 (이미 수락된 내 예약이면 DUPLICATE_RESERVATION)', async () => {
  const ctx = await setup();
  const mine = await requested(ctx);
  await accept(mine.id, ctx.sellerToken);
  const again = await reserve(ctx.fabric, mine.token);
  assert.equal(again.json.error.code, 'DUPLICATE_RESERVATION');
});

test('같은 구매자가 동시에 눌러도 예약은 하나만 만들어진다', async () => {
  const ctx = await setup({ roll: true });
  const { token } = await newBuyer();
  const results = await Promise.all(Array.from({ length: 6 }, () => reserve(ctx.fabric, token, { requested_length_cm: 90 })));
  assert.equal(results.filter((r) => r.status === 201).length, 1);
  assert.ok(results.filter((r) => r.status !== 201).every((r) => r.json.error.code === 'DUPLICATE_RESERVATION'));
  assert.equal(await db.Reservation.count(), 1);
});

test('행 잠금: 중복 확인과 저장 사이에 틈이 길어져도 같은 구매자의 예약은 하나만 만들어진다', async () => {
  const ctx = await setup({ roll: true });
  const { token } = await newBuyer();

  // 중복 여부를 확인한 직후에 잠깐 멈춘다. 원단 행 잠금이 없으면 두 요청이 모두 "예약 없음"을 보고 둘 다 저장한다.
  const original = db.Reservation.count.bind(db.Reservation);
  db.Reservation.count = async (options) => {
    const result = await original(options);
    if (options?.transaction) await new Promise((resolve) => setTimeout(resolve, 80));
    return result;
  };
  let results;
  try {
    results = await Promise.all([
      reserve(ctx.fabric, token, { requested_length_cm: 90 }),
      reserve(ctx.fabric, token, { requested_length_cm: 90 }),
      reserve(ctx.fabric, token, { requested_length_cm: 90 }),
    ]);
  } finally {
    db.Reservation.count = original;
  }
  assert.deepEqual(results.map((r) => r.status).sort(), [201, 409, 409], JSON.stringify(results.map((r) => r.json)));
  assert.equal(await db.Reservation.count(), 1);
});

test('예상 금액이 정수 범위를 넘으면 VALIDATION_ERROR (서버 오류가 나지 않는다)', async () => {
  const ctx = await setup({ roll: true, fabric: { price: 2000000000, remaining_length_cm: 900 } });
  const { token } = await newBuyer();
  const { status, json } = await reserve(ctx.fabric, token, { requested_length_cm: 180 }); // 40억
  assert.equal(status, 400);
  assert.equal(json.error.code, 'VALIDATION_ERROR');
  assert.equal(json.error.details[0].field, 'requested_length_cm');
});

// ==== 26. 내 예약 목록 (구매자)

test('내 예약 목록: 내 예약만, 최근 요청부터, 명세서 항목 그대로', async () => {
  const a = await setup();
  const b = await setup({ roll: true });
  const { token, buyer } = await newBuyer();
  const other = await newBuyer();
  await db.FabricImage.create({ fabric_id: a.fabric.fabric_id, image_url: 'http://x/1.png', thumbnail_url: 'http://x/thumbs/1.webp', sort_order: 0 });
  await db.FabricImage.create({ fabric_id: a.fabric.fabric_id, image_url: 'http://x/2.png', thumbnail_url: 'http://x/thumbs/2.webp', sort_order: 1 });

  const first = await reserve(a.fabric, token);
  await new Promise((resolve) => setTimeout(resolve, 20));
  const second = await reserve(b.fabric, token, { requested_length_cm: 180 });
  await reserve(a.fabric, other.token); // 남의 예약

  const { status, json } = await call('GET', '/reservations/me', { token });
  assert.equal(status, 200);
  assert.deepEqual(json.data.content.map((r) => r.reservationId), [second.json.data.reservationId, first.json.data.reservationId]);
  assert.deepEqual([json.data.page, json.data.size, json.data.totalElements, json.data.totalPages], [0, 20, 2, 1]);

  const item = json.data.content[1]; // 자투리(요청됨)
  assert.deepEqual(Object.keys(item).sort(), [
    'estimated_price', 'fabricId', 'pickup_at', 'reject_reason', 'requested_length_cm', 'requested_sheet_count', 'reservationId', 'status', 'store_name', 'thumbnail_url', 'title',
  ]);
  assert.equal(item.thumbnail_url, 'http://x/thumbs/1.webp'); // 대표 사진(0번)
  assert.equal(item.title, '네이비 면');
  assert.match(item.pickup_at, /\+09:00$/);
  assert.equal(json.data.content[0].estimated_price, 12000);
  assert.equal(json.data.content[0].thumbnail_url, null); // 사진이 없으면 null
  assert.ok(buyer);
});

test('내 예약 목록: 수락된 예약에는 store_address 와 pickup_guide 가 함께 온다, 거절된 예약은 사유가 보인다', async () => {
  const ctx = await setup();
  await ctx.store.update({ store_address: '경기도 양주시 어딘가로 12', pickup_guide: '1층 카운터' });
  const accepted = await requested(ctx);
  const rejected = await requested(ctx);
  await accept(accepted.id, ctx.sellerToken); // 자투리: 수락 후 나머지는 그대로 요청됨
  await reject(rejected.id, ctx.sellerToken, '다른 분과 약속이 잡혔어요');

  const a = await call('GET', '/reservations/me', { token: accepted.token });
  assert.equal(a.json.data.content[0].status, 'ACCEPTED');
  assert.equal(a.json.data.content[0].store_address, '경기도 양주시 어딘가로 12');
  assert.equal(a.json.data.content[0].pickup_guide, '1층 카운터');

  const r = await call('GET', '/reservations/me', { token: rejected.token });
  assert.equal(r.json.data.content[0].reject_reason, '다른 분과 약속이 잡혔어요');
  assert.equal('store_address' in r.json.data.content[0], false); // 수락된 예약에만 있다
});

test('내 예약 목록: status 로 거르고, 페이지 나누기, 입력 오류', async () => {
  const { token } = await newBuyer();
  const fabrics = [(await setup({ roll: true })).fabric, (await setup({ roll: true })).fabric, (await setup({ roll: true })).fabric];
  const ids = [];
  for (const fabric of fabrics) {
    ids.push((await reserve(fabric, token, { requested_length_cm: 90 })).json.data.reservationId);
    await new Promise((resolve) => setTimeout(resolve, 10)); // 요청 시각이 겹치지 않게
  }
  await cancel(ids[0], token);

  const canceled = await call('GET', '/reservations/me?status=CANCELED', { token });
  assert.deepEqual(canceled.json.data.content.map((r) => r.reservationId), [ids[0]]);
  assert.equal((await call('GET', '/reservations/me?status=REQUESTED', { token })).json.data.totalElements, 2);

  const page = await call('GET', '/reservations/me?page=1&size=2', { token });
  assert.deepEqual(page.json.data.content.map((r) => r.reservationId), [ids[0]]);
  assert.equal(page.json.data.totalPages, 2);

  for (const query of ['status=DONE', 'page=-1', 'size=0', 'size=51']) {
    const { status, json } = await call('GET', `/reservations/me?${query}`, { token });
    assert.equal(status, 400, query);
    assert.equal(json.error.code, 'VALIDATION_ERROR');
  }
});

test('내 예약 목록: 삭제된 원단의 끝난 예약도 기록으로 보인다', async () => {
  const ctx = await setup();
  const { token, id } = await requested(ctx);
  await reject(id, ctx.sellerToken);
  await ctx.fabric.destroy();
  const { json } = await call('GET', '/reservations/me', { token });
  assert.equal(json.data.content[0].title, '네이비 면');
  assert.equal(json.data.content[0].status, 'REJECTED');
});

test('내 예약 목록 권한: 로그인 안 함 401, 판매자·운영팀 403', async () => {
  assert.equal((await call('GET', '/reservations/me')).status, 401);
  const ctx = await setup();
  for (const token of [ctx.sellerToken, signToken(await makeUser({ role: 'ADMIN' }))]) {
    assert.equal((await call('GET', '/reservations/me', { token })).status, 403);
  }
});

// ==== 27. 받은 예약 목록 (판매자)

test('받은 예약 목록: 내 원단의 예약만, 구매자는 닉네임만 (전화번호 없음), 명세서 항목 그대로', async () => {
  const mine = await setup();
  const other = await setup();
  const buyer = await newBuyer({ nickname: '재봉러', phone_number: '010-9999-8888' });
  await reserve(mine.fabric, buyer.token, { memo: '오후 2시쯤 갈게요' });
  await reserve(other.fabric, buyer.token); // 남의 원단

  const { status, json } = await call('GET', '/sellers/me/reservations', { token: mine.sellerToken });
  assert.equal(status, 200);
  assert.equal(json.data.totalElements, 1);
  const item = json.data.content[0];
  assert.deepEqual(Object.keys(item).sort(), [
    'buyer_nickname', 'estimated_price', 'fabricId', 'memo', 'pickup_at', 'requested_length_cm', 'requested_sheet_count', 'reservationId', 'status', 'title',
  ]);
  assert.equal(item.buyer_nickname, '재봉러');
  assert.equal(item.memo, '오후 2시쯤 갈게요');
  assert.equal(item.fabricId, mine.fabric.fabric_id);
  assert.equal(JSON.stringify(json).includes('010-9999-8888'), false);
});

test('받은 예약 목록: status 와 fabric_id 로 거르고, 남의 원단 번호로 거르면 비어 있다', async () => {
  const ctx = await setup();
  const second = await makeFabric(ctx.store.store_id, { title: '두 번째 원단', price: 1000, status: 'POSTED' });
  const a = await requested(ctx);
  const b = await newBuyer();
  await reserve(second, b.token);
  await accept(a.id, ctx.sellerToken);

  const byStatus = await call('GET', '/sellers/me/reservations?status=ACCEPTED', { token: ctx.sellerToken });
  assert.deepEqual(byStatus.json.data.content.map((r) => r.reservationId), [a.id]);
  const byFabric = await call('GET', `/sellers/me/reservations?fabric_id=${second.fabric_id}`, { token: ctx.sellerToken });
  assert.deepEqual(byFabric.json.data.content.map((r) => r.title), ['두 번째 원단']);

  const stranger = (await setup()).sellerToken;
  const none = await call('GET', `/sellers/me/reservations?fabric_id=${ctx.fabric.fabric_id}`, { token: stranger });
  assert.deepEqual(none.json.data.content, []);

  for (const query of ['status=DONE', 'fabric_id=abc', 'fabric_id=0', 'size=51']) {
    assert.equal((await call('GET', `/sellers/me/reservations?${query}`, { token: ctx.sellerToken })).status, 400, query);
  }
});

test('받은 예약 목록 권한: 로그인 안 함 401, 구매자·운영팀 403', async () => {
  assert.equal((await call('GET', '/sellers/me/reservations')).status, 401);
  const { token } = await newBuyer();
  assert.equal((await call('GET', '/sellers/me/reservations', { token })).status, 403);
  assert.equal((await call('GET', '/sellers/me/reservations', { token: signToken(await makeUser({ role: 'ADMIN' })) })).status, 403);
});

// ==== 28. 예약 상세

test('예약 상세: 예약한 구매자와 그 원단의 판매자는 볼 수 있고, 명세서 항목 그대로', async () => {
  const ctx = await setup();
  await ctx.store.update({ store_name: '양주원단상회', store_address: '경기도 양주시', store_phone: '031-123-4567', closed_days: '일요일', pickup_guide: '1층' });
  const pattern = await db.Pattern.create({ pattern_name: '에코백', allowed_materials: ['COTTON'], allowed_thickness: ['NORMAL'] });
  await db.FabricImage.create({ fabric_id: ctx.fabric.fabric_id, image_url: 'http://x/1.png', thumbnail_url: 'http://x/thumbs/1.webp', sort_order: 0 });
  const { token, id } = await requested(ctx, { pattern_id: pattern.pattern_id, memo: '메모', buyerOverrides: { nickname: '재봉러' } });

  for (const who of [token, ctx.sellerToken]) {
    const { status, json } = await call('GET', `/reservations/${id}`, { token: who });
    assert.equal(status, 200);
    assert.deepEqual(Object.keys(json.data).sort(), [
      'accepted_at', 'buyer_nickname', 'canceled_at', 'canceled_by', 'created_at', 'estimated_price', 'fabric', 'memo',
      'pattern_name', 'picked_up_at', 'pickup_at', 'reject_reason', 'requested_length_cm', 'requested_sheet_count', 'reservationId', 'status', 'store',
    ]);
    assert.equal(json.data.reservationId, id);
    assert.equal(json.data.buyer_nickname, '재봉러');
    assert.equal(json.data.pattern_name, '에코백');
    assert.deepEqual(json.data.fabric, { fabricId: ctx.fabric.fabric_id, title: '네이비 면', sale_type: 'SCRAP', status: 'POSTED', thumbnail_url: 'http://x/thumbs/1.webp' });
    assert.deepEqual(json.data.store, { store_name: '양주원단상회', store_address: '경기도 양주시', store_phone: '031-123-4567', closed_days: '일요일', pickup_guide: '1층' });
    assert.match(json.data.created_at, /\+09:00$/);
    assert.equal(json.data.accepted_at, null);
  }
});

test('예약 상세: 도안을 안 골랐으면 pattern_name 은 null, 수락·취소 기록이 채워진다', async () => {
  const ctx = await setup({ roll: true });
  const { token, id } = await requested(ctx, { requested_length_cm: 90 });
  assert.equal((await call('GET', `/reservations/${id}`, { token })).json.data.pattern_name, null);

  await accept(id, ctx.sellerToken);
  let d = (await call('GET', `/reservations/${id}`, { token })).json.data;
  assert.match(d.accepted_at, /\+09:00$/);
  assert.equal(d.canceled_at, null);

  await cancel(id, ctx.sellerToken);
  d = (await call('GET', `/reservations/${id}`, { token })).json.data;
  assert.equal(d.status, 'CANCELED');
  assert.equal(d.canceled_by, 'SELLER');
  assert.match(d.canceled_at, /\+09:00$/);
});

test('예약 상세 권한: 당사자가 아니면 FORBIDDEN, 로그인 안 함 401, 없는 예약 404, 번호 형식 400', async () => {
  const ctx = await setup();
  const { id } = await requested(ctx);
  assert.equal((await call('GET', `/reservations/${id}`)).status, 401);

  const stranger = await newBuyer();
  const otherSeller = (await setup()).sellerToken;
  const admin = signToken(await makeUser({ role: 'ADMIN' }));
  for (const token of [stranger.token, otherSeller, admin]) {
    const { status, json } = await call('GET', `/reservations/${id}`, { token });
    assert.equal(status, 403);
    assert.equal(json.error.code, 'FORBIDDEN');
  }
  assert.equal((await call('GET', '/reservations/99999', { token: stranger.token })).json.error.code, 'NOT_FOUND');
  for (const bad of ['abc', '0', '-1']) assert.equal((await call('GET', `/reservations/${bad}`, { token: stranger.token })).status, 400, bad);
});

test('/reservations/me 는 예약 번호로 읽히지 않는다 (경로 순서)', async () => {
  const { token } = await newBuyer();
  const { status, json } = await call('GET', '/reservations/me', { token });
  assert.equal(status, 200);
  assert.ok('content' in json.data);
});

// ==== 29. 예약 수락

test('자투리 수락: REQUESTED → ACCEPTED, 응답 { reservationId, status }, 수락 시각이 기록된다', async () => {
  const ctx = await setup();
  const { id } = await requested(ctx);
  const { status, json } = await accept(id, ctx.sellerToken, {});
  assert.equal(status, 200);
  assert.deepEqual(json, { success: true, data: { reservationId: id, status: 'ACCEPTED' } });
  const saved = await row(id);
  assert.equal(saved.status, 'ACCEPTED');
  assert.ok(saved.accepted_at);
  assert.deepEqual(await stock(ctx.fabric), { remaining: null, reserved: 0, status: 'POSTED' });
});

test('본문 없이 보내도, 빈 객체를 보내도 수락된다', async () => {
  const ctx = await setup();
  const a = await requested(ctx);
  const noBody = await call('POST', `/reservations/${a.id}/accept`, { token: ctx.sellerToken });
  assert.equal(noBody.status, 200);

  const ctx2 = await setup();
  const b = await requested(ctx2);
  assert.equal((await accept(b.id, ctx2.sellerToken, {})).status, 200);
});

test('롤 수락: 확보 길이가 요청 길이만큼 늘어난다', async () => {
  const ctx = await setup({ roll: true });
  const a = await requested(ctx, { requested_length_cm: 270 });
  const b = await requested(ctx, { requested_length_cm: 180 });
  await accept(a.id, ctx.sellerToken);
  assert.deepEqual(await stock(ctx.fabric), { remaining: 900, reserved: 270, status: 'POSTED' });
  await accept(b.id, ctx.sellerToken);
  assert.deepEqual(await stock(ctx.fabric), { remaining: 900, reserved: 450, status: 'POSTED' });
});

test('수락할 때 픽업 일시를 조정할 수 있다 (지금 이후만)', async () => {
  const ctx = await setup();
  const { id } = await requested(ctx);
  const past = await accept(id, ctx.sellerToken, { pickup_at: new Date(Date.now() - DAY).toISOString() });
  assert.equal(past.status, 400);
  assert.equal(past.json.error.details[0].field, 'pickup_at');
  assert.equal((await row(id)).status, 'REQUESTED');

  const later = new Date(Date.now() + 5 * DAY);
  assert.equal((await accept(id, ctx.sellerToken, { pickup_at: later.toISOString() })).status, 200);
  assert.equal((await row(id)).pickup_at.getTime(), later.getTime());
});

test('다른 예약이 먼저 수락됐다면 자투리는 SCRAP_ALREADY_RESERVED, 롤은 INSUFFICIENT_LENGTH', async () => {
  const scrap = await setup();
  const s1 = await requested(scrap);
  const s2 = await requested(scrap);
  assert.equal((await accept(s1.id, scrap.sellerToken)).status, 200);
  const sr = await accept(s2.id, scrap.sellerToken);
  assert.equal(sr.status, 409);
  assert.equal(sr.json.error.code, 'SCRAP_ALREADY_RESERVED');
  assert.equal((await row(s2.id)).status, 'REQUESTED');

  const roll = await setup({ roll: true });
  const r1 = await requested(roll, { requested_length_cm: 630 });
  const r2 = await requested(roll, { requested_length_cm: 360 }); // 630 + 360 > 900
  assert.equal((await accept(r1.id, roll.sellerToken)).status, 200);
  const rr = await accept(r2.id, roll.sellerToken);
  assert.equal(rr.status, 409);
  assert.equal(rr.json.error.code, 'INSUFFICIENT_LENGTH');
  assert.deepEqual(await stock(roll.fabric), { remaining: 900, reserved: 630, status: 'POSTED' });
});

test('롤은 남은 길이를 정확히 다 확보할 수 있다 (경계)', async () => {
  const ctx = await setup({ roll: true });
  const a = await requested(ctx, { requested_length_cm: 540 });
  const b = await requested(ctx, { requested_length_cm: 360 });
  assert.equal((await accept(a.id, ctx.sellerToken)).status, 200);
  assert.equal((await accept(b.id, ctx.sellerToken)).status, 200);
  assert.deepEqual(await stock(ctx.fabric), { remaining: 900, reserved: 900, status: 'POSTED' });
});

test('REQUESTED 가 아니면 수락할 수 없다 (INVALID_STATUS), 원단이 게시 중이 아니어도 마찬가지', async () => {
  const ctx = await setup();
  const { id } = await requested(ctx);
  await accept(id, ctx.sellerToken);
  assert.equal((await accept(id, ctx.sellerToken)).json.error.code, 'INVALID_STATUS'); // 이미 수락됨

  for (const state of ['REJECTED', 'CANCELED', 'PICKED_UP']) {
    const r = await setup();
    const x = await requested(r);
    await row(x.id).then((row_) => row_.update({ status: state, reject_reason: state === 'REJECTED' ? 'x' : null, canceled_by: state === 'CANCELED' ? 'BUYER' : null }));
    const res = await accept(x.id, r.sellerToken);
    assert.equal(res.status, 409, state);
    assert.equal(res.json.error.code, 'INVALID_STATUS');
  }

  const sold = await setup();
  const y = await requested(sold);
  await sold.fabric.update({ status: 'SOLD_OUT' });
  assert.equal((await accept(y.id, sold.sellerToken)).json.error.code, 'INVALID_STATUS');
});

test('수락 권한: 로그인 안 함 401, 구매자·운영팀 403, 남의 원단의 예약 403, 없는 예약 404', async () => {
  const ctx = await setup();
  const other = await setup();
  const { id, token } = await requested(ctx);

  assert.equal((await accept(id, undefined)).status, 401);
  for (const t of [token, signToken(await makeUser({ role: 'ADMIN' }))]) assert.equal((await accept(id, t)).status, 403);
  const forbidden = await accept(id, other.sellerToken);
  assert.equal(forbidden.status, 403);
  assert.equal(forbidden.json.error.code, 'FORBIDDEN');
  assert.equal((await row(id)).status, 'REQUESTED');
  assert.equal((await accept(99999, ctx.sellerToken)).status, 404);
  for (const bad of ['abc', '0']) assert.equal((await accept(bad, ctx.sellerToken)).status, 400, bad);
});

test('남의 예약은 상태가 틀려도 FORBIDDEN 이 먼저다 (상태를 알려 주지 않는다)', async () => {
  const ctx = await setup();
  const other = await setup();
  const { id } = await requested(ctx);
  await accept(id, ctx.sellerToken);
  assert.equal((await accept(id, other.sellerToken)).json.error.code, 'FORBIDDEN');
});

// ---- 29. 동시성: 재고

test('같은 자투리에 동시에 여러 건을 수락해도 한 건만 성공한다', async () => {
  const ctx = await setup();
  const reservations = [];
  for (let i = 0; i < 5; i += 1) reservations.push(await requested(ctx));
  const results = await Promise.all(reservations.map((r) => accept(r.id, ctx.sellerToken)));
  assert.equal(results.filter((r) => r.status === 200).length, 1, results.map((r) => r.status).join(','));
  assert.ok(results.filter((r) => r.status !== 200).every((r) => r.json.error.code === 'SCRAP_ALREADY_RESERVED'));
  assert.equal(await db.Reservation.count({ where: { status: 'ACCEPTED' } }), 1);
});

test('롤에 동시에 수락해도 확보 길이가 남은 길이를 넘지 않는다', async () => {
  const ctx = await setup({ roll: true }); // 900cm
  const reservations = [];
  for (let i = 0; i < 6; i += 1) reservations.push(await requested(ctx, { requested_length_cm: 360 })); // 360 x 6
  const results = await Promise.all(reservations.map((r) => accept(r.id, ctx.sellerToken)));

  const ok = results.filter((r) => r.status === 200).length;
  assert.equal(ok, 2, results.map((r) => r.status).join(',')); // 360 x 2 = 720 (3번째는 1080 > 900)
  assert.ok(results.filter((r) => r.status !== 200).every((r) => r.json.error.code === 'INSUFFICIENT_LENGTH'));
  assert.deepEqual(await stock(ctx.fabric), { remaining: 900, reserved: 720, status: 'POSTED' });
});

test('행 잠금: 재고를 읽은 직후 틈이 길어져도 두 수락이 모두 성공하지 않는다', async () => {
  const ctx = await setup({ roll: true });
  const a = await requested(ctx, { requested_length_cm: 540 });
  const b = await requested(ctx, { requested_length_cm: 540 }); // 540 + 540 > 900

  const original = db.Reservation.findByPk.bind(db.Reservation);
  db.Reservation.findByPk = async (id, options) => {
    const result = await original(id, options);
    if (options?.transaction) await new Promise((resolve) => setTimeout(resolve, 80));
    return result;
  };
  let results;
  try {
    results = await Promise.all([accept(a.id, ctx.sellerToken), accept(b.id, ctx.sellerToken)]);
  } finally {
    db.Reservation.findByPk = original;
  }
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 409], JSON.stringify(results.map((r) => r.json)));
  assert.equal((await stock(ctx.fabric)).reserved, 540);
});

// ==== 30. 예약 거절

test('거절: REQUESTED → REJECTED, 사유가 저장되고 재고는 변하지 않는다', async () => {
  const ctx = await setup({ roll: true });
  const { id } = await requested(ctx, { requested_length_cm: 180 });
  const { status, json } = await reject(id, ctx.sellerToken, '  다른 분과 약속이 잡혔어요  ');
  assert.equal(status, 200);
  assert.deepEqual(json, { success: true, data: { reservationId: id, status: 'REJECTED' } });
  const saved = await row(id);
  assert.equal(saved.reject_reason, '다른 분과 약속이 잡혔어요');
  assert.deepEqual(await stock(ctx.fabric), { remaining: 900, reserved: 0, status: 'POSTED' });
});

test('거절 입력 오류: 사유가 없거나 공백이거나 255자 초과', async () => {
  const ctx = await setup();
  const { id } = await requested(ctx);
  const url = `/reservations/${id}/reject`;
  for (const body of [{}, { reason: '' }, { reason: '   ' }, { reason: 'a'.repeat(256) }, { reason: 1 }, { reason: null }]) {
    const { status, json } = await call('POST', url, { token: ctx.sellerToken, body });
    assert.equal(status, 400, JSON.stringify(body).slice(0, 30));
    assert.ok(json.error.details.some((d) => d.field === 'reason'));
  }
  assert.equal((await call('POST', url, { token: ctx.sellerToken })).status, 400);
  assert.equal((await row(id)).status, 'REQUESTED');
  assert.equal((await reject(id, ctx.sellerToken, 'a'.repeat(255))).status, 200); // 경계
});

test('거절: REQUESTED 가 아니면 INVALID_STATUS, 권한은 판매자 본인만', async () => {
  const ctx = await setup();
  const { id, token } = await requested(ctx);
  await accept(id, ctx.sellerToken);
  assert.equal((await reject(id, ctx.sellerToken)).json.error.code, 'INVALID_STATUS'); // 수락된 예약은 취소를 쓴다

  const other = await requested(await setup());
  assert.equal((await reject(other.id, ctx.sellerToken)).status, 403);
  assert.equal((await reject(id, token)).status, 403);
  assert.equal((await reject(id, undefined)).status, 401);
  assert.equal((await reject(99999, ctx.sellerToken)).status, 404);
});

// ==== 31. 예약 취소

test('구매자는 요청됨 예약을 취소할 수 있다 (canceled_by BUYER, 재고 변화 없음)', async () => {
  const ctx = await setup({ roll: true });
  const { id, token } = await requested(ctx, { requested_length_cm: 180 });
  const { status, json } = await cancel(id, token);
  assert.equal(status, 200);
  assert.deepEqual(json, { success: true, data: { reservationId: id, status: 'CANCELED' } });
  const saved = await row(id);
  assert.deepEqual([saved.canceled_by, !!saved.canceled_at], ['BUYER', true]);
  assert.deepEqual(await stock(ctx.fabric), { remaining: 900, reserved: 0, status: 'POSTED' });
});

test('수락된 롤 예약을 구매자가 취소하면 확보했던 길이가 풀린다', async () => {
  const ctx = await setup({ roll: true });
  const a = await requested(ctx, { requested_length_cm: 270 });
  const b = await requested(ctx, { requested_length_cm: 180 });
  await accept(a.id, ctx.sellerToken);
  await accept(b.id, ctx.sellerToken);
  assert.equal((await stock(ctx.fabric)).reserved, 450);

  assert.equal((await cancel(a.id, a.token)).status, 200);
  assert.equal((await stock(ctx.fabric)).reserved, 180); // 270 만 풀린다
  assert.equal((await row(a.id)).canceled_by, 'BUYER');
});

test('판매자는 수락된 예약만 취소할 수 있고 (canceled_by SELLER), 요청됨은 거절을 써야 한다', async () => {
  const ctx = await setup({ roll: true });
  const { id } = await requested(ctx, { requested_length_cm: 270 });
  const early = await cancel(id, ctx.sellerToken);
  assert.equal(early.status, 409);
  assert.equal(early.json.error.code, 'INVALID_STATUS');
  assert.equal((await row(id)).status, 'REQUESTED');

  await accept(id, ctx.sellerToken);
  assert.equal((await cancel(id, ctx.sellerToken)).status, 200);
  const saved = await row(id);
  assert.deepEqual([saved.status, saved.canceled_by], ['CANCELED', 'SELLER']);
  assert.equal((await stock(ctx.fabric)).reserved, 0);
});

test('수락된 자투리 예약을 취소하면 다시 예약·수락할 수 있다 (예약 중 해제)', async () => {
  const ctx = await setup();
  const a = await requested(ctx);
  await accept(a.id, ctx.sellerToken);
  assert.equal((await reserve(ctx.fabric, (await newBuyer()).token)).json.error.code, 'SCRAP_ALREADY_RESERVED');
  await cancel(a.id, ctx.sellerToken);
  assert.equal((await reserve(ctx.fabric, (await newBuyer()).token)).status, 201);
});

test('이미 끝난 예약은 취소할 수 없다 (INVALID_STATUS)', async () => {
  for (const state of ['REJECTED', 'CANCELED', 'PICKED_UP']) {
    const x = await requested(await setup());
    await (await row(x.id)).update({ status: state, reject_reason: state === 'REJECTED' ? 'x' : null, canceled_by: state === 'CANCELED' ? 'BUYER' : null });
    const res = await cancel(x.id, x.token);
    assert.equal(res.status, 409, state);
    assert.equal(res.json.error.code, 'INVALID_STATUS');
  }
});

test('취소 권한: 당사자만 (남의 구매자·남의 판매자·운영팀은 403), 로그인 안 함 401, 없는 예약 404', async () => {
  const ctx = await setup();
  const { id, token } = await requested(ctx);
  assert.equal((await cancel(id, undefined)).status, 401);
  const stranger = await newBuyer();
  for (const t of [stranger.token, (await setup()).sellerToken, signToken(await makeUser({ role: 'ADMIN' }))]) {
    const { status, json } = await cancel(id, t);
    assert.equal(status, 403);
    assert.equal(json.error.code, 'FORBIDDEN');
  }
  assert.equal((await row(id)).status, 'REQUESTED');
  assert.equal((await cancel(99999, token)).status, 404);
});

test('수락과 취소가 동시에 와도 재고가 어긋나지 않는다', async () => {
  const ctx = await setup({ roll: true });
  const { id, token } = await requested(ctx, { requested_length_cm: 270 });
  const results = await Promise.all([accept(id, ctx.sellerToken), cancel(id, token)]);
  const saved = await row(id);
  const reserved = (await stock(ctx.fabric)).reserved;
  // 수락 → 취소: 확보 0 / 취소 → 수락 시도: 수락은 INVALID_STATUS, 확보 0
  assert.equal(saved.status, 'CANCELED');
  assert.equal(reserved, 0, `확보 길이가 어긋났다: ${reserved} (${results.map((r) => r.status).join(',')})`);
});

// ==== 32. 수령 확인

test('자투리 수령 확인: PICKED_UP 이 되고 원단은 SOLD_OUT', async () => {
  const ctx = await setup();
  const { id } = await requested(ctx);
  await accept(id, ctx.sellerToken);
  const { status, json } = await pickup(id, ctx.sellerToken);
  assert.equal(status, 200);
  assert.deepEqual(json, { success: true, data: { reservationId: id, status: 'PICKED_UP' } });
  assert.ok((await row(id)).picked_up_at);
  assert.equal((await stock(ctx.fabric)).status, 'SOLD_OUT');
});

test('롤 수령 확인: 남은 길이와 확보 길이가 요청 길이만큼 줄고, 90cm 이상 남으면 판매 중이다', async () => {
  const ctx = await setup({ roll: true });
  const a = await requested(ctx, { requested_length_cm: 270 });
  const b = await requested(ctx, { requested_length_cm: 180 });
  await accept(a.id, ctx.sellerToken);
  await accept(b.id, ctx.sellerToken);
  assert.deepEqual(await stock(ctx.fabric), { remaining: 900, reserved: 450, status: 'POSTED' });

  await pickup(a.id, ctx.sellerToken);
  assert.deepEqual(await stock(ctx.fabric), { remaining: 630, reserved: 180, status: 'POSTED' });
  await pickup(b.id, ctx.sellerToken);
  assert.deepEqual(await stock(ctx.fabric), { remaining: 450, reserved: 0, status: 'POSTED' });
});

test('롤의 남은 길이가 90cm 미만이 되면 SOLD_OUT, 정확히 90cm 는 아직 판매 중', async () => {
  const exact = await setup({ roll: true, fabric: { remaining_length_cm: 180 } });
  const e = await requested(exact, { requested_length_cm: 90 });
  await accept(e.id, exact.sellerToken);
  await pickup(e.id, exact.sellerToken);
  assert.deepEqual(await stock(exact.fabric), { remaining: 90, reserved: 0, status: 'POSTED' }); // 경계: 90 은 판매 중

  const last = await requested(exact, { requested_length_cm: 90 });
  await accept(last.id, exact.sellerToken);
  await pickup(last.id, exact.sellerToken);
  assert.deepEqual(await stock(exact.fabric), { remaining: 0, reserved: 0, status: 'SOLD_OUT' });

  // 90 으로 딱 떨어지지 않는 남은 길이: 100cm 에서 90 을 가져가면 10cm 가 남아 판매 완료
  const odd = await setup({ roll: true, fabric: { remaining_length_cm: 100 } });
  const o = await requested(odd, { requested_length_cm: 90 });
  await accept(o.id, odd.sellerToken);
  await pickup(o.id, odd.sellerToken);
  assert.deepEqual(await stock(odd.fabric), { remaining: 10, reserved: 0, status: 'SOLD_OUT' });
});

test('판매 완료가 되면 그 원단에 남은 요청됨 예약은 "판매 완료" 사유로 자동 거절된다', async () => {
  const ctx = await setup();
  const winner = await requested(ctx);
  const waiting = await requested(ctx);
  const waiting2 = await requested(ctx);
  await accept(winner.id, ctx.sellerToken);
  await pickup(winner.id, ctx.sellerToken);

  for (const r of [waiting, waiting2]) {
    const saved = await row(r.id);
    assert.equal(saved.status, 'REJECTED');
    assert.equal(saved.reject_reason, '판매 완료');
  }
  assert.equal((await row(winner.id)).status, 'PICKED_UP'); // 수령한 예약은 그대로

  // 다른 원단의 요청됨 예약은 건드리지 않는다
  const other = await setup();
  const keep = await requested(other);
  assert.equal((await row(keep.id)).status, 'REQUESTED');
});

test('롤이 판매 완료가 될 때도 남은 요청됨 예약이 자동 거절된다 (수락된 다른 예약이 없을 때)', async () => {
  const ctx = await setup({ roll: true, fabric: { remaining_length_cm: 180 } });
  const winner = await requested(ctx, { requested_length_cm: 180 });
  const waiting = await requested(ctx, { requested_length_cm: 90 });
  await accept(winner.id, ctx.sellerToken);
  await pickup(winner.id, ctx.sellerToken);
  const saved = await row(waiting.id);
  assert.deepEqual([saved.status, saved.reject_reason], ['REJECTED', '판매 완료']);
});

test('판매 완료가 되지 않으면 남은 요청됨 예약은 그대로다', async () => {
  const ctx = await setup({ roll: true });
  const a = await requested(ctx, { requested_length_cm: 90 });
  const waiting = await requested(ctx, { requested_length_cm: 90 });
  await accept(a.id, ctx.sellerToken);
  await pickup(a.id, ctx.sellerToken);
  assert.equal((await row(waiting.id)).status, 'REQUESTED');
});

test('수령 확인: ACCEPTED 가 아니면 INVALID_STATUS, 권한은 판매자 본인만', async () => {
  const ctx = await setup();
  const { id, token } = await requested(ctx);
  const early = await pickup(id, ctx.sellerToken);
  assert.equal(early.status, 409);
  assert.equal(early.json.error.code, 'INVALID_STATUS');

  await accept(id, ctx.sellerToken);
  assert.equal((await pickup(id, token)).status, 403); // 구매자는 수령 확인을 못 한다
  assert.equal((await pickup(id, (await setup()).sellerToken)).status, 403);
  assert.equal((await pickup(id, undefined)).status, 401);
  assert.equal((await pickup(99999, ctx.sellerToken)).status, 404);

  await pickup(id, ctx.sellerToken);
  assert.equal((await pickup(id, ctx.sellerToken)).json.error.code, 'INVALID_STATUS'); // 두 번째 수령 확인
  assert.equal((await stock(ctx.fabric)).status, 'SOLD_OUT');
});

test('수령 확인과 취소가 동시에 와도 하나만 적용되고 재고가 어긋나지 않는다', async () => {
  const ctx = await setup({ roll: true });
  const { id, token } = await requested(ctx, { requested_length_cm: 270 });
  await accept(id, ctx.sellerToken);
  const results = await Promise.all([pickup(id, ctx.sellerToken), cancel(id, token)]);
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
  const s = await stock(ctx.fabric);
  const saved = await row(id);
  if (saved.status === 'PICKED_UP') assert.deepEqual([s.remaining, s.reserved], [630, 0]);
  else assert.deepEqual([s.remaining, s.reserved], [900, 0]);
});

// ==== 다른 API 와 이어지는 규칙

test('가격을 바꿔도 이미 요청된 예약의 예상 금액은 그대로이고, 새 요청부터 바뀐 가격이 적용된다 (12번)', async () => {
  const ctx = await setup({ roll: true });
  await db.FabricDetail.create({ fabric_id: ctx.fabric.fabric_id, width_cm: 150, thickness: 'NORMAL', color_family: 'NAVY' });
  const first = await requested(ctx, { requested_length_cm: 180 });
  assert.equal((await call('PATCH', `/fabrics/${ctx.fabric.fabric_id}`, { token: ctx.sellerToken, body: { price: 7000 } })).status, 200);
  assert.equal((await row(first.id)).estimated_price, 12000);
  const second = await newBuyer();
  const { json } = await reserve(ctx.fabric, second.token, { requested_length_cm: 180 });
  assert.equal(json.data.estimated_price, 14000);
});

test('진행 중인 예약이 있으면 원단을 삭제할 수 없고, 끝나면 삭제할 수 있다 (13번)', async () => {
  const ctx = await setup();
  const { id } = await requested(ctx);
  const blocked = await call('DELETE', `/fabrics/${ctx.fabric.fabric_id}`, { token: ctx.sellerToken });
  assert.equal(blocked.json.error.code, 'FABRIC_HAS_ACTIVE_RESERVATION');
  await reject(id, ctx.sellerToken);
  assert.equal((await call('DELETE', `/fabrics/${ctx.fabric.fabric_id}`, { token: ctx.sellerToken })).status, 200);
});

test('롤의 남은 길이를 확보 길이보다 줄일 수 없다 (12번 INSUFFICIENT_LENGTH)', async () => {
  const ctx = await setup({ roll: true });
  await db.FabricDetail.create({ fabric_id: ctx.fabric.fabric_id, width_cm: 150, thickness: 'NORMAL', color_family: 'NAVY' });
  const { id } = await requested(ctx, { requested_length_cm: 450 });
  await accept(id, ctx.sellerToken);
  const tooSmall = await call('PATCH', `/fabrics/${ctx.fabric.fabric_id}`, { token: ctx.sellerToken, body: { remaining_length_cm: 360 } });
  assert.equal(tooSmall.json.error.code, 'INSUFFICIENT_LENGTH');
  assert.equal((await call('PATCH', `/fabrics/${ctx.fabric.fabric_id}`, { token: ctx.sellerToken, body: { remaining_length_cm: 450 } })).status, 200);
});

test('처음부터 끝까지: 요청 → 수락 → 수령 → 판매 완료, 판매 완료된 원단에는 더 요청할 수 없다', async () => {
  const ctx = await setup();
  const { id, token } = await requested(ctx);
  await accept(id, ctx.sellerToken);
  await pickup(id, ctx.sellerToken);
  const detail = (await call('GET', `/reservations/${id}`, { token })).json.data;
  assert.equal(detail.status, 'PICKED_UP');
  assert.equal(detail.fabric.status, 'SOLD_OUT');
  assert.match(detail.picked_up_at, /\+09:00$/);
  assert.equal((await reserve(ctx.fabric, (await newBuyer()).token)).json.error.code, 'FABRIC_NOT_AVAILABLE');
});

test('자투리 여러 장: 고른 장수만 확보하고, 수령하면 그 장수만 줄어 나머지는 남는다', async () => {
  const ctx = await setup();
  await db.FabricDetail.create({ fabric_id: ctx.fabric.fabric_id, width_cm: 70, length_cm: 60, thickness: 'NORMAL', color_family: 'NAVY', sheet_count: 5 });
  const first = await requested(ctx, { requested_sheet_count: 1 });
  const second = await requested(ctx, { requested_sheet_count: 2 });
  assert.equal((await row(first.id)).estimated_price, 3000);
  await accept(first.id, ctx.sellerToken);
  await accept(second.id, ctx.sellerToken);
  assert.equal((await db.Fabric.findByPk(ctx.fabric.fabric_id)).reserved_sheet_count, 3);
  await pickup(first.id, ctx.sellerToken);
  const after = await db.Fabric.findByPk(ctx.fabric.fabric_id, { include: [{ model: db.FabricDetail, as: 'detail' }] });
  assert.equal(after.status, 'POSTED');
  assert.equal(after.detail.sheet_count, 4);
  assert.equal(after.reserved_sheet_count, 2);
  const tooMany = await reserve(ctx.fabric, (await newBuyer()).token, { requested_sheet_count: 3 });
  assert.equal(tooMany.json.error.code, 'INSUFFICIENT_SHEETS');
});
