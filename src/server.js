import { createApp } from './app.js';
import { env } from './config/env.js';
import sequelize from './db/connection.js';

const server = createApp().listen(env.port, () => {
  console.log(`Server running on http://localhost:${env.port}`);
});

// 안전한 종료: 새 요청을 멈추고 DB 연결을 닫는다.
const shutdown = () => server.close(() => sequelize.close().then(() => process.exit(0)));
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
