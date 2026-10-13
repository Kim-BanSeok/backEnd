import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { access, readdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { createApp } from '../src/app.js';
import { env } from '../src/config/env.js';
import { storage } from '../src/storage/index.js';
import { signToken } from '../src/services/auth.service.js';
import { db, resetDb, makeUser, makeStore, makeFabric } from './helpers.js';

let server;
let origin;
let base;

const wipeUploads = () => rm(env.uploadDir, { recursive: true, force: true });

before(async () => {
  await resetDb();
  await wipeUploads();
  server = createApp().listen(0);
  origin = `http://localhost:${server.address().port}`;
  base = `${origin}/api/v1`;
});
beforeEach(async () => {
  await resetDb();
  await wipeUploads();
});
after(async () => {
  server.close();
  await wipeUploads();
  await db.sequelize.close();
});

// ---- 도우미

const makeImage = (format = 'png', { width = 800, height = 600 } = {}) =>
  sharp({ create: { width, height, channels: 3, background: '#336699' } })[format]().toBuffer();

async function upload(fabricId, { token, file, name = 'photo.png', type = 'image/png', fields = {}, fieldName = 'file' } = {}) {
  const form = new FormData();
  if (file) form.append(fieldName, new Blob([file], { type }), name);
  for (const [key, value] of Object.entries(fields)) form.append(key, value);
  const res = await fetch(`${base}/fabrics/${fabricId}/images`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: form,
  });
  return { status: res.status, json: await res.json() };
}

