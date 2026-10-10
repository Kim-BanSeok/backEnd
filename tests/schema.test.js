import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { db, resetDb, makeUser, makeStore, makeFabric } from './helpers.js';

before(resetDb);
beforeEach(resetDb);
after(() => db.sequelize.close());

// DB 제약이 막았는지 PostgreSQL 오류 코드로 확인한다. 23505 UNIQUE, 23503 FK, 23514 CHECK
const rejectsWith = (promise, pgCode) =>
  assert.rejects(promise, (err) => (err.original?.code ?? err.parent?.code) === pgCode);

test('BIGINT id 는 숫자로 나온다', async () => {
  const user = await makeUser();
  assert.equal(typeof user.user_id, 'number');
});

test('이메일은 탈퇴하지 않은 회원 사이에서만 중복 불가', async () => {
  const first = await makeUser({ email: 'dup@test.com' });
  await rejectsWith(makeUser({ email: 'dup@test.com' }), '23505');
  await first.destroy(); // 탈퇴(soft delete)
  await makeUser({ email: 'dup@test.com' }); // 재가입 가능
});

test('탈퇴 회원은 기본 조회에서 빠진다', async () => {
  const user = await makeUser();
  await user.destroy();
  assert.equal(await db.User.findByPk(user.user_id), null);
  assert.ok(await db.User.findByPk(user.user_id, { paranoid: false }));
});

test('판매자는 승인 상태 필수, 구매자는 NULL', async () => {
  await rejectsWith(makeUser({ role: 'SELLER', seller_approval_status: null }), '23514');
  await rejectsWith(makeUser({ role: 'BUYER', seller_approval_status: 'PENDING' }), '23514');
  await rejectsWith(makeUser({ role: 'HACKER' }), '23514');
});

test('판매자당 매장은 1개', async () => {
  const { seller } = await makeStore();
  await rejectsWith(
    db.Store.create({ user_id: seller.user_id, store_name: 'b', store_address: 'b', store_phone: 'b' }),
    '23505',
  );
});

test('롤은 남은 길이 필수, 자투리는 NULL', async () => {
  const { store } = await makeStore();
  await rejectsWith(makeFabric(store.store_id, { sale_type: 'ROLL' }), '23514');
  await rejectsWith(makeFabric(store.store_id, { sale_type: 'SCRAP', remaining_length_cm: 100 }), '23514');
  await makeFabric(store.store_id, { sale_type: 'ROLL', remaining_length_cm: 900 });
});

test('확보 길이는 남은 길이를 넘을 수 없다', async () => {
  const { store } = await makeStore();
  await rejectsWith(
    makeFabric(store.store_id, { sale_type: 'ROLL', remaining_length_cm: 180, reserved_length_cm: 270 }),
    '23514',
  );
});

test('반려 상태는 사유 필수', async () => {
  const { store } = await makeStore();
  await rejectsWith(makeFabric(store.store_id, { status: 'REJECTED' }), '23514');
  await makeFabric(store.store_id, { status: 'REJECTED', reject_reason: '사진 흐림' });
});

test('원단 상세: 자투리 길이 30~90, 하자는 내용 필수, 원단당 1개', async () => {
  const { store } = await makeStore();
  const fabric = await makeFabric(store.store_id);
  const detail = { fabric_id: fabric.fabric_id, width_cm: 100, thickness: 'THIN', color_family: 'BLUE' };

  await rejectsWith(db.FabricDetail.create({ ...detail, length_cm: 100 }), '23514');
  await rejectsWith(db.FabricDetail.create({ ...detail, length_cm: 50, has_defect: true }), '23514');
  await db.FabricDetail.create({ ...detail, length_cm: 50 });
  await rejectsWith(db.FabricDetail.create({ ...detail, length_cm: 50 }), '23505');
});

