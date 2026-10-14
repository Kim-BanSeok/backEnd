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

async function call(method, path, { token } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: { ...(token && { Authorization: `Bearer ${token}` }) },
  });
  return { status: res.status, json: await res.json() };
}

// 쿼리 값(한글 포함)을 주소에 붙인다.
const listPath = (query = {}) => `/fabrics?${new URLSearchParams(query)}`;

// 원단과 원단상세를 함께 만든다. 기본은 게시 중인 자투리다. 롤은 remaining_length_cm 을 주고 length_cm 은 null 로 둔다.
async function makeListed(storeId, fabric = {}, detail = {}) {
  const created = await makeFabric(storeId, { status: 'POSTED', ...fabric });
  await db.FabricDetail.create({
    fabric_id: created.fabric_id,
    width_cm: 150,
    length_cm: created.sale_type === 'SCRAP' ? 65 : null,
    material: 'COTTON',
    thickness: 'NORMAL',
    color_family: 'NAVY',
    ...detail,
  });
  return created;
}

const makeImage = (fabricId, overrides = {}) =>
  db.FabricImage.create({
    fabric_id: fabricId,
    image_url: `https://example.com/${fabricId}/full.webp`,
    thumbnail_url: `https://example.com/${fabricId}/thumb.webp`,
    sort_order: 0,
    ...overrides,
  });

const ITEM_KEYS = [
  'available_length_cm', 'color_family', 'fabricId', 'has_defect', 'is_reserved', 'length_cm', 'material', 'price',
  'sale_type', 'store_name', 'thickness', 'thumbnail_url', 'title', 'width_cm',
];
const PAGE_KEYS = ['content', 'page', 'size', 'totalElements', 'totalPages'];
const ids = (json) => json.data.content.map((item) => item.fabricId);

// ---- 10. 원단 목록 조회

test('원단 목록 성공: 로그인 없이 200, 명세서 항목 그대로 (자투리가 기본)', async () => {
  const { store } = await makeStore({ store_name: '양주원단상회' });
  const fabric = await makeListed(
    store.store_id,
    { title: '네이비 면 20수', price: 3500 },
    { has_defect: true, defect_note: '모서리 얼룩' },
  );
  await makeImage(fabric.fabric_id);

  const { status, json } = await call('GET', '/fabrics');
  assert.equal(status, 200);
  assert.equal(json.success, true);
  assert.deepEqual(Object.keys(json.data).sort(), PAGE_KEYS);
  assert.deepEqual(json.data, {
    content: [{
      fabricId: fabric.fabric_id,
      title: '네이비 면 20수',
      sale_type: 'SCRAP',
      price: 3500,
      material: 'COTTON',
      thickness: 'NORMAL',
      color_family: 'NAVY',
      width_cm: 150,
      length_cm: 65,
      available_length_cm: null,
      is_reserved: false,
      has_defect: true,
      thumbnail_url: `https://example.com/${fabric.fabric_id}/thumb.webp`,
      store_name: '양주원단상회',
    }],
    page: 0,
    size: 20,
    totalElements: 1,
    totalPages: 1,
  });
  assert.deepEqual(Object.keys(json.data.content[0]).sort(), ITEM_KEYS);
});

test('sale_type: 자투리와 롤을 나눠 보고, 롤은 구매 가능 길이를 준다', async () => {
  const { store } = await makeStore();
  const scrap = await makeListed(store.store_id);
  const roll = await makeListed(
    store.store_id,
    { sale_type: 'ROLL', price: 12000, remaining_length_cm: 900, reserved_length_cm: 180 },
    { width_cm: 110 },
  );

  assert.deepEqual(ids((await call('GET', listPath({ sale_type: 'SCRAP' }))).json), [scrap.fabric_id]);
  assert.deepEqual(ids((await call('GET', '/fabrics')).json), [scrap.fabric_id]);
  assert.deepEqual(ids((await call('GET', listPath({ sale_type: 'ALL' }))).json).sort(), [scrap.fabric_id, roll.fabric_id].sort());

  const { json } = await call('GET', listPath({ sale_type: 'ROLL' }));
  assert.deepEqual(ids(json), [roll.fabric_id]);
  const item = json.data.content[0];
  assert.equal(item.sale_type, 'ROLL');
  assert.equal(item.price, 12000);
  assert.equal(item.width_cm, 110);
  assert.equal(item.length_cm, null);
  assert.equal(item.available_length_cm, 720);
  assert.equal(item.is_reserved, false);
});

