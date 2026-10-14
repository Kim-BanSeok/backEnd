import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApp } from '../src/app.js';
import XLSX from '../src/spreadsheets/sheetjs.js';
import { bulkSheetTemplate } from '../src/services/bulkSheet.service.js';
import { signToken } from '../src/services/auth.service.js';
import { db, resetDb, makeUser, makeStore } from './helpers.js';

let server, origin;
before(async () => {
  server = createApp().listen(0, '127.0.0.1');
  await once(server, 'listening');
  origin = `http://127.0.0.1:${server.address().port}/api/v1/sellers/me/fabric-sheet`;
});
beforeEach(resetDb);
after(async () => {
  await new Promise(resolve => server.close(resolve));
  await db.sequelize.close();
});
async function sellerToken() {
  const { seller } = await makeStore();
  return signToken(seller);
}
async function upload(bytes, token, filename = 'fabrics.xlsx') {
  const form = new FormData();
  form.append('file', new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), filename);
  const response = await fetch(origin, { method: 'POST', headers: token ? { Authorization: `Bearer ${token}` } : {}, body: form });
  return { status: response.status, json: await response.json() };
}
async function snapshot() {
  const result = {};
  for (const name of ['User', 'Store', 'Fabric', 'FabricDetail', 'Reservation', 'AiSession', 'AiUsageBucket', 'AiUsageLease']) {
    result[name] = await db[name].findAll({ raw: true });
  }
  return result;
}

test('판매자가 다운로드한 양식을 올리면 200과 기존 원단 행 응답을 받으며 DB에 저장하지 않는다', async () => {
  const token = await sellerToken();
  const before = await snapshot();
  const downloaded = await fetch(origin, { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(downloaded.status, 200);
  assert.match(downloaded.headers.get('content-type'), /spreadsheetml.sheet/);
  assert.match(downloaded.headers.get('content-disposition'), /fabring-fabrics.xlsx/);
  const workbook = XLSX.read(Buffer.from(await downloaded.arrayBuffer()), { type: 'buffer' });
  XLSX.utils.sheet_add_aoa(workbook.Sheets['입력'], [['롤', '면 롤', '면', '중간 두께', '네이비', 150, 270, '', 5000]], { origin: 'A3' });
  const response = await upload(XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }), token);
  assert.equal(response.status, 200);
  assert.deepEqual(response.json, { success: true, data: { rows: [{ sale_type: 'ROLL', title: '면 롤', material: '면', thickness: '중간 두께', color: '네이비', width_cm: 150, length_cm: 270, sheet_count: '', price: 5000, error: '' }] } });
  assert.deepEqual(await snapshot(), before);
});

test('xlsx 파일 업로드는 로그인과 판매자 권한을 검사한다', async () => {
  assert.equal((await upload(bulkSheetTemplate())).status, 401);
  const buyer = await makeUser();
  assert.equal((await upload(bulkSheetTemplate(), signToken(buyer))).status, 403);
});

test('정상 확장자와 MIME으로 위장한 CSV를 400으로 거절하고 DB를 변경하지 않는다', async () => {
  const token = await sellerToken();
  const before = await snapshot();
  const bytes = Buffer.from('판매형태,이름,소재,두께,색,폭,길이,장수,가격\n자투리,면,면,중간 두께,네이비,50,60,1,1000');
  const response = await upload(bytes, token);
  assert.equal(response.status, 400);
  assert.equal(response.json.error.code, 'VALIDATION_ERROR');
  assert.deepEqual(await snapshot(), before);
});

test('2MB를 넘는 파일과 xlsx가 아닌 확장자를 기존 입력 오류로 거절한다', async () => {
  const token = await sellerToken();
  const before = await snapshot();
  for (const [bytes, filename] of [[Buffer.alloc(2 * 1024 * 1024 + 1), 'fabrics.xlsx'], [bulkSheetTemplate(), 'fabrics.xls']]) {
    const response = await upload(bytes, token, filename);
    assert.equal(response.status, 400);
    assert.equal(response.json.error.code, 'VALIDATION_ERROR');
  }
  assert.deepEqual(await snapshot(), before);
});

test('과도한 입력 시트 범위는 400으로 거절하고 다음 요청도 처리한다', async () => {
  const token = await sellerToken();
  const before = await snapshot();
  const workbook = XLSX.read(bulkSheetTemplate(), { type: 'buffer' });
  workbook.Sheets['입력']['!ref'] = 'A1:BM2';
  const response = await upload(XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }), token);
  assert.equal(response.status, 400);
  assert.equal(response.json.error.code, 'VALIDATION_ERROR');
  assert.deepEqual(await snapshot(), before);
  assert.equal((await fetch(origin, { headers: { Authorization: `Bearer ${token}` } })).status, 200);
});
