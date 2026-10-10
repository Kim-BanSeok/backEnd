import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { signToken } from '../src/services/auth.service.js';
import { db, resetDb, makeUser, makeStore } from './helpers.js';

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

// 승인된 판매자 + 매장 → 토큰
const approvedSeller = async () => signToken((await makeStore()).seller);

// 명세서 9번의 요청 예시 그대로
const scrapBody = (detail = {}, top = {}) => ({
  sale_type: 'SCRAP',
  title: '네이비 면 20수',
  price: 3000,
  remaining_length_cm: null,
  detail: {
    material: 'COTTON',
    thickness: 'NORMAL',
    color_family: 'NAVY',
    color_detail: '짙은 남색',
    width_cm: 150,
    length_cm: 65,
    has_defect: true,
    defect_note: '오른쪽 아래 얼룩 3cm',
    description: '앞치마용으로 쓰던 원단이에요',
    ...detail,
  },
  ...top,
});

const rollBody = (detail = {}, top = {}) => ({
  sale_type: 'ROLL',
  title: '린넨 롤',
  price: 6000,
  remaining_length_cm: 900,
  detail: {
    material: 'LINEN',
    thickness: 'NORMAL',
    color_family: 'BEIGE',
    width_cm: 150,
    length_cm: null,
    has_defect: false,
    ...detail,
  },
  ...top,
});

const counts = async () => ({ fabrics: await db.Fabric.count(), details: await db.FabricDetail.count() });

// ---- 성공

test('자투리 등록 성공: 201 { fabricId, status: PENDING } 과 원단·상세가 함께 저장된다', async () => {
  const token = await approvedSeller();
  const { status, json } = await call('POST', '/fabrics', { token, body: scrapBody() });
  assert.equal(status, 201);
  assert.deepEqual(json, { success: true, data: { fabricId: json.data.fabricId, status: 'PENDING' } });
  assert.equal(typeof json.data.fabricId, 'number');

  const fabric = await db.Fabric.findByPk(json.data.fabricId, { include: [{ model: db.FabricDetail, as: 'detail' }] });
  assert.equal(fabric.status, 'PENDING');
  assert.equal(fabric.sale_type, 'SCRAP');
  assert.equal(fabric.remaining_length_cm, null);
  assert.equal(fabric.reserved_length_cm, 0);
  assert.equal(fabric.detail.length_cm, 65);
  assert.equal(fabric.detail.has_defect, true);
  assert.equal(fabric.detail.defect_note, '오른쪽 아래 얼룩 3cm');
});

test('롤 등록 성공: 남은 길이가 저장되고 세로 길이는 없다', async () => {
  const token = await approvedSeller();
  const { status, json } = await call('POST', '/fabrics', { token, body: rollBody() });
  assert.equal(status, 201);
  const fabric = await db.Fabric.findByPk(json.data.fabricId, { include: [{ model: db.FabricDetail, as: 'detail' }] });
  assert.equal(fabric.remaining_length_cm, 900);
  assert.equal(fabric.reserved_length_cm, 0);
  assert.equal(fabric.detail.length_cm, null);
  assert.equal(fabric.detail.has_defect, false);
});

test('등록한 원단은 내 매장에 연결된다', async () => {
  const { seller, store } = await makeStore();
  const { json } = await call('POST', '/fabrics', { token: signToken(seller), body: scrapBody() });
  assert.equal((await db.Fabric.findByPk(json.data.fabricId)).store_id, store.store_id);
});

test('소재를 보내지 않거나 null 이면 UNKNOWN 으로 저장, 선택 항목은 null', async () => {
  const token = await approvedSeller();
  for (const material of [undefined, null]) {
    const body = scrapBody({ material, has_defect: undefined, defect_note: undefined, color_detail: '', description: undefined });
    const { status, json } = await call('POST', '/fabrics', { token, body });
    assert.equal(status, 201, String(material));
    const detail = await db.FabricDetail.findOne({ where: { fabric_id: json.data.fabricId } });
    assert.equal(detail.material, 'UNKNOWN');
    assert.equal(detail.has_defect, false); // 기본 false
    assert.equal(detail.color_detail, null); // 빈 문자열은 null
    assert.equal(detail.defect_note, null);
    assert.equal(detail.blend_ratio, null);
  }
});

