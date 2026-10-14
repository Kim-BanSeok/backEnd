// 기존 명령도 원문을 보존하는 정제·적재기를 사용한다.
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import XLSX from '../src/spreadsheets/sheetjs.js';
import sequelize from '../src/db/connection.js';
import { prepareFactoryData, verifyFactorySource } from './factoryPreparation.js';
import { importPreparedFactories } from './factoryImport.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, 'data/factories/yangju-city');

export async function saveFactoryWorkbook({ dir, stamp }) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(stamp)) throw new Error('자료 기준월이 올바르지 않습니다.');
  let source;
  try { source = JSON.parse(await fs.readFile(path.join(ROOT, `docs/factories/yangju-${stamp}-source.json`), 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (!source) source = JSON.parse(await fs.readFile(path.join(dir, 'source.json'), 'utf8'));
  const names = (await fs.readdir(dir)).filter((name) => /\.xls$/i.test(name));
  let bytes;
  for (const filename of names) {
    const candidate = await fs.readFile(path.join(dir, filename));
    if (source.sha256 && createHash('sha256').update(candidate).digest('hex') !== source.sha256) continue;
    bytes = candidate; break;
  }
  if (!bytes) throw new Error('출처 기록과 일치하는 XLS 원본이 없습니다.');
  source = { ...source, datasetMonth: stamp, sheetName: source.sheetName || '공장등록현황' };
  verifyFactorySource(bytes, source);
  const workbook = XLSX.read(bytes, { type: 'buffer' });
  const sheet = workbook.Sheets[source.sheetName];
  if (!sheet) throw new Error('공장등록현황 시트가 없습니다.');
  const data = prepareFactoryData(XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', blankrows: true }), source);
  const result = await importPreparedFactories(data);
  console.log(JSON.stringify(result, null, 2));
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const stamp = (await fs.readdir(OUT_DIR)).filter((name) => /^\d{4}-\d{2}$/.test(name)).sort().at(-1);
    if (!stamp) throw new Error('받아 둔 공장등록 파일이 없습니다.');
    await saveFactoryWorkbook({ dir: path.join(OUT_DIR, stamp), stamp });
  } catch (error) { console.error(error.message); process.exitCode = 1; }
  finally { await sequelize.close(); }
}
