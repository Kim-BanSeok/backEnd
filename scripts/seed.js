// 처음 필요한 데이터를 넣는다. (npm run db:seed) 여러 번 실행해도 안전하다. (이미 있으면 건드리지 않는다)
import sequelize from '../src/db/connection.js';
import { env } from '../src/config/env.js';
import { seedAdmin } from '../src/db/seedAdmin.js';

try {
  const result = await seedAdmin();
  console.log(
    result === 'created'
      ? `운영팀 계정을 만들었어요: ${env.admin.email}`
      : `운영팀 계정이 이미 있어서 그대로 뒀어요: ${env.admin.email}`,
  );
} catch (err) {
  console.error(`시드 실패: ${err.message}`);
  process.exitCode = 1;
} finally {
  await sequelize.close();
}