test('예약: 요청 길이는 90의 배수, 거절은 사유 필수, 취소는 취소 주체 필수', async () => {
  const { seller, store } = await makeStore();
  const buyer = await makeUser();
  const fabric = await makeFabric(store.store_id, { sale_type: 'ROLL', remaining_length_cm: 900 });
  const base = {
    fabric_id: fabric.fabric_id,
    buyer_id: buyer.user_id,
    seller_id: seller.user_id,
    pickup_at: new Date(),
  };

  await rejectsWith(db.Reservation.create({ ...base, requested_length_cm: 100 }), '23514');
  await rejectsWith(db.Reservation.create({ ...base, status: 'REJECTED' }), '23514');
  await rejectsWith(db.Reservation.create({ ...base, status: 'CANCELED' }), '23514');
  const ok = await db.Reservation.create({ ...base, requested_length_cm: 180 });
  assert.equal(ok.status, 'REQUESTED');
});

test('예약에서 buyer 와 seller 를 별칭으로 조회한다', async () => {
  const { seller, store } = await makeStore();
  const buyer = await makeUser({ nickname: '구매자' });
  const fabric = await makeFabric(store.store_id);
  const r = await db.Reservation.create({
    fabric_id: fabric.fabric_id, buyer_id: buyer.user_id, seller_id: seller.user_id, pickup_at: new Date(),
  });
  const found = await db.Reservation.findByPk(r.reservation_id, {
    include: [{ model: db.User, as: 'buyer' }, { model: db.User, as: 'seller' }],
  });
  assert.equal(found.buyer.nickname, '구매자');
  assert.equal(found.seller.user_id, seller.user_id);
});

test('관심저장: 대상 하나만, 같은 대상 중복 불가', async () => {
  const user = await makeUser();
  const { store } = await makeStore();
  const fabric = await makeFabric(store.store_id);

  await rejectsWith(db.Favorite.create({ user_id: user.user_id, target_type: 'FABRIC' }), '23514');
  await rejectsWith(
    db.Favorite.create({ user_id: user.user_id, target_type: 'FABRIC', fabric_id: fabric.fabric_id, pattern_id: 1 }),
    '23514',
  );
  const fav = { user_id: user.user_id, target_type: 'FABRIC', fabric_id: fabric.fabric_id };
  await db.Favorite.create(fav);
  await rejectsWith(db.Favorite.create(fav), '23505');
});

test('문의: 답변 완료는 답변 내용 필수', async () => {
  const { seller, store } = await makeStore();
  const buyer = await makeUser();
  const fabric = await makeFabric(store.store_id);
  const base = { fabric_id: fabric.fabric_id, buyer_id: buyer.user_id, seller_id: seller.user_id, content: '문의' };

  await rejectsWith(db.Inquiry.create({ ...base, status: 'ANSWERED' }), '23514');
  await db.Inquiry.create({ ...base, status: 'ANSWERED', answer: '답변', answered_at: new Date() });
});

test('도안을 지우면 부품도 함께 지워진다 (CASCADE)', async () => {
  const pattern = await db.Pattern.create({
    pattern_name: '에코백', allowed_materials: ['COTTON'], allowed_thickness: ['NORMAL'],
  });
  await rejectsWith(db.PatternPart.create({ pattern_id: pattern.pattern_id, part_name: '앞판', width_cm: 30, height_cm: 40, quantity: 0 }), '23514');
  await db.PatternPart.create({ pattern_id: pattern.pattern_id, part_name: '앞판', width_cm: 30, height_cm: 40 });
  await pattern.destroy();
  assert.equal(await db.PatternPart.count(), 0);
});

test('없는 매장을 가리키는 원단은 FK 가 막는다', async () => {
  await rejectsWith(makeFabric(9999), '23503');
});

test('사진 순서(sort_order)는 원단 안에서 중복 불가', async () => {
  const { store } = await makeStore();
  const fabric = await makeFabric(store.store_id);
  const img = { fabric_id: fabric.fabric_id, image_url: 'http://x/1.jpg', sort_order: 0 };
  await db.FabricImage.create(img);
  await rejectsWith(db.FabricImage.create(img), '23505');
});