test('is_reserved: 수락된 예약이 있는 자투리만 true 이고 목록에는 남는다. 수락된 예약이 있는 롤은 false', async () => {
  const { store, seller } = await makeStore();
  const buyer = await makeUser();
  const reserved = await makeListed(store.store_id, { title: '예약 중' });
  const requested = await makeListed(store.store_id, { title: '요청만 있음' });
  const plain = await makeListed(store.store_id, { title: '예약 없음' });
  const roll = await makeListed(
    store.store_id,
    { sale_type: 'ROLL', remaining_length_cm: 900, reserved_length_cm: 180 },
    { width_cm: 110 },
  );
  const reserve = (fabric, status, requested_length_cm = null) =>
    db.Reservation.create({
      fabric_id: fabric.fabric_id,
      buyer_id: buyer.user_id,
      seller_id: seller.user_id,
      requested_length_cm,
      pickup_at: new Date('2026-10-20T10:00:00+09:00'),
      status,
    });
  await reserve(reserved, 'ACCEPTED');
  await reserve(requested, 'REQUESTED');
  await reserve(roll, 'ACCEPTED', 180);

  const { json } = await call('GET', '/fabrics');
  const flag = Object.fromEntries(json.data.content.map((item) => [item.fabricId, item.is_reserved]));
  assert.deepEqual(flag, {
    [reserved.fabric_id]: true,
    [requested.fabric_id]: false,
    [plain.fabric_id]: false,
  });
  assert.equal(json.data.totalElements, 3);

  const rolls = (await call('GET', listPath({ sale_type: 'ROLL' }))).json;
  assert.deepEqual(rolls.data.content.map((item) => [item.fabricId, item.is_reserved, item.available_length_cm]), [
    [roll.fabric_id, false, 720],
  ]);
});

test('thumbnail_url: 대표 사진(sort_order 0)의 썸네일이고, 사진이 없으면 null, 사진 수는 개수에 영향이 없다', async () => {
  const { store } = await makeStore();
  const withImages = await makeListed(store.store_id, { title: '사진 3장' });
  const noImage = await makeListed(store.store_id, { title: '사진 없음' });
  await makeImage(withImages.fabric_id, { sort_order: 2, thumbnail_url: 'https://example.com/t2.webp' });
  await makeImage(withImages.fabric_id, { sort_order: 0, thumbnail_url: 'https://example.com/t0.webp' });
  await makeImage(withImages.fabric_id, { sort_order: 1, thumbnail_url: 'https://example.com/t1.webp' });

  const { json } = await call('GET', '/fabrics');
  const byId = Object.fromEntries(json.data.content.map((item) => [item.fabricId, item.thumbnail_url]));
  assert.deepEqual(byId, {
    [withImages.fabric_id]: 'https://example.com/t0.webp',
    [noImage.fabric_id]: null,
  });
  assert.equal(json.data.totalElements, 2);
});

test('목록에는 게시 중인 원단만 나온다: 게시 대기·반려·판매 완료·삭제된 원단은 빠진다', async () => {
  const { store } = await makeStore();
  const posted = await makeListed(store.store_id, { title: '게시 중' });
  await makeListed(store.store_id, { title: '게시 대기', status: 'PENDING' });
  await makeListed(store.store_id, { title: '반려', status: 'REJECTED', reject_reason: '사진이 흐려요' });
  await makeListed(store.store_id, { title: '판매 완료', status: 'SOLD_OUT' });
  const deleted = await makeListed(store.store_id, { title: '삭제' });
  await deleted.destroy();

  const { json } = await call('GET', '/fabrics');
  assert.deepEqual(ids(json), [posted.fabric_id]);
  assert.equal(json.data.totalElements, 1);
});

test('material·thickness·color_family: 쉼표로 여러 개를 보내면 그중 하나와 같은 원단이 나오고, 조건끼리는 모두 맞아야 한다', async () => {
  const { store } = await makeStore();
  const cottonNavy = await makeListed(store.store_id, {}, { material: 'COTTON', thickness: 'NORMAL', color_family: 'NAVY' });
  const linenNavy = await makeListed(store.store_id, {}, { material: 'LINEN', thickness: 'THIN', color_family: 'NAVY' });
  const woolRed = await makeListed(store.store_id, {}, { material: 'WOOL', thickness: 'THICK', color_family: 'RED' });

  const search = async (query) => ids((await call('GET', listPath(query))).json).sort();
  const sorted = (...fabrics) => fabrics.map((f) => f.fabric_id).sort();

  assert.deepEqual(await search({ material: 'COTTON' }), sorted(cottonNavy));
  assert.deepEqual(await search({ material: 'COTTON,LINEN' }), sorted(cottonNavy, linenNavy));
  assert.deepEqual(await search({ thickness: 'THIN,THICK' }), sorted(linenNavy, woolRed));
  assert.deepEqual(await search({ color_family: 'NAVY' }), sorted(cottonNavy, linenNavy));
  assert.deepEqual(await search({ color_family: 'NAVY', thickness: 'THIN' }), sorted(linenNavy));
  assert.deepEqual(await search({ material: ' COTTON , WOOL ' }), sorted(cottonNavy, woolRed));
  assert.deepEqual(await search({ material: 'NYLON' }), []);
});

