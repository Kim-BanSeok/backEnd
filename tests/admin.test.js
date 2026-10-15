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
      ...(body && { 'Content-Type': 'application/json' }),
      ...(token && { Authorization: `Bearer ${token}` }),
    },
    body: body && JSON.stringify(body),
  });
  return { status: res.status, json: await res.json() };
}

// ---- 도우미

const adminToken = async () => signToken(await makeUser({ role: 'ADMIN' }));
const tokenOf = async (role) =>
  signToken(await makeUser({ role, seller_approval_status: role === 'SELLER' ? 'APPROVED' : null }));

let seq = 0;
const addDetail = (fabric, overrides = {}) =>
  db.FabricDetail.create({
    fabric_id: fabric.fabric_id,
    width_cm: 150,
    length_cm: fabric.sale_type === 'SCRAP' ? 65 : null,
    thickness: 'NORMAL',
    color_family: 'NAVY',
    material: 'COTTON',
    ...overrides,
  });
const addImage = (fabric, sortOrder = 0) => {
  seq += 1;
  return db.FabricImage.create({
    fabric_id: fabric.fabric_id,
    image_url: `http://x/${seq}.png`,
    thumbnail_url: `http://x/thumbs/${seq}.webp`,
    image_type: 'FULL',
    sort_order: sortOrder,
  });
};

// 매장 + 원단(상세 포함). 사진은 images 개수만큼 붙인다.
async function makeListed({ images = 1, ...fabricOverrides } = {}, storeOverrides = {}) {
  const { store } = await makeStore(storeOverrides);
  const fabric = await makeFabric(store.store_id, fabricOverrides);
  await addDetail(fabric);
  for (let i = 0; i < images; i += 1) await addImage(fabric, i);
  return { store, fabric };
}

const statusOf = async (fabric) => (await db.Fabric.findByPk(fabric.fabric_id)).status;

// ---- 모든 운영 API 의 권한

const ALL = [
  ['GET', '/admin/fabrics'],
  ['POST', '/admin/fabrics/1/approve'],
  ['POST', '/admin/fabrics/1/reject', { reason: '사유' }],
  ['GET', '/admin/sellers'],
  ['POST', '/admin/sellers/1/approve'],
  ['POST', '/admin/sellers/1/reject'],
];

test('운영 API 6개: 로그인 안 함 401, 판매자·구매자 403 (운영팀만 쓸 수 있다)', async () => {
  const seller = await tokenOf('SELLER');
  const buyer = await tokenOf('BUYER');
  for (const [method, path, body] of ALL) {
    const none = await call(method, path, { body });
    assert.equal(none.status, 401, `${method} ${path}`);
    assert.equal(none.json.error.code, 'UNAUTHORIZED');
    for (const token of [seller, buyer]) {
      const res = await call(method, path, { body, token });
      assert.equal(res.status, 403, `${method} ${path}`);
      assert.equal(res.json.error.code, 'FORBIDDEN');
    }
  }
});

test('권한이 없으면 입력 검사보다 먼저 거절한다 (존재 여부를 알려 주지 않는다)', async () => {
  const buyer = await tokenOf('BUYER');
  const { status } = await call('POST', '/admin/fabrics/abc/approve', { token: buyer });
  assert.equal(status, 403);
});

// ---- 33. 게시 대기 원단 목록

test('원단 목록: 기본은 게시 대기(PENDING), 오래 기다린 순, 명세서 항목 그대로', async () => {
  const token = await adminToken();
  const first = await makeListed({ title: '먼저 등록' }, { store_name: '양주원단상회' });
  const second = await makeListed({ title: '나중 등록' });
  await makeListed({ title: '이미 게시됨', status: 'POSTED' });
  await makeListed({ title: '반려됨', status: 'REJECTED', reject_reason: '사유' });

  const { status, json } = await call('GET', '/admin/fabrics', { token });
  assert.equal(status, 200);
  assert.deepEqual(json.data.content.map((f) => f.title), ['먼저 등록', '나중 등록']);
  assert.equal(json.data.totalElements, 2);
  assert.equal(json.data.page, 0);
  assert.equal(json.data.size, 20);
  assert.equal(json.data.totalPages, 1);

  const item = json.data.content[0];
  assert.deepEqual(Object.keys(item).sort(), [
    'created_at', 'detail', 'fabricId', 'images', 'price', 'remaining_length_cm', 'sale_type', 'status', 'store_name', 'title',
  ]);
  assert.equal(item.fabricId, first.fabric.fabric_id);
  assert.equal(item.store_name, '양주원단상회');
  assert.equal(item.status, 'PENDING');
  assert.match(item.created_at, /\+09:00$/);
  assert.deepEqual(Object.keys(item.detail).sort(), [
    'blend_ratio', 'color_detail', 'color_family', 'defect_note', 'description', 'grain_direction',
    'has_defect', 'length_cm', 'material', 'sheet_count', 'thickness', 'weave', 'width_cm',
  ]);
  assert.equal(item.detail.length_cm, 65);
  assert.deepEqual(Object.keys(item.images[0]).sort(), ['imageId', 'image_type', 'image_url', 'sort_order', 'thumbnail_url']);
  assert.ok(second);
});

