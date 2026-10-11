// 받아 둔 양주시청 공장등록 엑셀을 factories 에 넣는다.
// 회사명+주소가 같고 생산품도 같으면 건너뛴다. 생산품이 다르면 수정하고, 없으면 추가한다.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import XLSX from 'xlsx';
import sequelize from '../src/db/connection.js';
import Factory from '../src/models/Factory.js';
import { planFactoryChanges, readFactoryRows } from './factorySync.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, 'data/factories/yangju-city');

async function latestDir() {
  const names = (await fs.readdir(OUT_DIR)).filter((name) => /^\d{4}-\d{2}$/.test(name)).sort();
  const stamp = names.at(-1);
  if (!stamp) throw new Error('받아 둔 공장등록 파일이 없습니다. npm run factories:pull 을 먼저 실행하세요.');
  return { stamp, dir: path.join(OUT_DIR, stamp) };
}

export async function saveFactoryWorkbook({ dir, stamp }) {
  const names = await fs.readdir(dir);
  const filename = names.find((name) => /\.xls[x]?$/i.test(name));
  if (!filename) throw new Error(`엑셀 파일이 없습니다: ${dir}`);

  const workbook = XLSX.readFile(path.join(dir, filename));
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
  const parsed = readFactoryRows(matrix);
  const dataSource = `양주시청 공장등록 ${stamp}`;

  const counts = await sequelize.transaction(async (transaction) => {
    const existing = await Factory.findAll({
      attributes: ['factory_id', 'factory_name', 'industry', 'address'],
      transaction,
    });
    const plan = planFactoryChanges(existing, parsed.rows);
    if (plan.insert.length > 0) {
      await Factory.bulkCreate(
        plan.insert.map((row) => ({ ...row, latitude: null, longitude: null, data_source: dataSource })),
        { transaction },
      );
    }
    for (const row of plan.update) {
      await Factory.update(
        { industry: row.industry, data_source: dataSource },
        { where: { factory_id: row.factory_id }, transaction },
      );
    }
    return {
      inserted: plan.insert.length,
      updated: plan.update.length,
      unchanged: plan.unchanged,
      skipped: parsed.skipped,
      duplicateInFile: parsed.duplicateInFile,
    };
  });

  console.log(
    `factories ${stamp}: 추가 ${counts.inserted}, 수정 ${counts.updated}, 그대로 ${counts.unchanged}, 빈 행 ${counts.skipped}, 파일 안 중복 ${counts.duplicateInFile}`,
  );
  return counts;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  try {
    const target = await latestDir();
    await saveFactoryWorkbook(target);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  } finally {
    await sequelize.close();
  }
}
