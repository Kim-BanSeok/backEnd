import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { Op } from 'sequelize';
import migration from '../migrations/20261014100000-active-reservation-unique.cjs';
import { createApp } from '../src/app.js';
import { signToken } from '../src/services/auth.service.js';
import { db, resetDb, makeUser, makeStore, makeFabric } from './helpers.js';

const INDEX = 'reservations_buyer_fabric_active_unique';
const ACTIVE = ['REQUESTED', 'ACCEPTED'];
const CLOSED = ['REJECTED', 'CANCELED', 'PICKED_UP'];
const queryInterface = db.sequelize.getQueryInterface();
let server;
let base;

before(() => {
  server = createApp().listen(0);
  base = `http://localhost:${server.address().port}/api/v1`;
});
beforeEach(resetDb);
after(async () => {
  await new Promise(resolve => server.close(resolve));
  await db.sequelize.close();
});

async function context(saleType = 'ROLL') {
  const { seller, store } = await makeStore();
  const buyer = await makeUser();
  const fabric = await makeFabric(store.store_id, {
    sale_type: saleType, status: 'POSTED',
    ...(saleType === 'ROLL' && { remaining_length_cm: 900 }),
  });
  return { seller, store, buyer, fabric };
}

const values = (ctx, status = 'REQUESTED', overrides = {}) => ({
  buyer_id: ctx.buyer.user_id, seller_id: ctx.seller.user_id, fabric_id: ctx.fabric.fabric_id,
  pickup_at: new Date(Date.now() + 2 * 86400e3), status,
  requested_length_cm: ctx.fabric.sale_type === 'ROLL' ? 90 : null,
  requested_sheet_count: ctx.fabric.sale_type === 'SCRAP' ? 1 : null,
  ...(status === 'REJECTED' && { reject_reason: '거절' }),
  ...(status === 'CANCELED' && { canceled_by: 'BUYER' }),
  ...overrides,
});
const insert = (ctx, status = 'REQUESTED', overrides = {}, options = {}) =>
  db.Reservation.create(values(ctx, status, overrides), options);
const isConflict = error => {
  assert.equal(error.name, 'SequelizeUniqueConstraintError');
  assert.equal(error.original.code, '23505');
  assert.equal(error.original.constraint, INDEX);
  return true;
};
async function indexMetadata() {
  const [rows] = await db.sequelize.query(`
    SELECT i.indisunique, i.indisvalid, pg_get_indexdef(i.indexrelid) AS definition,
           pg_get_expr(i.indpred, i.indrelid) AS predicate
    FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = :name
  `, { replacements: { name: INDEX } });
  return rows;
}

test('부분 UNIQUE 인덱스: 실제 DB와 모델이 구매자·원단 및 두 활성 상태를 일치시킨다', async () => {
  const [index] = await indexMetadata();
  assert.equal(index.indisunique, true);
  assert.equal(index.indisvalid, true);
  assert.match(index.definition, /USING btree \(buyer_id, fabric_id\)/);
  assert.match(index.predicate, /REQUESTED/);
  assert.match(index.predicate, /ACCEPTED/);
  for (const status of CLOSED) assert.ok(!index.predicate.includes(status));
  const modelIndex = db.Reservation.options.indexes.find(item => item.name === INDEX);
  assert.equal(modelIndex.unique, true);
  assert.deepEqual(modelIndex.fields, ['buyer_id', 'fabric_id']);
  assert.deepEqual(modelIndex.where.status[Op.in], ACTIVE);
});

for (const saleType of ['ROLL', 'SCRAP']) {
  for (const first of ACTIVE) {
    for (const second of ACTIVE) {
      test(`${saleType}: 직접 DB 쓰기 ${first} → ${second} 활성 중복은 23505로 거절한다`, async () => {
        const ctx = await context(saleType);
        const saved = await insert(ctx, first);
        await assert.rejects(insert(ctx, second), isConflict);
        assert.equal(await db.Reservation.count(), 1);
        assert.equal((await saved.reload()).status, first);
      });
    }
  }
}