test('원단 목록: 사진은 대표(sort_order 0)부터 순서대로 나온다', async () => {
  const token = await adminToken();
  const { fabric } = await makeListed({ images: 0 });
  await addImage(fabric, 2);
  await addImage(fabric, 0);
  await addImage(fabric, 1);
  const { json } = await call('GET', '/admin/fabrics', { token });
  assert.deepEqual(json.data.content[0].images.map((i) => i.sort_order), [0, 1, 2]);
});

test('원단 목록: status 로 다른 상태를 볼 수 있다', async () => {
  const token = await adminToken();
  await makeListed({ title: '대기' });
  await makeListed({ title: '게시', status: 'POSTED' });
  await makeListed({ title: '반려', status: 'REJECTED', reject_reason: 'x' });
  await makeListed({ title: '완판', status: 'SOLD_OUT' });
  for (const [status, title] of [['POSTED', '게시'], ['REJECTED', '반려'], ['SOLD_OUT', '완판'], ['PENDING', '대기']]) {
    const { json } = await call('GET', `/admin/fabrics?status=${status}`, { token });
    assert.deepEqual(json.data.content.map((f) => f.title), [title], status);
  }
});

test('원단 목록: 사진이 없어도 상세만 있어도 보이고, 삭제된 원단은 빠진다', async () => {
  const token = await adminToken();
  const noImage = await makeListed({ title: '사진 없음', images: 0 });
  const deleted = await makeListed({ title: '삭제됨' });
  await deleted.fabric.destroy();
  const { json } = await call('GET', '/admin/fabrics', { token });
  assert.deepEqual(json.data.content.map((f) => f.title), ['사진 없음']);
  assert.deepEqual(json.data.content[0].images, []);
  assert.ok(noImage);
});

test('원단 목록: 페이지 나누기 (사진이 여러 장이어도 개수와 페이지가 정확하다)', async () => {
  const token = await adminToken();
  for (let i = 1; i <= 5; i += 1) await makeListed({ title: `원단${i}`, images: 3 });

  const p0 = await call('GET', '/admin/fabrics?page=0&size=2', { token });
  assert.deepEqual(p0.json.data.content.map((f) => f.title), ['원단1', '원단2']);
  assert.equal(p0.json.data.totalElements, 5);
  assert.equal(p0.json.data.totalPages, 3);
  assert.ok(p0.json.data.content.every((f) => f.images.length === 3));

  const p2 = await call('GET', '/admin/fabrics?page=2&size=2', { token });
  assert.deepEqual(p2.json.data.content.map((f) => f.title), ['원단5']);

  const beyond = await call('GET', '/admin/fabrics?page=9&size=2', { token });
  assert.deepEqual(beyond.json.data.content, []);
  assert.equal(beyond.json.data.totalElements, 5);
});

test('원단 목록 입력 오류: 없는 상태, 범위를 벗어난 page·size', async () => {
  const token = await adminToken();
  for (const [query, field] of [
    ['status=DONE', 'status'], ['status=pending', 'status'], ['page=-1', 'page'], ['page=abc', 'page'],
    ['size=0', 'size'], ['size=51', 'size'], ['size=1.5', 'size'],
  ]) {
    const { status, json } = await call('GET', `/admin/fabrics?${query}`, { token });
    assert.equal(status, 400, query);
    assert.equal(json.error.code, 'VALIDATION_ERROR');
    assert.ok(json.error.details.some((d) => d.field === field), `${query}: ${JSON.stringify(json.error.details)}`);
  }
});

