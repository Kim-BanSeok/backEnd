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

// 게시 중인 원단. 상태를 바꿔 만들려면 { status } 를 넘긴다.
async function makePostedFabric(overrides = {}) {
  const { store } = await makeStore();
  return makeFabric(store.store_id, { status: 'POSTED', ...overrides });
}

// 도안은 helpers.js 에 도우미가 없어서 여기서 만든다.
const makePattern = (overrides = {}) =>
  db.Pattern.create({
    pattern_name: '에코백',
    allowed_materials: ['COTTON'],
    allowed_thickness: ['NORMAL'],
    ...overrides,
  });

const NOT_FOUND = { code: 'NOT_FOUND', message: '찾을 수 없어요' };

// ---- 39. 관심저장 추가

test('원단 관심저장 성공: 201 { favoriteId } 와 DB 저장', async () => {
  const fabric = await makePostedFabric();
  const user = await makeUser();
  const token = signToken(user);

  const { status, json } = await call('POST', '/favorites', {
    token,
    body: { target_type: 'FABRIC', fabric_id: fabric.fabric_id },
  });
  assert.equal(status, 201);
  assert.deepEqual(json, { success: true, data: { favoriteId: json.data.favoriteId } });
  assert.equal(typeof json.data.favoriteId, 'number');

  const saved = await db.Favorite.findByPk(json.data.favoriteId);
  assert.equal(saved.user_id, user.user_id);
  assert.equal(saved.target_type, 'FABRIC');
  assert.equal(saved.fabric_id, fabric.fabric_id);
  assert.equal(saved.pattern_id, null);
});

test('도안 관심저장 성공: 201 { favoriteId } 와 DB 저장', async () => {
  const pattern = await makePattern();
  const user = await makeUser();

  const { status, json } = await call('POST', '/favorites', {
    token: signToken(user),
    body: { target_type: 'PATTERN', pattern_id: pattern.pattern_id },
  });
  assert.equal(status, 201);
  assert.deepEqual(Object.keys(json.data), ['favoriteId']);

  const saved = await db.Favorite.findByPk(json.data.favoriteId);
  assert.equal(saved.user_id, user.user_id);
  assert.equal(saved.target_type, 'PATTERN');
  assert.equal(saved.pattern_id, pattern.pattern_id);
  assert.equal(saved.fabric_id, null);
});

test('로그인한 사용자는 역할에 상관없이 저장할 수 있다', async () => {
  const fabric = await makePostedFabric();
  for (const role of ['BUYER', 'SELLER', 'ADMIN']) {
    const { status } = await call('POST', '/favorites', {
      token: await tokenOf(role),
      body: { target_type: 'FABRIC', fabric_id: fabric.fabric_id },
    });
    assert.equal(status, 201, role);
  }
});

test('다른 사용자는 같은 대상을 따로 저장할 수 있다', async () => {
  const pattern = await makePattern();
  const body = { target_type: 'PATTERN', pattern_id: pattern.pattern_id };
  const first = await call('POST', '/favorites', { token: await tokenOf(), body });
  const second = await call('POST', '/favorites', { token: await tokenOf(), body });
  assert.equal(first.status, 201);
  assert.equal(second.status, 201);
  assert.notEqual(first.json.data.favoriteId, second.json.data.favoriteId);
});

test('관심저장 권한: 토큰 없음, 잘못된 토큰, 만료된 토큰은 401 UNAUTHORIZED', async () => {
  const fabric = await makePostedFabric();
  const body = { target_type: 'FABRIC', fabric_id: fabric.fabric_id };
  const expired = jwt.sign({ role: 'BUYER' }, env.jwtSecret, { subject: '1', expiresIn: -10 });
  for (const token of [undefined, 'garbage', expired]) {
    const { status, json } = await call('POST', '/favorites', { token, body });
    assert.equal(status, 401);
    assert.equal(json.error.code, 'UNAUTHORIZED');
  }
  assert.equal(await db.Favorite.count(), 0);
});

