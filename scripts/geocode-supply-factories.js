// 기본은 호출 계획 출력. --apply에서만 네이버를 호출하고 검증된 좌표를 저장한다.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { Op } from 'sequelize';
import Factory from '../src/models/Factory.js';
import sequelize from '../src/db/connection.js';
import { env } from '../src/config/env.js';
import { createNaverGeocoder } from '../src/factories/geocoding.js';

try {
  const { values } = parseArgs({ options: { apply: { type: 'boolean', default: false } } });
  const rows = await Factory.findAll({ where: { is_current: true, supply_status: 'candidate' }, order: [['source_key', 'ASC']] });
  const byAddress = new Map();
  for (const row of rows) {
    if (!row.source_key || !row.dataset_key) throw new Error('출처가 연결된 공장 자료를 먼저 적재하세요.');
    if (!byAddress.has(row.address)) byAddress.set(row.address, []);
    byAddress.get(row.address).push(row);
  }
  const jobs = [...byAddress].map(([address, factories]) => ({ address,
    factories: factories.map((row) => ({ sourceKey: row.source_key, name: row.factory_name, datasetKey: row.dataset_key })),
    ready: factories.every((row) => row.geocoding_status === 'matched' && row.geocoded_address === address && row.latitude !== null && row.longitude !== null),
  }));
  const plan = { candidateCount: rows.length, uniqueAddresses: jobs.length, pendingAddresses: jobs.filter((job) => !job.ready).length, jobs };
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const dir = path.join(root, 'data/factories/map');
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'geocoding-plan.json'), `${JSON.stringify(plan, null, 2)}\n`);
  if (values.apply) {
    const geocode = createNaverGeocoder(env.naverMaps);
    const results = [];
    for (const job of jobs) {
      if (job.ready) continue;
      let result;
      try { result = await geocode(job.address); }
      catch (error) {
        if ([401, 403].includes(error.status)) throw error;
        result = { status: 'failed', latitude: null, longitude: null };
      }
      const [updated] = await Factory.update({ latitude: result.latitude, longitude: result.longitude,
        geocoding_status: result.status, geocoded_address: job.address, geocoded_at: new Date(),
      }, { where: { source_key: { [Op.in]: job.factories.map((item) => item.sourceKey) }, address: job.address, is_current: true, supply_status: 'candidate' } });
      results.push({ ...job, result, updated });
      await fs.writeFile(path.join(dir, 'geocoding-result.json'), `${JSON.stringify(results, null, 2)}\n`);
    }
    console.log(JSON.stringify({ candidateCount: rows.length, calls: results.length, matchedAddresses: results.filter((item) => item.result.status === 'matched').length }, null, 2));
  } else console.log(JSON.stringify({ candidateCount: plan.candidateCount, uniqueAddresses: plan.uniqueAddresses, pendingAddresses: plan.pendingAddresses, mode: 'plan' }, null, 2));
} catch (error) { console.error(error.message); process.exitCode = 1; }
finally { await sequelize.close(); }