async function remove(fabricId, imageId, token) {
  const res = await fetch(`${base}/fabrics/${fabricId}/images/${imageId}`, {
    method: 'DELETE',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  return { status: res.status, json: await res.json() };
}

// 판매자 + 매장 + 원단
async function setup() {
  const { seller, store } = await makeStore();
  const fabric = await makeFabric(store.store_id);
  return { seller, store, fabric, token: signToken(seller), fabricId: fabric.fabric_id };
}

const fileOf = (url) => path.join(env.uploadDir, storage.keyOf(url));
const exists = (file) => access(file).then(() => true, () => false);

// 저장 폴더 안의 모든 파일 이름
async function filesOnDisk() {
  const out = [];
  const walk = async (dir) => {
    for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else out.push(full);
    }
  };
  await walk(env.uploadDir);
  return out;
}

const orders = async (fabricId) =>
  (await db.FabricImage.findAll({ where: { fabric_id: fabricId }, order: [['sort_order', 'ASC']] })).map((i) => i.sort_order);

// ---- 15. 사진 업로드: 성공

test('업로드 성공: 201 { imageId, image_url, thumbnail_url, sort_order: 0 }', async () => {
  const { token, fabricId } = await setup();
  const { status, json } = await upload(fabricId, { token, file: await makeImage(), fields: { image_type: 'FULL' } });
  assert.equal(status, 201);
  assert.equal(json.success, true);
  assert.deepEqual(Object.keys(json.data).sort(), ['imageId', 'image_url', 'sort_order', 'thumbnail_url']);
  assert.equal(typeof json.data.imageId, 'number');
  assert.equal(json.data.sort_order, 0);
  assert.match(new URL(json.data.image_url).pathname, new RegExp(`/uploads/fabrics/${fabricId}/[0-9a-f-]{36}\\.png$`));
  assert.match(new URL(json.data.thumbnail_url).pathname, new RegExp(`/uploads/fabrics/${fabricId}/thumbs/[0-9a-f-]{36}\\.webp$`));
  assert.ok(new URL(json.data.image_url).searchParams.has('signature'));

  const saved = await db.FabricImage.findByPk(json.data.imageId);
  assert.equal(saved.fabric_id, fabricId);
  assert.equal(saved.image_type, 'FULL');
  assert.equal(new URL(saved.image_url).pathname, new URL(json.data.image_url).pathname);
});

test('원본은 안전하게 재인코딩하고 썸네일은 가로 400px 의 webp 로 저장된다', async () => {
  const { token, fabricId } = await setup();
  const original = await makeImage('jpeg', { width: 1200, height: 900 });
  const { json } = await upload(fabricId, { token, file: original, name: 'big.jpg', type: 'image/jpeg' });

  assert.match(new URL(json.data.image_url).pathname, /\.jpg$/);
  const clean = await sharp(await readFile(fileOf(json.data.image_url))).metadata();
  assert.equal(clean.width, 1200);
  assert.equal(clean.height, 900);
  assert.equal(clean.exif, undefined);

  const thumb = await sharp(await readFile(fileOf(json.data.thumbnail_url))).metadata();
  assert.equal(thumb.format, 'webp');
  assert.equal(thumb.width, 400);
  assert.equal(thumb.height, 300);
});

test('jpg, png, webp 모두 올릴 수 있다', async () => {
  const { token, fabricId } = await setup();
  for (const [format, ext] of [['jpeg', 'jpg'], ['png', 'png'], ['webp', 'webp']]) {
    const { status, json } = await upload(fabricId, { token, file: await makeImage(format), name: `a.${ext}` });
    assert.equal(status, 201, format);
    assert.match(new URL(json.data.image_url).pathname, new RegExp(`\\.${ext}$`));
  }
});

test('확장자가 아니라 파일 내용으로 판별한다', async () => {
  const { token, fabricId } = await setup();
  // 이름은 .txt 지만 내용은 png → 올릴 수 있다 (확장자는 내용에 맞춰 .png 로 저장)
  const real = await upload(fabricId, { token, file: await makeImage('png'), name: 'photo.txt', type: 'text/plain' });
  assert.equal(real.status, 201);
  assert.match(new URL(real.json.data.image_url).pathname, /\.png$/);

  // 이름은 .png 지만 내용은 텍스트 → IMAGE_TOO_LARGE
  const fake = await upload(fabricId, { token, file: Buffer.from('이건 이미지가 아니에요'), name: 'fake.png' });
  assert.equal(fake.status, 400);
  assert.equal(fake.json.error.code, 'IMAGE_TOO_LARGE');
});

test('작은 사진은 썸네일을 억지로 키우지 않는다', async () => {
  const { token, fabricId } = await setup();
  const { json } = await upload(fabricId, { token, file: await makeImage('png', { width: 200, height: 100 }) });
  const thumb = await sharp(await readFile(fileOf(json.data.thumbnail_url))).metadata();
  assert.equal(thumb.width, 200);
});

test('image_type 은 선택이고, 비어 있으면 null', async () => {
  const { token, fabricId } = await setup();
  const none = await upload(fabricId, { token, file: await makeImage() });
  const empty = await upload(fabricId, { token, file: await makeImage(), fields: { image_type: '' } });
  assert.equal(none.status, 201);
  assert.equal(empty.status, 201);
  assert.equal((await db.FabricImage.findByPk(none.json.data.imageId)).image_type, null);
  assert.equal((await db.FabricImage.findByPk(empty.json.data.imageId)).image_type, null);
});

// ---- 15. 3장 제한과 순서

test('올린 순서대로 sort_order 0, 1, 2 이고 4장째는 IMAGE_LIMIT_EXCEEDED (파일도 남지 않는다)', async () => {
  const { token, fabricId } = await setup();
  for (const expected of [0, 1, 2]) {
    const { status, json } = await upload(fabricId, { token, file: await makeImage() });
    assert.equal(status, 201);
    assert.equal(json.data.sort_order, expected);
  }
  const fourth = await upload(fabricId, { token, file: await makeImage() });
  assert.equal(fourth.status, 400);
  assert.equal(fourth.json.error.code, 'IMAGE_LIMIT_EXCEEDED');
  assert.equal(fourth.json.error.message, '사진은 3장까지 올릴 수 있어요');
  assert.equal(await db.FabricImage.count(), 3);
  assert.equal((await filesOnDisk()).length, 6); // 원본 3 + 썸네일 3
});

test('동시에 6장을 올려도 3장만 저장되고 순서가 겹치지 않는다', async () => {
  const { token, fabricId } = await setup();
  const file = await makeImage();
  const results = await Promise.all(Array.from({ length: 6 }, () => upload(fabricId, { token, file })));

  assert.equal(results.filter((r) => r.status === 201).length, 3);
  assert.ok(results.filter((r) => r.status !== 201).every((r) => r.json.error.code === 'IMAGE_LIMIT_EXCEEDED'));
  assert.deepEqual(await orders(fabricId), [0, 1, 2]);
  assert.equal((await filesOnDisk()).length, 6); // 거절된 요청이 올린 파일은 지워진다
});

test('원단 행 잠금: 개수를 센 뒤 저장하기까지 틈이 길어져도 3장·순서 중복이 생기지 않는다', async () => {
  const { token, fabricId } = await setup();
  const file = await makeImage();

  // 트랜잭션 안에서 개수를 센 직후에 잠깐 멈춰서, 잠금이 없으면 모두 같은 개수를 보고 같은 순서로 저장하려는 상황을 만든다.
  const originalCount = db.FabricImage.count.bind(db.FabricImage);
  db.FabricImage.count = async (options) => {
    const result = await originalCount(options);
    if (options?.transaction) await new Promise((resolve) => setTimeout(resolve, 80));
    return result;
  };
  let results;
  try {
    results = await Promise.all(Array.from({ length: 5 }, () => upload(fabricId, { token, file })));
  } finally {
    db.FabricImage.count = originalCount;
  }

  assert.deepEqual(results.map((r) => r.status).sort(), [201, 201, 201, 400, 400]);
  assert.ok(results.filter((r) => r.status === 400).every((r) => r.json.error.code === 'IMAGE_LIMIT_EXCEEDED'));
  assert.deepEqual(await orders(fabricId), [0, 1, 2]);
  assert.equal((await filesOnDisk()).length, 6);
});

test('DB 저장에 실패하면 이미 올린 파일을 지운다', async () => {
  const { token, fabricId } = await setup();
  const original = db.FabricImage.create;
  db.FabricImage.create = async () => {
    throw new Error('DB 저장 실패(시험용)');
  };
  try {
    const { status, json } = await upload(fabricId, { token, file: await makeImage() });
    assert.equal(status, 500);
    assert.equal(json.error.code, 'INTERNAL_ERROR');
  } finally {
    db.FabricImage.create = original;
  }
  assert.equal(await db.FabricImage.count(), 0);
  assert.deepEqual(await filesOnDisk(), []);
});

// ---- 15. 입력 오류

test('5MB 를 넘으면 IMAGE_TOO_LARGE, 5MB 정확히는 통과 크기', async () => {
  const { token, fabricId } = await setup();
  const tooBig = Buffer.alloc(5 * 1024 * 1024 + 1, 1);
  const { status, json } = await upload(fabricId, { token, file: tooBig });
  assert.equal(status, 400);
  assert.equal(json.error.code, 'IMAGE_TOO_LARGE');
  assert.equal(json.error.message, '5MB 이하의 jpg·png·webp만 올릴 수 있어요');
  assert.equal(await db.FabricImage.count(), 0);
  assert.deepEqual(await filesOnDisk(), []);
});

test('jpg·png·webp 가 아닌 이미지(gif, svg)와 깨진 이미지는 IMAGE_TOO_LARGE', async () => {
  const { token, fabricId } = await setup();
  const gif = await sharp({ create: { width: 10, height: 10, channels: 3, background: '#fff' } }).gif().toBuffer();
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>');
  const truncated = (await makeImage('png')).subarray(0, 60); // 중간에 잘린 png
  for (const [label, file, name] of [['gif', gif, 'a.gif'], ['svg', svg, 'a.svg'], ['깨진 png', truncated, 'a.png']]) {
    const { status, json } = await upload(fabricId, { token, file, name });
    assert.equal(status, 400, label);
    assert.equal(json.error.code, 'IMAGE_TOO_LARGE', label);
  }
  assert.equal(await db.FabricImage.count(), 0);
  assert.deepEqual(await filesOnDisk(), []);
});

test('파일이 없거나 다른 이름의 필드로 보내면 VALIDATION_ERROR', async () => {
  const { token, fabricId } = await setup();
  const noFile = await upload(fabricId, { token });
  assert.equal(noFile.status, 400);
  assert.equal(noFile.json.error.code, 'VALIDATION_ERROR');
  assert.equal(noFile.json.error.details[0].field, 'file');

  const wrongName = await upload(fabricId, { token, file: await makeImage(), fieldName: 'photo' });
  assert.equal(wrongName.status, 400);
  assert.equal(wrongName.json.error.code, 'VALIDATION_ERROR');

  // multipart 가 아닌 JSON 으로 보냄
  const res = await fetch(`${base}/fabrics/${fabricId}/images`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ file: 'x' }),
  });
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error.details[0].field, 'file');
  assert.deepEqual(await filesOnDisk(), []);
});