// ---- 34. 게시 승인

test('게시 승인: PENDING → POSTED, 응답 { fabricId, status }', async () => {
  const token = await adminToken();
  const { fabric } = await makeListed();
  const { status, json } = await call('POST', `/admin/fabrics/${fabric.fabric_id}/approve`, { token });
  assert.equal(status, 200);
  assert.deepEqual(json, { success: true, data: { fabricId: fabric.fabric_id, status: 'POSTED' } });
  assert.equal(await statusOf(fabric), 'POSTED');
});

test('게시 승인: 사진이 한 장도 없으면 IMAGE_REQUIRED (상태는 그대로)', async () => {
  const token = await adminToken();
  const { fabric } = await makeListed({ images: 0 });
  const { status, json } = await call('POST', `/admin/fabrics/${fabric.fabric_id}/approve`, { token });
  assert.equal(status, 400);
  assert.equal(json.error.code, 'IMAGE_REQUIRED');
  assert.equal(json.error.message, '사진이 없는 원단은 게시할 수 없어요');
  assert.equal(await statusOf(fabric), 'PENDING');
});

test('게시 승인: PENDING 이 아니면 INVALID_STATUS, 없거나 삭제된 원단은 NOT_FOUND', async () => {
  const token = await adminToken();
  for (const state of ['POSTED', 'REJECTED', 'SOLD_OUT']) {
    const { fabric } = await makeListed({ status: state, reject_reason: state === 'REJECTED' ? 'x' : null });
    const { status, json } = await call('POST', `/admin/fabrics/${fabric.fabric_id}/approve`, { token });
    assert.equal(status, 409, state);
    assert.equal(json.error.code, 'INVALID_STATUS');
    assert.equal(await statusOf(fabric), state);
  }
  assert.equal((await call('POST', '/admin/fabrics/99999/approve', { token })).json.error.code, 'NOT_FOUND');

  const { fabric: gone } = await makeListed();
  await gone.destroy();
  assert.equal((await call('POST', `/admin/fabrics/${gone.fabric_id}/approve`, { token })).status, 404);
});

test('게시 승인: 번호가 숫자가 아니면 VALIDATION_ERROR', async () => {
  const token = await adminToken();
  for (const id of ['abc', '0', '-1', '1.5']) {
    const { status, json } = await call('POST', `/admin/fabrics/${id}/approve`, { token });
    assert.equal(status, 400, id);
    assert.equal(json.error.code, 'VALIDATION_ERROR');
    assert.ok(json.error.details.some((d) => d.field === 'fabricId'));
  }
});

test('게시 승인을 여러 번 동시에 눌러도 한 번만 성공한다', async () => {
  const token = await adminToken();
  const { fabric } = await makeListed();
  const results = await Promise.all(Array.from({ length: 5 }, () => call('POST', `/admin/fabrics/${fabric.fabric_id}/approve`, { token })));
  assert.equal(results.filter((r) => r.status === 200).length, 1);
  assert.ok(results.filter((r) => r.status !== 200).every((r) => r.json.error.code === 'INVALID_STATUS'));
  assert.equal(await statusOf(fabric), 'POSTED');
});

test('승인과 반려가 동시에 와도 하나만 적용된다', async () => {
  const token = await adminToken();
  const { fabric } = await makeListed();
  const [approve, reject] = await Promise.all([
    call('POST', `/admin/fabrics/${fabric.fabric_id}/approve`, { token }),
    call('POST', `/admin/fabrics/${fabric.fabric_id}/reject`, { token, body: { reason: '동시 반려' } }),
  ]);
  assert.deepEqual([approve.status, reject.status].sort(), [200, 409]);
  const saved = await db.Fabric.findByPk(fabric.fabric_id);
  assert.equal(saved.status, approve.status === 200 ? 'POSTED' : 'REJECTED');
  // 반려가 이겼을 때만 사유가 남는다
  assert.equal(saved.reject_reason, saved.status === 'REJECTED' ? '동시 반려' : null);
});

