import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { env } from './config/env.js';
import routes from './routes/index.js';
import { createDocsRouter } from './docs/swagger.js';
import { notFound } from './middlewares/notFound.js';
import { errorHandler } from './middlewares/errorHandler.js';

export function createApp() {
  const app = express();
  // API 문서 화면은 helmet 의 보안 헤더(CSP)가 스크립트를 막으므로 helmet 보다 앞에 둔다. 운영에서는 기본으로 꺼진다.
  if (env.docsEnabled) app.use(createDocsRouter());
  app.use(helmet());
  app.use(cors({ origin: env.corsOrigins }));
  app.use(express.json({ limit: '8mb' }));
  // 올린 사진 보여 주기 (로컬 저장소일 때). helmet 의 기본값은 다른 사이트(프론트엔드)가 이미지를 못 불러오게 하므로 이 경로만 허용한다.
  if (env.storageProvider === 'local') {
    app.use(
      '/uploads',
      express.static(env.uploadDir, {
        setHeaders: (res) => res.set('Cross-Origin-Resource-Policy', 'cross-origin'),
      }),
    );
  }
  app.use('/api/v1', routes);
  app.use(notFound);
  app.use(errorHandler);
  return app;
}