test('관심저장 입력 오류: VALIDATION_ERROR 와 항목별 details', async () => {
  const fabric = await makePostedFabric();
  const pattern = await makePattern();
  const token = await tokenOf();
  const f = fabric.fabric_id;
  const p = pattern.pattern_id;

  for (const [field, body] of [
    ['target_type', {}],
    ['target_type', { fabric_id: f }],
    ['target_type', { target_type: 'STORE', fabric_id: f }],
    ['target_type', { target_type: 'fabric', fabric_id: f }],
    ['fabric_id', { target_type: 'FABRIC' }],
    ['pattern_id', { target_type: 'FABRIC', fabric_id: f, pattern_id: p }],
    ['pattern_id', { target_type: 'PATTERN' }],
    ['fabric_id', { target_type: 'PATTERN', pattern_id: p, fabric_id: f }],
    ['fabric_id', { target_type: 'FABRIC', fabric_id: String(f) }],
    ['fabric_id', { target_type: 'FABRIC', fabric_id: 0 }],
    ['fabric_id', { target_type: 'FABRIC', fabric_id: -1 }],
    ['fabric_id', { target_type: 'FABRIC', fabric_id: 1.5 }],
    ['pattern_id', { target_type: 'PATTERN', pattern_id: null }],
  ]) {
    const { status, json } = await call('POST', '/favorites', { token, body });
    assert.equal(status, 400, JSON.stringify(body));
    assert.equal(json.error.code, 'VALIDATION_ERROR');
    assert.ok(
      json.error.details.some((d) => d.field === field && d.message),
      `${field}: ${JSON.stringify(body)} → ${JSON.stringify(json.error.details)}`,
    );
  }
  assert.equal(await db.Favorite.count(), 0);
});

test('관심저장 입력 오류: 깨진 요청 본문도 VALIDATION_ERROR', async () => {
  const token = await tokenOf();
  const res = await fetch(`${base}/favorites`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: '[]',
  });
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error.code, 'VALIDATION_ERROR');
});

test('게시 중이 아닌 원단과 없는 원단은 404 NOT_FOUND 이고 저장되지 않는다', async () => {
  const pending = await makePostedFabric({ status: 'PENDING' });
  const soldOut = await makePostedFabric({ status: 'SOLD_OUT' });
  const deleted = await makePostedFabric();
  await deleted.destroy();
  const token = await tokenOf();

  for (const id of [pending.fabric_id, soldOut.fabric_id, deleted.fabric_id, 99999]) {
    const { status, json } = await call('POST', '/favorites', {
      token,
      body: { target_type: 'FABRIC', fabric_id: id },
    });
    assert.equal(status, 404, `fabric ${id}`);
    assert.deepEqual(json, { success: false, error: NOT_FOUND });
  }
  assert.equal(await db.Favorite.count(), 0);
});

test('사용 중이 아닌 도안과 없는 도안은 404 NOT_FOUND 이고 저장되지 않는다', async () => {
  const inactive = await makePattern({ is_active: false });
  const token = await tokenOf();

  for (const id of [inactive.pattern_id, 99999]) {
    const { status, json } = await call('POST', '/favorites', {
      token,
      body: { target_type: 'PATTERN', pattern_id: id },
    });
    assert.equal(status, 404, `pattern ${id}`);
    assert.deepEqual(json, { success: false, error: NOT_FOUND });
  }
  assert.equal(await db.Favorite.count(), 0);
});

test('같은 원단을 두 번 저장하면 409 FAVORITE_DUPLICATED', async () => {
  const fabric = await makePostedFabric();
  const token = await tokenOf();
  const body = { target_type: 'FABRIC', fabric_id: fabric.fabric_id };

  assert.equal((await call('POST', '/favorites', { token, body })).status, 201);
  const { status, json } = await call('POST', '/favorites', { token, body });
  assert.equal(status, 409);
  assert.deepEqual(json, {
    success: false,
    error: { code: 'FAVORITE_DUPLICATED', message: '이미 관심 목록에 있어요' },
  });
  assert.equal(await db.Favorite.count(), 1);
});

test('같은 도안을 두 번 저장하면 409 FAVORITE_DUPLICATED', async () => {
  const pattern = await makePattern();
  const token = await tokenOf();
  const body = { target_type: 'PATTERN', pattern_id: pattern.pattern_id };

  assert.equal((await call('POST', '/favorites', { token, body })).status, 201);
  const { status, json } = await call('POST', '/favorites', { token, body });
  assert.equal(status, 409);
  assert.equal(json.error.code, 'FAVORITE_DUPLICATED');
  assert.equal(await db.Favorite.count(), 1);
});