test('요청에 없는 항목(status, store_id 등)은 무시하고 서버가 정한다', async () => {
  const { seller, store } = await makeStore();
  const body = { ...scrapBody(), status: 'POSTED', store_id: 9999, reserved_length_cm: 50, fabric_id: 7 };
  const { status, json } = await call('POST', '/fabrics', { token: signToken(seller), body });
  assert.equal(status, 201);
  assert.equal(json.data.status, 'PENDING');
  const fabric = await db.Fabric.findByPk(json.data.fabricId);
  assert.equal(fabric.store_id, store.store_id);
  assert.equal(fabric.reserved_length_cm, 0);
});

// ---- 권한

test('로그인 안 함 401, 구매자·운영팀 403', async () => {
  const noToken = await call('POST', '/fabrics', { body: scrapBody() });
  assert.equal(noToken.status, 401);
  assert.equal(noToken.json.error.code, 'UNAUTHORIZED');

  for (const role of ['BUYER', 'ADMIN']) {
    const token = signToken(await makeUser({ role }));
    const { status, json } = await call('POST', '/fabrics', { token, body: scrapBody() });
    assert.equal(status, 403, role);
    assert.equal(json.error.code, 'FORBIDDEN');
  }
  assert.deepEqual(await counts(), { fabrics: 0, details: 0 });
});

test('승인되지 않은 판매자(PENDING·REJECTED)는 SELLER_NOT_APPROVED', async () => {
  for (const approval of ['PENDING', 'REJECTED']) {
    const { seller } = await makeStore();
    await seller.update({ seller_approval_status: approval });
    const { status, json } = await call('POST', '/fabrics', { token: signToken(seller), body: scrapBody() });
    assert.equal(status, 403, approval);
    assert.equal(json.error.code, 'SELLER_NOT_APPROVED');
  }
  assert.deepEqual(await counts(), { fabrics: 0, details: 0 });
});

test('승인된 판매자라도 매장이 없으면 STORE_REQUIRED', async () => {
  const seller = await makeUser({ role: 'SELLER', seller_approval_status: 'APPROVED' });
  const { status, json } = await call('POST', '/fabrics', { token: signToken(seller), body: scrapBody() });
  assert.equal(status, 403);
  assert.equal(json.error.code, 'STORE_REQUIRED');
});

test('승인을 먼저 확인하고 그다음 매장을 확인한다 (둘 다 없으면 SELLER_NOT_APPROVED)', async () => {
  const seller = await makeUser({ role: 'SELLER', seller_approval_status: 'PENDING' }); // 매장도 없음
  const { json } = await call('POST', '/fabrics', { token: signToken(seller), body: scrapBody() });
  assert.equal(json.error.code, 'SELLER_NOT_APPROVED');
});

// ---- 입력 오류 (형식)

test('형식 오류는 VALIDATION_ERROR 와 항목별 details (detail.xxx 포함)', async () => {
  const token = await approvedSeller();
  const cases = [
    ['sale_type', scrapBody({}, { sale_type: 'BOX' })],
    ['title', scrapBody({}, { title: '   ' })],
    ['title', scrapBody({}, { title: 'a'.repeat(101) })],
    ['price', scrapBody({}, { price: 0 })],
    ['price', scrapBody({}, { price: 1.5 })],
    ['price', scrapBody({}, { price: '3000' })],
    ['price', scrapBody({}, { price: 2147483648 })],
    ['detail.material', scrapBody({ material: 'SILK' })],
    ['detail.thickness', scrapBody({ thickness: undefined })],
    ['detail.thickness', scrapBody({ thickness: 'HEAVY' })],
    ['detail.color_family', scrapBody({ color_family: 'ORANGE' })],
    ['detail.width_cm', scrapBody({ width_cm: 0 })],
    ['detail.width_cm', scrapBody({ width_cm: 1001 })],
    ['detail.width_cm', scrapBody({ width_cm: 150.5 })],
    ['detail.has_defect', scrapBody({ has_defect: 'yes' })],
    ['detail.defect_note', scrapBody({ defect_note: 'a'.repeat(256) })],
    ['detail.color_detail', scrapBody({ color_detail: 'a'.repeat(101) })],
    ['detail.description', scrapBody({ description: 'a'.repeat(5001) })],
    ['detail', { ...scrapBody(), detail: undefined }],
  ];
  for (const [field, body] of cases) {
    const { status, json } = await call('POST', '/fabrics', { token, body });
    assert.equal(status, 400, field);
    assert.equal(json.error.code, 'VALIDATION_ERROR', field);
    assert.ok(json.error.details.some((d) => d.field === field), `${field}: ${JSON.stringify(json.error.details)}`);
  }
  assert.deepEqual(await counts(), { fabrics: 0, details: 0 });
});

// ---- 규칙 오류

