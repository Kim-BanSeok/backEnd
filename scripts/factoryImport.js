import { createHash } from 'node:crypto';
import { Op, Transaction } from 'sequelize';
import sequelize from '../src/db/connection.js';
import Factory from '../src/models/Factory.js';
import FactoryDataset from '../src/models/FactoryDataset.js';
import { PREPARATION_VERSION, factorySourceKey, normalizeFactoryText } from './factoryPreparation.js';

const hash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

function importable(data) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(data.source?.datasetMonth) || !/^[a-f0-9]{64}$/.test(data.source?.sha256)) throw new Error('검증한 원본 출처가 필요합니다.');
  if (data.preparationVersion !== PREPARATION_VERSION || data.rejected?.length || !data.records?.length) throw new Error('자료 버전·필수값 누락을 먼저 검토하세요.');
  const keys = new Set();
  for (const record of data.records) {
    if (record.sourceKey !== factorySourceKey(record.factory_name, record.address) || keys.has(record.sourceKey)) throw new Error('업체 식별키가 잘못됐거나 중복됩니다.');
    keys.add(record.sourceKey);
    const allowed = ['MISSING_PRODUCT', 'INDUSTRY_EXCEEDS_DB_LIMIT', 'DUPLICATE_PRODUCT_CONFLICT'];
    if (record.issues.some((issue) => !allowed.includes(issue))) throw new Error('이름·주소·지역의 검토가 필요한 자료는 적재하지 않습니다.');
  }
}

export async function importPreparedFactories(data) {
  importable(data);
  const month = data.source.datasetMonth;
  const datasetKey = hash([data.source.sha256, data.preparationVersion]);
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await sequelize.transaction({ isolationLevel: Transaction.ISOLATION_LEVELS.SERIALIZABLE }, async (transaction) => {
        const latest = await FactoryDataset.findOne({ order: [['dataset_month', 'DESC']], transaction });
        if (latest && latest.dataset_month > month) throw new Error('이미 더 최신 자료가 적재돼 있어 과거 자료로 목록을 되돌리지 않습니다.');
        const snapshot = await FactoryDataset.findByPk(datasetKey, { transaction });
        if (!snapshot) await FactoryDataset.create({
          dataset_key: datasetKey, dataset_month: month,
          source_manifest: data.source, prepared_records: data.records,
        }, { transaction });

        const existing = await Factory.findAll({ transaction, lock: transaction.LOCK.UPDATE });
        const byKey = new Map();
        for (const row of existing) {
          const key = row.source_key || factorySourceKey(row.factory_name, row.address);
          if (byKey.has(key)) throw new Error('기존 DB에 같은 회사명·주소가 여러 행입니다. 기존 행을 먼저 검토하세요.');
          byKey.set(key, row);
        }
        let inserted = 0, updated = 0, unchanged = 0;
        const inserts = [];
        for (const record of data.records) {
          const sourceRecord = { products: record.products, sourceRows: record.sourceRows, raw: record.raw, issues: record.issues, supply: record.supply };
          const fields = {
            source_key: record.sourceKey,
            factory_name: record.factory_name, address: record.address, industry: record.industry,
            phone_number: record.phone_number, fax_number: record.fax_number,
            employee_count: record.employee_count, legal_dong: record.legal_dong,
            data_source: `양주시청 공장등록 ${month}`, dataset_month: month, dataset_key: datasetKey,
            source_record: sourceRecord, supply_status: record.supply.status, is_current: true,
          };
          fields.record_hash = hash(fields);
          const found = byKey.get(record.sourceKey);
          if (!found) {
            inserts.push(fields); inserted++;
          } else if (found.record_hash === fields.record_hash && found.is_current) {
            unchanged++;
          } else {
            if (normalizeFactoryText(found.address) !== record.address) Object.assign(fields, {
              latitude: null, longitude: null, geocoding_status: 'pending', geocoded_address: null, geocoded_at: null,
            });
            await found.update(fields, { transaction }); updated++;
          }
        }
        for (let i = 0; i < inserts.length; i += 500) await Factory.bulkCreate(inserts.slice(i, i + 500), { transaction });
        const [deactivated] = await Factory.update({ is_current: false }, { where: {
          dataset_month: { [Op.lte]: month }, source_key: { [Op.notIn]: data.records.map((record) => record.sourceKey) }, is_current: true,
        }, transaction });
        return { datasetMonth: month, datasetKey, inserted, updated, unchanged, deactivated,
          total: data.records.length, preservedSourceRows: data.records.reduce((total, record) => total + record.raw.length, 0),
          longProductsPreserved: data.records.filter((record) => record.issues.includes('INDUSTRY_EXCEEDS_DB_LIMIT')).length,
          conflictingGroupsPreserved: data.records.filter((record) => record.products.length > 1).length,
          supplyCandidates: data.records.filter((record) => record.supply.status === 'candidate').length };
      });
    } catch (error) {
      const code = error.original?.code || error.parent?.code;
      if (attempt === 2 || !['40001', '23505', '40P01'].includes(code)) throw error;
    }
  }
}