test('동시에 여러 번 저장해도 한 건만 생긴다', async () => {
  const fabric = await makePostedFabric();
  const token = await tokenOf();
  const body = { target_type: 'FABRIC', fabric_id: fabric.fabric_id };

  const results = await Promise.all(Array.from({ length: 5 }, () => call('POST', '/favorites', { token, body })));
  assert.equal(results.filter((r) => r.status === 201).length, 1);
  assert.ok(results.filter((r) => r.status !== 201).every((r) => r.json.error.code === 'FAVORITE_DUPLICATED'));
  assert.equal(await db.Favorite.count(), 1);
});

// ---- 40. 내 관심 목록

// 관심저장을 DB 에 바로 만든다. (저장 API 는 39번 테스트에서 따로 확인한다)
const saveFabric = (userId, fabricId) =>
  db.Favorite.create({ user_id: userId, target_type: 'FABRIC', fabric_id: fabricId });
const savePattern = (userId, patternId) =>
  db.Favorite.create({ user_id: userId, target_type: 'PATTERN', pattern_id: patternId });

const listPath = (query = {}) => `/favorites/me?${new URLSearchParams(query)}`;
const FABRIC_ITEM_KEYS = [
  'created_at', 'fabricId', 'fabric_status', 'favoriteId', 'is_deleted', 'price', 'sale_type',
  'target_type', 'thumbnail_url', 'title',
];
const PATTERN_ITEM_KEYS = [
  'category', 'created_at', 'favoriteId', 'image_url', 'is_active', 'patternId', 'pattern_name', 'target_type',
];
const PAGE_KEYS = ['content', 'page', 'size', 'totalElements', 'totalPages'];

test('내 관심 목록 성공: 원단·도안 항목이 명세서 모양이고 최근에 저장한 것이 먼저', async () => {
  const user = await makeUser();
  const fabric = await makePostedFabric({ title: '네이비 면 20수', price: 3500 });
  await db.FabricImage.create({
    fabric_id: fabric.fabric_id, image_url: 'https://example.com/b.png', thumbnail_url: 'https://example.com/thumbs/b.webp', sort_order: 1,
  });
  await db.FabricImage.create({
    fabric_id: fabric.fabric_id, image_url: 'https://example.com/a.png', thumbnail_url: 'https://example.com/thumbs/a.webp', sort_order: 0,
  });
  const pattern = await makePattern({ pattern_name: '에코백', category: '가방', image_url: 'https://example.com/eco.png' });
  const first = await saveFabric(user.user_id, fabric.fabric_id);
  const second = await savePattern(user.user_id, pattern.pattern_id);

  const { status, json } = await call('GET', '/favorites/me', { token: signToken(user) });
  assert.equal(status, 200);
  assert.deepEqual(Object.keys(json.data).sort(), PAGE_KEYS);
  assert.deepEqual({ page: json.data.page, size: json.data.size, totalElements: json.data.totalElements, totalPages: json.data.totalPages },
    { page: 0, size: 20, totalElements: 2, totalPages: 1 });
  assert.deepEqual(json.data.content.map((i) => i.favoriteId), [second.favorite_id, first.favorite_id]);

  const [patternItem, fabricItem] = json.data.content;
  assert.deepEqual(Object.keys(patternItem).sort(), PATTERN_ITEM_KEYS);
  assert.deepEqual(patternItem, {
    favoriteId: second.favorite_id,
    target_type: 'PATTERN',
    created_at: patternItem.created_at,
    patternId: pattern.pattern_id,
    pattern_name: '에코백',
    category: '가방',
    image_url: 'https://example.com/eco.png',
    is_active: true,
  });
  assert.deepEqual(Object.keys(fabricItem).sort(), FABRIC_ITEM_KEYS);
  assert.deepEqual(fabricItem, {
    favoriteId: first.favorite_id,
    target_type: 'FABRIC',
    created_at: fabricItem.created_at,
    fabricId: fabric.fabric_id,
    title: '네이비 면 20수',
    sale_type: 'SCRAP',
    price: 3500,
    thumbnail_url: 'https://example.com/thumbs/a.webp',
    fabric_status: 'POSTED',
    is_deleted: false,
  });
  assert.match(fabricItem.created_at, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\+09:00$/);
});

test('내 관심 목록: 사진이 없으면 thumbnail_url 은 null, 저장한 것이 없으면 빈 목록', async () => {
  const user = await makeUser();
  const token = signToken(user);
  const empty = await call('GET', '/favorites/me', { token });
  assert.deepEqual(empty.json.data, { content: [], page: 0, size: 20, totalElements: 0, totalPages: 0 });

  const fabric = await makePostedFabric();
  await saveFabric(user.user_id, fabric.fabric_id);
  const { json } = await call('GET', '/favorites/me', { token });
  assert.equal(json.data.content[0].thumbnail_url, null);
});

