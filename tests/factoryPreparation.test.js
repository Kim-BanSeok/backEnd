import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { factorySourceKey, identifySupplyProducts, normalizeFactoryText, prepareFactoryData, verifyFactorySource } from '../scripts/factoryPreparation.js';
import { prepareWorkbook } from '../scripts/prepare-yangju-factories.js';

const source = { datasetMonth: '2026-09' };
const matrix = (rows, title = "공장등록현황('26. 9월말)") => [
  [title],
  ['연번', '회사명', '소재지(지번)', '종업원수', '생산품', '전화번호', 'FAX'],
  ...rows.map((row, i) => [i + 1, row[0], row[1], '1', row[2], '010-1234-5678', '031-123-4567']),
];

test('회사명·주소 정규화는 주식회사 기호와 공백·전각 문자의 표현 차이를 묶는다', () => {
  assert.equal(normalizeFactoryText(' ㈜샘플\n 공장 '), '(주)샘플 공장');
  assert.equal(factorySourceKey('㈜ 샘플', '경기도  양주시 고암동 １２-３'), factorySourceKey('(주)샘플', '경기도 양주시 고암동 12-3'));
  assert.notEqual(factorySourceKey('샘플', '경기도 양주시 고암동 12-3'), factorySourceKey('샘플', '경기도 양주시 고암동 12-4'));
});

test('같은 이름·주소의 완전 중복은 원본 행을 보존해 묶고 다른 업체는 합치지 않는다', () => {
  const data = prepareFactoryData(matrix([
    ['㈜ 샘플', '경기도 양주시 고암동 12', '단추'],
    ['(주)샘플', '경기도 양주시 고암동 12', '단추'],
    ['다른업체', '경기도 양주시 고암동 12', '단추'],
  ]), source);
  assert.equal(data.summary.inputRows, 3);
  assert.equal(data.summary.uniqueFactories, 2);
  assert.equal(data.summary.duplicateRows, 1);
  assert.equal(data.summary.productConflictGroups, 0);
  assert.equal(data.importRows.length, 2);
  const sample = data.records.find((record) => record.raw.length === 2);
  assert.deepEqual(sample.sourceRows, [3, 4]);
  assert.equal(sample.raw[0].factory_name, '㈜ 샘플');
  assert.equal(Object.hasOwn(sample.raw[0], '전화번호'), false);
});

test('생산품이 다른 중복은 모든 생산품을 보존하고 현재 스키마 적재에서 보류한다', () => {
  const data = prepareFactoryData(matrix([
    ['샘플', '경기도 양주시 고암동 12', '단추'],
    ['샘플', '경기도 양주시 고암동 12', '원단가공'],
  ]), source);
  assert.deepEqual(data.records[0].products, ['단추', '원단가공']);
  assert.equal(data.records[0].industry, '단추 / 원단가공');
  assert.deepEqual(data.records[0].issues, ['DUPLICATE_PRODUCT_CONFLICT']);
  assert.equal(data.summary.productConflictGroups, 1);
  assert.equal(data.importRows.length, 0);
});

test('생산품 100자 초과를 자르지 않고 보류하며, 경계인 100자는 적재 후보로 유지한다', () => {
  const data = prepareFactoryData(matrix([
    ['긴제품', '경기도 양주시 고암동 1', '원'.repeat(101)],
    ['경계제품', '경기도 양주시 고암동 2', '원'.repeat(100)],
  ]), source);
  const held = data.records.find((record) => record.factory_name === '긴제품');
  assert.equal(held.industry.length, 101);
  assert.equal(held.raw[0].industry.length, 101);
  assert.deepEqual(held.issues, ['INDUSTRY_EXCEEDS_DB_LIMIT']);
  assert.deepEqual(data.importRows.map((record) => record.factory_name), ['경계제품']);
});

test('빈 행·필수값 누락·생산품 누락·양주시 밖 주소를 서로 구분한다', () => {
  const rows = matrix([
    ['누락업체', '', '지퍼'],
    ['외부업체', '경기도 의정부시 시민로 1', '단추'],
    ['제품누락', '경기도 양주시 고암동 12', ''],
  ]);
  rows.push(['', '', '', '', '', '', '']);
  const data = prepareFactoryData(rows, source);
  assert.equal(data.summary.blankRows, 1);
  assert.equal(data.summary.rejectedRows, 1);
  assert.equal(data.summary.issueCounts.ADDRESS_OUTSIDE_YANGJU, 1);
  assert.equal(data.summary.issueCounts.MISSING_PRODUCT, 1);
  assert.equal(data.importRows.length, 1);
  assert.equal(data.importRows[0].industry, null);
});

