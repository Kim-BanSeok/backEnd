import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bodyCases, extraField, fabricBody, listingBody } from './strictBodyFixtures.js';
import { validate } from '../src/middlewares/validate.js';
import { createFabricSchema, updateFabricSchema } from '../src/validators/fabrics.schema.js';
import { listingSchema, confirmSchema, answerSchema } from '../src/validators/aiSessions.schema.js';
import { acceptReservationSchema } from '../src/validators/reservations.schema.js';
import { uploadImageSchema } from '../src/validators/images.schema.js';
import { loginSchema } from '../src/validators/auth.schema.js';
import { listFavoritesSchema } from '../src/validators/favorites.schema.js';

const unknownIssue = (schema, input, field, path = []) => {
  const result = schema.safeParse(input);
  assert.equal(result.success, false);
  assert.ok(result.error.issues.some(issue => issue.code === 'unrecognized_keys' && issue.keys.includes(field) && JSON.stringify(issue.path) === JSON.stringify(path)), JSON.stringify(result.error.issues));
};
for (const item of bodyCases) {
  test(`엄격한 본문 ${item.label}: 정상 입력은 유지하고 추가 필드·프로토타입 키를 거절한다`, () => {
    const input = item.input();
    assert.equal(item.schema.body.safeParse(input).success, true);
    unknownIssue(item.schema.body, { ...input, [extraField]: '값' }, extraField);
    for (const key of ['__proto__', 'constructor', 'toString']) {
      const extra = JSON.parse(`{"${key}":{"role":"ADMIN"}}`);
      unknownIssue(item.schema.body, { ...input, ...extra }, key);
    }
    assert.equal({}.role, undefined);
  });
}

test('원단 등록·수정·AI 확정: detail 속 소유자·상태 필드도 거절한다', () => {
  for (const schema of [createFabricSchema, updateFabricSchema, confirmSchema]) {
    const body = fabricBody();
    unknownIssue(schema.body, { ...body, detail: { ...body.detail, seller_id: 99 } }, 'seller_id', ['detail']);
    unknownIssue(schema.body, { ...body, detail: { ...body.detail, ...JSON.parse('{"__proto__":{"status":"POSTED"}}') } }, '__proto__', ['detail']);
  }
});

test('AI 소개: 이미지 배열의 각 객체 안에 있는 추가 필드도 거절한다', () => {
  const body = listingBody();
  unknownIssue(listingSchema.body, { ...body, images: [body.images[0], { ...body.images[0], url: 'https://example.invalid' }] }, 'url', ['images', 1]);
});

test('정상 값의 trim·기본값·null·빈 multipart 값·본문 생략 처리는 유지한다', () => {
  assert.equal(loginSchema.body.parse({ email: ' BUYER@STRICT.TEST ', password: 'password123' }).email, 'buyer@strict.test');
  assert.deepEqual(acceptReservationSchema.body.parse(undefined), {});
  assert.deepEqual(acceptReservationSchema.body.parse({}), {});
  assert.deepEqual(uploadImageSchema.body.parse({ image_type: '' }), { image_type: undefined });
  assert.equal(createFabricSchema.body.parse(fabricBody()).detail.material, 'UNKNOWN');
  assert.deepEqual(updateFabricSchema.body.parse({ detail: { description: '' } }), { detail: { description: null } });
  assert.deepEqual(answerSchema.body.parse({ answer: ' 면 ', finish: false }), { answer: '면', finish: false });
});

test('검증 미들웨어: 본문 없는 API는 생략·{}만 받고 배열·추가 필드를 거절한다', () => {
  for (const body of [undefined, {}]) {
    const req = { params: {}, query: {}, body };
    let error;
    validate({})(req, {}, value => { error = value; });
    assert.equal(error, undefined);
    assert.deepEqual(req.valid.body, {});
  }
  for (const body of [[], { [extraField]: true }, '임의 본문']) {
    const req = { params: {}, query: {}, body };
    let error;
    validate({})(req, {}, value => { error = value; });
    assert.equal(error.code, 'VALIDATION_ERROR');
    assert.equal(req.valid, undefined);
  }
});

test('검증 미들웨어: URL 쿼리의 기존 처리와 오류의 field·message 형식은 유지한다', () => {
  const req = { params: {}, query: { page: '0', size: '20', cache_key: '허용하던 추가 쿼리' } };
  let error;
  validate(listFavoritesSchema)(req, {}, value => { error = value; });
  assert.equal(error, undefined);
  assert.deepEqual(req.valid.query, { page: 0, size: 20 });
  const bad = { params: {}, query: {}, body: { ...listingBody(), images: [{ ...listingBody().images[0], [extraField]: '값은 응답에 없음' }] } };
  validate(listingSchema)(bad, {}, value => { error = value; });
  assert.equal(error.code, 'VALIDATION_ERROR');
  assert.ok(error.details.some(detail => detail.field === 'images.0' && typeof detail.message === 'string'));
  assert.doesNotMatch(JSON.stringify(error.details), /값은 응답에 없음/);
});
