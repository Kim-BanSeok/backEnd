import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import { createApp } from '../src/app.js';
import { env } from '../src/config/env.js';
import { toKstIso } from '../src/utils/response.js';
import { classifyIndustry } from '../src/factories/categories.js';
import { db, resetDb } from './helpers.js';

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

const listPath = (query = {}) => `/factories?${new URLSearchParams(query)}`;

async function makeFactory(overrides = {}) {
  return db.Factory.create({
    factory_name: '대영섬유',
    industry: '직물호부처리',
    address: '경기도 양주시 고암동 385-10',
    data_source: '양주시청 공장등록 2026-09',
    ...overrides,
  });
}

const summary = (factory) => ({
  factoryId: Number(factory.factory_id),
  factory_name: factory.factory_name,
  industry: factory.industry,
  category: classifyIndustry(factory.industry),
  address: factory.address,
  latitude: null,
  longitude: null,
  data_source: factory.data_source,
  created_at: toKstIso(factory.created_at),
});

const ITEM_KEYS = [
  'address', 'category', 'created_at', 'data_source', 'factoryId', 'factory_name', 'industry', 'latitude', 'longitude',
];
const PAGE_KEYS = ['content', 'page', 'size', 'totalElements', 'totalPages'];

test('생산품 문장을 업종 카테고리로 묶는다', () => {
  assert.equal(classifyIndustry('직물호부처리'), 'TEXTILE');
  assert.equal(classifyIndustry('남성정장, 원피스'), 'APPAREL');
  assert.equal(classifyIndustry('피혁임가공'), 'LEATHER');
  assert.equal(classifyIndustry('즉석조리식품'), 'FOOD');
  assert.equal(classifyIndustry('플라스틱 용기'), 'PLASTIC');
  assert.equal(classifyIndustry('레미콘'), 'CONSTRUCTION');
  assert.equal(classifyIndustry(''), 'OTHER');
  assert.equal(classifyIndustry(null), 'OTHER');
});

test('공장 목록 성공: 로그인 없이 200, 업종 카테고리가 붙고 등록 순이다', async () => {
  const textile = await makeFactory();
  const concrete = await makeFactory({
    factory_name: '양주레미콘',
    industry: '레미콘',
    address: '경기도 양주시 남면 1',
  });
  const { status, json } = await call('GET', '/factories');
  assert.equal(status, 200);
  assert.equal(json.success, true);
  assert.deepEqual(Object.keys(json.data).sort(), PAGE_KEYS);
  assert.deepEqual(Object.keys(json.data.content[0]).sort(), ITEM_KEYS);
  assert.deepEqual(json.data, {
    content: [summary(textile), summary(concrete)],
    page: 0,
    size: 20,
    totalElements: 2,
    totalPages: 1,
  });
});

test('공장 목록: category 로 그 업종만 본다', async () => {
  const textile = await makeFactory();
  await makeFactory({ factory_name: '양주레미콘', industry: '레미콘', address: '경기도 양주시 남면 1' });
  const { status, json } = await call('GET', listPath({ category: 'TEXTILE' }));
  assert.equal(status, 200);
  assert.deepEqual(json.data.content, [summary(textile)]);
  assert.equal(json.data.totalElements, 1);
});

test('공장 목록: 페이지를 넘어가면 400', async () => {
  for (const query of [{ page: -1 }, { size: 0 }, { size: 51 }, { category: 'FABRIC' }]) {
    const { status, json } = await call('GET', listPath(query));
    assert.equal(status, 400, JSON.stringify(query));
    assert.equal(json.error.code, 'VALIDATION_ERROR');
  }
});

test('공장 목록: 공개 API 라도 잘못된 토큰이면 401', async () => {
  const expired = jwt.sign({ role: 'BUYER' }, env.jwtSecret, { subject: '1', expiresIn: -10 });
  for (const token of ['garbage', expired]) {
    const { status, json } = await call('GET', '/factories', { token });
    assert.equal(status, 401);
    assert.equal(json.error.code, 'UNAUTHORIZED');
  }
});
