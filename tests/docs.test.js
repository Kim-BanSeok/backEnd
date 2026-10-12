import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import SwaggerParser from '@apidevtools/swagger-parser';
import { createApp } from '../src/app.js';
import { buildOpenApi } from '../src/docs/buildOpenApi.js';
import { ERRORS } from '../src/utils/errors.js';

const readText = (relative) => readFileSync(new URL(relative, import.meta.url), 'utf8');
const spec = JSON.parse(readText('../src/docs/openapi.json'));
const operations = Object.entries(spec.paths).flatMap(([path, methods]) =>
  Object.entries(methods).map(([method, op]) => ({ path, method, op })),
);

let server;
let origin;
before(() => {
  server = createApp().listen(0);
  origin = `http://localhost:${server.address().port}`;
});
after(() => server.close());

// ---- 문서 내용

test('명세서의 API 49개가 모두 문서에 있고 번호가 1~49 이다', () => {
  assert.equal(operations.length, 49);
  const numbers = operations.map((o) => o.op['x-api-no']).sort((a, b) => a - b);
  assert.deepEqual(numbers, Array.from({ length: 49 }, (_, i) => i + 1));
});

test('openapi.json 이 명세서와 같다 (명세서를 고치고 npm run docs:build 를 빼먹지 않았는지)', () => {
  const fresh = buildOpenApi(readText('../docs/API_명세서_v0.3.md'));
  assert.deepEqual(spec, fresh, '명세서와 src/docs/openapi.json 이 달라요. npm run docs:build 를 실행하고 변경된 파일을 커밋하세요.');
});

test('OpenAPI 문법이 올바르다', async () => {
  await SwaggerParser.validate(structuredClone(spec));
});

test('모든 API 에 태그·성공 응답·오류 응답이 있고, 오류 코드는 오류 코드 표에 있는 것만 쓴다', () => {
  for (const { path, method, op } of operations) {
    const label = `${method.toUpperCase()} ${path}`;
    assert.ok(op.tags?.[0], `${label}: 태그`);
    const codes = Object.keys(op.responses);
    assert.ok(codes.some((c) => Number(c) < 300), `${label}: 성공 응답`);
    for (const [status, response] of Object.entries(op.responses)) {
      if (Number(status) < 400) continue;
      for (const [code, example] of Object.entries(response.content['application/json'].examples)) {
        assert.ok(ERRORS[code], `${label}: 오류 코드 ${code} 가 utils/errors.js 에 없어요`);
        assert.equal(ERRORS[code].status, Number(status), `${label}: ${code} 의 HTTP 상태가 달라요`);
        assert.equal(example.value.error.message, ERRORS[code].message);
      }
    }
  }
});

test('로그인이 필요한 API 에만 보안(Authorize)이 걸려 있다', () => {
  const pub = operations.filter((o) => o.op['x-permission'] === '공개');
  const optional = operations.filter((o) => o.op['x-permission'].startsWith('공개 ('));
  const secured = operations.filter((o) => !o.op['x-permission'].startsWith('공개'));
  assert.ok(secured.length > 0 && pub.length > 0);
  assert.ok(pub.filter((o) => !optional.includes(o)).every((o) => o.op.security.length === 0));
  assert.ok(optional.every((o) => o.op.security.length === 2));
  assert.ok(secured.every((o) => o.op.security[0].bearerAuth));
});

test('회원가입 문서: 항목 이름, 필수 여부, 값 목록, 길이 제한이 명세서와 같다', () => {
  const body = spec.paths['/auth/signup'].post.requestBody.content['application/json'].schema;
  assert.deepEqual([...body.required].sort(), ['email', 'nickname', 'password', 'privacy_agreed', 'role', 'terms_agreed']);
  assert.deepEqual(body.properties.role.enum, ['SELLER', 'BUYER']);
  assert.equal(body.properties.password.minLength, 8);
  assert.equal(body.properties.password.maxLength, 72);
  assert.equal(body.properties.phone_number.nullable, true);
  assert.equal(body.properties.privacy_agreed.type, 'boolean');
});