test('전월 원본이나 생산품 헤더가 없는 원본은 정제하지 않는다', () => {
  assert.throws(() => prepareFactoryData(matrix([], "공장등록현황('26. 8월말)"), source), /기준월/);
  const rows = matrix([]);
  rows[1][4] = '업종코드';
  assert.throws(() => prepareFactoryData(rows, source), /헤더/);
});

test('단추·지퍼·버클 등은 API의 넓은 업종 분류와 별도로 부자재 후보가 된다', () => {
  for (const industry of ['단추,파스너,지퍼', '금속장식품(버클 등)', '의류등의 섬유라벨', '세폭직물(라벨지)', '자수,레이스', '마스크끈, 의류부자재용끈']) {
    const found = identifySupplyProducts(industry);
    assert.equal(found.status, 'candidate', industry);
    assert.ok(found.matches.length > 0);
  }
});

test('전자라벨·전기 레이스웨이·건축 부자재·가발 원사를 의류 부자재로 선별하지 않는다', () => {
  for (const industry of ['전자라벨', '전자저울, 라벨, 티켓용지', '산업용라벨, 스티커', '레이스웨이,케이블트레이', '조립식 판넬 및 부자재', '철물가구부자재', '인조가발원사']) {
    assert.equal(identifySupplyProducts(industry).status, 'excluded', industry);
  }
  for (const industry of ['끈', '라벨', '연사', '자동차안전벨트용웨빙', '고무사세폭직물']) {
    assert.equal(identifySupplyProducts(industry).status, 'review', industry);
  }
  assert.equal(identifySupplyProducts('실리콘 식품용기').status, 'unmatched');
  assert.equal(identifySupplyProducts('금속단추, 전자라벨').status, 'candidate');
});

test('동일 입력의 결과는 동일하며, 월이 바뀌어도 회사명·주소 식별키는 유지된다', () => {
  const rows = matrix([['샘플', '경기도 양주시 고암동 12', '단추']]);
  const first = prepareFactoryData(rows, source);
  assert.deepEqual(prepareFactoryData(rows, source), first);
  const next = prepareFactoryData(matrix([['샘플', '경기도 양주시 고암동 12', '단추']], "공장등록현황('26. 10월말)"), { datasetMonth: '2026-10' });
  assert.equal(first.records[0].sourceKey, next.records[0].sourceKey);
  assert.equal(first.importRows[0].data_source, '양주시청 공장등록 2026-09');
  assert.equal(next.importRows[0].data_source, '양주시청 공장등록 2026-10');
  assert.equal(first.records[0].latitude, null);
  assert.equal(first.records[0].longitude, null);
});

test('원본 해시·크기·XLS 형식을 검증한다', () => {
  const bytes = Buffer.from('d0cf11e0a1b11ae100000000', 'hex');
  const manifest = { ...source, byteLength: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
  assert.doesNotThrow(() => verifyFactorySource(bytes, manifest));
  assert.throws(() => verifyFactorySource(Buffer.concat([bytes, Buffer.from('1')]), manifest), /SHA-256/);
  const altered = Buffer.from(bytes);
  altered[9] = 1;
  assert.throws(() => verifyFactorySource(altered, manifest), /SHA-256/);
  assert.throws(() => verifyFactorySource(bytes, { ...manifest, datasetMonth: '../../2026-09' }), /기준월/);
});

test('원본이 변조된 경우 출력 파일을 쓰기 전에 중단한다', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'factory-preparation-'));
  try {
    const sourcePath = path.join(dir, 'source.json');
    const inputPath = path.join(dir, 'source.xls');
    const outputDir = path.join(dir, 'out');
    await fs.writeFile(sourcePath, JSON.stringify({ ...source, byteLength: 8, sha256: '0'.repeat(64) }));
    await fs.writeFile(inputPath, Buffer.from('d0cf11e0a1b11ae1', 'hex'));
    await assert.rejects(prepareWorkbook({ sourcePath, inputPath, outputDir }), /SHA-256/);
    await assert.rejects(fs.access(outputDir), { code: 'ENOENT' });
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});