test('image_type 이 목록에 없으면 VALIDATION_ERROR 이고 파일은 저장되지 않는다', async () => {
  const { token, fabricId } = await setup();
  const { status, json } = await upload(fabricId, { token, file: await makeImage(), fields: { image_type: 'BIG' } });
  assert.equal(status, 400);
  assert.equal(json.error.code, 'VALIDATION_ERROR');
  assert.ok(json.error.details.some((d) => d.field === 'image_type'));
  assert.deepEqual(await filesOnDisk(), []);
});

test('fabricId 가 숫자가 아니면 VALIDATION_ERROR', async () => {
  const { token } = await setup();
  for (const id of ['abc', '0', '-1', '1.5']) {
    const { status, json } = await upload(id, { token, file: await makeImage() });
    assert.equal(status, 400, id);
    assert.equal(json.error.code, 'VALIDATION_ERROR');
    assert.ok(json.error.details.some((d) => d.field === 'fabricId'));
  }
});

// ---- 15. 권한

test('로그인 안 함 401, 구매자·운영팀 403', async () => {
  const { fabricId } = await setup();
  const file = await makeImage();
  const noToken = await upload(fabricId, { file });
  assert.equal(noToken.status, 401);
  assert.equal(noToken.json.error.code, 'UNAUTHORIZED');

  for (const role of ['BUYER', 'ADMIN']) {
    const token = signToken(await makeUser({ role }));
    const { status, json } = await upload(fabricId, { token, file });
    assert.equal(status, 403, role);
    assert.equal(json.error.code, 'FORBIDDEN');
  }
  assert.deepEqual(await filesOnDisk(), []);
});

