import assert from 'node:assert/strict';
import test from 'node:test';
import XLSX from 'xlsx';
import { parseBulkSheet } from '../src/services/bulkSheet.service.js';

function book(rows) {
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, '입력');
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
}

const header = ['판매형태', '이름', '소재', '두께', '색', '폭', '길이', '장수', '가격'];

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
