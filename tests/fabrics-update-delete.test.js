import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { signToken } from '../src/services/auth.service.js';
import { db, resetDb, makeUser, makeStore, makeFabric } from './helpers.js';

let server;
let base;

before(async () => {
  await resetDb();
  server = createApp().listen(0);
  base = `http://localhost:${server.address().port}/api/v1`;
});
beforeEach(resetDb);
after(async () => {
  server.close();
  await db.sequelize.close();
});

async function call(method, path, { body, token } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: {
      ...(body !== undefined && { 'Content-Type': 'application/json' }),
      ...(token && { Authorization: `Bearer ${token}` }),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: await res.json() };
}

const patch = (fabric, body, token) => call('PATCH', `/fabrics/${fabric.fabric_id ?? fabric}`, { body, token });
const del = (fabric, token) => call('DELETE', `/fabrics/${fabric.fabric_id ?? fabric}`, { token });

// ---- 도우미

// 판매자 + 매장 + 원단 + 상세. 기본은 자투리(SCRAP)이고 { roll: true } 면 롤이다.
async function setup({ roll = false, fabric: fabricOverrides = {}, detail: detailOverrides = {} } = {}) {
  const { seller, store } = await makeStore();
  const fabric = await makeFabric(
    store.store_id,
    roll
      ? { sale_type: 'ROLL', title: '린넨 롤', price: 6000, remaining_length_cm: 900, ...fabricOverrides }
      : { title: '네이비 면', price: 3000, ...fabricOverrides },
  );
  const detail = await db.FabricDetail.create({
    fabric_id: fabric.fabric_id,
    width_cm: 150,
    length_cm: roll ? null : 65,
    material: 'COTTON',
    thickness: 'NORMAL',
    color_family: 'NAVY',
    color_detail: '짙은 남색',
    has_defect: false,
    description: '원래 설명',
    ...detailOverrides,
  });
  return { seller, store, fabric, detail, token: signToken(seller) };
}

const reload = (fabric) => db.Fabric.findByPk(fabric.fabric_id, { paranoid: false });
const reloadDetail = (fabric) => db.FabricDetail.findOne({ where: { fabric_id: fabric.fabric_id } });

const addReservation = async (fabric, store, status, overrides = {}) => {
  const buyer = await makeUser({ role: 'BUYER' });
  const seller = await db.User.findByPk(store.user_id);
  return db.Reservation.create({
    fabric_id: fabric.fabric_id,
    buyer_id: buyer.user_id,
    seller_id: seller.user_id,
    pickup_at: new Date(),
    status,
    reject_reason: status === 'REJECTED' ? '사유' : null,
    canceled_by: status === 'CANCELED' ? 'BUYER' : null,
    ...overrides,
  });
};

// ==== 12. 원단 수정

test('수정 성공: 보낸 항목만 바뀌고 응답은 { fabricId, status } (명세서 예시)', async () => {
  const { fabric, token } = await setup({ fabric: { status: 'POSTED' } });
  const { status, json } = await patch(fabric, { price: 3500, detail: { color_detail: '짙은 남색(네이비)' } }, token);
  assert.equal(status, 200);
  assert.deepEqual(json, { success: true, data: { fabricId: fabric.fabric_id, status: 'POSTED' } });

  const saved = await reload(fabric);
  assert.equal(saved.price, 3500);
  assert.equal(saved.title, '네이비 면'); // 안 보낸 항목은 그대로
  const detail = await reloadDetail(fabric);
  assert.equal(detail.color_detail, '짙은 남색(네이비)');
  assert.equal(detail.width_cm, 150);
  assert.equal(detail.description, '원래 설명');
});

test('수정: 원단 항목과 상세 항목을 모두 바꿀 수 있다', async () => {
  const { fabric, token } = await setup();
  const { status } = await patch(fabric, {
    title: '새 제목', price: 4000,
    detail: { material: 'LINEN', thickness: 'THICK', color_family: 'BEIGE', width_cm: 120, length_cm: 80, has_defect: true, defect_note: '얼룩', blend_ratio: '면 50 린넨 50', weave: '평직', grain_direction: '세로', description: '새 설명' },
  }, token);
  assert.equal(status, 200);
  const saved = await reload(fabric);
  assert.deepEqual([saved.title, saved.price], ['새 제목', 4000]);
  const d = await reloadDetail(fabric);
  assert.deepEqual(
    [d.material, d.thickness, d.color_family, d.width_cm, d.length_cm, d.has_defect, d.defect_note, d.blend_ratio, d.weave, d.grain_direction, d.description],
    ['LINEN', 'THICK', 'BEIGE', 120, 80, true, '얼룩', '면 50 린넨 50', '평직', '세로', '새 설명'],
  );
});