test('keyword: 제목에서 대소문자 상관없이 부분 일치로 찾고, %, _ 는 글자 그대로 찾는다', async () => {
  const { store } = await makeStore();
  const navy = await makeListed(store.store_id, { title: '네이비 면 20수' });
  const english = await makeListed(store.store_id, { title: 'Cotton Poplin' });
  const percent = await makeListed(store.store_id, { title: '면 100% 원단' });
  const underscore = await makeListed(store.store_id, { title: '린넨_특가' });
  await makeListed(store.store_id, { title: '울 원단' });

  const search = async (keyword) => ids((await call('GET', listPath({ keyword }))).json);
  assert.deepEqual(await search('네이비'), [navy.fabric_id]);
  assert.deepEqual(await search('cotton'), [english.fabric_id]);
  assert.deepEqual(await search('  COTTON  '), [english.fabric_id]);
  assert.deepEqual(await search('%'), [percent.fabric_id]);
  assert.deepEqual(await search('_'), [underscore.fabric_id]);
  assert.deepEqual(await search('없는 제목'), []);
});

test('sort: latest 는 최신순, price_asc·price_desc 는 가격순이고 같은 가격은 최신순', async () => {
  const { store } = await makeStore();
  const a = await makeListed(store.store_id, { price: 5000 });
  const b = await makeListed(store.store_id, { price: 3000 });
  const c = await makeListed(store.store_id, { price: 5000 });
  const d = await makeListed(store.store_id, { price: 1000 });

  const order = async (query) => ids((await call('GET', listPath(query))).json);
  assert.deepEqual(await order({}), [d, c, b, a].map((f) => f.fabric_id));
  assert.deepEqual(await order({ sort: 'latest' }), [d, c, b, a].map((f) => f.fabric_id));
  assert.deepEqual(await order({ sort: 'price_asc' }), [d, b, c, a].map((f) => f.fabric_id));
  assert.deepEqual(await order({ sort: 'price_desc' }), [c, a, b, d].map((f) => f.fabric_id));
});

test('원단 목록 페이지 나누기: page·size, 범위 밖 페이지는 빈 목록, 원단이 없으면 totalPages 0', async () => {
  assert.deepEqual((await call('GET', '/fabrics')).json.data, {
    content: [], page: 0, size: 20, totalElements: 0, totalPages: 0,
  });

  const { store } = await makeStore();
  const made = [];
  for (let i = 0; i < 5; i += 1) made.push(await makeListed(store.store_id));
  const newestFirst = made.map((f) => f.fabric_id).reverse();

  const first = (await call('GET', listPath({ page: 0, size: 2 }))).json.data;
  assert.deepEqual(first.content.map((item) => item.fabricId), newestFirst.slice(0, 2));
  assert.equal(first.totalElements, 5);
  assert.equal(first.totalPages, 3);
  const last = (await call('GET', listPath({ page: 2, size: 2 }))).json.data;
  assert.deepEqual(last.content.map((item) => item.fabricId), newestFirst.slice(4));
  const outside = (await call('GET', listPath({ page: 3, size: 2 }))).json.data;
  assert.deepEqual(outside.content, []);
  assert.equal(outside.totalElements, 5);
});

test('원단 목록 입력 오류: VALIDATION_ERROR 와 항목별 details', async () => {
  for (const [field, query] of [
    ['sale_type', { sale_type: 'WOOL' }],
    ['material', { material: 'ABC' }],
    ['material', { material: 'COTTON,,LINEN' }],
    ['material', { material: '' }],
    ['thickness', { thickness: 'THIN,HEAVY' }],
    ['color_family', { color_family: 'PURPLE,GOLD' }],
    ['keyword', { keyword: '   ' }],
    ['keyword', { keyword: 'ㄱ'.repeat(101) }],
    ['sort', { sort: 'oldest' }],
    ['page', { page: -1 }],
    ['page', { page: 'abc' }],
    ['size', { size: 0 }],
    ['size', { size: 51 }],
  ]) {
    const { status, json } = await call('GET', listPath(query));
    assert.equal(status, 400, JSON.stringify(query));
    assert.equal(json.error.code, 'VALIDATION_ERROR');
    assert.ok(json.error.details.some((d) => d.field === field && d.message), `${field}: ${JSON.stringify(json.error.details)}`);
  }
});

