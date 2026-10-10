import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { env } from './config/env.js';
import routes from './routes/index.js';
import { notFound } from './middlewares/notFound.js';
import { errorHandler } from './middlewares/errorHandler.js';

export function createApp() {
  const app = express();
  app.use(helmet());
  app.use(cors({ origin: env.corsOrigins }));
  app.use(express.json());
  app.use('/api/v1', routes);
  app.use(notFound);
  app.use(errorHandler);
  return app;
}
