// 현재 접속 대상을 확인하는 읽기 전용 명령. 비밀번호·개별 업무 데이터는 출력하지 않는다.
import pg from 'pg';
import { env } from '../src/config/env.js';

const { host, port, database, username, password } = env.db;
const client = new pg.Client({ host, port, database, user: username, password, connectionTimeoutMillis: 5000, statement_timeout: 5000 });
const target = { host, port, database, localEndpoint: ['localhost', '127.0.0.1', '::1'].includes(host) };
try {
  await client.connect();
  await client.query('BEGIN READ ONLY');
  const identity = await client.query('SELECT current_database() AS database, version() AS version');
  const tables = await client.query("SELECT tablename FROM pg_catalog.pg_tables WHERE schemaname = 'public' ORDER BY tablename");
  const names = tables.rows.map((row) => row.tablename);
  const result = { target, server: identity.rows[0], tables: names };
  if (names.includes('SequelizeMeta')) {
    result.migrations = (await client.query('SELECT name FROM "SequelizeMeta" ORDER BY name')).rows.map((row) => row.name);
  }
  if (names.includes('factories')) {
    result.factories = Number((await client.query('SELECT count(*) AS count FROM factories')).rows[0].count);
    const columns = await client.query("SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'factories'");
    if (columns.rows.some((row) => row.column_name === 'supply_status')) {
      result.currentCandidates = Number((await client.query("SELECT count(*) AS count FROM factories WHERE is_current = true AND supply_status = 'candidate'")).rows[0].count);
      result.locatedCandidates = Number((await client.query("SELECT count(*) AS count FROM factories WHERE is_current = true AND supply_status = 'candidate' AND latitude IS NOT NULL AND longitude IS NOT NULL")).rows[0].count);
    }
  }
  await client.query('ROLLBACK');
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  // 연결 오류 전체에는 계정 등이 포함될 수 있어 대상과 오류 코드만 출력한다.
  console.error(JSON.stringify({ target, error: error.code || error.name, message: 'DB 연결·읽기 점검에 실패했습니다. 접속 정보와 네트워크/TLS 조건을 확인하세요.' }, null, 2));
  process.exitCode = 1;
} finally {
  await client.end();
}
