import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { DataTypes, Utils } from 'sequelize';
import { db, resetDb, makeUser } from './helpers.js';

// 애플리케이션에서 우연히 다른 버전을 찾는 대신 Sequelize의 require 경로로 검사한다.
const require = createRequire(import.meta.url);
const sequelizeRequire = createRequire(require.resolve('sequelize'));
const uuid = sequelizeRequire('uuid');
beforeEach(resetDb);
after(() => db.sequelize.close());

test('Sequelize의 CommonJS uuid 의존성으로 UUIDV1·UUIDV4 기본값을 계속 생성한다', () => {
  const v1 = Utils.toDefaultValue(new DataTypes.UUIDV1());
  const v4 = Utils.toDefaultValue(new DataTypes.UUIDV4());
  assert.equal(uuid.validate(v1), true);
  assert.equal(uuid.version(v1), 1);
  assert.equal(uuid.validate(v4), true);
  assert.equal(uuid.version(v4), 4);
  assert.notEqual(Utils.toDefaultValue(new DataTypes.UUIDV4()), v4);
});

const generators = [
  ['v3', (buffer, offset) => uuid.v3('material-loop', uuid.v3.DNS, buffer, offset)],
  ['v5', (buffer, offset) => uuid.v5('material-loop', uuid.v5.DNS, buffer, offset)],
  ['v6', (buffer, offset) => uuid.v6({ node: [0, 1, 2, 3, 4, 5], clockseq: 1, msecs: 1791936000000, nsecs: 0 }, buffer, offset)],
];
for (const [name, generate] of generators) {
  test(`uuid ${name}: 작은 버퍼·음수·범위 밖 오프셋은 쓰기 전에 거절한다 (GHSA-w5hq-g745-h8pq)`, () => {
    for (const [size, offset] of [[8, 0], [16, -1], [16, 1], [32, 17]]) {
      const buffer = Buffer.alloc(size, 0xaa);
      const original = Buffer.from(buffer);
      assert.throws(() => generate(buffer, offset), RangeError, `${size} bytes, offset ${offset}`);
      assert.deepEqual(buffer, original, '실패한 호출이 버퍼 일부를 바꾸면 안 된다');
    }
  });
  test(`uuid ${name}: 유효한 버퍼와 오프셋에는 정확히 16바이트만 쓴다`, () => {
    const expected = generate();
    const buffer = Buffer.alloc(32, 0xaa);
    assert.equal(generate(buffer, 8), buffer);
    assert.deepEqual(buffer.subarray(0, 8), Buffer.alloc(8, 0xaa));
    assert.deepEqual(buffer.subarray(24), Buffer.alloc(8, 0xaa));
    assert.equal(uuid.stringify(buffer.subarray(8, 24)), expected);
  });
}

test('로컬 PostgreSQL: 쿼리 UUID·트랜잭션 UUID를 생성하고 정상 커밋한다', async () => {
  const user = await makeUser();
  const Query = db.sequelize.dialect.Query;
  const query = new Query(null, db.sequelize, { logging: false });
  assert.equal(uuid.version(query.uuid), 4);
  await db.sequelize.transaction(async transaction => {
    assert.equal(uuid.version(transaction.id), 4);
    await user.update({ nickname: 'UUID 커밋 확인' }, { transaction });
  });
  assert.equal((await db.User.findByPk(user.user_id)).nickname, 'UUID 커밋 확인');
});

test('로컬 PostgreSQL: 중첩 savepoint와 전체 롤백도 기존 데이터 규칙을 지킨다', async () => {
  const user = await makeUser();
  const original = user.nickname;
  await assert.rejects(() => db.sequelize.transaction(async transaction => {
    await user.update({ nickname: '외부 변경' }, { transaction });
    await assert.rejects(() => db.sequelize.transaction({ transaction }, async nested => {
      assert.equal(uuid.version(nested.id), 4);
      await user.update({ nickname: '내부 변경' }, { transaction: nested });
      throw new Error('savepoint rollback');
    }), /savepoint rollback/);
    assert.equal((await db.User.findByPk(user.user_id, { transaction })).nickname, '외부 변경');
    throw new Error('transaction rollback');
  }), /transaction rollback/);
  assert.equal((await db.User.findByPk(user.user_id)).nickname, original);
});
