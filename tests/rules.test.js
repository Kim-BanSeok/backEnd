import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluatePattern, recommend } from '../src/services/recommendation.rules.js';

// DB 없이 도는 추천 판정 규칙 시험. 명세서 24번의 에코백 예시를 그대로 쓴다.
// 에코백: 앞판 40×45 1장, 뒤판 40×45 1장, 끈 8×60 2장
const ecoBag = {
  pattern_id: 1,
  pattern_name: '에코백',
  image_url: null,
  allowed_materials: ['COTTON', 'LINEN'],
  allowed_thickness: ['NORMAL', 'THICK'],
  parts: [
    { part_name: '앞판', width_cm: 40, height_cm: 45, quantity: 1 },
    { part_name: '뒤판', width_cm: 40, height_cm: 45, quantity: 1 },
    { part_name: '끈', width_cm: 8, height_cm: 60, quantity: 2 },
  ],
};

const scrap = (detail = {}, fabric = {}) => ({
  fabric: { sale_type: 'SCRAP', price: 3000, remaining_length_cm: null, reserved_length_cm: 0, ...fabric },
  detail: { width_cm: 150, length_cm: 65, material: 'COTTON', thickness: 'NORMAL', ...detail },
});
const roll = (detail = {}, fabric = {}) => ({
  fabric: { sale_type: 'ROLL', price: 6000, remaining_length_cm: 900, reserved_length_cm: 0, ...fabric },
  detail: { width_cm: 150, length_cm: null, material: 'COTTON', thickness: 'NORMAL', ...detail },
});
const check = ({ fabric, detail }, pattern = ecoBag) => evaluatePattern(fabric, detail, pattern);

// ---- 자투리: 모든 부품을 폭 방향으로 한 줄로 놓는다

test('자투리: 필요 가로는 부품 가로의 합(장수 포함) 96, 필요 세로는 부품 세로의 최댓값 60 (명세서 예시)', () => {
  const result = check(scrap());
  assert.equal(result.judgement, 'SUITABLE');
  const [width, length] = result.item.reasons;
  assert.deepEqual([width.criterion, width.required, width.actual, width.met], ['WIDTH', 96, 150, true]);
  assert.deepEqual([length.criterion, length.required, length.actual, length.met], ['LENGTH', 60, 65, true]);
  assert.equal(width.text, '필요 가로 96cm 이상 → 폭 150cm (충족)'); // 명세서 문구 그대로
  assert.equal(length.text, '필요 세로 60cm 이상 → 길이 65cm (충족)');
  assert.deepEqual(
    [result.item.required_length_cm, result.item.purchase_length_cm, result.item.yards, result.item.estimated_price],
    [null, null, null, null],
  );
});

test('자투리 경계: 폭 96 과 길이 60 은 통과, 1cm 모자라면 부적합', () => {
  assert.ok(check(scrap({ width_cm: 96, length_cm: 60 })));
  assert.equal(check(scrap({ width_cm: 95, length_cm: 60 })), null);
  assert.equal(check(scrap({ width_cm: 96, length_cm: 59 })), null);
});

test('자투리는 회전하지 않는다: 가로·세로를 바꾸면 맞을 크기라도 부적합', () => {
  // 폭 60, 길이 96 이라면 돌려서 놓을 수 있지만 회전은 계산하지 않는다
  assert.equal(check(scrap({ width_cm: 60, length_cm: 90 })), null);
});

test('자투리는 여러 줄로 놓지 않는다: 면적이 넉넉해도 한 줄에 안 들어가면 부적합', () => {
  // 필요 면적 40*45*2 + 8*60*2 = 4560, 원단 면적 70*65 = 4550 이 아니라 폭 70 < 96 이라서 부적합
  assert.equal(check(scrap({ width_cm: 70, length_cm: 90 })), null);
});

// ---- 롤: 폭 ≥ 부품 가로의 최댓값, 구매 길이 = 필요 길이를 90cm 단위로 올림

