// 적재 결과를 원본에서 만든 정제 데이터와 읽기 전용으로 대조한다.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import Factory from '../src/models/Factory.js';
import FactoryDataset from '../src/models/FactoryDataset.js';
import sequelize from '../src/db/connection.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
try {
  const data = JSON.parse(await fs.readFile(path.join(root, 'data/factories/yangju-city/2026-09/prepared/prepared.json'), 'utf8'));
  const datasetKey = createHash('sha256').update(JSON.stringify([data.source.sha256, data.preparationVersion])).digest('hex');
  const snapshot = await FactoryDataset.findByPk(datasetKey);
  assert.ok(snapshot, '출처 스냅샷이 없습니다.');
  assert.deepEqual(snapshot.prepared_records, data.records);
  const saved = await Factory.findAll({ where: { dataset_key: datasetKey, is_current: true }, order: [['source_key', 'ASC']] });
  assert.equal(saved.length, data.records.length);
  const byKey = new Map(saved.map((row) => [row.source_key, row]));
  for (const record of data.records) {
    const row = byKey.get(record.sourceKey);
    assert.ok(row);
    assert.equal(row.industry, record.industry);
    assert.equal(row.factory_name, record.factory_name);
    assert.equal(row.address, record.address);
    assert.equal(row.supply_status, record.supply.status);
    assert.deepEqual(row.source_record.raw, record.raw);
    assert.deepEqual(row.source_record.products, record.products);
  }
  const logicalRows = saved.map((row) => [row.source_key, row.factory_name, row.industry, row.address, row.dataset_month, row.record_hash]);
  const result = { factories: saved.length, preservedSourceRows: saved.reduce((count, row) => count + row.source_record.raw.length, 0),
    longProducts: saved.filter((row) => [...(row.industry || '')].length > 100).length,
    conflictingProducts: saved.filter((row) => row.source_record.products.length > 1).length,
    candidates: saved.filter((row) => row.supply_status === 'candidate').length,
    uniqueCandidateAddresses: new Set(saved.filter((row) => row.supply_status === 'candidate').map((row) => row.address)).size,
    logicalSha256: createHash('sha256').update(JSON.stringify(logicalRows)).digest('hex'),
  };
  console.log(JSON.stringify(result, null, 2));
} catch (error) { console.error(error.message); process.exitCode = 1; }
finally { await sequelize.close(); }