test('수정: null 이나 빈 문자열로 선택 항목을 비울 수 있고, 안 보낸 항목은 지켜진다', async () => {
  const { fabric, token } = await setup({ detail: { blend_ratio: '면 100', weave: '평직' } });
  const { status } = await patch(fabric, { detail: { color_detail: null, description: '   ', weave: undefined } }, token);
  assert.equal(status, 200);
  const d = await reloadDetail(fabric);
  assert.equal(d.color_detail, null);
  assert.equal(d.description, null); // 공백만 보내면 비움
  assert.equal(d.weave, '평직'); // 안 보냄 → 그대로
  assert.equal(d.blend_ratio, '면 100');
});

test('수정: 소재를 null 로 보내면 UNKNOWN', async () => {
  const { fabric, token } = await setup();
  assert.equal((await patch(fabric, { detail: { material: null } }, token)).status, 200);
  assert.equal((await reloadDetail(fabric)).material, 'UNKNOWN');
});

test('수정: status·store_id 등의 추가 필드가 섞이면 정상 필드도 저장하지 않는다', async () => {
  const { fabric, store, token } = await setup({ fabric: { status: 'POSTED' } });
  const { status, json } = await patch(fabric, { price: 3100, status: 'SOLD_OUT', store_id: 9999, reserved_length_cm: 50, fabric_id: 7 }, token);
  assert.equal(status, 400);
  assert.equal(json.error.code, 'VALIDATION_ERROR');
  const saved = await reload(fabric);
  assert.deepEqual([saved.price, saved.status, saved.store_id, saved.reserved_length_cm], [3000, 'POSTED', store.store_id, 0]);
  assert.equal((await patch(fabric, { price: 3100 }, token)).status, 200);
  assert.equal((await reload(fabric)).price, 3100);
});

test('수정: 상세만 바꿔도 원단의 수정 시각이 갱신된다', async () => {
  const { fabric, token } = await setup();
  const before = (await reload(fabric)).updated_at.getTime();
  await new Promise((resolve) => setTimeout(resolve, 30));
  await patch(fabric, { detail: { description: '다른 설명' } }, token);
  assert.ok((await reload(fabric)).updated_at.getTime() > before);
});

// ---- 12. 상태 전환

test('반려된 원단을 고치면 PENDING 이 되고 반려 사유가 지워진다', async () => {
  const { fabric, token } = await setup({ fabric: { status: 'REJECTED', reject_reason: '하자 사진이 필요해요' } });
  const { status, json } = await patch(fabric, { detail: { has_defect: true, defect_note: '오른쪽 아래 얼룩' } }, token);
  assert.equal(status, 200);
  assert.equal(json.data.status, 'PENDING');
  const saved = await reload(fabric);
  assert.equal(saved.status, 'PENDING');
  assert.equal(saved.reject_reason, null);
});

test('게시 중(POSTED)은 상태가 그대로이고, 게시 대기(PENDING)도 그대로', async () => {
  for (const state of ['POSTED', 'PENDING']) {
    const { fabric, token } = await setup({ fabric: { status: state } });
    const { json } = await patch(fabric, { title: '고침' }, token);
    assert.equal(json.data.status, state);
    assert.equal((await reload(fabric)).status, state);
  }
});

test('판매 완료(SOLD_OUT)는 수정할 수 없다 (INVALID_STATUS, 값은 그대로)', async () => {
  const { fabric, token } = await setup({ fabric: { status: 'SOLD_OUT' } });
  const { status, json } = await patch(fabric, { price: 1 }, token);
  assert.equal(status, 409);
  assert.equal(json.error.code, 'INVALID_STATUS');
  assert.equal((await reload(fabric)).price, 3000);
});

// ---- 12. 판매 형태