test('남의 원단에는 올릴 수 없다 (403), 없거나 삭제된 원단은 404', async () => {
  const mine = await setup();
  const other = await setup();
  const file = await makeImage();

  const forbidden = await upload(other.fabricId, { token: mine.token, file });
  assert.equal(forbidden.status, 403);
  assert.equal(forbidden.json.error.code, 'FORBIDDEN');

  const missing = await upload(99999, { token: mine.token, file });
  assert.equal(missing.status, 404);
  assert.equal(missing.json.error.code, 'NOT_FOUND');

  await mine.fabric.destroy(); // 삭제 표시된 원단
  const deleted = await upload(mine.fabricId, { token: mine.token, file });
  assert.equal(deleted.status, 404);

  assert.equal(await db.FabricImage.count(), 0);
  assert.deepEqual(await filesOnDisk(), []);
});

// ---- 올린 사진 보여 주기

test('올린 사진은 image_url 주소로 볼 수 있고, 다른 사이트에서도 불러올 수 있다', async () => {
  const { token, fabricId } = await setup();
  const original = await makeImage('png');
  const { json } = await upload(fabricId, { token, file: original });

  const privateUrl = new URL(json.data.image_url);
  assert.equal((await fetch(origin + privateUrl.pathname)).status, 404);
  const res = await fetch(origin + privateUrl.pathname + privateUrl.search);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'image/png');
  assert.equal(res.headers.get('cross-origin-resource-policy'), 'cross-origin');
  assert.equal((await sharp(Buffer.from(await res.arrayBuffer())).metadata()).format, 'png');

  const thumbUrl = new URL(json.data.thumbnail_url);
  const thumb = await fetch(origin + thumbUrl.pathname + thumbUrl.search);
  assert.equal(thumb.headers.get('content-type'), 'image/webp');
});

test('저장 폴더 밖의 파일은 읽을 수 없다', async () => {
  for (const attack of ['/uploads/../package.json', '/uploads/%2e%2e/package.json', '/uploads/..%2fpackage.json']) {
    const res = await fetch(origin + attack);
    assert.notEqual(res.status, 200, attack);
  }
  await assert.rejects(() => storage.put('../escape.txt', Buffer.from('x')), /잘못된 저장 경로/);
});

// ---- 16. 사진 삭제

test('삭제 성공: 200 data null, DB 와 저장소 파일이 모두 지워진다', async () => {
  const { token, fabricId } = await setup();
  const { json: up } = await upload(fabricId, { token, file: await makeImage() });
  const files = [fileOf(up.data.image_url), fileOf(up.data.thumbnail_url)];
  assert.ok(await exists(files[0]) && (await exists(files[1])));

  const { status, json } = await remove(fabricId, up.data.imageId, token);
  assert.equal(status, 200);
  assert.deepEqual(json, { success: true, data: null });
  assert.equal(await db.FabricImage.count(), 0);
  assert.equal(await exists(files[0]), false);
  assert.equal(await exists(files[1]), false);
});

