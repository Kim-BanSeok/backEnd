import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { createApp } from '../src/app.js';
import { signToken } from '../src/services/auth.service.js';
import { setProvider } from '../src/ai/index.js';
import { db, resetDb, makeUser, makeStore } from './helpers.js';

let server;
let base;

before(async () => {
  await resetDb();
  server = createApp().listen(0);
  base = `http://localhost:${server.address().port}/api/v1`;
});
beforeEach(async () => {
  await resetDb();
  setProvider();
});
after(async () => {
  setProvider();
  server.close();
  await db.sequelize.close();
});

const png = () => sharp({ create: { width: 2, height: 2, channels: 3, background: { r: 20, g: 40, b: 80 } } }).png().toBuffer();

async function send(token, buffer, filename = 'fabric.png') {
  const form = new FormData();
  form.append('file', new Blob([buffer]), filename);
  const res = await fetch(`${base}/ai/fabric-photo`, {
    method: 'POST',
    headers: { ...(token && { Authorization: `Bearer ${token}` }) },
    body: form,
  });
  return { status: res.status, json: await res.json() };
}

test('사진 초안: 승인된 판매자는 200, 목록 밖 값은 비우고 저장하지 않는다', async () => {
  const { seller } = await makeStore();
  setProvider({
    name: 'stub',
    model: 'stub',
    async describeImage() {
      return {
        values: {
          title: '  네이비 면  ',
          material: 'SILK',
          thickness: 'THIN',
          color_family: 'NAVY',
          has_defect: false,
          defect_note: '무시',
          price: 3000,
        },
        usage: { input_tokens: 1, output_tokens: 1 },
      };
    },
  });
  const { status, json } = await send(signToken(seller), await png());
  assert.equal(status, 200, JSON.stringify(json));
  assert.deepEqual(json.data, {
    title: '네이비 면',
    material: null,
    thickness: 'THIN',
    color_family: 'NAVY',
    has_defect: false,
    defect_note: null,
  });
  assert.equal(await db.Fabric.count(), 0);
});

test('사진 초안: 가짜 AI 는 사진을 보지 않고 빈 초안을 돌려준다', async () => {
  const { seller } = await makeStore();
  const { status, json } = await send(signToken(seller), await png());
  assert.equal(status, 200);
  assert.deepEqual(json.data, {
    title: null, material: null, thickness: null, color_family: null, has_defect: null, defect_note: null,
  });
});

test('사진 초안: 로그인·권한·매장·파일 형식·AI 실패', async () => {
  assert.equal((await send(null, await png())).json.error.code, 'UNAUTHORIZED');

  const buyer = await makeUser({ role: 'BUYER' });
  assert.equal((await send(signToken(buyer), await png())).json.error.code, 'FORBIDDEN');

  const pending = await makeUser({ role: 'SELLER', seller_approval_status: 'PENDING' });
  assert.equal((await send(signToken(pending), await png())).json.error.code, 'SELLER_NOT_APPROVED');

  const noStore = await makeUser({ role: 'SELLER', seller_approval_status: 'APPROVED' });
  assert.equal((await send(signToken(noStore), await png())).json.error.code, 'STORE_REQUIRED');

  const { seller } = await makeStore();
  const bad = await send(signToken(seller), Buffer.from('not an image'));
  assert.equal(bad.status, 400);
  assert.equal(bad.json.error.code, 'IMAGE_TOO_LARGE');

  setProvider({ name: 'down', model: 'down', async describeImage() { throw new Error('down'); } });
  const failed = await send(signToken(seller), await png());
  assert.equal(failed.status, 503);
  assert.equal(failed.json.error.code, 'AI_UNAVAILABLE');
});