test('다른 구매자의 같은 원단 예약과 같은 구매자의 다른 원단 예약은 허용한다', async () => {
  const ctx = await context();
  await insert(ctx);
  const otherBuyer = await makeUser();
  await insert(ctx, 'ACCEPTED', { buyer_id: otherBuyer.user_id });
  const otherFabric = await makeFabric(ctx.store.store_id, { status: 'POSTED' });
  await insert({ ...ctx, fabric: otherFabric });
  assert.equal(await db.Reservation.count(), 3);
});

for (const status of CLOSED) {
  test(`${status}: 종료 이력 여러 건과 새로운 활성 예약을 함께 보관한다`, async () => {
    const ctx = await context();
    await insert(ctx, status);
    await insert(ctx, status);
    await insert(ctx);
    assert.equal(await db.Reservation.count(), 3);
    await assert.rejects(insert(ctx, 'ACCEPTED'), isConflict);
  });
  test(`ACCEPTED → ${status}: 활성 키를 해제하고 재활성화 충돌은 막는다`, async () => {
    const ctx = await context();
    const previous = await insert(ctx, 'ACCEPTED');
    await previous.update({
      status,
      ...(status === 'REJECTED' && { reject_reason: '거절' }),
      ...(status === 'CANCELED' && { canceled_by: 'BUYER' }),
    });
    await insert(ctx);
    await assert.rejects(previous.update({ status: 'ACCEPTED' }), isConflict);
    assert.equal((await previous.reload()).status, status);
    assert.equal(await db.Reservation.count(), 2);
  });
}

async function waitForUniqueLock(pid) {
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    const [[activity]] = await db.sequelize.query(
      'SELECT wait_event_type FROM pg_stat_activity WHERE pid = :pid', { replacements: { pid } },
    );
    if (activity?.wait_event_type === 'Lock') return;
    await delay(20);
  }
  assert.fail('독립 트랜잭션의 UNIQUE 충돌 대기를 확인하지 못했습니다.');
}

for (const finish of ['commit', 'rollback']) {
  test(`동시 직접 DB 쓰기: 먼저 삽입한 트랜잭션 ${finish} 후에 두 번째 결과를 확정한다`, async () => {
    const ctx = await context();
    const first = await db.sequelize.transaction();
    const second = await db.sequelize.transaction();
    let pending;
    try {
      await insert(ctx, 'REQUESTED', {}, { transaction: first });
      const [[{ pid }]] = await db.sequelize.query('SELECT pg_backend_pid() AS pid', { transaction: second });
      pending = insert(ctx, 'ACCEPTED', {}, { transaction: second })
        .then(value => ({ value }), error => ({ error }));
      await waitForUniqueLock(pid);
      await first[finish]();
      const result = await pending;
      if (finish === 'commit') {
        isConflict(result.error);
        await second.rollback();
      } else {
        assert.ok(result.value, result.error?.message);
        await second.commit();
      }
      const rows = await db.Reservation.findAll();
      assert.equal(rows.length, 1);
      assert.equal(rows[0].status, finish === 'commit' ? 'REQUESTED' : 'ACCEPTED');
    } finally {
      if (!first.finished) await first.rollback();
      if (pending) await pending;
      if (!second.finished) await second.rollback();
    }
  });
}

async function request(ctx) {
  const response = await fetch(`${base}/reservations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${signToken(ctx.buyer)}` },
    body: JSON.stringify({ fabric_id: ctx.fabric.fabric_id, requested_length_cm: 90, pickup_at: values(ctx).pickup_at }),
  });
  return { status: response.status, json: await response.json() };
}

test('API: 사전 중복 검사가 놓쳐도 실제 인덱스 오류는 롤백 후 409 DUPLICATE_RESERVATION이다', async (t) => {
  const ctx = await context();
  const existing = await insert(ctx, 'ACCEPTED');
  const before = existing.toJSON();
  // 애플리케이션 검사를 우회한 경우의 DB 방어를 검증한다. INSERT·인덱스·트랜잭션은 실제 DB다.
  t.mock.method(db.Reservation, 'count', async () => 0);
  const result = await request(ctx);
  assert.equal(result.status, 409);
  assert.equal(result.json.error.code, 'DUPLICATE_RESERVATION');
  t.mock.restoreAll();
  assert.equal(await db.Reservation.count(), 1);
  assert.deepEqual((await existing.reload()).toJSON(), before);
  assert.equal((await ctx.fabric.reload()).reserved_length_cm, 0);
  // 롤백한 연결과 원단 잠금이 정상 해제되었는지도 확인한다.
  await existing.update({ status: 'CANCELED', canceled_by: 'BUYER' });
  assert.equal((await request(ctx)).status, 201);
});