test('중간 사진을 지우면 남은 사진의 sort_order 를 0부터 다시 매긴다', async () => {
  const { token, fabricId } = await setup();
  const ids = [];
  for (let i = 0; i < 3; i += 1) ids.push((await upload(fabricId, { token, file: await makeImage() })).json.data.imageId);

  assert.equal((await remove(fabricId, ids[0], token)).status, 200); // 대표 사진을 지움
  assert.deepEqual(await orders(fabricId), [0, 1]);
  const rest = await db.FabricImage.findAll({ where: { fabric_id: fabricId }, order: [['sort_order', 'ASC']] });
  assert.deepEqual(rest.map((i) => i.image_id), [ids[1], ids[2]]); // 두 번째 사진이 새 대표가 된다

  // 지운 자리에 다시 올리면 마지막 순서로 들어간다
  const again = await upload(fabricId, { token, file: await makeImage() });
  assert.equal(again.status, 201);
  assert.equal(again.json.data.sort_order, 2);
  assert.deepEqual(await orders(fabricId), [0, 1, 2]);
});

test('3장을 채운 뒤 하나 지우면 다시 올릴 수 있다', async () => {
  const { token, fabricId } = await setup();
  const ids = [];
  for (let i = 0; i < 3; i += 1) ids.push((await upload(fabricId, { token, file: await makeImage() })).json.data.imageId);
  assert.equal((await upload(fabricId, { token, file: await makeImage() })).status, 400);

  await remove(fabricId, ids[1], token);
  assert.equal((await upload(fabricId, { token, file: await makeImage() })).status, 201);
});

test('삭제 권한: 로그인 안 함 401, 구매자·운영팀 403, 남의 원단 403', async () => {
  const mine = await setup();
  const other = await setup();
  const { json: up } = await upload(mine.fabricId, { token: mine.token, file: await makeImage() });
  const imageId = up.data.imageId;

  assert.equal((await remove(mine.fabricId, imageId)).status, 401);
  for (const role of ['BUYER', 'ADMIN']) {
    const { status, json } = await remove(mine.fabricId, imageId, signToken(await makeUser({ role })));
    assert.equal(status, 403, role);
    assert.equal(json.error.code, 'FORBIDDEN');
  }
  const forbidden = await remove(mine.fabricId, imageId, other.token);
  assert.equal(forbidden.status, 403);
  assert.equal(forbidden.json.error.code, 'FORBIDDEN');

  assert.equal(await db.FabricImage.count(), 1); // 아무것도 지워지지 않았다
  assert.equal(await exists(fileOf(up.data.image_url)), true);
});

test('삭제 오류: 없는 사진, 다른 원단의 사진, 없는 원단은 404, 숫자가 아닌 번호는 400', async () => {
  const a = await setup();
  const b = await setup();
  const { json: upB } = await upload(b.fabricId, { token: b.token, file: await makeImage() });

  const missing = await remove(a.fabricId, 99999, a.token);
  assert.equal(missing.status, 404);
  assert.equal(missing.json.error.code, 'NOT_FOUND');

  // 내 원단 주소에 남의 사진 번호를 넣어도 지워지지 않는다
  const crossed = await remove(a.fabricId, upB.data.imageId, a.token);
  assert.equal(crossed.status, 404);
  assert.equal(await db.FabricImage.count(), 1);

  assert.equal((await remove(99999, 1, a.token)).status, 404);

  for (const [fabricId, imageId] of [['abc', 1], [a.fabricId, 'abc'], [a.fabricId, 0]]) {
    const { status, json } = await remove(fabricId, imageId, a.token);
    assert.equal(status, 400, `${fabricId}/${imageId}`);
    assert.equal(json.error.code, 'VALIDATION_ERROR');
  }
});

test('같은 사진을 두 번 지우면 두 번째는 404', async () => {
  const { token, fabricId } = await setup();
  const { json: up } = await upload(fabricId, { token, file: await makeImage() });
  assert.equal((await remove(fabricId, up.data.imageId, token)).status, 200);
  assert.equal((await remove(fabricId, up.data.imageId, token)).status, 404);
});

test('같은 사진을 동시에 여러 번 지워도 한 번만 성공한다', async () => {
  const { token, fabricId } = await setup();
  const { json: up } = await upload(fabricId, { token, file: await makeImage() });
  const results = await Promise.all(Array.from({ length: 4 }, () => remove(fabricId, up.data.imageId, token)));
  assert.equal(results.filter((r) => r.status === 200).length, 1);
  assert.ok(results.filter((r) => r.status !== 200).every((r) => r.status === 404));
});