test('원단 목록: 공개 API 라도 잘못된 토큰이면 401 (명세서 2.3)', async () => {
  const expired = jwt.sign({ role: 'BUYER' }, env.jwtSecret, { subject: '1', expiresIn: -10 });
  for (const token of ['garbage', expired]) {
    const { status, json } = await call('GET', '/fabrics', { token });
    assert.equal(status, 401);
    assert.equal(json.error.code, 'UNAUTHORIZED');
  }
});

// ---- 11. 원단 상세 조회

const DETAIL_KEYS = [
  'availability', 'created_at', 'detail', 'fabricId', 'images', 'price', 'sale_type', 'status', 'store', 'title',
];
const DETAIL_INNER_KEYS = [
  'blend_ratio', 'color_detail', 'color_family', 'defect_note', 'description', 'grain_direction', 'has_defect',
  'length_cm', 'material', 'sheet_count', 'thickness', 'weave', 'width_cm',
];
const IMAGE_KEYS = ['imageId', 'image_type', 'image_url', 'sort_order', 'thumbnail_url'];
const STORE_KEYS = ['closed_days', 'pickup_guide', 'storeId', 'store_address', 'store_name', 'store_phone'];
const AVAILABILITY_KEYS = ['available_length_cm', 'available_sheet_count', 'is_reserved', 'reserved_length_cm', 'reserved_sheet_count'];

test('원단 상세 성공: 로그인 없이 200, 명세서 항목 그대로, 사진은 sort_order 순', async () => {
  const { store } = await makeStore({
    store_name: '양주원단상회',
    store_address: '경기도 양주시 어딘가로 12',
    store_phone: '031-123-4567',
    closed_days: '매주 일요일, 공휴일',
    pickup_guide: '평일 10~18시, 1층 카운터에서 말씀해 주세요',
  });
  const fabric = await makeListed(
    store.store_id,
    { title: '네이비 면 20수', price: 3500 },
    {
      color_detail: '짙은 남색(네이비)',
      has_defect: true,
      defect_note: '오른쪽 아래 얼룩 3cm',
      description: '앞치마용으로 쓰던 원단이에요',
    },
  );
  const second = await makeImage(fabric.fabric_id, { sort_order: 1, image_type: 'ZOOM' });
  const first = await makeImage(fabric.fabric_id, { sort_order: 0, image_type: 'FULL' });

  const { status, json } = await call('GET', `/fabrics/${fabric.fabric_id}`);
  assert.equal(status, 200);
  assert.equal(json.success, true);
  const data = json.data;
  assert.deepEqual(Object.keys(data).sort(), DETAIL_KEYS);
  assert.deepEqual(Object.keys(data.detail).sort(), DETAIL_INNER_KEYS);
  assert.deepEqual(Object.keys(data.store).sort(), STORE_KEYS);
  assert.deepEqual(Object.keys(data.availability).sort(), AVAILABILITY_KEYS);
  assert.deepEqual(
    { fabricId: data.fabricId, title: data.title, sale_type: data.sale_type, price: data.price, status: data.status },
    { fabricId: fabric.fabric_id, title: '네이비 면 20수', sale_type: 'SCRAP', price: 3500, status: 'POSTED' },
  );
  assert.deepEqual(data.detail, {
    material: 'COTTON',
    thickness: 'NORMAL',
    color_family: 'NAVY',
    color_detail: '짙은 남색(네이비)',
    width_cm: 150,
    length_cm: 65,
    has_defect: true,
    defect_note: '오른쪽 아래 얼룩 3cm',
    blend_ratio: null,
    weave: null,
    grain_direction: null,
    description: '앞치마용으로 쓰던 원단이에요',
    sheet_count: null,
  });
  assert.deepEqual(data.store, {
    storeId: store.store_id,
    store_name: '양주원단상회',
    store_address: '경기도 양주시 어딘가로 12',
    store_phone: '031-123-4567',
    closed_days: '매주 일요일, 공휴일',
    pickup_guide: '평일 10~18시, 1층 카운터에서 말씀해 주세요',
  });
  assert.deepEqual(data.images.map((image) => image.imageId), [first.image_id, second.image_id]);
  assert.deepEqual(Object.keys(data.images[0]).sort(), IMAGE_KEYS);
  assert.deepEqual(data.images.map((image) => [image.sort_order, image.image_type]), [[0, 'FULL'], [1, 'ZOOM']]);
  assert.deepEqual(data.availability, { is_reserved: false, available_length_cm: null, reserved_length_cm: null, available_sheet_count: 1, reserved_sheet_count: 0 });
  assert.match(data.created_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+09:00$/);
  // 구매자(로그인)에게도 판매자 전용 항목은 키 자체가 없다.
  assert.equal('reject_reason' in data, false);
  assert.equal('remaining_length_cm' in data, false);
});

