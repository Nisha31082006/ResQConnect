import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import fs from 'fs';
import path from 'path';
import { env } from './config/env';
import { apiRouter } from './routes';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' }, contentSecurityPolicy: false }));
  app.use(cors({ origin: env.clientOrigins, credentials: true }));
  app.use(express.json({ limit: '1mb' }));
  app.use('/api', apiRouter);
  app.use('/api', notFoundHandler);

  if (env.serveClient && fs.existsSync(env.clientDist)) {
    app.use(express.static(env.clientDist));
    app.get('*', (_req, res) => res.sendFile(path.join(env.clientDist, 'index.html')));
  }
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