test('내 관심 목록: 판매 완료·삭제된 원단과 사용 중이 아닌 도안도 남고 상태로 알린다', async () => {
  const user = await makeUser();
  const soldOut = await makePostedFabric({ title: '판매 완료 원단' });
  const deleted = await makePostedFabric({ title: '삭제된 원단' });
  const inactive = await makePattern({ pattern_name: '내려간 도안' });
  await saveFabric(user.user_id, soldOut.fabric_id);
  await saveFabric(user.user_id, deleted.fabric_id);
  await savePattern(user.user_id, inactive.pattern_id);
  await soldOut.update({ status: 'SOLD_OUT' });
  await deleted.destroy();
  await inactive.update({ is_active: false });

  const { json } = await call('GET', '/favorites/me', { token: signToken(user) });
  assert.equal(json.data.totalElements, 3);
  const byTitle = Object.fromEntries(json.data.content.map((i) => [i.title ?? i.pattern_name, i]));
  assert.equal(byTitle['판매 완료 원단'].fabric_status, 'SOLD_OUT');
  assert.equal(byTitle['판매 완료 원단'].is_deleted, false);
  assert.equal(byTitle['삭제된 원단'].is_deleted, true);
  assert.equal(byTitle['삭제된 원단'].title, '삭제된 원단');
  assert.equal(byTitle['내려간 도안'].is_active, false);
});

test('내 관심 목록: target_type 으로 원단 또는 도안만 보고, 내 것만 보인다', async () => {
  const me = await makeUser();
  const other = await makeUser();
  const fabric = await makePostedFabric();
  const pattern = await makePattern();
  const mine1 = await saveFabric(me.user_id, fabric.fabric_id);
  const mine2 = await savePattern(me.user_id, pattern.pattern_id);
  await saveFabric(other.user_id, fabric.fabric_id);
  const token = signToken(me);

  const fabrics = await call('GET', listPath({ target_type: 'FABRIC' }), { token });
  assert.deepEqual(fabrics.json.data.content.map((i) => i.favoriteId), [mine1.favorite_id]);
  const patterns = await call('GET', listPath({ target_type: 'PATTERN' }), { token });
  assert.deepEqual(patterns.json.data.content.map((i) => i.favoriteId), [mine2.favorite_id]);
  const all = await call('GET', '/favorites/me', { token });
  assert.equal(all.json.data.totalElements, 2);
});

test('내 관심 목록 페이지 나누기: page·size 와 범위 밖 페이지', async () => {
  const user = await makeUser();
  const ids = [];
  for (let i = 0; i < 5; i += 1) {
    const pattern = await makePattern({ pattern_name: `도안${i}` });
    ids.push((await savePattern(user.user_id, pattern.pattern_id)).favorite_id);
  }
  const token = signToken(user);

  const second = await call('GET', listPath({ page: 1, size: 2 }), { token });
  assert.deepEqual(second.json.data.content.map((i) => i.favoriteId), [ids[2], ids[1]]);
  assert.equal(second.json.data.totalElements, 5);
  assert.equal(second.json.data.totalPages, 3);

  const beyond = await call('GET', listPath({ page: 9, size: 2 }), { token });
  assert.deepEqual(beyond.json.data.content, []);
});

test('내 관심 목록 권한: 토큰 없음, 잘못된 토큰, 만료된 토큰은 401', async () => {
  const expired = jwt.sign({ role: 'BUYER' }, env.jwtSecret, { subject: '1', expiresIn: -10 });
  for (const token of [undefined, 'garbage', expired]) {
    const { status, json } = await call('GET', '/favorites/me', { token });
    assert.equal(status, 401);
    assert.equal(json.error.code, 'UNAUTHORIZED');
  }
});

