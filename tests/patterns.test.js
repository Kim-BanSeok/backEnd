import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import { createApp } from '../src/app.js';
import { env } from '../src/config/env.js';
import { signToken } from '../src/services/auth.service.js';
import { db, resetDb, makeUser } from './helpers.js';

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

// 쿼리 값(한글 포함)을 주소에 붙인다.
const listPath = (query = {}) => `/patterns?${new URLSearchParams(query)}`;

// 도안은 helpers.js 에 도우미가 없어서 여기서 만든다. 부품은 목록 응답에 나오지 않지만 실제 모양대로 함께 만든다.
async function makePattern(overrides = {}) {
  const pattern = await db.Pattern.create({
    pattern_name: '에코백',
    aliases: '장바구니, 토트백',
    category: '가방',
    description: '기본 에코백',
    allowed_materials: ['COTTON', 'LINEN'],
    allowed_thickness: ['NORMAL', 'THICK'],
    reviewed_by: '운영팀',
    ...overrides,
  });
  await db.PatternPart.create({ pattern_id: pattern.pattern_id, part_name: '몸판', width_cm: 40, height_cm: 45, quantity: 2 });
  return pattern;
}

const ITEM_KEYS = [
  'aliases', 'allowed_materials', 'allowed_thickness', 'category', 'image_url', 'patternId', 'pattern_name',
];
const PAGE_KEYS = ['content', 'page', 'size', 'totalElements', 'totalPages'];

// ---- 22. 도안 목록 조회

test('도안 목록 성공: 로그인 없이 200, 명세서 항목 그대로', async () => {
  const pattern = await makePattern();
  const { status, json } = await call('GET', '/patterns');
  assert.equal(status, 200);
  assert.equal(json.success, true);
  assert.deepEqual(Object.keys(json.data).sort(), PAGE_KEYS);
  assert.deepEqual(json.data, {
    content: [{
      patternId: pattern.pattern_id,
      pattern_name: '에코백',
      aliases: '장바구니, 토트백',
      category: '가방',
      image_url: null,
      allowed_materials: ['COTTON', 'LINEN'],
      allowed_thickness: ['NORMAL', 'THICK'],
    }],
    page: 0,
    size: 20,
    totalElements: 1,
    totalPages: 1,
  });
  assert.deepEqual(Object.keys(json.data.content[0]).sort(), ITEM_KEYS);
});

test('도안 목록: 로그인해도 같은 목록을 본다', async () => {
  await makePattern();
  const token = signToken(await makeUser());
  const { status, json } = await call('GET', '/patterns', { token });
  assert.equal(status, 200);
  assert.equal(json.data.totalElements, 1);
});

test('도안 목록: 사용 중이 아닌 도안(is_active=false)은 보이지 않는다', async () => {
  const active = await makePattern({ pattern_name: '파우치' });
  await makePattern({ pattern_name: '앞치마', is_active: false });
  const { json } = await call('GET', '/patterns');
  assert.deepEqual(json.data.content.map((p) => p.patternId), [active.pattern_id]);
  assert.equal(json.data.totalElements, 1);
});

test('도안 목록 페이지 나누기: page·size, 등록 순, 범위 밖 페이지는 빈 목록', async () => {
  const ids = [];
  for (const name of ['가', '나', '다', '라', '마']) ids.push((await makePattern({ pattern_name: name })).pattern_id);

  const second = await call('GET', listPath({ page: 1, size: 2 }));
  assert.equal(second.status, 200);
  assert.deepEqual(second.json.data.content.map((p) => p.patternId), ids.slice(2, 4));
  assert.equal(second.json.data.page, 1);
  assert.equal(second.json.data.size, 2);
  assert.equal(second.json.data.totalElements, 5);
  assert.equal(second.json.data.totalPages, 3);

  const beyond = await call('GET', listPath({ page: 9, size: 2 }));
  assert.deepEqual(beyond.json.data.content, []);
  assert.equal(beyond.json.data.totalElements, 5);
});

test('도안 목록: 도안이 없으면 빈 목록과 totalPages 0', async () => {
  const { json } = await call('GET', '/patterns');
  assert.deepEqual(json.data, { content: [], page: 0, size: 20, totalElements: 0, totalPages: 0 });
});

