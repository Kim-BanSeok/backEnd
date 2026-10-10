import os from 'node:os';
import path from 'node:path';

// 환경변수를 한 곳에서 읽는다. 다른 파일은 process.env 를 직접 쓰지 않는다.
const num = (v, fallback) => (v === undefined || v === '' ? fallback : Number(v));

const nodeEnv = process.env.NODE_ENV || 'development';

const baseDatabase = process.env.DB_DATABASE || 'material_loop';
// 테스트는 항상 별도 DB 를 쓴다. (개발 DB 를 지우지 않도록) 이름은 _test 로 끝나야 한다.
const database =
  nodeEnv === 'test' ? process.env.DB_DATABASE_TEST || `${baseDatabase}_test` : baseDatabase;

export const env = {
  nodeEnv,
  isProd: nodeEnv === 'production',
  isTest: nodeEnv === 'test',
  port: num(process.env.PORT, 3000),
  db: {
    username: process.env.DB_ID || 'postgres',
    password: process.env.DB_PASS || undefined,
    database,
    host: process.env.DB_HOST || 'localhost',
    port: num(process.env.DB_PORT, 5432),
    dialect: process.env.DB_DIALECT || 'postgres',
  },
  // 사진 저장소. 지금은 내 컴퓨터 폴더(local)만 지원한다. 클라우드로 옮길 때 storage/ 에 제공자를 추가한다.
  storageProvider: process.env.STORAGE_PROVIDER || 'local',
  // 테스트는 임시 폴더를 써서 프로젝트의 uploads/ 를 건드리지 않는다.
  uploadDir: path.resolve(
    process.env.UPLOAD_DIR || (nodeEnv === 'test' ? path.join(os.tmpdir(), 'material-loop-test-uploads') : 'uploads'),
  ),
  // 응답의 사진 주소 앞부분 (프론트엔드가 이 주소로 사진을 불러온다)
  publicUrl: (process.env.PUBLIC_URL || `http://localhost:${process.env.PORT || 3000}`).replace(/\/+$/, ''),
  // API 문서(Swagger, /api-docs). 개발에서는 켜져 있고, 운영에서는 DOCS_ENABLED=true 로 켠 경우에만 보인다.
  docsEnabled: process.env.DOCS_ENABLED ? process.env.DOCS_ENABLED === 'true' : nodeEnv !== 'production',
  jwtSecret: process.env.JWT_SECRET || 'dev-only-secret',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '24h',
  corsOrigins: (process.env.CORS_ORIGIN || 'http://localhost:5173')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
};

if (env.isTest && !env.db.database.endsWith('_test')) {
  throw new Error(`테스트 DB 이름은 _test 로 끝나야 합니다: ${env.db.database}`);
}

// 운영에서 약한 설정이면 서버를 켜지 않는다.
if (env.isProd && (env.jwtSecret === 'dev-only-secret' || env.jwtSecret.length < 32)) {
  throw new Error('운영 환경에서는 32자 이상의 JWT_SECRET 이 필요합니다.');
}