test('판매 형태는 바꿀 수 없다: 다른 값은 VALIDATION_ERROR, 같은 값은 통과', async () => {
  const { fabric, token } = await setup();
  const diff = await patch(fabric, { sale_type: 'ROLL', remaining_length_cm: 900 }, token);
  assert.equal(diff.status, 400);
  assert.equal(diff.json.error.code, 'VALIDATION_ERROR');
  assert.equal(diff.json.error.details[0].field, 'sale_type');
  assert.equal((await reload(fabric)).sale_type, 'SCRAP');

  const same = await patch(fabric, { sale_type: 'SCRAP', price: 3200 }, token);
  assert.equal(same.status, 200);
  assert.equal((await reload(fabric)).price, 3200);
});

// ---- 12. 바뀐 뒤의 모습으로 등록 규칙을 다시 검사

test('자투리 세로 길이는 1cm 이상: 긴 길이도 통과하고, 0 이하면 SCRAP_LENGTH_OUT_OF_RANGE', async () => {
  const { fabric, token } = await setup();
  for (const length_cm of [1, 29, 90, 150]) assert.equal((await patch(fabric, { detail: { length_cm } }, token)).status, 200, `${length_cm}`);
  for (const length_cm of [0, -1, null]) {
    const { status, json } = await patch(fabric, { detail: { length_cm } }, token);
    assert.equal(status, 400, String(length_cm));
    assert.equal(json.error.code, 'SCRAP_LENGTH_OUT_OF_RANGE', String(length_cm));
  }
  assert.equal((await reloadDetail(fabric)).length_cm, 150); // 마지막으로 성공한 값이 남았다
});

test('롤 남은 길이는 90 이상: 경계는 통과, 부족하거나 비우면 ROLL_LENGTH_REQUIRED', async () => {
  const { fabric, token } = await setup({ roll: true });
  assert.equal((await patch(fabric, { remaining_length_cm: 90 }, token)).status, 200);
  for (const remaining_length_cm of [89, 0, -90, null]) {
    const { status, json } = await patch(fabric, { remaining_length_cm }, token);
    assert.equal(status, 400, String(remaining_length_cm));
    assert.equal(json.error.code, 'ROLL_LENGTH_REQUIRED', String(remaining_length_cm));
  }
  assert.equal((await reload(fabric)).remaining_length_cm, 90);
});

test('자투리에 남은 길이를, 롤에 세로 길이를 넣으면 VALIDATION_ERROR', async () => {
  const scrap = await setup();
  const a = await patch(scrap.fabric, { remaining_length_cm: 100 }, scrap.token);
  assert.equal(a.status, 400);
  assert.equal(a.json.error.details[0].field, 'remaining_length_cm');

  const roll = await setup({ roll: true });
  const b = await patch(roll.fabric, { detail: { length_cm: 60 } }, roll.token);
  assert.equal(b.status, 400);
  assert.equal(b.json.error.details[0].field, 'detail.length_cm');

  // null 은 "없음"이라 통과
  assert.equal((await patch(scrap.fabric, { remaining_length_cm: null }, scrap.token)).status, 200);
  assert.equal((await patch(roll.fabric, { detail: { length_cm: null } }, roll.token)).status, 200);
});

test('하자: 있다고 바꾸면 내용 필수, 내용을 비우면 DEFECT_NOTE_REQUIRED, 하자를 없애면 내용 없이 통과', async () => {
  const { fabric, token } = await setup();
  const noNote = await patch(fabric, { detail: { has_defect: true } }, token);
  assert.equal(noNote.status, 400);
  assert.equal(noNote.json.error.code, 'DEFECT_NOTE_REQUIRED');

  assert.equal((await patch(fabric, { detail: { has_defect: true, defect_note: '얼룩' } }, token)).status, 200);
  for (const defect_note of [null, '', '   ']) {
    const { json } = await patch(fabric, { detail: { defect_note } }, token);
    assert.equal(json.error.code, 'DEFECT_NOTE_REQUIRED', JSON.stringify(defect_note));
  }
  assert.equal((await reloadDetail(fabric)).defect_note, '얼룩'); // 실패한 수정은 아무것도 바꾸지 않는다

  // 하자를 없앤다(내용은 보낸 항목만 바뀐다는 규칙대로 그대로 둔다)
  assert.equal((await patch(fabric, { detail: { has_defect: false } }, token)).status, 200);
  assert.equal((await reloadDetail(fabric)).has_defect, false);
});