test('원단 상세: 사진이 없으면 images 는 빈 배열이고, 선택 항목은 null 이다', async () => {
  const { store } = await makeStore();
  const fabric = await makeListed(store.store_id);
  const { json } = await call('GET', `/fabrics/${fabric.fabric_id}`);
  assert.deepEqual(json.data.images, []);
  assert.equal(json.data.detail.color_detail, null);
  assert.equal(json.data.detail.description, null);
});

test('availability: 자투리는 수락된 예약이 있을 때만 is_reserved true 이고, 롤은 구매 가능 길이와 확보 길이를 준다', async () => {
  const { store, seller } = await makeStore();
  const buyer = await makeUser();
  const scrap = await makeListed(store.store_id);
  const requestedOnly = await makeListed(store.store_id);
  const roll = await makeListed(
    store.store_id,
    { sale_type: 'ROLL', remaining_length_cm: 900, reserved_length_cm: 180 },
    { width_cm: 110 },
  );
  const reserve = (fabric, status, requested_length_cm = null) =>
    db.Reservation.create({
      fabric_id: fabric.fabric_id,
      buyer_id: buyer.user_id,
      seller_id: seller.user_id,
      requested_length_cm,
      pickup_at: new Date('2026-10-20T10:00:00+09:00'),
      status,
    });
  await reserve(scrap, 'ACCEPTED');
  await reserve(requestedOnly, 'REQUESTED');
  await reserve(roll, 'ACCEPTED', 180);

  const availability = async (fabric) => (await call('GET', `/fabrics/${fabric.fabric_id}`)).json.data.availability;
  assert.deepEqual(await availability(scrap), { is_reserved: true, available_length_cm: null, reserved_length_cm: null, available_sheet_count: 0, reserved_sheet_count: 1 });
  assert.deepEqual(await availability(requestedOnly), { is_reserved: false, available_length_cm: null, reserved_length_cm: null, available_sheet_count: 1, reserved_sheet_count: 0 });
  assert.deepEqual(await availability(roll), { is_reserved: false, available_length_cm: 720, reserved_length_cm: 180, available_sheet_count: null, reserved_sheet_count: null });
  const rollDetail = (await call('GET', `/fabrics/${roll.fabric_id}`)).json.data;
  assert.equal(rollDetail.detail.length_cm, null);
});

test('판매자 본인과 운영팀은 reject_reason, remaining_length_cm 도 받는다', async () => {
  const { store, seller } = await makeStore();
  const admin = await makeUser({ role: 'ADMIN' });
  const scrap = await makeListed(store.store_id);
  const roll = await makeListed(
    store.store_id,
    { sale_type: 'ROLL', remaining_length_cm: 900, reserved_length_cm: 180 },
    { width_cm: 110 },
  );
  const rejected = await makeListed(store.store_id, { status: 'REJECTED', reject_reason: '사진이 흐려요' });

  for (const token of [signToken(seller), signToken(admin)]) {
    const scrapData = (await call('GET', `/fabrics/${scrap.fabric_id}`, { token })).json.data;
    assert.equal(scrapData.reject_reason, null);
    assert.equal(scrapData.remaining_length_cm, null);
    const rollData = (await call('GET', `/fabrics/${roll.fabric_id}`, { token })).json.data;
    assert.equal(rollData.remaining_length_cm, 900);
    const rejectedData = (await call('GET', `/fabrics/${rejected.fabric_id}`, { token })).json.data;
    assert.equal(rejectedData.reject_reason, '사진이 흐려요');
    assert.equal(rejectedData.status, 'REJECTED');
  }
});

test('게시 중이 아닌 원단: 비로그인·구매자·다른 판매자는 404, 그 원단의 판매자와 운영팀은 볼 수 있다', async () => {
  const { store, seller } = await makeStore();
  const { seller: otherSeller } = await makeStore();
  const buyer = await makeUser();
  const admin = await makeUser({ role: 'ADMIN' });

  for (const status of ['PENDING', 'REJECTED', 'SOLD_OUT']) {
    const fabric = await makeListed(
      store.store_id,
      { status, ...(status === 'REJECTED' && { reject_reason: '사유' }) },
    );
    const path = `/fabrics/${fabric.fabric_id}`;
    for (const token of [undefined, signToken(buyer), signToken(otherSeller)]) {
      const { status: code, json } = await call('GET', path, { token });
      assert.equal(code, 404, `${status}`);
      assert.equal(json.error.code, 'NOT_FOUND');
    }
    for (const token of [signToken(seller), signToken(admin)]) {
      const { status: code, json } = await call('GET', path, { token });
      assert.equal(code, 200, `${status}`);
      assert.equal(json.data.status, status);
    }
  }
});

