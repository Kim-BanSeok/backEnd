import { createApp } from './app.js';
import { env } from './config/env.js';
import sequelize from './db/connection.js';
import { startAiSessionMaintenance } from './services/aiSessionMaintenance.service.js';
import { closeAiSessionLocks } from './dao/security.dao.js';
import { securityEvent } from './utils/securityLog.js';

await sequelize.authenticate();
const stopMaintenance = startAiSessionMaintenance();

const server = createApp().listen(env.port, env.isTest ? '127.0.0.1' : undefined, () => {
  console.log(`Server running on http://localhost:${server.address().port}`);
  console.log(`AI provider: ${env.ai.provider} (${env.ai.provider === 'openai' ? env.ai.openaiModel : env.ai.provider === 'claude' ? env.ai.anthropicModel : 'rules'})`);
  securityEvent('server.started');
});

// 안전한 종료: 새 요청을 멈추고 DB 연결을 닫는다.
let closing = false;
const shutdown = () => {
  if (closing) return;
  closing = true;
  server.close(async () => {
    await stopMaintenance();
    await closeAiSessionLocks();
    await sequelize.close();
    securityEvent('server.stopped');
    process.exit(0);
  });
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