test('규칙을 어기면 일부만 저장되지 않는다 (원단 값은 맞고 상세가 틀려도 둘 다 취소)', async () => {
  const { fabric, token } = await setup({ fabric: { status: 'REJECTED', reject_reason: '사유' } });
  const { status } = await patch(fabric, { title: '새 제목', price: 9999, detail: { length_cm: 0 } }, token);
  assert.equal(status, 400);
  const saved = await reload(fabric);
  assert.deepEqual([saved.title, saved.price, saved.status, saved.reject_reason], ['네이비 면', 3000, 'REJECTED', '사유']);
});

// ---- 12. 롤: 확보 길이

test('롤의 남은 길이를 확보 길이보다 작게 줄일 수 없다 (INSUFFICIENT_LENGTH), 같거나 크면 통과', async () => {
  const { fabric, token } = await setup({ roll: true, fabric: { remaining_length_cm: 900, reserved_length_cm: 360 } });
  const tooSmall = await patch(fabric, { remaining_length_cm: 270 }, token);
  assert.equal(tooSmall.status, 409);
  assert.equal(tooSmall.json.error.code, 'INSUFFICIENT_LENGTH');
  assert.equal((await reload(fabric)).remaining_length_cm, 900);

  assert.equal((await patch(fabric, { remaining_length_cm: 359 }, token)).status, 409);
  assert.equal((await patch(fabric, { remaining_length_cm: 360 }, token)).status, 200); // 경계
  assert.equal((await patch(fabric, { remaining_length_cm: 1000 }, token)).status, 200);
});

test('가격을 바꿔도 이미 요청된 예약의 예상 금액은 바뀌지 않는다', async () => {
  const { fabric, store, token } = await setup({ roll: true });
  const reservation = await addReservation(fabric, store, 'REQUESTED', { requested_length_cm: 180, estimated_price: 12000 });
  assert.equal((await patch(fabric, { price: 7000 }, token)).status, 200);
  assert.equal((await reservation.reload()).estimated_price, 12000);
});

// ---- 12. 입력 오류

test('수정 입력 오류: 형식이 틀린 값은 VALIDATION_ERROR 와 항목별 details', async () => {
  const { fabric, token } = await setup();
  const cases = [
    ['sale_type', { sale_type: 'BOX' }],
    ['title', { title: '' }], ['title', { title: '   ' }], ['title', { title: 'a'.repeat(101) }], ['title', { title: null }],
    ['price', { price: 0 }], ['price', { price: 1.5 }], ['price', { price: '3000' }], ['price', { price: null }], ['price', { price: 2147483648 }],
    ['detail.material', { detail: { material: 'SILK' } }],
    ['detail.thickness', { detail: { thickness: 'HEAVY' } }], ['detail.thickness', { detail: { thickness: null } }],
    ['detail.color_family', { detail: { color_family: 'ORANGE' } }],
    ['detail.width_cm', { detail: { width_cm: 0 } }], ['detail.width_cm', { detail: { width_cm: 1001 } }], ['detail.width_cm', { detail: { width_cm: null } }],
    ['detail.has_defect', { detail: { has_defect: 'yes' } }], ['detail.has_defect', { detail: { has_defect: null } }],
    ['detail.defect_note', { detail: { defect_note: 'a'.repeat(256) } }],
    ['detail.description', { detail: { description: 'a'.repeat(5001) } }],
    ['detail', { detail: 'x' }],
  ];
  for (const [field, body] of cases) {
    const { status, json } = await patch(fabric, body, token);
    assert.equal(status, 400, JSON.stringify(body).slice(0, 50));
    assert.equal(json.error.code, 'VALIDATION_ERROR');
    assert.ok(json.error.details.some((d) => d.field === field), `${field}: ${JSON.stringify(json.error.details)}`);
  }
  const saved = await reload(fabric);
  assert.deepEqual([saved.title, saved.price], ['네이비 면', 3000]);
});