test('원단 행 잠금: 상태를 읽은 직후 틈이 길어져도 승인·반려가 둘 다 성공하지 않는다', async () => {
  const token = await adminToken();
  const { fabric } = await makeListed();

  // 트랜잭션 안에서 원단을 읽은 직후에 잠깐 멈춘다. 잠금이 없으면 두 요청이 모두 PENDING 으로 읽고 둘 다 바꿔 버린다.
  const original = db.Fabric.findByPk.bind(db.Fabric);
  db.Fabric.findByPk = async (id, options) => {
    const result = await original(id, options);
    if (options?.transaction) await new Promise((resolve) => setTimeout(resolve, 100));
    return result;
  };
  let results;
  try {
    results = await Promise.all([
      call('POST', `/admin/fabrics/${fabric.fabric_id}/approve`, { token }),
      call('POST', `/admin/fabrics/${fabric.fabric_id}/reject`, { token, body: { reason: '동시 반려' } }),
      call('POST', `/admin/fabrics/${fabric.fabric_id}/approve`, { token }),
    ]);
  } finally {
    db.Fabric.findByPk = original;
  }

  const ok = results.filter((r) => r.status === 200);
  assert.equal(ok.length, 1, results.map((r) => r.status).join(','));
  assert.ok(results.filter((r) => r.status !== 200).every((r) => r.json.error.code === 'INVALID_STATUS'));
  assert.equal(await statusOf(fabric), ok[0].json.data.status);
});

// ---- 35. 게시 반려

test('게시 반려: PENDING → REJECTED 이고 사유가 저장된다 (앞뒤 공백은 지운다)', async () => {
  const token = await adminToken();
  const { fabric } = await makeListed();
  const { status, json } = await call('POST', `/admin/fabrics/${fabric.fabric_id}/reject`, {
    token,
    body: { reason: '  하자 사진이 필요해요  ' },
  });
  assert.equal(status, 200);
  assert.deepEqual(json, { success: true, data: { fabricId: fabric.fabric_id, status: 'REJECTED' } });
  const saved = await db.Fabric.findByPk(fabric.fabric_id);
  assert.equal(saved.status, 'REJECTED');
  assert.equal(saved.reject_reason, '하자 사진이 필요해요');
});

test('게시 반려: 사진이 없어도 반려할 수 있다', async () => {
  const token = await adminToken();
  const { fabric } = await makeListed({ images: 0 });
  const { status } = await call('POST', `/admin/fabrics/${fabric.fabric_id}/reject`, { token, body: { reason: '사진 없음' } });
  assert.equal(status, 200);
});

test('게시 반려 입력 오류: 사유가 없거나 공백이거나 255자 초과', async () => {
  const token = await adminToken();
  const { fabric } = await makeListed();
  const url = `/admin/fabrics/${fabric.fabric_id}/reject`;
  for (const body of [{}, { reason: '' }, { reason: '   ' }, { reason: 'a'.repeat(256) }, { reason: 123 }, { reason: null }]) {
    const { status, json } = await call('POST', url, { token, body });
    assert.equal(status, 400, JSON.stringify(body).slice(0, 30));
    assert.equal(json.error.code, 'VALIDATION_ERROR');
    assert.ok(json.error.details.some((d) => d.field === 'reason'));
  }
  const noBody = await call('POST', url, { token });
  assert.equal(noBody.status, 400);
  assert.equal(await statusOf(fabric), 'PENDING');
  assert.equal((await call('POST', url, { token, body: { reason: 'a'.repeat(255) } })).status, 200); // 경계
});

test('게시 반려: PENDING 이 아니면 INVALID_STATUS, 없는 원단은 NOT_FOUND', async () => {
  const token = await adminToken();
  for (const state of ['POSTED', 'REJECTED', 'SOLD_OUT']) {
    const { fabric } = await makeListed({ status: state, reject_reason: state === 'REJECTED' ? '이전 사유' : null });
    const { status, json } = await call('POST', `/admin/fabrics/${fabric.fabric_id}/reject`, { token, body: { reason: '새 사유' } });
    assert.equal(status, 409, state);
    assert.equal(json.error.code, 'INVALID_STATUS');
    assert.equal((await db.Fabric.findByPk(fabric.fabric_id)).reject_reason, state === 'REJECTED' ? '이전 사유' : null);
  }
  const missing = await call('POST', '/admin/fabrics/99999/reject', { token, body: { reason: 'x' } });
  assert.equal(missing.status, 404);
  assert.equal(missing.json.error.code, 'NOT_FOUND');
});

