// 정제 전용 명령. .env, Sequelize, DB 모델, 기존 다운로드/적재 명령을 불러오지 않는다.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import XLSX from 'xlsx';
import { prepareFactoryData, renderPreparationReport, verifyFactorySource } from './factoryPreparation.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const officialUrl = (url) => {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' || !['www.yangju.go.kr', 'yjcc.yangju.go.kr'].includes(parsed.hostname)) {
    throw new Error('양주시청 HTTPS 원본 주소만 다운로드할 수 있습니다.');
  }
  return parsed;
};

export async function prepareWorkbook({ sourcePath, inputPath, outputDir, download = false }) {
  const source = JSON.parse(await fs.readFile(sourcePath, 'utf8'));
  let bytes;
  try { bytes = await fs.readFile(inputPath); }
  catch (error) {
    if (error.code !== 'ENOENT' || !download) throw error;
  }
  if (!bytes) {
    officialUrl(source.downloadUrl);
    const response = await fetch(source.downloadUrl, { signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error(`원본 다운로드 실패: HTTP ${response.status}`);
    officialUrl(response.url);
    bytes = Buffer.from(await response.arrayBuffer());
    verifyFactorySource(bytes, source);
    await fs.mkdir(path.dirname(inputPath), { recursive: true });
    await fs.writeFile(inputPath, bytes);
  }
  verifyFactorySource(bytes, source);
  const workbook = XLSX.read(bytes, { type: 'buffer' });
  const sheet = workbook.Sheets[source.sheetName];
  if (!sheet) throw new Error('출처 기록에 지정한 시트가 없습니다.');
  const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', blankrows: true });
  const result = prepareFactoryData(matrix, source);
  await fs.mkdir(outputDir, { recursive: true });
  const writeJson = (filename, data) => fs.writeFile(path.join(outputDir, filename), `${JSON.stringify(data, null, 2)}\n`);
  await writeJson('prepared.json', result);
  await writeJson('supply-candidates.json', {
    source: result.source,
    preparationVersion: result.preparationVersion,
    candidates: result.records.filter((record) => record.supply.status === 'candidate'),
    review: result.records.filter((record) => record.supply.status === 'review'),
    excluded: result.records.filter((record) => record.supply.status === 'excluded'),
  });
  await writeJson('review.json', {
    source: result.source,
    summary: result.summary,
    duplicateGroups: result.records.filter((record) => record.sourceRows.length > 1),
    issues: result.records.filter((record) => record.issues.length),
    rejected: result.rejected,
  });
  await writeJson('summary.json', { preparationVersion: result.preparationVersion, source: result.source, summary: result.summary });
  await fs.writeFile(path.join(outputDir, 'report.md'), renderPreparationReport(result));
  return result;
}

async function main() {
  const { values } = parseArgs({ options: {
    source: { type: 'string', default: 'docs/factories/yangju-2026-09-source.json' },
    input: { type: 'string' },
    out: { type: 'string' },
    download: { type: 'boolean', default: false },
  } });
  const sourcePath = path.resolve(ROOT, values.source);
  const source = JSON.parse(await fs.readFile(sourcePath, 'utf8'));
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(source.datasetMonth)) throw new Error('자료 기준월이 올바르지 않습니다.');
  const dataDir = path.join(ROOT, 'data/factories/yangju-city', source.datasetMonth);
  const result = await prepareWorkbook({
    sourcePath,
    inputPath: values.input ? path.resolve(values.input) : path.join(dataDir, 'source.xls'),
    outputDir: values.out ? path.resolve(values.out) : path.join(dataDir, 'prepared'),
    download: values.download,
  });
  console.log(JSON.stringify(result.summary, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