test('수정할 항목이 하나도 없으면 VALIDATION_ERROR (빈 본문, 빈 detail, 모르는 항목만)', async () => {
  const { fabric, token } = await setup({ fabric: { status: 'REJECTED', reject_reason: '사유' } });
  for (const body of [{}, { detail: {} }, { status: 'POSTED' }, { detail: { unknown: 1 } }]) {
    const { status, json } = await patch(fabric, body, token);
    assert.equal(status, 400, JSON.stringify(body));
    assert.equal(json.error.code, 'VALIDATION_ERROR');
  }
  assert.equal((await reload(fabric)).status, 'REJECTED'); // 아무것도 안 바꾼 요청으로는 다시 심사로 넘어가지 않는다
  const noBody = await call('PATCH', `/fabrics/${fabric.fabric_id}`, { token });
  assert.equal(noBody.status, 400);
});

test('번호가 숫자가 아니면 VALIDATION_ERROR', async () => {
  const { token } = await setup();
  for (const id of ['abc', '0', '-1', '1.5']) {
    const { status, json } = await call('PATCH', `/fabrics/${id}`, { body: { price: 1000 }, token });
    assert.equal(status, 400, id);
    assert.ok(json.error.details.some((d) => d.field === 'fabricId'));
  }
});

// ---- 12. 권한

test('수정 권한: 로그인 안 함 401, 구매자·운영팀 403, 남의 원단 403, 없거나 삭제된 원단 404', async () => {
  const mine = await setup();
  const other = await setup();

  const none = await patch(mine.fabric, { price: 1 });
  assert.equal(none.status, 401);
  assert.equal(none.json.error.code, 'UNAUTHORIZED');

  for (const role of ['BUYER', 'ADMIN']) {
    const token = signToken(await makeUser({ role }));
    assert.equal((await patch(mine.fabric, { price: 1 }, token)).status, 403, role);
  }
  const forbidden = await patch(other.fabric, { price: 1 }, mine.token);
  assert.equal(forbidden.status, 403);
  assert.equal(forbidden.json.error.code, 'FORBIDDEN');
  assert.equal((await reload(other.fabric)).price, 3000);

  const missing = await patch(99999, { price: 1 }, mine.token);
  assert.equal(missing.status, 404);
  assert.equal(missing.json.error.code, 'NOT_FOUND');

  await mine.fabric.destroy();
  assert.equal((await patch(mine.fabric, { price: 1 }, mine.token)).status, 404);
});

test('남의 원단은 입력이 틀려도 규칙 오류가 아니라 FORBIDDEN 이 먼저다 (규칙 정보를 알려 주지 않는다)', async () => {
  const mine = await setup();
  const other = await setup({ fabric: { status: 'SOLD_OUT' } });
  const { status, json } = await patch(other.fabric, { detail: { length_cm: 500 } }, mine.token);
  assert.equal(status, 403);
  assert.equal(json.error.code, 'FORBIDDEN');
});

// ---- 12. 동시성

test('수정과 삭제가 동시에 와도 값이 깨지지 않는다 (삭제된 원단에는 수정이 적용되지 않는다)', async () => {
  const { fabric, token } = await setup();
  const results = await Promise.all([
    patch(fabric, { price: 5000 }, token),
    del(fabric, token),
    patch(fabric, { title: '동시 수정' }, token),
  ]);
  const saved = await reload(fabric);
  assert.ok(saved.deleted_at, '삭제는 성공해야 한다');
  assert.equal(results[1].status, 200);
  for (const index of [0, 2]) assert.ok([200, 404].includes(results[index].status), String(results[index].status));
  // 삭제 뒤에 도착한 수정은 404 이고 값이 바뀌지 않았다
  if (results[0].status === 404) assert.equal(saved.price, 3000);
});

test('행 잠금: 같은 원단을 동시에 고쳐도 한 줄로 처리되어 마지막에 모두 반영된다', async () => {
  const { fabric, token } = await setup();

  // 상세를 읽은 직후 멈춰서, 잠금이 없으면 두 요청이 같은 값을 읽고 서로의 변경을 덮어쓰는 상황을 만든다.
  const original = db.FabricDetail.findOne.bind(db.FabricDetail);
  db.FabricDetail.findOne = async (options) => {
    const result = await original(options);
    if (options?.transaction) await new Promise((resolve) => setTimeout(resolve, 80));
    return result;
  };
  let results;
  try {
    results = await Promise.all([
      patch(fabric, { detail: { color_detail: '첫 번째 색' } }, token),
      patch(fabric, { detail: { description: '두 번째 설명' } }, token),
    ]);
  } finally {
    db.FabricDetail.findOne = original;
  }
  assert.deepEqual(results.map((r) => r.status), [200, 200]);
  const d = await reloadDetail(fabric);
  assert.equal(d.color_detail, '첫 번째 색');
  assert.equal(d.description, '두 번째 설명');
});