test('삭제된 원단과 없는 원단은 누구에게나 404 이다 (판매자·운영팀 포함)', async () => {
  const { store, seller } = await makeStore();
  const admin = await makeUser({ role: 'ADMIN' });
  const deleted = await makeListed(store.store_id);
  await deleted.destroy();

  for (const token of [undefined, signToken(await makeUser()), signToken(seller), signToken(admin)]) {
    for (const id of [deleted.fabric_id, 999999]) {
      const { status, json } = await call('GET', `/fabrics/${id}`, { token });
      assert.equal(status, 404);
      assert.equal(json.error.code, 'NOT_FOUND');
    }
  }
});

test('원단상세가 없는 원단은 500 이 아니라 404 이고, 목록에도 나오지 않는다', async () => {
  const { store, seller } = await makeStore();
  const noDetail = await makeFabric(store.store_id, { status: 'POSTED' });
  for (const token of [undefined, signToken(seller)]) {
    const { status, json } = await call('GET', `/fabrics/${noDetail.fabric_id}`, { token });
    assert.equal(status, 404);
    assert.equal(json.error.code, 'NOT_FOUND');
  }
  assert.deepEqual(ids((await call('GET', '/fabrics')).json), []);
});

test('원단 상세 입력 오류: 숫자가 아니거나 1 보다 작은 번호는 400 VALIDATION_ERROR', async () => {
  for (const id of ['abc', '0', '-1', '1.5']) {
    const { status, json } = await call('GET', `/fabrics/${id}`);
    assert.equal(status, 400, id);
    assert.equal(json.error.code, 'VALIDATION_ERROR');
    assert.ok(json.error.details.some((d) => d.field === 'fabricId' && d.message), JSON.stringify(json.error.details));
  }
});

test('원단 상세: 공개 API 라도 잘못된 토큰이면 401 (명세서 2.3)', async () => {
  const { store } = await makeStore();
  const fabric = await makeListed(store.store_id);
  const expired = jwt.sign({ role: 'BUYER' }, env.jwtSecret, { subject: '1', expiresIn: -10 });
  for (const token of ['garbage', expired]) {
    const { status, json } = await call('GET', `/fabrics/${fabric.fabric_id}`, { token });
    assert.equal(status, 401);
    assert.equal(json.error.code, 'UNAUTHORIZED');
  }
});

// ---- 14. 내 원단 목록 조회

const MINE_KEYS = [...ITEM_KEYS, 'active_reservation_count', 'reject_reason', 'status'].sort();
const minePath = (query = {}) => `/sellers/me/fabrics?${new URLSearchParams(query)}`;

test('내 원단 목록 성공: 상태와 관계없이 내 원단이 모두 나오고, 항목은 명세서 그대로, 최근 등록한 것이 먼저', async () => {
  const { store, seller } = await makeStore({ store_name: '양주원단상회' });
  const posted = await makeListed(store.store_id, { title: '게시 중' });
  const pending = await makeListed(store.store_id, { title: '게시 대기', status: 'PENDING' });
  const rejected = await makeListed(
    store.store_id,
    { title: '반려될 원단', price: 3000, status: 'REJECTED', reject_reason: '하자 사진이 필요해요' },
    { has_defect: true, defect_note: '모서리 얼룩' },
  );
  const soldOut = await makeListed(store.store_id, { title: '판매 완료', status: 'SOLD_OUT' });

  const { status, json } = await call('GET', minePath(), { token: signToken(seller) });
  assert.equal(status, 200);
  assert.deepEqual(Object.keys(json.data).sort(), PAGE_KEYS);
  assert.deepEqual(json.data.content.map((item) => item.fabricId), [soldOut, rejected, pending, posted].map((f) => f.fabric_id));
  assert.equal(json.data.totalElements, 4);
  assert.deepEqual(Object.keys(json.data.content[0]).sort(), MINE_KEYS);

  const item = json.data.content.find((x) => x.fabricId === rejected.fabric_id);
  assert.deepEqual(item, {
    fabricId: rejected.fabric_id,
    title: '반려될 원단',
    sale_type: 'SCRAP',
    price: 3000,
    material: 'COTTON',
    thickness: 'NORMAL',
    color_family: 'NAVY',
    width_cm: 150,
    length_cm: 65,
    available_length_cm: null,
    is_reserved: false,
    has_defect: true,
    thumbnail_url: null,
    store_name: '양주원단상회',
    status: 'REJECTED',
    reject_reason: '하자 사진이 필요해요',
    active_reservation_count: 0,
  });
  // 반려가 아닌 원단의 reject_reason 은 키는 있고 값은 null 이다.
  const other = json.data.content.find((x) => x.fabricId === posted.fabric_id);
  assert.equal(other.reject_reason, null);
});

