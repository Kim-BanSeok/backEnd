import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { db, resetDb } from './helpers.js';
import { prepareFactoryData } from '../scripts/factoryPreparation.js';
import { importPreparedFactories } from '../scripts/factoryImport.js';

beforeEach(resetDb);
after(() => db.sequelize.close());
const prepare = (rows, { month = '09', checksum = 'a' } = {}) => prepareFactoryData([
  [`공장등록현황('26. ${Number(month)}월말)`],
  ['회사명', '소재지(지번)', '생산품'], ...rows,
], { datasetMonth: `2026-${month}`, sha256: checksum.repeat(64) });
const address = '경기도 양주시 고암동 12';

test('긴 생산품과 다른 생산품 중복을 모두 저장하고 원본 행의 출처를 보존한다', async () => {
  const data = prepare([['샘플', address, '원'.repeat(718)], ['중복', address, '원단'], ['중복', address, '단추']]);
  const result = await importPreparedFactories(data);
  assert.equal(result.inserted, 2);
  assert.equal(result.preservedSourceRows, 3);
  assert.equal(result.longProductsPreserved, 1);
  assert.equal(result.conflictingGroupsPreserved, 1);
  const saved = await db.Factory.findOne({ where: { factory_name: '샘플' } });
  assert.equal(saved.industry.length, 718);
  assert.equal(saved.source_record.raw[0].industry.length, 718);
  const duplicate = await db.Factory.findOne({ where: { factory_name: '중복' } });
  assert.deepEqual(duplicate.source_record.products, ['단추', '원단']);
  assert.equal(duplicate.industry, '단추 / 원단');
  assert.equal(duplicate.supply_status, 'candidate');
  const snapshot = await db.FactoryDataset.findByPk(result.datasetKey);
  assert.equal(snapshot.prepared_records.reduce((total, record) => total + record.raw.length, 0), 3);
});

test('재적재는 ID·등록 시각·좌표를 유지하고 스냅샷과 업체 수를 늘리지 않는다', async () => {
  const data = prepare([['샘플', address, '단추']]);
  await importPreparedFactories(data);
  const before = await db.Factory.findOne();
  await before.update({ latitude: 37.8, longitude: 127.0, geocoding_status: 'matched', geocoded_address: address });
  const result = await importPreparedFactories(data);
  const after = await db.Factory.findOne();
  assert.deepEqual([result.inserted, result.updated, result.unchanged], [0, 0, 1]);
  assert.equal(after.factory_id, before.factory_id);
  assert.equal(after.created_at.valueOf(), before.created_at.valueOf());
  assert.equal(Number(after.latitude), 37.8);
  assert.equal(Number(after.longitude), 127.0);
  assert.equal(await db.FactoryDataset.count(), 1);
  assert.equal(await db.Factory.count(), 1);
});

test('동시에 같은 자료를 적재해도 업체와 원본 스냅샷은 하나씩 남는다', async () => {
  const data = prepare([['샘플', address, '단추']]);
  await Promise.all([importPreparedFactories(data), importPreparedFactories(data)]);
  assert.equal(await db.Factory.count(), 1);
  assert.equal(await db.FactoryDataset.count(), 1);
});

test('다음 달은 생산품을 갱신하고 빠진 업체를 비활성화하면서 이전 원문을 보존한다', async () => {
  const first = prepare([['샘플', address, '단추'], ['빠진업체', '경기도 양주시 고암동 13', '지퍼']]);
  const oldResult = await importPreparedFactories(first);
  const id = (await db.Factory.findOne({ where: { factory_name: '샘플' } })).factory_id;
  const result = await importPreparedFactories(prepare([['샘플', address, '단추, 지퍼']], { month: '10', checksum: 'b' }));
  assert.equal(result.updated, 1);
  assert.equal(result.deactivated, 1);
  const saved = await db.Factory.findByPk(id);
  assert.equal(saved.industry, '단추, 지퍼');
  assert.equal(saved.data_source, '양주시청 공장등록 2026-10');
  assert.equal((await db.Factory.findOne({ where: { factory_name: '빠진업체' } })).is_current, false);
  assert.equal((await db.FactoryDataset.findByPk(oldResult.datasetKey)).prepared_records.find((record) => record.factory_name === '샘플').industry, '단추');
  await assert.rejects(importPreparedFactories(first), /더 최신 자료/);
});

test('레거시 업체의 동일 주소는 ID를 유지하며 출처를 연결하고, 이름·주소 중복은 롤백한다', async () => {
  const old = await db.Factory.create({ factory_name: '샘플', address, industry: '원단', data_source: '이전 자료' });
  const data = prepare([['샘플', address, '단추']]);
  const result = await importPreparedFactories(data);
  assert.equal(result.updated, 1);
  assert.equal((await db.Factory.findOne()).factory_id, old.factory_id);
  await db.Factory.create({ factory_name: '샘플', address, industry: '지퍼', data_source: '이전 자료' });
  await assert.rejects(importPreparedFactories(data), /기존 DB/);
  assert.equal(await db.FactoryDataset.count(), 1);
});

test('고유키 제약이 중복을 막고 필요한 주소가 없는 데이터는 적재 전 차단한다', async () => {
  const data = prepare([['샘플', address, '단추']]);
  await importPreparedFactories(data);
  const saved = await db.Factory.findOne();
  await assert.rejects(db.Factory.create({ factory_name: '다른업체', address, industry: null, data_source: '이전 자료', source_key: saved.source_key }), (error) => error.parent?.code === '23505');
  await assert.rejects(importPreparedFactories(prepare([['주소없음', '', '단추']])), /필수값/);
});