test('행 잠금: 서로 의존하는 두 수정이 동시에 와도 "하자가 있으면 내용 필수" 규칙이 깨지지 않는다', async () => {
  // 처음: 하자 없음 + 하자 내용 있음(허용). A 는 "하자 있음"으로, B 는 "하자 내용 비움"으로 바꾼다.
  // 각각 따로 보면 유효하지만 합치면 (하자 있음 + 내용 없음)이 된다. 잠금이 없으면 둘 다 낡은 값으로 검사를 통과해 버린다.
  const { fabric, token } = await setup({ detail: { has_defect: false, defect_note: '지난 얼룩' } });

  const original = db.FabricDetail.findOne.bind(db.FabricDetail);
  db.FabricDetail.findOne = async (options) => {
    const result = await original(options);
    if (options?.transaction) await new Promise((resolve) => setTimeout(resolve, 80));
    return result;
  };
  let results;
  try {
    results = await Promise.all([
      patch(fabric, { detail: { has_defect: true } }, token),
      patch(fabric, { detail: { defect_note: null } }, token),
    ]);
  } finally {
    db.FabricDetail.findOne = original;
  }

  // 하나만 성공하고 다른 하나는 바뀐 뒤의 모습을 보고 DEFECT_NOTE_REQUIRED 로 거절된다. (서버 오류 500 이 나서는 안 된다)
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 400], JSON.stringify(results.map((r) => r.json)));
  assert.equal(results.find((r) => r.status === 400).json.error.code, 'DEFECT_NOTE_REQUIRED');
  const d = await reloadDetail(fabric);
  assert.ok(!d.has_defect || d.defect_note, `깨진 상태: has_defect=${d.has_defect}, defect_note=${d.defect_note}`);
});

// ==== 13. 원단 삭제

test('삭제 성공: 200 { data: null } 이고 삭제 표시만 한다 (행은 남는다)', async () => {
  const { fabric, token } = await setup({ fabric: { status: 'POSTED' } });
  const { status, json } = await del(fabric, token);
  assert.equal(status, 200);
  assert.deepEqual(json, { success: true, data: null });

  const saved = await reload(fabric);
  assert.ok(saved, '실제로 지우지 않는다');
  assert.ok(saved.deleted_at);
  assert.equal(await db.Fabric.findByPk(fabric.fabric_id), null); // 기본 조회에서는 빠진다
  assert.ok(await reloadDetail(fabric)); // 상세도 남는다
});

test('모든 상태에서 삭제할 수 있다 (PENDING, POSTED, REJECTED, SOLD_OUT)', async () => {
  for (const state of ['PENDING', 'POSTED', 'REJECTED', 'SOLD_OUT']) {
    const { fabric, token } = await setup({ fabric: { status: state, reject_reason: state === 'REJECTED' ? '사유' : null } });
    assert.equal((await del(fabric, token)).status, 200, state);
  }
});

test('삭제하면 사진 업로드·수정·승인 등 이후 요청에서 없는 원단(404)이 된다', async () => {
  const { fabric, token } = await setup();
  await del(fabric, token);
  assert.equal((await patch(fabric, { price: 1 }, token)).status, 404);
  assert.equal((await del(fabric, token)).status, 404); // 두 번째 삭제
  const admin = signToken(await makeUser({ role: 'ADMIN' }));
  assert.equal((await call('POST', `/admin/fabrics/${fabric.fabric_id}/approve`, { token: admin })).status, 404);
});

test('요청됨·수락됨 예약이 있으면 삭제할 수 없다 (FABRIC_HAS_ACTIVE_RESERVATION)', async () => {
  for (const reservationStatus of ['REQUESTED', 'ACCEPTED']) {
    const { fabric, store, token } = await setup({ fabric: { status: 'POSTED' } });
    await addReservation(fabric, store, reservationStatus);
    const { status, json } = await del(fabric, token);
    assert.equal(status, 409, reservationStatus);
    assert.equal(json.error.code, 'FABRIC_HAS_ACTIVE_RESERVATION');
    assert.equal(json.error.message, '진행 중인 예약이 있어 삭제할 수 없어요');
    assert.equal((await reload(fabric)).deleted_at, null);
  }
});

