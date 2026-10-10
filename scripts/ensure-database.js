// DB 가 없으면 만든다. npm run db:ensure (개발 DB), npm run db:ensure:test (테스트 DB)
import pg from 'pg';

const baseDatabase = process.env.DB_DATABASE || 'material_loop';
const database = process.argv.includes('--test')
  ? process.env.DB_DATABASE_TEST || `${baseDatabase}_test`
  : baseDatabase;
if (!/^[a-z0-9_]+$/.test(database)) throw new Error(`DB 이름이 올바르지 않습니다: ${database}`);

// 대상 DB 가 아직 없으므로 기본 DB(postgres)에 접속해서 만든다.
const client = new pg.Client({
  user: process.env.DB_ID || 'postgres',
  password: process.env.DB_PASS || undefined,
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT || 5432),
  database: 'postgres',
});
await client.connect();
const { rowCount } = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [database]);
if (rowCount === 0) {
  await client.query(`CREATE DATABASE ${database}`);
  console.log(`created database ${database}`);
} else {
  console.log(`database ${database} already exists`);
}
await client.end();
