// sequelize-cli(마이그레이션)용 설정. 앱 연결은 src/db/connection.js 가 맡는다.
// 테스트 DB 는 `--env test` 로 고른다. (npm run migrate:test)
const database = process.env.DB_DATABASE || 'material_loop';

const base = {
  username: process.env.DB_ID || 'postgres',
  password: process.env.DB_PASS || undefined,
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT || 5432),
  dialect: process.env.DB_DIALECT || 'postgres',
  logging: false,
};

module.exports = {
  development: { ...base, database },
  production: { ...base, database },
  test: { ...base, database: process.env.DB_DATABASE_TEST || `${database}_test` },
};