test('끝난 예약(거절·취소·수령 완료)만 있으면 삭제할 수 있고, 다른 원단의 예약은 상관없다', async () => {
  const { fabric, store, token } = await setup({ fabric: { status: 'POSTED' } });
  for (const reservationStatus of ['REJECTED', 'CANCELED', 'PICKED_UP']) await addReservation(fabric, store, reservationStatus);

  const other = await setup({ fabric: { status: 'POSTED' } });
  await addReservation(other.fabric, other.store, 'ACCEPTED'); // 남의 원단의 진행 중 예약

  assert.equal((await del(fabric, token)).status, 200);
});

test('삭제 권한: 로그인 안 함 401, 구매자·운영팀 403, 남의 원단 403, 없는 원단 404', async () => {
  const mine = await setup();
  const other = await setup();
  assert.equal((await del(mine.fabric)).status, 401);
  for (const role of ['BUYER', 'ADMIN']) {
    assert.equal((await del(mine.fabric, signToken(await makeUser({ role })))).status, 403, role);
  }
  const forbidden = await del(other.fabric, mine.token);
  assert.equal(forbidden.status, 403);
  assert.equal(forbidden.json.error.code, 'FORBIDDEN');
  assert.equal((await reload(other.fabric)).deleted_at, null);
  assert.equal((await del(99999, mine.token)).json.error.code, 'NOT_FOUND');
});

test('남의 원단은 진행 중 예약이 있어도 FORBIDDEN 이 먼저다 (예약 여부를 알려 주지 않는다)', async () => {
  const mine = await setup();
  const other = await setup({ fabric: { status: 'POSTED' } });
  await addReservation(other.fabric, other.store, 'ACCEPTED');
  assert.equal((await del(other.fabric, mine.token)).json.error.code, 'FORBIDDEN');
});

test('삭제 번호가 숫자가 아니면 VALIDATION_ERROR', async () => {
  const { token } = await setup();
  for (const id of ['abc', '0', '-1']) {
    const { status, json } = await call('DELETE', `/fabrics/${id}`, { token });
    assert.equal(status, 400, id);
    assert.ok(json.error.details.some((d) => d.field === 'fabricId'));
  }
});

test('같은 원단을 동시에 여러 번 삭제해도 한 번만 성공한다', async () => {
  const { fabric, token } = await setup();
  const results = await Promise.all(Array.from({ length: 4 }, () => del(fabric, token)));
  assert.equal(results.filter((r) => r.status === 200).length, 1);
  assert.ok(results.filter((r) => r.status !== 200).every((r) => r.status === 404));
});

test('삭제는 원단 행을 잠그므로, 예약을 만드는 중인 요청이 끝날 때까지 기다린 뒤 그 예약을 보고 거절한다', async () => {
  const { fabric, store, token } = await setup({ fabric: { status: 'POSTED' } });
  const buyer = await makeUser({ role: 'BUYER' });
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  // 예약 요청(25번)이 쓸 방식: 원단 행을 잠그고 예약을 만든 뒤 잠시 있다가 확정한다.
  // 삭제가 잠금 없이 예약 개수만 세면, 이 요청이 확정되기 전의 0건을 보고 지워 버린다.
  const reserving = db.sequelize.transaction(async (transaction) => {
    await db.Fabric.findByPk(fabric.fabric_id, { transaction, lock: transaction.LOCK.UPDATE });
    await db.Reservation.create(
      { fabric_id: fabric.fabric_id, buyer_id: buyer.user_id, seller_id: store.user_id, pickup_at: new Date(), status: 'REQUESTED' },
      { transaction },
    );
    await sleep(200);
  });
  await sleep(60); // 예약 쪽이 먼저 잠금을 잡은 뒤에 삭제가 들어오게 한다.
  const [deleted] = await Promise.all([del(fabric, token), reserving]);

  assert.equal(deleted.status, 409, JSON.stringify(deleted.json));
  assert.equal(deleted.json.error.code, 'FABRIC_HAS_ACTIVE_RESERVATION');
  assert.equal((await reload(fabric)).deleted_at, null);
});