test('원단 등록 문서: 안쪽 항목(detail.xxx)이 detail 안에 들어 있다', () => {
  const body = spec.paths['/fabrics'].post.requestBody.content['application/json'].schema;
  assert.deepEqual([...body.required].sort(), ['detail', 'price', 'sale_type', 'title']);
  const detail = body.properties.detail;
  assert.equal(detail.type, 'object');
  assert.deepEqual([...detail.required].sort(), ['color_family', 'thickness', 'width_cm']);
  assert.deepEqual(detail.properties.thickness.enum, ['THIN', 'NORMAL', 'THICK']);
  assert.equal(detail.properties.width_cm.maximum, 1000);
  assert.ok(!('detail.thickness' in body.properties), '점(.)이 들어간 이름으로 남지 않아야 해요');
  // 요청 예시가 자투리·롤 둘 다 있다
  assert.deepEqual(Object.keys(spec.paths['/fabrics'].post.requestBody.content['application/json'].examples), ['자투리', '롤']);
});

test('경로(Path)·쿼리(Query) 항목이 파라미터로 들어 있다', () => {
  const list = spec.paths['/fabrics'].get;
  const names = list.parameters.map((p) => p.name);
  assert.deepEqual(names, ['sale_type', 'material', 'thickness', 'color_family', 'keyword', 'sort', 'page', 'size']);
  assert.ok(list.parameters.every((p) => p.in === 'query'));
  assert.equal(list.parameters.find((p) => p.name === 'size').maximum ?? list.parameters.find((p) => p.name === 'size').schema.maximum, 50);

  const store = spec.paths['/stores/{storeId}'].get;
  assert.equal(store.parameters[0].in, 'path');
  assert.equal(store.parameters[0].required, true);
});

test('사진 업로드는 multipart/form-data 이고 file 은 파일이다', () => {
  const content = spec.paths['/fabrics/{fabricId}/images'].post.requestBody.content;
  assert.deepEqual(Object.keys(content), ['multipart/form-data']);
  assert.equal(content['multipart/form-data'].schema.properties.file.format, 'binary');
});

test('성공 응답 코드와 예시: 가입은 201, 삭제는 data null', () => {
  assert.ok(spec.paths['/auth/signup'].post.responses['201']);
  const del = spec.paths['/fabrics/{fabricId}/images/{imageId}'].delete.responses['200'];
  assert.deepEqual(del.content['application/json'].example, { success: true, data: null });
});

// ---- 서버에서 보여 주기

test('/api-docs 는 Swagger 화면을 보여 주고, 화면이 쓰는 스크립트가 보안 헤더(CSP)에 막히지 않는다', async () => {
  const res = await fetch(`${origin}/api-docs/`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/html/);
  assert.match(await res.text(), /swagger-ui/i);
  assert.equal(res.headers.get('content-security-policy'), null);

  const asset = await fetch(`${origin}/api-docs/swagger-ui-bundle.js`);
  assert.equal(asset.status, 200);
});

test('/api-docs.json 은 문서 원본을 돌려준다', async () => {
  const res = await fetch(`${origin}/api-docs.json`);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), spec);
});

test('API 응답에는 여전히 보안 헤더(helmet)가 붙는다', async () => {
  const res = await fetch(`${origin}/api/v1/health`);
  assert.ok(res.headers.get('content-security-policy'));
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
});

// ---- 구현과 문서가 어긋나지 않게

// Express 라우터 안을 돌며 실제로 연결된 (메서드, 경로) 를 모은다.
function collectRoutes(router, prefix = '') {
  const found = [];
  for (const layer of router.stack) {
    if (layer.route) {
      for (const method of Object.keys(layer.route.methods)) {
        found.push({ method, path: prefix + layer.route.path });
      }
    } else if (layer.handle?.stack) {
      found.push(...collectRoutes(layer.handle, prefix));
    }
  }
  return found;
}

test('구현된 모든 API 는 명세서(문서)에 있다 — 명세서에 없는 API 를 만들지 않았는지', async () => {
  const { default: routes } = await import('../src/routes/index.js');
  const documented = new Set(operations.map((o) => `${o.method} ${o.path}`));
  const NOT_IN_SPEC = new Set(['get /health']); // 서버 상태 확인용 (명세서 밖)

  const missing = collectRoutes(routes)
    .map((r) => `${r.method} ${r.path.replace(/:(\w+)/g, '{$1}')}`)
    .filter((key) => !documented.has(key) && !NOT_IN_SPEC.has(key));
  assert.deepEqual(missing, [], `명세서에 없는 API 가 구현되어 있어요: ${missing.join(', ')}`);
});