// ---- 36. 판매자 목록

const makeSeller = async (overrides = {}, withStore = true, storeOverrides = {}) => {
  const seller = await makeUser({ role: 'SELLER', seller_approval_status: 'PENDING', ...overrides });
  const store = withStore
    ? await db.Store.create({
        user_id: seller.user_id, store_name: '매장', store_address: '주소', store_phone: '031', ...storeOverrides,
      })
    : null;
  return { seller, store };
};

test('판매자 목록: 기본은 승인 대기(PENDING), 오래 기다린 순, 회원·매장 정보가 함께 온다', async () => {
  const token = await adminToken();
  const a = await makeSeller({ nickname: '먼저', phone_number: '010-1234-5678' }, true, {
    store_name: '양주원단상회', closed_days: '매주 일요일', pickup_guide: '1층 카운터',
  });
  await makeSeller({ nickname: '나중' });
  await makeSeller({ nickname: '승인됨', seller_approval_status: 'APPROVED' });
  await makeSeller({ nickname: '거절됨', seller_approval_status: 'REJECTED' });
  await makeUser({ role: 'BUYER' });

  const { status, json } = await call('GET', '/admin/sellers', { token });
  assert.equal(status, 200);
  assert.deepEqual(json.data.content.map((s) => s.nickname), ['먼저', '나중']);
  assert.equal(json.data.totalElements, 2);

  const item = json.data.content[0];
  assert.deepEqual(Object.keys(item).sort(), [
    'created_at', 'email', 'nickname', 'phone_number', 'seller_approval_status', 'store', 'userId',
  ]);
  assert.equal(item.userId, a.seller.user_id);
  assert.equal(item.phone_number, '010-1234-5678');
  assert.equal(item.seller_approval_status, 'PENDING');
  assert.match(item.created_at, /\+09:00$/);
  assert.deepEqual(Object.keys(item.store).sort(), ['closed_days', 'pickup_guide', 'storeId', 'store_address', 'store_name', 'store_phone']);
  assert.equal(item.store.store_name, '양주원단상회');
  assert.equal(item.store.storeId, a.store.store_id);
  assert.equal('password_hash' in item, false);
});

test('판매자 목록: 매장이 없으면 store 는 null, status 로 다른 상태를 본다, 탈퇴 회원은 빠진다', async () => {
  const token = await adminToken();
  await makeSeller({ nickname: '매장 없음' }, false);
  await makeSeller({ nickname: '승인됨', seller_approval_status: 'APPROVED' });
  await makeSeller({ nickname: '거절됨', seller_approval_status: 'REJECTED' });
  const gone = await makeSeller({ nickname: '탈퇴' });
  await gone.seller.destroy();

  const pending = await call('GET', '/admin/sellers', { token });
  assert.deepEqual(pending.json.data.content.map((s) => s.nickname), ['매장 없음']);
  assert.equal(pending.json.data.content[0].store, null);

  for (const [state, nickname] of [['APPROVED', '승인됨'], ['REJECTED', '거절됨']]) {
    const { json } = await call('GET', `/admin/sellers?status=${state}`, { token });
    assert.deepEqual(json.data.content.map((s) => s.nickname), [nickname], state);
  }
});

test('판매자 목록: 페이지 나누기와 입력 오류', async () => {
  const token = await adminToken();
  for (let i = 1; i <= 3; i += 1) await makeSeller({ nickname: `판매자${i}` });
  const p1 = await call('GET', '/admin/sellers?page=1&size=2', { token });
  assert.deepEqual(p1.json.data.content.map((s) => s.nickname), ['판매자3']);
  assert.equal(p1.json.data.totalPages, 2);

  for (const query of ['status=DONE', 'status=BUYER', 'page=-1', 'size=51']) {
    const { status, json } = await call('GET', `/admin/sellers?${query}`, { token });
    assert.equal(status, 400, query);
    assert.equal(json.error.code, 'VALIDATION_ERROR');
  }
});

// ---- 37. 판매자 승인

const sellerStatus = async (seller) => (await db.User.findByPk(seller.user_id)).seller_approval_status;

