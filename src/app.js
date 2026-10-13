import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { env } from './config/env.js';
import routes from './routes/index.js';
import { createDocsRouter } from './docs/swagger.js';
import { notFound } from './middlewares/notFound.js';
import { errorHandler } from './middlewares/errorHandler.js';
import { optionalAuth } from './middlewares/auth.js';
import { authorizeImage, sanitizedLegacyImage } from './services/imageAccess.service.js';

export function createApp() {
  const app = express();
  // API 문서 화면은 helmet 의 보안 헤더(CSP)가 스크립트를 막으므로 helmet 보다 앞에 둔다. 운영에서는 기본으로 꺼진다.
  if (env.docsEnabled) app.use(createDocsRouter());
  app.use(helmet());
  app.use(cors({ origin: env.corsOrigins }));
  app.use(express.json());
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
