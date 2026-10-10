import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createAuthLimiter } from '../src/middlewares/rateLimiters.js';
import { errorHandler } from '../src/middlewares/errorHandler.js';

test('한도를 넘으면 429 TOO_MANY_REQUESTS (가입과 로그인이 한도를 함께 쓴다)', async () => {
  const limiter = createAuthLimiter({ max: 3 });
  const app = express();
  app.post('/auth/signup', limiter, (req, res) => res.json({ ok: true }));
  app.post('/auth/login', limiter, (req, res) => res.json({ ok: true }));
  app.use(errorHandler);

  const server = app.listen(0);
  try {
    const url = (path) => `http://localhost:${server.address().port}${path}`;
    const statuses = [];
    for (const path of ['/auth/signup', '/auth/login', '/auth/login', '/auth/signup']) {
      statuses.push((await fetch(url(path), { method: 'POST' })).status);
    }
    assert.deepEqual(statuses, [200, 200, 200, 429]);

    const blocked = await fetch(url('/auth/login'), { method: 'POST' });
    const body = await blocked.json();
    assert.equal(body.error.code, 'TOO_MANY_REQUESTS');
    assert.equal(body.error.message, '요청이 너무 많아요. 잠시 후 다시 시도해 주세요');
  } finally {
    server.close();
  }
});