test('판매자 승인: PENDING·REJECTED 모두 APPROVED 로, 응답 { userId, seller_approval_status }', async () => {
  const token = await adminToken();
  for (const from of ['PENDING', 'REJECTED']) {
    const { seller } = await makeSeller({ seller_approval_status: from });
    const { status, json } = await call('POST', `/admin/sellers/${seller.user_id}/approve`, { token });
    assert.equal(status, 200, from);
    assert.deepEqual(json, { success: true, data: { userId: seller.user_id, seller_approval_status: 'APPROVED' } });
    assert.equal(await sellerStatus(seller), 'APPROVED');
  }
});

test('판매자 승인: 이미 승인된 판매자는 INVALID_STATUS', async () => {
  const token = await adminToken();
  const { seller } = await makeSeller({ seller_approval_status: 'APPROVED' });
  const { status, json } = await call('POST', `/admin/sellers/${seller.user_id}/approve`, { token });
  assert.equal(status, 409);
  assert.equal(json.error.code, 'INVALID_STATUS');
});

test('판매자 승인·거절: 판매자가 아니거나 탈퇴했거나 없는 회원은 NOT_FOUND', async () => {
  const token = await adminToken();
  const buyer = await makeUser({ role: 'BUYER' });
  const admin = await makeUser({ role: 'ADMIN' });
  const { seller: gone } = await makeSeller();
  await gone.destroy();
  for (const userId of [buyer.user_id, admin.user_id, gone.user_id, 99999]) {
    for (const action of ['approve', 'reject']) {
      const { status, json } = await call('POST', `/admin/sellers/${userId}/${action}`, { token });
      assert.equal(status, 404, `${action} ${userId}`);
      assert.equal(json.error.code, 'NOT_FOUND');
    }
  }
  assert.equal((await db.User.findByPk(buyer.user_id)).seller_approval_status, null); // 구매자가 판매자가 되지 않는다
});

test('판매자 승인·거절: 번호가 숫자가 아니면 VALIDATION_ERROR', async () => {
  const token = await adminToken();
  for (const action of ['approve', 'reject']) {
    for (const id of ['abc', '0', '-1']) {
      const { status, json } = await call('POST', `/admin/sellers/${id}/${action}`, { token });
      assert.equal(status, 400, `${action} ${id}`);
      assert.ok(json.error.details.some((d) => d.field === 'userId'));
    }
  }
});

test('판매자 행 잠금: 상태를 읽은 직후 틈이 길어져도 한 번만 성공한다', async () => {
  const token = await adminToken();
  const { seller } = await makeSeller();

  const original = db.User.findOne.bind(db.User);
  db.User.findOne = async (options) => {
    const result = await original(options);
    if (options?.transaction) await new Promise((resolve) => setTimeout(resolve, 100));
    return result;
  };
  let results;
  try {
    results = await Promise.all(Array.from({ length: 3 }, () => call('POST', `/admin/sellers/${seller.user_id}/approve`, { token })));
  } finally {
    db.User.findOne = original;
  }
  assert.equal(results.filter((r) => r.status === 200).length, 1, results.map((r) => r.status).join(','));
  assert.ok(results.filter((r) => r.status !== 200).every((r) => r.json.error.code === 'INVALID_STATUS'));
});

test('판매자 승인을 동시에 여러 번 눌러도 한 번만 성공한다', async () => {
  const token = await adminToken();
  const { seller } = await makeSeller();
  const results = await Promise.all(Array.from({ length: 5 }, () => call('POST', `/admin/sellers/${seller.user_id}/approve`, { token })));
  assert.equal(results.filter((r) => r.status === 200).length, 1);
  assert.ok(results.filter((r) => r.status !== 200).every((r) => r.json.error.code === 'INVALID_STATUS'));
});

// ---- 38. 판매자 거절

test('판매자 거절: PENDING → REJECTED', async () => {
  const token = await adminToken();
  const { seller } = await makeSeller();
  const { status, json } = await call('POST', `/admin/sellers/${seller.user_id}/reject`, { token });
  assert.equal(status, 200);
  assert.deepEqual(json, { success: true, data: { userId: seller.user_id, seller_approval_status: 'REJECTED' } });
  assert.equal(await sellerStatus(seller), 'REJECTED');
});

