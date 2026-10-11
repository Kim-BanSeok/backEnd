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

async function recommendations(fabricId, token) {
  const res = await fetch(`${base}/fabrics/${fabricId}/recommendations`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  return { status: res.status, json: await res.json() };
}

// 명세서 예시의 에코백: 앞판 40×45 1장, 뒤판 40×45 1장, 끈 8×60 2장
async function makeEcoBag(overrides = {}) {
  const pattern = await db.Pattern.create({
    pattern_name: '에코백',
    allowed_materials: ['COTTON', 'LINEN'],
    allowed_thickness: ['NORMAL', 'THICK'],
    ...overrides,
  });
  await db.PatternPart.bulkCreate([
    { pattern_id: pattern.pattern_id, part_name: '앞판', width_cm: 40, height_cm: 45, quantity: 1 },
    { pattern_id: pattern.pattern_id, part_name: '뒤판', width_cm: 40, height_cm: 45, quantity: 1 },
    { pattern_id: pattern.pattern_id, part_name: '끈', width_cm: 8, height_cm: 60, quantity: 2 },
  ]);
  return pattern;
}

async function setup({ roll = false, fabric = {}, detail = {} } = {}) {
  const { seller, store } = await makeStore();
  const f = await makeFabric(
    store.store_id,
    roll
      ? { sale_type: 'ROLL', price: 6000, remaining_length_cm: 900, status: 'POSTED', ...fabric }
      : { price: 3000, status: 'POSTED', ...fabric },
  );
  await db.FabricDetail.create({
    fabric_id: f.fabric_id,
    width_cm: 150,
    length_cm: roll ? null : 65,
    material: 'COTTON',
    thickness: 'NORMAL',
    color_family: 'NAVY',
    ...detail,
  });
  return { seller, store, fabric: f };
}

test('자투리 추천 성공: 명세서 예시 그대로 (에코백, SUITABLE, 판단 근거 4개)', async () => {
  const pattern = await makeEcoBag();
  const { fabric } = await setup();
  const { status, json } = await recommendations(fabric.fabric_id);
  assert.equal(status, 200);
  assert.equal(json.data.available, true);
  assert.equal(json.data.message, null);
  assert.deepEqual(Object.keys(json.data).sort(), ['available', 'items', 'message', 'notices']);
  assert.equal(json.data.items.length, 1);

  const item = json.data.items[0];
  assert.deepEqual(Object.keys(item).sort(), [
    'estimated_price', 'image_url', 'judgement', 'patternId', 'pattern_name', 'purchase_length_cm', 'reasons', 'required_length_cm', 'yards',
  ]);
  assert.equal(item.patternId, pattern.pattern_id);
  assert.equal(item.pattern_name, '에코백');
  assert.equal(item.judgement, 'SUITABLE');
  assert.deepEqual(item.reasons.map((r) => [r.criterion, r.required, r.actual, r.met]).slice(0, 2), [
    ['WIDTH', 96, 150, true],
    ['LENGTH', 60, 65, true],
  ]);
  assert.equal(item.reasons[0].text, '필요 가로 96cm 이상 → 폭 150cm (충족)');
  assert.deepEqual(json.data.notices, ['실물 확인 권장: 촉감·결 방향·수축은 정보로 확인할 수 없어요']);
});

test('롤 추천 성공: 필요 길이 210 → 구매 길이 270(3마), 예상 금액 18000', async () => {
  await makeEcoBag();
  const { fabric } = await setup({ roll: true });
  const { json } = await recommendations(fabric.fabric_id);
  const item = json.data.items[0];
  assert.deepEqual(
    [item.required_length_cm, item.purchase_length_cm, item.yards, item.estimated_price],
    [210, 270, 3, 18000],
  );
  assert.deepEqual(item.reasons.slice(0, 2).map((r) => [r.criterion, r.required, r.actual]), [['WIDTH', 40, 150], ['LENGTH', 270, 900]]);
});

test('로그인하지 않아도 볼 수 있고, 잘못된 토큰이면 401 (공개 API)', async () => {
  const { fabric } = await setup();
  assert.equal((await recommendations(fabric.fabric_id)).status, 200);
  const buyer = signToken(await makeUser({ role: 'BUYER' }));
  assert.equal((await recommendations(fabric.fabric_id, buyer)).status, 200);

  const expired = jwt.sign({ role: 'BUYER' }, env.jwtSecret, { subject: '1', expiresIn: -10 });
  for (const token of ['garbage', expired]) {
    const { status, json } = await recommendations(fabric.fabric_id, token);
    assert.equal(status, 401);
    assert.equal(json.error.code, 'UNAUTHORIZED');
  }
});

test('사용 중(is_active)인 도안만 비교하고, 비활성 도안은 나오지 않는다', async () => {
  const active = await makeEcoBag({ pattern_name: '쓰는 도안' });
  await makeEcoBag({ pattern_name: '쉬는 도안', is_active: false });
  const { fabric } = await setup();
  const { json } = await recommendations(fabric.fabric_id);
  assert.deepEqual(json.data.items.map((i) => i.patternId), [active.pattern_id]);
});

test('소재를 모르는 원단은 NEEDS_CHECK 와 소재 확인 안내(notices)', async () => {
  await makeEcoBag();
  const { fabric } = await setup({ detail: { material: 'UNKNOWN' } });
  const { json } = await recommendations(fabric.fabric_id);
  assert.equal(json.data.items[0].judgement, 'NEEDS_CHECK');
  assert.equal(json.data.items[0].reasons.find((r) => r.criterion === 'MATERIAL').met, null);
  assert.deepEqual(json.data.notices, ['실물 확인 권장: 촉감·결 방향·수축은 정보로 확인할 수 없어요', '소재를 판매자에게 확인해 보세요']);
});

test('맞는 도안이 없으면 available 은 true 이고 items 는 비어 있으며 안내 message 가 있다', async () => {
  await makeEcoBag();
  const { fabric } = await setup({ detail: { width_cm: 30 } });
  const { json } = await recommendations(fabric.fabric_id);
  assert.equal(json.data.available, true);
  assert.deepEqual(json.data.items, []);
  assert.equal(typeof json.data.message, 'string');
});

test('도안이 하나도 없어도 오류가 아니다', async () => {
  const { fabric } = await setup();
  const { status, json } = await recommendations(fabric.fabric_id);
  assert.equal(status, 200);
  assert.deepEqual(json.data.items, []);
});

test('게시 중이 아닌 원단은 available false 이고 items 는 비어 있다', async () => {
  await makeEcoBag();
  for (const state of ['PENDING', 'REJECTED', 'SOLD_OUT']) {
    const { fabric } = await setup({ fabric: { status: state, reject_reason: state === 'REJECTED' ? 'x' : null } });
    const { status, json } = await recommendations(fabric.fabric_id);
    assert.equal(status, 200, state);
    assert.equal(json.data.available, false, state);
    assert.deepEqual(json.data.items, []);
    assert.equal(typeof json.data.message, 'string');
    assert.equal(json.data.notices.length, 1);
  }
});

test('수락된 예약이 있는 자투리는 available false (예약 중), 요청됨만 있으면 true', async () => {
  await makeEcoBag();
  const { store, fabric, seller } = await setup();
  const buyer = await makeUser({ role: 'BUYER' });
  const reservation = await db.Reservation.create({
    fabric_id: fabric.fabric_id, buyer_id: buyer.user_id, seller_id: seller.user_id, pickup_at: new Date(), status: 'REQUESTED',
  });
  assert.equal((await recommendations(fabric.fabric_id)).json.data.available, true);

  await reservation.update({ status: 'ACCEPTED' });
  const { json } = await recommendations(fabric.fabric_id);
  assert.equal(json.data.available, false);
  assert.deepEqual(json.data.items, []);

  await reservation.update({ status: 'CANCELED', canceled_by: 'BUYER' }); // 취소되면 다시 추천 가능
  assert.equal((await recommendations(fabric.fabric_id)).json.data.available, true);
  assert.ok(store);
});

test('롤의 구매 가능 길이가 90cm 미만이면 available false, 90cm 이상이면 true', async () => {
  await makeEcoBag();
  const low = await setup({ roll: true, fabric: { remaining_length_cm: 900, reserved_length_cm: 811 } }); // 89
  assert.equal((await recommendations(low.fabric.fabric_id)).json.data.available, false);

  const ok = await setup({ roll: true, fabric: { remaining_length_cm: 900, reserved_length_cm: 810 } }); // 90
  const { json } = await recommendations(ok.fabric.fabric_id);
  assert.equal(json.data.available, true);
  assert.deepEqual(json.data.items, []); // 90cm 로는 에코백(270cm)을 못 만든다
});

test('수락된 롤 예약만큼 구매 가능 길이가 줄어 추천이 달라진다', async () => {
  await makeEcoBag();
  const { fabric } = await setup({ roll: true, fabric: { remaining_length_cm: 900 } });
  assert.equal((await recommendations(fabric.fabric_id)).json.data.items.length, 1);
  await fabric.update({ reserved_length_cm: 700 }); // 구매 가능 200 < 270
  assert.deepEqual((await recommendations(fabric.fabric_id)).json.data.items, []);
});

test('없거나 삭제된 원단은 404, 번호 형식이 틀리면 400', async () => {
  const missing = await recommendations(99999);
  assert.equal(missing.status, 404);
  assert.equal(missing.json.error.code, 'NOT_FOUND');

  const { fabric } = await setup();
  await fabric.destroy();
  assert.equal((await recommendations(fabric.fabric_id)).status, 404);

  for (const id of ['abc', '0', '-1', '1.5']) {
    const { status, json } = await recommendations(id);
    assert.equal(status, 400, id);
    assert.ok(json.error.details.some((d) => d.field === 'fabricId'));
  }
});

test('적합 5개·확인 필요 3개 제한과 정렬이 API 응답에도 적용된다', async () => {
  const sizes = [10, 20, 30, 40, 50, 15, 25];
  for (const size of sizes) {
    const pattern = await db.Pattern.create({ pattern_name: `정사각 ${size}`, allowed_materials: ['COTTON'], allowed_thickness: ['NORMAL'] });
    await db.PatternPart.create({ pattern_id: pattern.pattern_id, part_name: '판', width_cm: size, height_cm: size, quantity: 1 });
  }
  const { fabric } = await setup({ detail: { width_cm: 100, length_cm: 90 } });
  const { json } = await recommendations(fabric.fabric_id);
  assert.equal(json.data.items.length, 5);
  // 자투리는 필요 면적이 큰 도안부터: 50, 40, 30, 25, 20
  assert.deepEqual(json.data.items.map((i) => i.pattern_name), ['정사각 50', '정사각 40', '정사각 30', '정사각 25', '정사각 20']);
});
