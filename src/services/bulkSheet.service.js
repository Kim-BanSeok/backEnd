import XLSX from 'xlsx';
import { fail } from '../utils/errors.js';

const HEADERS = ['판매형태', '이름', '소재', '두께', '색', '폭', '길이', '장수', '가격'];
const MATERIALS = ['면', '린넨', '폴리에스터', '나일론', '레이온', '울', '혼방', '기타', '미확인'];
const THICKNESS = ['얇음', '중간 두께', '두꺼움'];
const COLORS = ['흰색', '검정', '회색', '베이지', '갈색', '빨강', '분홍', '노랑', '초록', '블루', '네이비', '보라', '혼합'];
const MAX_ROWS = 40;

const cell = (value) => String(value ?? '').trim();

function integerCell(value) {
  const text = cell(value).replace(/,/g, '');
  if (!text) return '';
  if (!/^\d+$/.test(text)) return null;
  const number = Number(text);
  return Number.isSafeInteger(number) ? number : null;
}

function headerIndex(row) {
  const names = row.map(cell);
  return HEADERS.every((name) => names.includes(name)) ? names : null;
}

export function parseBulkSheet(buffer) {
  let book;
  try {
    book = XLSX.read(buffer, { type: 'buffer' });
  } catch {
    throw fail('VALIDATION_ERROR', [{ field: 'file', message: '엑셀 파일을 읽지 못했어요. xlsx 파일을 올려 주세요.' }]);
  }
  const sheet = book.Sheets['입력'] || book.Sheets[book.SheetNames[0]];
  if (!sheet) throw fail('VALIDATION_ERROR', [{ field: 'file', message: '입력 시트가 없어요.' }]);
  const grid = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '' });
  const headerAt = grid.findIndex((row) => headerIndex(row));
  if (headerAt < 0) throw fail('VALIDATION_ERROR', [{ field: 'file', message: '첫 줄에 판매형태, 이름, 소재, 두께, 색, 폭, 길이, 장수, 가격이 있어야 해요.' }]);
  const names = headerIndex(grid[headerAt]);
  const column = Object.fromEntries(HEADERS.map((name) => [name, names.indexOf(name)]));
  const rows = [];
  for (const line of grid.slice(headerAt + 1)) {
    const pick = (name) => cell(line[column[name]]);
    if (HEADERS.every((name) => !pick(name))) continue;
    const title = pick('이름');
    if (title.startsWith('예시')) continue;
    const kind = pick('판매형태');
    const saleType = /롤|ROLL/i.test(kind) ? 'ROLL' : /자투리|SCRAP/i.test(kind) ? 'SCRAP' : '';
    const width = integerCell(pick('폭'));
    const length = integerCell(pick('길이'));
    const sheets = integerCell(pick('장수'));
    const price = integerCell(pick('가격'));
    const material = pick('소재');
    const thickness = pick('두께');
    const color = pick('색');
    const problems = [];
    if (!saleType) problems.push('판매형태는 자투리 또는 롤로 적어 주세요.');
    if (!title) problems.push('이름을 적어 주세요.');
    if (material && !MATERIALS.includes(material)) problems.push('소재는 양식의 목록과 같은 글자로 적어 주세요.');
    if (thickness && !THICKNESS.includes(thickness)) problems.push('두께는 얇음, 중간 두께, 두꺼움 중 하나로 적어 주세요.');
    if (color && !COLORS.includes(color)) problems.push('색은 양식의 목록과 같은 글자로 적어 주세요.');
    const missing = (value) => value === '' || value === null;
    if (missing(width) || missing(length) || missing(price) || (saleType !== 'ROLL' && missing(sheets))) problems.push('폭, 길이, 가격은 숫자로 적고, 자투리는 장수도 숫자로 적어 주세요.');
    rows.push({
      sale_type: saleType || 'SCRAP',
      title,
      material: MATERIALS.includes(material) ? material : '면',
      thickness: THICKNESS.includes(thickness) ? thickness : '중간 두께',
      color: COLORS.includes(color) ? color : '네이비',
      width_cm: width ?? '',
      length_cm: length ?? '',
      sheet_count: saleType === 'ROLL' ? '' : (sheets ?? ''),
      price: price ?? '',
      error: problems.join(' '),
    });
    if (rows.length > MAX_ROWS) throw fail('VALIDATION_ERROR', [{ field: 'file', message: `한 번에 ${MAX_ROWS}줄까지 올릴 수 있어요.` }]);
  }
  if (!rows.length) throw fail('VALIDATION_ERROR', [{ field: 'file', message: '올릴 원단 줄이 없어요. 예시 행 아래에 원단을 적어 주세요.' }]);
  return { rows };
}

export function bulkSheetTemplate() {
  const input = XLSX.utils.aoa_to_sheet([
    HEADERS,
    ['자투리', '예시: 네이비 면 자투리', '면', '중간 두께', '네이비', 50, 70, 3, 7000],
  ]);
  input['!cols'] = HEADERS.map((name) => ({ wch: Math.max(name.length + 2, 12) }));
  const guide = XLSX.utils.aoa_to_sheet([
    ['입력 시트 2행은 예시입니다. 예시로 시작하는 이름은 올리지 않습니다. 3행부터 실제 원단을 적으세요.'],
    ['판매형태', '자투리 또는 롤'],
    ['롤', '장수는 비우고, 길이는 90 이상'],
    ['자투리', '길이는 1 이상, 장수는 1 이상'],
    ['소재', MATERIALS.join(', ')],
    ['두께', THICKNESS.join(', ')],
    ['색', COLORS.join(', ')],
    ['사진과 소개', '엑셀에는 넣지 않습니다. 올린 뒤 화면에서 사진을 고르면 그 줄만 AI 소개를 씁니다.'],
  ]);
  guide['!cols'] = [{ wch: 16 }, { wch: 72 }];
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, input, '입력');
  XLSX.utils.book_append_sheet(book, guide, '작성법');
  return XLSX.write(book, { type: 'buffer', bookType: 'xlsx' });
}
