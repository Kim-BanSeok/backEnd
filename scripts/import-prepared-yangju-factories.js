// 환경 접속 정보는 기존 config를 쓰고, 원본은 고정된 출처 기록으로 재검증한다.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import sequelize from '../src/db/connection.js';
import { prepareWorkbook } from './prepare-yangju-factories.js';
import { importPreparedFactories } from './factoryImport.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
try {
  const { values } = parseArgs({ options: { source: { type: 'string', default: 'docs/factories/yangju-2026-09-source.json' }, download: { type: 'boolean', default: false } } });
  const sourcePath = path.resolve(root, values.source);
  const source = JSON.parse(await fs.readFile(sourcePath, 'utf8'));
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(source.datasetMonth)) throw new Error('자료 기준월이 올바르지 않습니다.');
  const dir = path.join(root, 'data/factories/yangju-city', source.datasetMonth);
  const data = await prepareWorkbook({ sourcePath, inputPath: path.join(dir, 'source.xls'), outputDir: path.join(dir, 'prepared'), download: values.download });
  const result = await importPreparedFactories(data);
  await fs.writeFile(path.join(dir, 'prepared/import-result.json'), `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify(result, null, 2));
} catch (error) { console.error(error.message); process.exitCode = 1; }
finally { await sequelize.close(); }
