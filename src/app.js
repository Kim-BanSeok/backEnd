import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { env } from './config/env.js';
import routes from './routes/index.js';
import { createDocsRouter } from './docs/swagger.js';
import { notFound } from './middlewares/notFound.js';
import { errorHandler } from './middlewares/errorHandler.js';
import { optionalAuth } from './middlewares/auth.js';
import { createApiLimiter } from './middlewares/rateLimiters.js';
import { securityRequestLog } from './middlewares/securityRequestLog.js';
import { noStore } from './middlewares/noStore.js';
import { authorizeImage, sanitizedLegacyImage } from './services/imageAccess.service.js';

export function createApp() {
  const app = express();
  app.disable('etag');
  // 프록시는 지정한 IP/CIDR만 신뢰한다. 기본은 직접 연결 주소이며 전달 헤더를 신뢰하지 않는다.
  app.set('trust proxy', env.trustedProxyCidrs.length ? env.trustedProxyCidrs : false);
  // API 문서 화면은 helmet 의 보안 헤더(CSP)가 스크립트를 막으므로 helmet 보다 앞에 둔다. 운영에서는 기본으로 꺼진다.
  if (env.docsEnabled) app.use(createDocsRouter());
  app.use(helmet());
  app.use(['/api/v1', '/uploads'], noStore);
  app.use(cors({ origin: env.corsOrigins, exposedHeaders: ['RateLimit', 'RateLimit-Policy', 'Retry-After', 'X-Request-Id'] }));
  app.use(['/api/v1', '/uploads'], securityRequestLog);
  // 잘못된 JSON·인증 실패·없는 API도 센다. 초과 요청은 파싱/DB/파일/AI 처리에 들어가지 않는다.
  app.use(['/api/v1', '/uploads'], createApiLimiter());
  app.use(express.json({ limit: '8mb' }));
  // Check DB visibility even for old image URLs; never expose the upload directory directly.
  if (env.storageProvider === 'local') {
    app.use('/uploads', optionalAuth, async (req, res, next) => {
      if (!['GET', 'HEAD'].includes(req.method)) return next();
      const key = await authorizeImage(req.user, req.path.replace(/^\//, ''), req.query);
      res.set({ 'Cross-Origin-Resource-Policy': 'cross-origin', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
      const clean = await sanitizedLegacyImage(key);
      if (clean) return res.type(clean.type).send(clean.buffer);
      res.sendFile(key, { root: env.uploadDir, dotfiles: 'deny' }, error => { if (error) next(error); });
    });
  }
  app.use('/api/v1', routes);
  app.use(notFound);
  app.use(errorHandler);
  return app;
}
