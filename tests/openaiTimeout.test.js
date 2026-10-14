import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createOpenaiProvider } from '../src/ai/openaiProvider.js';

const body = {
  choices: [{ message: { content: '{"material":"COTTON","title":"면 원단","description":"소개","parts":[]}' } }],
  usage: { prompt_tokens: 80, completion_tokens: 12 },
};
const operations = [
  ['답변 추출', provider => provider.extract({ question: { field: 'material' }, text: '면', draft: {} })],
  ['사진 분석', provider => provider.describeImage({ mediaType: 'image/png', data: 'test' })],
  ['상품 소개', provider => provider.describeProduct({ text: '면 원단', images: [] })],
  ['도안 생성', provider => provider.draftPattern({ itemName: '파우치', note: null, fabric: { width_cm: 100, length_cm: 100 } })],
];

for (const [label, invoke, status = 200] of [...operations, ['HTTP 오류', operations[1][1], 401]]) {
  test(`OpenAI ${label}: 헤더 수신 시간까지 합산해 본문 읽기 타임아웃을 적용한다`, async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    let signal, finishBody, started;
    const bodyStarted = new Promise(resolve => { started = resolve; });
    const provider = createOpenaiProvider({
      apiKey: 'test-only', model: 'fake', timeoutMs: 25,
      fetchImpl: async (_url, init) => {
        signal = init.signal;
        t.mock.timers.tick(8);
        return {
          ok: status === 200, status,
          json: () => new Promise((resolve, reject) => {
            finishBody = resolve;
            signal.addEventListener('abort', () => reject(signal.reason), { once: true });
            started();
          }),
        };
      },
    });
    const pending = invoke(provider);
    await bodyStarted;
    t.mock.timers.tick(17);
    // 타이머가 잘못 해제된 이전 코드도 무한 대기 없이 실패하도록 본문을 마무리한다.
    finishBody(body);
    await assert.rejects(pending, { name: 'AbortError' });
    assert.equal(signal.aborted, true);
  });
}

test('OpenAI: 헤더가 오지 않을 때도 같은 타임아웃으로 취소한다', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const provider = createOpenaiProvider({
    apiKey: 'test-only', model: 'fake', timeoutMs: 25,
    fetchImpl: (_url, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    }),
  });
  const pending = operations[1][1](provider);
  t.mock.timers.tick(25);
  await assert.rejects(pending, { name: 'AbortError' });
});

const cleanupCases = [
  ['정상 응답', async () => ({ ok: true, json: async () => body }), null],
  ['네트워크 오류', async () => { throw new Error('network down'); }, /network down/],
  ['본문 읽기 오류', async () => ({ ok: true, json: async () => { throw new SyntaxError('invalid JSON'); } }), /OpenAI 응답에 내용이 없어요/],
  ['본문 값 형식 오류', async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: '[1,2]' } }] }) }), /JSON 객체가 아니에요/],
];
for (const [label, response, expectedError] of cleanupCases) {
  test(`OpenAI ${label}: 완료 후 타이머를 정리해 뒤늦게 취소하지 않는다`, async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    let signal;
    const provider = createOpenaiProvider({
      apiKey: 'test-only', model: 'fake', timeoutMs: 25,
      fetchImpl: async (_url, init) => { signal = init.signal; return response(); },
    });
    const pending = operations[0][1](provider);
    if (expectedError) await assert.rejects(pending, expectedError);
    else assert.deepEqual(await pending, { values: { material: 'COTTON' }, usage: { input_tokens: 80, output_tokens: 12 } });
    t.mock.timers.tick(100);
    assert.equal(signal.aborted, false);
  });
}

test('OpenAI: JSON이 아닌 HTTP 오류 본문도 기존 HTTP 오류 메시지로 처리한다', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let signal;
  const provider = createOpenaiProvider({
    apiKey: 'test-only', model: 'fake', timeoutMs: 25,
    fetchImpl: async (_url, init) => {
      signal = init.signal;
      return { ok: false, status: 502, json: async () => { throw new SyntaxError('HTML error page'); } };
    },
  });
  await assert.rejects(operations[1][1](provider), /OpenAI 응답 오류 502/);
  t.mock.timers.tick(100);
  assert.equal(signal.aborted, false);
});

test('OpenAI: 로컬 HTTP 서버의 지연된 본문을 실제 fetch로 취소한다', { timeout: 5000 }, async () => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.flushHeaders();
    const timer = setTimeout(() => response.end(JSON.stringify(body)), 1000);
    response.on('close', () => clearTimeout(timer));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  let headersReceived = false;
  const provider = createOpenaiProvider({
    apiKey: 'test-only', model: 'fake', timeoutMs: 250,
    fetchImpl: async (_url, init) => {
      const response = await fetch(`http://127.0.0.1:${server.address().port}`, init);
      headersReceived = true;
      return response;
    },
  });
  try {
    await assert.rejects(operations[1][1](provider), { name: 'AbortError' });
    assert.equal(headersReceived, true);
  } finally {
    const closed = new Promise(resolve => server.close(resolve));
    server.closeAllConnections();
    await closed;
  }
});