test('API: 다른 UNIQUE 제약 오류를 중복 예약으로 잘못 바꾸지 않는다', async (t) => {
  const ctx = await context();
  const existing = await insert(ctx, 'PICKED_UP');
  const originalCreate = db.Reservation.create.bind(db.Reservation);
  t.mock.method(db.Reservation, 'create', (input, options) =>
    originalCreate({ ...input, reservation_id: existing.reservation_id }, options));
  const result = await request(ctx); // 실제 reservations_pkey 충돌
  assert.equal(result.status, 500);
  assert.equal(result.json.error.code, 'INTERNAL_ERROR');
  t.mock.restoreAll();
  assert.equal(await db.Reservation.count(), 1);
  assert.equal((await existing.reload()).status, 'PICKED_UP');
  assert.equal((await request(ctx)).status, 201);
});

test('마이그레이션 down/up: 예약 기록은 그대로이고 해당 인덱스만 제거·복구한다', async () => {
  const ctx = await context();
  const existing = await insert(ctx);
  const before = existing.toJSON();
  await migration.down(queryInterface);
  try {
    assert.deepEqual(await indexMetadata(), []);
    assert.deepEqual((await existing.reload()).toJSON(), before);
  } finally {
    await migration.up(queryInterface);
  }
  assert.equal((await indexMetadata())[0].indisvalid, true);
  assert.deepEqual((await existing.reload()).toJSON(), before);
  await assert.rejects(insert(ctx), isConflict);
});

test('기존 활성 중복이 있으면 적용을 중단하고 모든 예약을 변경 없이 유지한다', async () => {
  const ctx = await context();
  await migration.down(queryInterface);
  try {
    await insert(ctx);
    await insert(ctx, 'ACCEPTED');
    const before = (await db.Reservation.findAll({ order: [['reservation_id', 'ASC']] })).map(row => row.toJSON());
    await assert.rejects(migration.up(queryInterface), /활성 예약이 중복/);
    assert.deepEqual(await indexMetadata(), [], '실패 후 불완전한 인덱스를 남기지 않는다');
    const afterRows = (await db.Reservation.findAll({ order: [['reservation_id', 'ASC']] })).map(row => row.toJSON());
    assert.deepEqual(afterRows, before, '중복 예약을 임의 삭제하거나 상태를 바꾸지 않는다');
  } finally {
    await resetDb();
    await migration.up(queryInterface);
  }
});

test('인덱스 생성의 DB 오류도 롤백하고 기존 예약과 세션의 timeout 설정을 유지한다', async (t) => {
  const ctx = await context();
  const existing = await insert(ctx);
  const before = existing.toJSON();
  await migration.down(queryInterface);
  try {
    t.mock.method(queryInterface, 'addIndex', (_table, _fields, options) =>
      db.sequelize.query('CREATE UNIQUE INDEX test_invalid_reservation_index ON reservations (test_missing_column)', { transaction: options.transaction }));
    await assert.rejects(migration.up(queryInterface), error => {
      assert.equal(error.original.code, '42703'); // 실제 DB 오류로 트랜잭션이 중단된 뒤 롤백해야 한다.
      return true;
    });
    t.mock.restoreAll();
    assert.deepEqual(await indexMetadata(), []);
    assert.deepEqual((await existing.reload()).toJSON(), before);
    const [[settings]] = await db.sequelize.query("SELECT current_setting('lock_timeout') AS lock_timeout, current_setting('statement_timeout') AS statement_timeout");
    assert.equal(settings.lock_timeout, '0');
    assert.equal(settings.statement_timeout, '0');
  } finally {
    t.mock.restoreAll();
    await migration.up(queryInterface);
  }
});