test('도안 목록 category: 같은 분류만 보인다', async () => {
  const bag = await makePattern({ category: '가방' });
  await makePattern({ pattern_name: '앞치마', aliases: null, category: '주방' });
  const { json } = await call('GET', listPath({ category: '가방' }));
  assert.deepEqual(json.data.content.map((p) => p.patternId), [bag.pattern_id]);
});

test('도안 목록 keyword: 이름과 별칭에서 찾고, 대소문자는 가리지 않는다', async () => {
  const ecoBag = await makePattern({ pattern_name: '에코백', aliases: '장바구니, 토트백' });
  const pouch = await makePattern({ pattern_name: 'Mini Pouch', aliases: null, category: '소품' });
  await makePattern({ pattern_name: '앞치마', aliases: '에이프런', category: '주방' });

  const byName = await call('GET', listPath({ keyword: '에코' }));
  assert.deepEqual(byName.json.data.content.map((p) => p.patternId), [ecoBag.pattern_id]);

  const byAlias = await call('GET', listPath({ keyword: '토트' }));
  assert.deepEqual(byAlias.json.data.content.map((p) => p.patternId), [ecoBag.pattern_id]);

  const ignoreCase = await call('GET', listPath({ keyword: 'pouch' }));
  assert.deepEqual(ignoreCase.json.data.content.map((p) => p.patternId), [pouch.pattern_id]);

  const both = await call('GET', listPath({ keyword: '백', category: '가방' }));
  assert.deepEqual(both.json.data.content.map((p) => p.patternId), [ecoBag.pattern_id]);
});

test('도안 목록 keyword: %, _ 는 글자 그대로 찾는다', async () => {
  const percent = await makePattern({ pattern_name: '100% 면 가방', aliases: null });
  await makePattern({ pattern_name: '면 가방', aliases: null });
  const { json } = await call('GET', listPath({ keyword: '%' }));
  assert.deepEqual(json.data.content.map((p) => p.patternId), [percent.pattern_id]);

  const underscore = await call('GET', listPath({ keyword: '_' }));
  assert.deepEqual(underscore.json.data.content, []);
});

test('도안 목록: 빈 검색어와 빈 분류는 보내지 않은 것과 같다', async () => {
  await makePattern();
  const { status, json } = await call('GET', listPath({ keyword: '', category: '  ' }));
  assert.equal(status, 200);
  assert.equal(json.data.totalElements, 1);
});

test('도안 목록 입력 오류: VALIDATION_ERROR 와 항목별 details', async () => {
  for (const [field, query] of [
    ['page', { page: -1 }],
    ['page', { page: 'abc' }],
    ['page', { page: 1.5 }],
    ['size', { size: 0 }],
    ['size', { size: 51 }],
    ['category', { category: 'ㄱ'.repeat(51) }],
    ['keyword', { keyword: 'ㄱ'.repeat(101) }],
  ]) {
    const { status, json } = await call('GET', listPath(query));
    assert.equal(status, 400, JSON.stringify(query));
    assert.equal(json.error.code, 'VALIDATION_ERROR');
    assert.ok(json.error.details.some((d) => d.field === field && d.message), `${field}: ${JSON.stringify(json.error.details)}`);
  }
});

test('도안 목록: 공개 API 라도 잘못된 토큰이면 401 (명세서 2.3)', async () => {
  const expired = jwt.sign({ role: 'BUYER' }, env.jwtSecret, { subject: '1', expiresIn: -10 });
  for (const token of ['garbage', expired]) {
    const { status, json } = await call('GET', '/patterns', { token });
    assert.equal(status, 401);
    assert.equal(json.error.code, 'UNAUTHORIZED');
  }
});

// ---- 23. 도안 상세 조회

const DETAIL_KEYS = [
  'aliases', 'allowed_materials', 'allowed_thickness', 'category', 'description', 'image_url',
  'parts', 'patternId', 'pattern_name', 'reviewed_by',
];
const PART_KEYS = ['height_cm', 'part_name', 'quantity', 'width_cm'];