test('내 원단 목록: 자투리·롤 모두 나오고, 롤은 구매 가능 길이를 주고, 대표 사진 썸네일이 나온다', async () => {
  const { store, seller } = await makeStore();
  const scrap = await makeListed(store.store_id);
  const roll = await makeListed(
    store.store_id,
    { sale_type: 'ROLL', remaining_length_cm: 900, reserved_length_cm: 180 },
    { width_cm: 110 },
  );
  await makeImage(scrap.fabric_id, { sort_order: 1, thumbnail_url: 'https://example.com/t1.webp' });
  await makeImage(scrap.fabric_id, { sort_order: 0, thumbnail_url: 'https://example.com/t0.webp' });

  const { json } = await call('GET', minePath(), { token: signToken(seller) });
  const byId = Object.fromEntries(json.data.content.map((item) => [item.fabricId, item]));
  assert.equal(byId[scrap.fabric_id].thumbnail_url, 'https://example.com/t0.webp');
  assert.equal(byId[scrap.fabric_id].available_length_cm, null);
  assert.equal(byId[roll.fabric_id].sale_type, 'ROLL');
  assert.equal(byId[roll.fabric_id].length_cm, null);
  assert.equal(byId[roll.fabric_id].available_length_cm, 720);
  assert.equal(json.data.totalElements, 2);
});

test('active_reservation_count: 요청됨·수락됨 예약만 세고, is_reserved 는 수락된 자투리만 true', async () => {
  const { store, seller } = await makeStore();
  const buyer = await makeUser();
  const acceptedBuyer = await makeUser(); // 같은 원단의 활성 예약 2건은 서로 다른 구매자다.
  const busy = await makeListed(store.store_id, { title: '요청 1 수락 1 거절 1 수령 1' });
  const requestedOnly = await makeListed(store.store_id, { title: '요청만 1' });
  const none = await makeListed(store.store_id, { title: '예약 없음' });
  const roll = await makeListed(
    store.store_id,
    { title: '롤', sale_type: 'ROLL', remaining_length_cm: 900, reserved_length_cm: 90 },
    { width_cm: 110 },
  );
  // DB 제약: 거절은 reject_reason, 취소는 canceled_by 가 꼭 있어야 한다.
  const reserve = (fabric, status, requested_length_cm = null) =>
    db.Reservation.create({
      fabric_id: fabric.fabric_id,
      buyer_id: status === 'ACCEPTED' ? acceptedBuyer.user_id : buyer.user_id,
      seller_id: seller.user_id,
      requested_length_cm,
      pickup_at: new Date('2026-10-20T10:00:00+09:00'),
      status,
      ...(status === 'REJECTED' && { reject_reason: '재고가 없어요' }),
      ...(status === 'CANCELED' && { canceled_by: 'BUYER' }),
    });
  for (const status of ['REQUESTED', 'ACCEPTED', 'REJECTED', 'PICKED_UP', 'CANCELED']) await reserve(busy, status);
  await reserve(requestedOnly, 'REQUESTED');
  await reserve(roll, 'REQUESTED', 90);
  await reserve(roll, 'ACCEPTED', 90);

  const { json } = await call('GET', minePath(), { token: signToken(seller) });
  const byId = Object.fromEntries(json.data.content.map((item) => [item.fabricId, item]));
  assert.deepEqual(
    [busy, requestedOnly, none, roll].map((f) => [byId[f.fabric_id].active_reservation_count, byId[f.fabric_id].is_reserved]),
    [[2, true], [1, false], [0, false], [2, false]],
  );
  assert.equal(json.data.totalElements, 4);
});

test('내 원단 목록 status: 그 상태의 원단만 나온다', async () => {
  const { store, seller } = await makeStore();
  const posted = await makeListed(store.store_id);
  const pending = await makeListed(store.store_id, { status: 'PENDING' });
  const rejected = await makeListed(store.store_id, { status: 'REJECTED', reject_reason: '사유' });
  const soldOut = await makeListed(store.store_id, { status: 'SOLD_OUT' });

  const token = signToken(seller);
  const only = async (status) => ids((await call('GET', minePath({ status }), { token })).json);
  assert.deepEqual(await only('POSTED'), [posted.fabric_id]);
  assert.deepEqual(await only('PENDING'), [pending.fabric_id]);
  assert.deepEqual(await only('REJECTED'), [rejected.fabric_id]);
  assert.deepEqual(await only('SOLD_OUT'), [soldOut.fabric_id]);
});

