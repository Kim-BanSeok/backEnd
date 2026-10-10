import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';

async function withServer(fn) {
  const server = createApp().listen(0);
  try {
    await fn(`http://localhost:${server.address().port}`);
  } finally {
    server.close();
  }
}

test('GET /api/v1/health', () =>
  withServer(async (base) => {
    const res = await fetch(`${base}/api/v1/health`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { success: true, data: { status: 'ok' } });
  }));

test('없는 주소는 404 NOT_FOUND', () =>
  withServer(async (base) => {
    const res = await fetch(`${base}/api/v1/nope`);
    assert.equal(res.status, 404);
    assert.equal((await res.json()).error.code, 'NOT_FOUND');
  }));