test('롤: 필요 길이 210 → 구매 길이 270(3마), 폭 40 이상 (명세서 예시)', () => {
  const result = check(roll());
  assert.equal(result.judgement, 'SUITABLE');
  const [width, length] = result.item.reasons;
  assert.deepEqual([width.criterion, width.required, width.actual], ['WIDTH', 40, 150]);
  assert.deepEqual([length.criterion, length.required, length.actual], ['LENGTH', 270, 900]); // actual 은 구매 가능 길이
  assert.deepEqual(
    [result.item.required_length_cm, result.item.purchase_length_cm, result.item.yards, result.item.estimated_price],
    [210, 270, 3, 18000], // 90cm당 6000원 x 3마
  );
});

test('롤 경계: 폭 40 은 통과, 구매 가능 길이가 정확히 270 이면 통과, 269 이하면 부적합', () => {
  assert.ok(check(roll({ width_cm: 40 })));
  assert.equal(check(roll({ width_cm: 39 })), null);
  assert.ok(check(roll({}, { remaining_length_cm: 270 })));
  assert.equal(check(roll({}, { remaining_length_cm: 269 })), null);
});

test('롤의 구매 가능 길이는 남은 길이에서 확보 길이를 뺀 값이다', () => {
  assert.equal(check(roll({}, { remaining_length_cm: 900, reserved_length_cm: 630 })).item.reasons[1].actual, 270);
  assert.ok(check(roll({}, { remaining_length_cm: 900, reserved_length_cm: 630 })));
  assert.equal(check(roll({}, { remaining_length_cm: 900, reserved_length_cm: 631 })), null);
});

test('필요 길이가 90 의 배수이면 올림하지 않고, 아니면 올림한다', () => {
  const exact = { ...ecoBag, parts: [{ width_cm: 30, height_cm: 90, quantity: 2 }] }; // 필요 180
  const odd = { ...ecoBag, parts: [{ width_cm: 30, height_cm: 91, quantity: 1 }] }; // 필요 91 → 180
  assert.deepEqual([check(roll(), exact).item.purchase_length_cm, check(roll(), exact).item.yards], [180, 2]);
  assert.deepEqual([check(roll(), odd).item.purchase_length_cm, check(roll(), odd).item.yards], [180, 2]);
});

// ---- 소재와 두께

test('소재: 허용 소재에 있으면 적합, 없으면 부적합', () => {
  assert.equal(check(scrap({ material: 'LINEN' })).judgement, 'SUITABLE');
  assert.equal(check(scrap({ material: 'POLYESTER' })), null);
  const material = check(scrap({ material: 'LINEN' })).item.reasons.find((r) => r.criterion === 'MATERIAL');
  assert.deepEqual([material.met, material.actual, material.required], [true, 'LINEN', ['COTTON', 'LINEN']]);
});

test('소재를 모르면(UNKNOWN) 크기·두께가 맞는 도안을 확인 필요(NEEDS_CHECK)로 보고 met 은 null', () => {
  const result = check(scrap({ material: 'UNKNOWN' }));
  assert.equal(result.judgement, 'NEEDS_CHECK');
  const material = result.item.reasons.find((r) => r.criterion === 'MATERIAL');
  assert.deepEqual([material.met, material.actual], [null, 'UNKNOWN']);
  // 크기가 안 맞으면 소재를 모르더라도 목록에 넣지 않는다
  assert.equal(check(scrap({ material: 'UNKNOWN', width_cm: 50 })), null);
  // 두께가 안 맞아도 넣지 않는다
  assert.equal(check(scrap({ material: 'UNKNOWN', thickness: 'THIN' })), null);
});

test('두께: 허용 두께에 없으면 부적합', () => {
  assert.equal(check(scrap({ thickness: 'THIN' })), null);
  assert.equal(check(scrap({ thickness: 'THICK' })).judgement, 'SUITABLE');
});

test('판단 근거 reasons 는 WIDTH, LENGTH, MATERIAL, THICKNESS 순서다', () => {
  assert.deepEqual(check(scrap()).item.reasons.map((r) => r.criterion), ['WIDTH', 'LENGTH', 'MATERIAL', 'THICKNESS']);
  assert.deepEqual(check(roll()).item.reasons.map((r) => r.criterion), ['WIDTH', 'LENGTH', 'MATERIAL', 'THICKNESS']);
});