test('자투리 세로 길이는 30~90cm: 경계는 통과, 벗어나거나 없으면 SCRAP_LENGTH_OUT_OF_RANGE', async () => {
  const token = await approvedSeller();
  for (const length_cm of [30, 90]) {
    assert.equal((await call('POST', '/fabrics', { token, body: scrapBody({ length_cm }) })).status, 201, `${length_cm}`);
  }
  for (const length_cm of [29, 91, 0, -5, 150, null, undefined]) {
    const { status, json } = await call('POST', '/fabrics', { token, body: scrapBody({ length_cm }) });
    assert.equal(status, 400, String(length_cm));
    assert.equal(json.error.code, 'SCRAP_LENGTH_OUT_OF_RANGE', String(length_cm));
    assert.equal(json.error.message, '자투리는 길이 30~90cm만 등록할 수 있어요');
  }
});

test('롤 남은 길이는 90cm 이상: 경계는 통과, 부족하거나 없으면 ROLL_LENGTH_REQUIRED', async () => {
  const token = await approvedSeller();
  assert.equal((await call('POST', '/fabrics', { token, body: rollBody({}, { remaining_length_cm: 90 }) })).status, 201);
  for (const remaining_length_cm of [89, 0, -90, null, undefined]) {
    const { status, json } = await call('POST', '/fabrics', { token, body: rollBody({}, { remaining_length_cm }) });
    assert.equal(status, 400, String(remaining_length_cm));
    assert.equal(json.error.code, 'ROLL_LENGTH_REQUIRED', String(remaining_length_cm));
  }
});

test('자투리는 남은 길이를, 롤은 세로 길이를 보내면 VALIDATION_ERROR', async () => {
  const token = await approvedSeller();
  const scrap = await call('POST', '/fabrics', { token, body: scrapBody({}, { remaining_length_cm: 100 }) });
  assert.equal(scrap.status, 400);
  assert.equal(scrap.json.error.code, 'VALIDATION_ERROR');
  assert.equal(scrap.json.error.details[0].field, 'remaining_length_cm');

  const roll = await call('POST', '/fabrics', { token, body: rollBody({ length_cm: 60 }) });
  assert.equal(roll.status, 400);
  assert.equal(roll.json.error.code, 'VALIDATION_ERROR');
  assert.equal(roll.json.error.details[0].field, 'detail.length_cm');
  assert.deepEqual(await counts(), { fabrics: 0, details: 0 });
});

test('하자가 있으면 하자 내용 필수: 없거나 공백이면 DEFECT_NOTE_REQUIRED, 하자가 없으면 내용 없어도 됨', async () => {
  const token = await approvedSeller();
  for (const defect_note of [undefined, null, '', '   ']) {
    const { status, json } = await call('POST', '/fabrics', { token, body: scrapBody({ has_defect: true, defect_note }) });
    assert.equal(status, 400, JSON.stringify(defect_note));
    assert.equal(json.error.code, 'DEFECT_NOTE_REQUIRED');
  }
  const rollDefect = await call('POST', '/fabrics', { token, body: rollBody({ has_defect: true }) });
  assert.equal(rollDefect.json.error.code, 'DEFECT_NOTE_REQUIRED');

  const ok = await call('POST', '/fabrics', { token, body: scrapBody({ has_defect: false, defect_note: undefined }) });
  assert.equal(ok.status, 201);
});

// ---- 트랜잭션

test('원단상세 저장이 실패하면 원단도 저장되지 않는다 (한 트랜잭션)', async () => {
  const token = await approvedSeller();
  const original = db.FabricDetail.create;
  db.FabricDetail.create = async () => {
    throw new Error('상세 저장 실패(시험용)');
  };
  try {
    const { status, json } = await call('POST', '/fabrics', { token, body: scrapBody() });
    assert.equal(status, 500);
    assert.equal(json.error.code, 'INTERNAL_ERROR');
  } finally {
    db.FabricDetail.create = original;
  }
  assert.deepEqual(await counts(), { fabrics: 0, details: 0 });
});

test('같은 요청을 여러 번 보내면 그만큼 별도의 원단이 생긴다', async () => {
  const token = await approvedSeller();
  const results = await Promise.all(Array.from({ length: 3 }, () => call('POST', '/fabrics', { token, body: scrapBody() })));
  assert.ok(results.every((r) => r.status === 201));
  assert.equal(new Set(results.map((r) => r.json.data.fabricId)).size, 3);
  assert.deepEqual(await counts(), { fabrics: 3, details: 3 });
});
