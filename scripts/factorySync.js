// 양주시청 공장등록 엑셀을 factories 행으로 맞춘다.
// 같은 회사명·주소는 한 공장으로 보고, 생산품·연락처·종업원수·법정동이 바뀐 것만 수정, 없는 것만 추가한다.

const NAME_MAX = 100;
const INDUSTRY_MAX = 100;
const ADDRESS_MAX = 255;
const PHONE_MAX = 20;
const DONG_MAX = 50;

function employeeCount(value) {
  const text = String(value ?? '').replace(/\s+/g, '');
  if (!/^\d+$/.test(text)) return null;
  const count = Number(text);
  return Number.isSafeInteger(count) ? count : null;
}

export function clip(value, max) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  return text.length > max ? text.slice(0, max) : text;
}

export function factoryKey(name, address) {
  const compact = (value) => String(value ?? '')
    .normalize('NFKC')
    .replace(/㈜/g, '(주)')
    .replace(/\s+/g, '')
    .toLowerCase();
  return `${compact(name)}|${compact(address)}`;
}

function columnIndex(header, label) {
  return header.findIndex((name) => name.includes(label));
}

// sheet_to_json(..., { header: 1 }) 결과. 제목 행 아래의 회사명 헤더를 찾는다.
export function readFactoryRows(matrix) {
  const headerIndex = matrix.findIndex((row) =>
    row.some((cell) => String(cell).replace(/\s/g, '') === '회사명'));
  if (headerIndex < 0) throw new Error('회사명 열을 찾지 못했습니다.');

  const header = matrix[headerIndex].map((cell) => String(cell).replace(/\s/g, ''));
  const nameCol = columnIndex(header, '회사명');
  const addressCol = columnIndex(header, '소재지');
  const productCol = columnIndex(header, '생산품');
  const phoneCol = columnIndex(header, '전화');
  const faxCol = columnIndex(header, 'FAX');
  const employeeCol = columnIndex(header, '종업원');
  const dongCol = columnIndex(header, '법정동');
  if (nameCol < 0 || addressCol < 0) throw new Error('회사명 또는 소재지 열이 없습니다.');

  const byKey = new Map();
  let skipped = 0;
  let duplicateInFile = 0;
  for (const row of matrix.slice(headerIndex + 1)) {
    const factory_name = clip(row[nameCol], NAME_MAX);
    const address = clip(row[addressCol], ADDRESS_MAX);
    if (!factory_name || !address) {
      skipped += 1;
      continue;
    }
    const product = productCol < 0 ? '' : clip(row[productCol], INDUSTRY_MAX);
    const phone = phoneCol < 0 ? '' : clip(row[phoneCol], PHONE_MAX);
    const fax = faxCol < 0 ? '' : clip(row[faxCol], PHONE_MAX);
    const legalDong = dongCol < 0 ? '' : clip(row[dongCol], DONG_MAX);
    const record = {
      factory_name,
      address,
      industry: product || null,
      phone_number: phone || null,
      fax_number: fax || null,
      employee_count: employeeCol < 0 ? null : employeeCount(row[employeeCol]),
      legal_dong: legalDong || null,
    };
    const key = factoryKey(factory_name, address);
    if (byKey.has(key)) duplicateInFile += 1;
    byKey.set(key, record);
  }
  return { rows: [...byKey.values()], skipped, duplicateInFile };
}

// existing: DB 에 이미 있는 행. incoming: 이번 파일의 행.
export function planFactoryChanges(existing, incoming) {
  const byKey = new Map(existing.map((row) => [factoryKey(row.factory_name, row.address), row]));
  const insert = [];
  const update = [];
  let unchanged = 0;
  for (const row of incoming) {
    const found = byKey.get(factoryKey(row.factory_name, row.address));
    if (!found) {
      insert.push(row);
      continue;
    }
    const tracked = ['industry', 'phone_number', 'fax_number', 'employee_count', 'legal_dong'];
    const same = tracked.every((name) => (found[name] ?? null) === (row[name] ?? null));
    if (same) {
      unchanged += 1;
      continue;
    }
    update.push({
      factory_id: found.factory_id,
      industry: row.industry ?? null,
      phone_number: row.phone_number ?? null,
      fax_number: row.fax_number ?? null,
      employee_count: row.employee_count ?? null,
      legal_dong: row.legal_dong ?? null,
    });
  }
  return { insert, update, unchanged };
}