test('내 원단 목록은 내 매장의 원단만 보여 주고, 삭제된 원단은 나오지 않는다', async () => {
  const { store, seller } = await makeStore();
  const { store: otherStore } = await makeStore();
  const mine = await makeListed(store.store_id, { title: '내 원단' });
  await makeListed(otherStore.store_id, { title: '남의 원단' });
  const deleted = await makeListed(store.store_id, { title: '삭제한 원단' });
  await deleted.destroy();

  const { json } = await call('GET', minePath(), { token: signToken(seller) });
  assert.deepEqual(ids(json), [mine.fabric_id]);
  assert.equal(json.data.totalElements, 1);
});

test('매장을 아직 등록하지 않은 판매자는 빈 목록이다', async () => {
  const seller = await makeUser({ role: 'SELLER', seller_approval_status: 'APPROVED' });
  const { status, json } = await call('GET', minePath(), { token: signToken(seller) });
  assert.equal(status, 200);
  assert.deepEqual(json.data, { content: [], page: 0, size: 20, totalElements: 0, totalPages: 0 });
});

test('승인 전·반려된 판매자도 403 이 아니라 200 이고, 내 매장 원단이 나온다', async () => {
  const { store, seller } = await makeStore();
  const fabric = await makeListed(store.store_id);
  for (const approval of ['PENDING', 'REJECTED']) {
    await seller.update({ seller_approval_status: approval });
    const { status, json } = await call('GET', minePath(), { token: signToken(seller) });
    assert.equal(status, 200, approval);
    assert.deepEqual(ids(json), [fabric.fabric_id]);
  }
});

test('내 원단 목록 페이지 나누기: page·size 와 범위 밖 페이지', async () => {
  const { store, seller } = await makeStore();
  const made = [];
  for (let i = 0; i < 5; i += 1) made.push(await makeListed(store.store_id));
  const newestFirst = made.map((f) => f.fabric_id).reverse();

  const token = signToken(seller);
  const first = (await call('GET', minePath({ page: 0, size: 2 }), { token })).json.data;
  assert.deepEqual(first.content.map((item) => item.fabricId), newestFirst.slice(0, 2));
  assert.equal(first.totalElements, 5);
  assert.equal(first.totalPages, 3);
  const last = (await call('GET', minePath({ page: 2, size: 2 }), { token })).json.data;
  assert.deepEqual(last.content.map((item) => item.fabricId), newestFirst.slice(4));
  const outside = (await call('GET', minePath({ page: 3, size: 2 }), { token })).json.data;
  assert.deepEqual(outside.content, []);
  assert.equal(outside.totalElements, 5);
});

test('내 원단 목록 권한: 로그인 안 함·잘못된 토큰·만료된 토큰은 401, 구매자·운영팀은 403', async () => {
  const expired = jwt.sign({ role: 'SELLER' }, env.jwtSecret, { subject: '1', expiresIn: -10 });
  for (const token of [undefined, 'garbage', expired]) {
    const { status, json } = await call('GET', minePath(), { token });
    assert.equal(status, 401);
    assert.equal(json.error.code, 'UNAUTHORIZED');
  }
  for (const role of ['BUYER', 'ADMIN']) {
    const { status, json } = await call('GET', minePath(), { token: signToken(await makeUser({ role })) });
    assert.equal(status, 403, role);
    assert.equal(json.error.code, 'FORBIDDEN');
  }
});

test('내 원단 목록 입력 오류: VALIDATION_ERROR 와 항목별 details', async () => {
  const { seller } = await makeStore();
  const token = signToken(seller);
  for (const [field, query] of [
    ['status', { status: 'ARCHIVED' }],
    ['status', { status: 'posted' }],
    ['status', { status: '' }],
    ['page', { page: -1 }],
    ['page', { page: 'abc' }],
    ['size', { size: 0 }],
    ['size', { size: 51 }],
  ]) {
    const { status, json } = await call('GET', minePath(query), { token });
    assert.equal(status, 400, JSON.stringify(query));
    assert.equal(json.error.code, 'VALIDATION_ERROR');
    assert.ok(json.error.details.some((d) => d.field === field && d.message), `${field}: ${JSON.stringify(json.error.details)}`);
  }
});