test('부품이 하나도 없는 도안은 계산할 수 없어서 제외한다', () => {
  assert.equal(check(scrap(), { ...ecoBag, parts: [] }), null);
});

// ---- 목록 만들기

const makePattern = (id, parts, extra = {}) => ({
  ...ecoBag, pattern_id: id, pattern_name: `도안${id}`, parts: parts.map(([w, h, q = 1]) => ({ width_cm: w, height_cm: h, quantity: q })), ...extra,
});

test('자투리는 필요 면적이 큰 도안부터 정렬한다 (같으면 도안 번호 순)', () => {
  const { fabric, detail } = scrap({ width_cm: 200, length_cm: 90 });
  const patterns = [
    makePattern(1, [[20, 20]]), // 400
    makePattern(2, [[50, 50]]), // 2500
    makePattern(3, [[30, 30]]), // 900
    makePattern(4, [[30, 30]]), // 900 (3 과 같다)
  ];
  assert.deepEqual(recommend(fabric, detail, patterns).items.map((i) => i.patternId), [2, 3, 4, 1]);
});

test('롤은 필요 마 수가 적은 도안부터 정렬한다 (같으면 도안 번호 순)', () => {
  const { fabric, detail } = roll();
  const patterns = [
    makePattern(1, [[30, 200]]), // 3마
    makePattern(2, [[30, 80]]), // 1마
    makePattern(3, [[30, 170]]), // 2마
    makePattern(4, [[30, 85]]), // 1마 (2 와 같다)
  ];
  assert.deepEqual(recommend(fabric, detail, patterns).items.map((i) => i.patternId), [2, 4, 3, 1]);
});

test('적합은 최대 5개, 확인 필요는 최대 3개이고 적합이 먼저 온다', () => {
  const many = Array.from({ length: 9 }, (_, i) => makePattern(i + 1, [[10, 10]]));
  const suitable = recommend(...Object.values(scrap()).concat([many]));
  assert.equal(suitable.items.length, 5);
  assert.ok(suitable.items.every((i) => i.judgement === 'SUITABLE'));

  const unknown = recommend(...Object.values(scrap({ material: 'UNKNOWN' })).concat([many]));
  assert.equal(unknown.items.length, 3);
  assert.ok(unknown.items.every((i) => i.judgement === 'NEEDS_CHECK'));
});

test('적합과 확인 필요가 섞이면 적합 5개 뒤에 확인 필요가 온다', () => {
  // 원단 소재는 면. 도안 1~6 은 면 허용(적합), 7~9 는 소재 허용 목록에 면이 없어 부적합이라 제외된다.
  const patterns = [
    ...Array.from({ length: 6 }, (_, i) => makePattern(i + 1, [[10, 10]])),
    ...Array.from({ length: 3 }, (_, i) => makePattern(i + 7, [[10, 10]], { allowed_materials: ['WOOL'] })),
  ];
  const { items } = recommend(...Object.values(scrap()).concat([patterns]));
  assert.deepEqual(items.map((i) => i.patternId), [1, 2, 3, 4, 5]);
});

test('notices 에는 항상 실물 확인 안내가 있고, 소재를 모르면 소재 확인 안내가 더해진다', () => {
  const known = recommend(...Object.values(scrap()).concat([[ecoBag]]));
  assert.deepEqual(known.notices, ['실물 확인 권장: 촉감·결 방향·수축은 정보로 확인할 수 없어요']);
  const unknown = recommend(...Object.values(scrap({ material: 'UNKNOWN' })).concat([[ecoBag]]));
  assert.deepEqual(unknown.notices, [
    '실물 확인 권장: 촉감·결 방향·수축은 정보로 확인할 수 없어요',
    '소재를 판매자에게 확인해 보세요',
  ]);
});

test('맞는 도안이 없으면 items 는 비어 있다', () => {
  assert.deepEqual(recommend(...Object.values(scrap({ width_cm: 10 })).concat([[ecoBag]])).items, []);
});
