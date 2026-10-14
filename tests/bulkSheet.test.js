import assert from 'node:assert/strict';
import test from 'node:test';
import XLSX from '../src/spreadsheets/sheetjs.js';
import { parseBulkSheet, bulkSheetTemplate } from '../src/services/bulkSheet.service.js';

function book(rows, bookType = 'xlsx') {
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, '입력');
  return XLSX.write(workbook, { type: 'buffer', bookType });
}

const header = ['판매형태', '이름', '소재', '두께', '색', '폭', '길이', '장수', '가격'];
const validRow = ['자투리', '체크 자투리', '면', '중간 두께', '네이비', 70, 60, 4, 1000];

test('예시 행은 빼고 자투리와 롤을 줄로 읽는다', () => {
  const parsed = parseBulkSheet(book([
    header,
    ['자투리', '예시: 네이비 면 자투리', '면', '중간 두께', '네이비', 50, 70, 3, 7000],
    ['자투리', '체크 자투리', '면', '중간 두께', '네이비', 70, 60, 4, 1000],
    ['롤', '캔버스 롤', '면', '두꺼움', '베이지', 150, 270, '', 5000],
  ]));
  assert.equal(parsed.rows.length, 2);
  assert.equal(parsed.rows[0].sale_type, 'SCRAP');
  assert.equal(parsed.rows[0].sheet_count, 4);
  assert.equal(parsed.rows[0].error, '');
  assert.equal(parsed.rows[1].sale_type, 'ROLL');
  assert.equal(parsed.rows[1].sheet_count, '');
  assert.equal(parsed.rows[1].length_cm, 270);
});

test('숫자가 아니면 그 줄에 이유를 남긴다', () => {
  const parsed = parseBulkSheet(book([header, ['자투리', '잘못된 치수', '면', '얇음', '흰색', '넓음', 20, 1, 3000]]));
  assert.match(parsed.rows[0].error, /숫자/);
  assert.equal(parsed.rows[0].width_cm, '');
});

test('다운로드 양식을 작성해서 올리면 한국어와 원단 입력값을 보존한다', () => {
  const workbook = XLSX.read(bulkSheetTemplate(), { type: 'buffer' });
  XLSX.utils.sheet_add_aoa(workbook.Sheets['입력'], [validRow], { origin: 'A3' });
  const parsed = parseBulkSheet(XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }));
  assert.equal(parsed.rows.length, 1);
  assert.deepEqual(parsed.rows[0], { sale_type: 'SCRAP', title: '체크 자투리', material: '면', thickness: '중간 두께', color: '네이비', width_cm: 70, length_cm: 60, sheet_count: 4, price: 1000, error: '' });
});

test('입력 시트가 첫 시트가 아니어도 선택하며, 없으면 첫 시트를 읽는다', () => {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([header, ['롤', '첫 시트', '면', '두꺼움', '베이지', 150, 270, '', 5000]]), '다른 시트');
  const fallback = parseBulkSheet(XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }));
  assert.equal(fallback.rows[0].title, '첫 시트');
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([header, validRow]), '입력');
  assert.equal(parseBulkSheet(XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' })).rows[0].title, '체크 자투리');
});

test('40줄은 모두 읽고 41줄은 일부만 반환하지 않고 거절한다', () => {
  assert.equal(parseBulkSheet(book([header, ...Array.from({ length: 40 }, () => validRow)])).rows.length, 40);
  assert.throws(() => parseBulkSheet(book([header, ...Array.from({ length: 41 }, () => validRow)])), { code: 'VALIDATION_ERROR' });
});

for (const format of ['csv', 'html', 'biff8', 'ods', 'xlsm']) {
  test(`xlsx로 위장한 ${format} 파일은 원단 표가 있어도 거절한다`, () => {
    assert.throws(() => parseBulkSheet(book([header, validRow], format)), { code: 'VALIDATION_ERROR' });
  });
}

test('손상된 ZIP 파일은 입력 오류로 거절한다', () => {
  assert.throws(() => parseBulkSheet(Buffer.from('504b0304000000', 'hex')), { code: 'VALIDATION_ERROR' });
});

for (const [label, address, ref] of [['행', 'A1001', 'A1:I1001'], ['열', 'BM2', 'A1:BM2']]) {
  test(`입력 시트의 과도한 ${label} 범위는 JSON 배열을 만들기 전에 거절한다`, () => {
    const workbook = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet([header, validRow]);
    sheet[address] = { t: 's', v: '범위 밖' };
    sheet['!ref'] = ref;
    XLSX.utils.book_append_sheet(workbook, sheet, '입력');
    assert.throws(() => parseBulkSheet(XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' })), { code: 'VALIDATION_ERROR' });
  });
}

test('기존 XLS 공장 자료의 한글과 특수문자를 유지한다', () => {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['회사명', 'café', '€']]), '공장등록현황');
  const bytes = XLSX.write(workbook, { type: 'buffer', bookType: 'biff8' });
  const restored = XLSX.read(bytes, { type: 'buffer' });
  assert.deepEqual(XLSX.utils.sheet_to_json(restored.Sheets['공장등록현황'], { header: 1 }), [['회사명', 'café', '€']]);
});