test('도안 상세 성공: 로그인 없이 200, 명세서 항목 그대로, 부품은 등록 순', async () => {
  const pattern = await makePattern({ image_url: 'https://example.com/eco.png' });
  await db.PatternPart.create({ pattern_id: pattern.pattern_id, part_name: '끈', width_cm: 5, height_cm: 60, quantity: 2 });

  const { status, json } = await call('GET', `/patterns/${pattern.pattern_id}`);
  assert.equal(status, 200);
  assert.deepEqual(json, {
    success: true,
    data: {
      patternId: pattern.pattern_id,
      pattern_name: '에코백',
      aliases: '장바구니, 토트백',
      category: '가방',
      description: '기본 에코백',
      image_url: 'https://example.com/eco.png',
      allowed_materials: ['COTTON', 'LINEN'],
      allowed_thickness: ['NORMAL', 'THICK'],
      reviewed_by: '운영팀',
      parts: [
        { part_name: '몸판', width_cm: 40, height_cm: 45, quantity: 2 },
        { part_name: '끈', width_cm: 5, height_cm: 60, quantity: 2 },
      ],
    },
  });
  assert.deepEqual(Object.keys(json.data).sort(), DETAIL_KEYS);
  assert.deepEqual(Object.keys(json.data.parts[0]).sort(), PART_KEYS);
});

test('도안 상세: 선택 항목은 null, 부품이 없으면 빈 배열, 로그인해도 같다', async () => {
  const pattern = await db.Pattern.create({
    pattern_name: '파우치',
    allowed_materials: ['COTTON'],
    allowed_thickness: ['THIN'],
  });
  const token = signToken(await makeUser());
  const { status, json } = await call('GET', `/patterns/${pattern.pattern_id}`, { token });
  assert.equal(status, 200);
  assert.deepEqual(json.data, {
    patternId: pattern.pattern_id,
    pattern_name: '파우치',
    aliases: null,
    category: null,
    description: null,
    image_url: null,
    allowed_materials: ['COTTON'],
    allowed_thickness: ['THIN'],
    reviewed_by: null,
    parts: [],
  });
});

test('도안 상세: 다른 도안의 부품은 섞이지 않는다', async () => {
  const eco = await makePattern();
  const apron = await makePattern({ pattern_name: '앞치마' });
  await db.PatternPart.create({ pattern_id: apron.pattern_id, part_name: '허리끈', width_cm: 8, height_cm: 90, quantity: 1 });

  const { json } = await call('GET', `/patterns/${eco.pattern_id}`);
  assert.deepEqual(json.data.parts.map((p) => p.part_name), ['몸판']);
});

test('도안 상세 오류: 없는 도안과 사용 중이 아닌 도안은 똑같이 404 NOT_FOUND', async () => {
  const inactive = await makePattern({ is_active: false });
  for (const id of [9999, inactive.pattern_id]) {
    const { status, json } = await call('GET', `/patterns/${id}`);
    assert.equal(status, 404, `id ${id}`);
    assert.deepEqual(json, { success: false, error: { code: 'NOT_FOUND', message: '찾을 수 없어요' } });
  }
});

test('도안 상세 입력 오류: 숫자가 아니거나 1 보다 작은 번호는 400 VALIDATION_ERROR', async () => {
  for (const id of ['abc', '0', '-1', '1.5', '99999999999999999999']) {
    const { status, json } = await call('GET', `/patterns/${id}`);
    assert.equal(status, 400, id);
    assert.equal(json.error.code, 'VALIDATION_ERROR');
    assert.ok(json.error.details.some((d) => d.field === 'patternId' && d.message), `${id}: ${JSON.stringify(json.error.details)}`);
  }
});

test('도안 상세: 공개 API 라도 잘못된 토큰이면 401 (명세서 2.3)', async () => {
  const pattern = await makePattern();
  const expired = jwt.sign({ role: 'BUYER' }, env.jwtSecret, { subject: '1', expiresIn: -10 });
  for (const token of ['garbage', expired]) {
    const { status, json } = await call('GET', `/patterns/${pattern.pattern_id}`, { token });
    assert.equal(status, 401);
    assert.equal(json.error.code, 'UNAUTHORIZED');
  }
});