test('내 관심 목록 입력 오류: VALIDATION_ERROR 와 항목별 details', async () => {
  const token = await tokenOf();
  for (const [field, query] of [
    ['target_type', { target_type: 'STORE' }],
    ['target_type', { target_type: 'fabric' }],
    ['target_type', { target_type: '' }],
    ['page', { page: -1 }],
    ['page', { page: 'abc' }],
    ['page', { page: 1.5 }],
    ['size', { size: 0 }],
    ['size', { size: 51 }],
  ]) {
    const { status, json } = await call('GET', listPath(query), { token });
    assert.equal(status, 400, JSON.stringify(query));
    assert.equal(json.error.code, 'VALIDATION_ERROR');
    assert.ok(json.error.details.some((d) => d.field === field && d.message), `${field}: ${JSON.stringify(json.error.details)}`);
  }
});

// ---- 41. 관심저장 삭제

test('관심저장 삭제 성공: 200 data null, 내 것만 지워지고 다시 저장할 수 있다', async () => {
  const user = await makeUser();
  const fabric = await makePostedFabric();
  const pattern = await makePattern();
  const target = await saveFabric(user.user_id, fabric.fabric_id);
  const kept = await savePattern(user.user_id, pattern.pattern_id);
  const token = signToken(user);

  const { status, json } = await call('DELETE', `/favorites/${target.favorite_id}`, { token });
  assert.equal(status, 200);
  assert.deepEqual(json, { success: true, data: null });
  assert.equal(await db.Favorite.findByPk(target.favorite_id), null);
  assert.ok(await db.Favorite.findByPk(kept.favorite_id));

  const again = await call('POST', '/favorites', { token, body: { target_type: 'FABRIC', fabric_id: fabric.fabric_id } });
  assert.equal(again.status, 201);
});

test('관심저장 삭제 권한: 토큰 없음, 잘못된 토큰, 만료된 토큰은 401', async () => {
  const saved = await saveFabric((await makeUser()).user_id, (await makePostedFabric()).fabric_id);
  const expired = jwt.sign({ role: 'BUYER' }, env.jwtSecret, { subject: '1', expiresIn: -10 });
  for (const token of [undefined, 'garbage', expired]) {
    const { status, json } = await call('DELETE', `/favorites/${saved.favorite_id}`, { token });
    assert.equal(status, 401);
    assert.equal(json.error.code, 'UNAUTHORIZED');
  }
  assert.ok(await db.Favorite.findByPk(saved.favorite_id));
});

test('남의 관심저장은 지울 수 없다: 403 FORBIDDEN 이고 그대로 남는다', async () => {
  const owner = await makeUser();
  const saved = await saveFabric(owner.user_id, (await makePostedFabric()).fabric_id);
  for (const role of ['BUYER', 'SELLER', 'ADMIN']) {
    const { status, json } = await call('DELETE', `/favorites/${saved.favorite_id}`, { token: await tokenOf(role) });
    assert.equal(status, 403, role);
    assert.deepEqual(json, { success: false, error: { code: 'FORBIDDEN', message: '권한이 없어요' } });
  }
  assert.ok(await db.Favorite.findByPk(saved.favorite_id));
});

test('관심저장 삭제 오류: 없는 번호는 404, 같은 것을 두 번 지우면 두 번째는 404', async () => {
  const user = await makeUser();
  const token = signToken(user);
  const missing = await call('DELETE', '/favorites/99999', { token });
  assert.equal(missing.status, 404);
  assert.deepEqual(missing.json, { success: false, error: NOT_FOUND });

  const saved = await saveFabric(user.user_id, (await makePostedFabric()).fabric_id);
  assert.equal((await call('DELETE', `/favorites/${saved.favorite_id}`, { token })).status, 200);
  const second = await call('DELETE', `/favorites/${saved.favorite_id}`, { token });
  assert.equal(second.status, 404);
  assert.equal(second.json.error.code, 'NOT_FOUND');
});

test('관심저장 삭제 입력 오류: 숫자가 아니거나 1 보다 작은 번호는 400', async () => {
  const token = await tokenOf();
  for (const id of ['abc', '0', '-1', '1.5', '99999999999999999999']) {
    const { status, json } = await call('DELETE', `/favorites/${id}`, { token });
    assert.equal(status, 400, id);
    assert.equal(json.error.code, 'VALIDATION_ERROR');
    assert.ok(json.error.details.some((d) => d.field === 'favoriteId' && d.message), `${id}: ${JSON.stringify(json.error.details)}`);
  }
});

test('/favorites/me 는 번호가 아니라 내 목록이다 (경로 순서)', async () => {
  const { status, json } = await call('GET', '/favorites/me', { token: await tokenOf() });
  assert.equal(status, 200);
  assert.equal(json.data.totalElements, 0);
});
