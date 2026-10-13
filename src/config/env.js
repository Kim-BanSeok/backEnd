import os from 'node:os';
import path from 'node:path';

// 환경변수를 한 곳에서 읽는다. 다른 파일은 process.env 를 직접 쓰지 않는다.
const num = (v, fallback) => (v === undefined || v === '' ? fallback : Number(v));
const positive = (name, fallback) => {
  const value = num(process.env[name], fallback);
  if (!Number.isSafeInteger(value) || value < 1 || value > 2147483647) throw new Error(`${name} must be a positive integer`);
  return value;
};

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
  // 처음 한 번 만들 운영팀(ADMIN) 계정. npm run db:seed 가 이 값으로 만들고, 이미 있으면 만들지 않는다. (가입 API 로는 ADMIN 을 만들 수 없다)
  admin: {
    email: (process.env.ADMIN_EMAIL || '').trim().toLowerCase(),
    password: process.env.ADMIN_PASSWORD || '',
    nickname: (process.env.ADMIN_NICKNAME || '').trim() || '운영팀',
  },
  // AI 보조 등록. fake 는 키워드 규칙으로 답을 읽는 개발·시험용이라 운영에서는 쓸 수 없다. 운영은 AI_PROVIDER=claude 와 ANTHROPIC_API_KEY 가 필요하다.
  ai: {
    provider: process.env.AI_PROVIDER || 'fake',
    anthropicApiKey: process.env.ANTHROPIC_API_KEY || '',
    anthropicModel: process.env.ANTHROPIC_MODEL || 'claude-haiku-5-5',
    timeoutMs: positive('AI_TIMEOUT_MS', 15000),
    callLimits: {
      userHourly: positive('AI_USER_CALLS_PER_HOUR', 30),
      globalHourly: positive('AI_GLOBAL_CALLS_PER_HOUR', 300),
      userConcurrent: positive('AI_USER_CONCURRENT_CALLS', 2),
      globalConcurrent: positive('AI_GLOBAL_CONCURRENT_CALLS', 4),
    },
    sessionLimits: {
      userHourly: positive('AI_USER_SESSIONS_PER_HOUR', 20),
      globalHourly: positive('AI_GLOBAL_SESSIONS_PER_HOUR', 200),
      userConcurrent: positive('AI_USER_ACTIVE_SESSIONS', 5),
      globalConcurrent: positive('AI_GLOBAL_ACTIVE_SESSIONS', 100),
    },
    // Database sessions survive restart and keep quota leases consistent.
    sessionStore: process.env.AI_SESSION_STORE || 'database',
  },
  jwtSecret: process.env.JWT_SECRET || 'dev-only-secret',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '24h',
  corsOrigins: (process.env.CORS_ORIGIN || 'http://localhost:5173')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  naverMaps: {
    clientId: process.env.NAVER_MAPS_CLIENT_ID || '',
    clientSecret: process.env.NAVER_MAPS_CLIENT_SECRET || '',
  },
};

if (env.isTest && !env.db.database.endsWith('_test')) {
  throw new Error(`테스트 DB 이름은 _test 로 끝나야 합니다: ${env.db.database}`);
}

if (!['fake', 'claude'].includes(env.ai.provider)) throw new Error(`지원하지 않는 AI_PROVIDER: ${env.ai.provider}`);
if (env.ai.provider === 'claude' && !env.ai.anthropicApiKey) throw new Error('AI_PROVIDER=claude 에는 ANTHROPIC_API_KEY 가 필요해요.');
if (!['memory', 'database'].includes(env.ai.sessionStore)) throw new Error(`지원하지 않는 AI_SESSION_STORE: ${env.ai.sessionStore}`);
if (env.isProd && env.ai.sessionStore !== 'database') throw new Error('운영 AI 세션은 database 저장소를 사용해야 합니다.');
if (env.isProd && env.ai.provider === 'fake') throw new Error('운영 환경에서는 가짜 AI(fake)를 쓸 수 없어요. AI_PROVIDER=claude 로 설정해 주세요.');

// 운영에서 약한 설정이면 서버를 켜지 않는다.
if (env.isProd && (env.jwtSecret === 'dev-only-secret' || env.jwtSecret.length < 32)) {
  throw new Error('운영 환경에서는 32자 이상의 JWT_SECRET 이 필요합니다.');
}
