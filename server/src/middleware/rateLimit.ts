import type { RequestHandler } from 'express';
import rateLimit from 'express-rate-limit';
import { env } from '../config/env';

const passthrough: RequestHandler = (_req, _res, next) => next();

function limiter(windowMs: number, max: number, code: string): RequestHandler {
  if (!env.rateLimitEnabled) return passthrough;
  return rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (_req, res) => {
      res.status(429).json({ success: false, error: { code, message: 'Too many requests, please try again later' } });
    },
  });
}

/** Login / register: slows down credential stuffing. */
export const authLimiter = limiter(15 * 60 * 1000, 30, 'RATE_LIMIT_AUTH');
/** Emergency/SOS creation and uploads: protects against flooding while allowing real bursts. */
export const reportLimiter = limiter(60 * 60 * 1000, 60, 'RATE_LIMIT_REPORTS');
/** Public webhook endpoints. */
export const webhookLimiter = limiter(60 * 1000, 60, 'RATE_LIMIT_WEBHOOK');
/** General API limiter. */
export const apiLimiter = limiter(60 * 1000, 600, 'RATE_LIMIT_API');