test('판매자 거절: PENDING 이 아니면(APPROVED·REJECTED) INVALID_STATUS', async () => {
  const token = await adminToken();
  for (const from of ['APPROVED', 'REJECTED']) {
    const { seller } = await makeSeller({ seller_approval_status: from });
    const { status, json } = await call('POST', `/admin/sellers/${seller.user_id}/reject`, { token });
    assert.equal(status, 409, from);
    assert.equal(json.error.code, 'INVALID_STATUS');
    assert.equal(await sellerStatus(seller), from);
  }
});

test('거절된 판매자도 운영팀이 37번으로 다시 승인할 수 있고, 그 뒤에야 거절은 불가', async () => {
  const token = await adminToken();
  const { seller } = await makeSeller();
  assert.equal((await call('POST', `/admin/sellers/${seller.user_id}/reject`, { token })).status, 200);
  assert.equal((await call('POST', `/admin/sellers/${seller.user_id}/approve`, { token })).status, 200);
  assert.equal(await sellerStatus(seller), 'APPROVED');
  assert.equal((await call('POST', `/admin/sellers/${seller.user_id}/reject`, { token })).status, 409);
});

test('승인과 거절이 동시에 와도 하나만 적용된다', async () => {
  const token = await adminToken();
  const { seller } = await makeSeller();
  const [approve, reject] = await Promise.all([
    call('POST', `/admin/sellers/${seller.user_id}/approve`, { token }),
    call('POST', `/admin/sellers/${seller.user_id}/reject`, { token }),
  ]);
  // 거절이 먼저면 승인도 성공할 수 있다 (REJECTED → APPROVED). 어느 쪽이든 최종 상태는 응답과 일치해야 한다.
  const final = await sellerStatus(seller);
  if (approve.status === 200 && reject.status === 200) assert.equal(final, 'APPROVED'); // 거절 → 승인 순서
  else if (approve.status === 200) assert.equal(final, 'APPROVED');
  else assert.equal(final, 'REJECTED');
  assert.ok([approve.status, reject.status].every((s) => s === 200 || s === 409));
});

// ---- 업무 흐름: 판매자 승인 → 원단 등록 → 사진 → 게시 승인

test('운영 흐름: 판매자 승인 후에야 원단을 등록할 수 있고, 승인한 원단이 목록에서 PENDING 에서 빠진다', async () => {
  const admin = await adminToken();
  const { seller } = await makeSeller({ seller_approval_status: 'PENDING' });
  const sellerToken = signToken(seller);
  const fabricBody = {
    sale_type: 'SCRAP', title: '네이비 면', price: 3000,
    detail: { thickness: 'NORMAL', color_family: 'NAVY', width_cm: 150, length_cm: 65, sheet_count: 1 },
  };

  const before = await call('POST', '/fabrics', { token: sellerToken, body: fabricBody });
  assert.equal(before.json.error.code, 'SELLER_NOT_APPROVED');

  assert.equal((await call('POST', `/admin/sellers/${seller.user_id}/approve`, { token: admin })).status, 200);
  const created = await call('POST', '/fabrics', { token: sellerToken, body: fabricBody });
  assert.equal(created.status, 201);
  const { fabricId } = created.json.data;

  const noPhoto = await call('POST', `/admin/fabrics/${fabricId}/approve`, { token: admin });
  assert.equal(noPhoto.json.error.code, 'IMAGE_REQUIRED');

  await addImage({ fabric_id: fabricId });
  assert.equal((await call('POST', `/admin/fabrics/${fabricId}/approve`, { token: admin })).status, 200);
  assert.deepEqual((await call('GET', '/admin/fabrics', { token: admin })).json.data.content, []);
  assert.equal((await call('GET', '/admin/fabrics?status=POSTED', { token: admin })).json.data.totalElements, 1);
});

test('운영팀은 다른 판매자의 원단을 삭제할 수 있고, 구매자는 삭제할 수 없다', async () => {
  const admin = await adminToken();
  const buyer = await tokenOf('BUYER');
  const { fabric } = await makeListed({ status: 'POSTED' });

  assert.equal((await call('DELETE', `/fabrics/${fabric.fabric_id}`, { token: buyer })).status, 403);
  assert.equal((await call('DELETE', `/fabrics/${fabric.fabric_id}`, { token: admin })).status, 200);
  assert.equal(await db.Fabric.findByPk(fabric.fabric_id), null);
  assert.ok((await db.Fabric.findByPk(fabric.fabric_id, { paranoid: false })).deleted_at);
});
