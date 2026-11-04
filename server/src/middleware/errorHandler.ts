import type { ErrorRequestHandler, RequestHandler } from 'express';
import mongoose from 'mongoose';
import multer from 'multer';
import { ZodError } from 'zod';
import { env } from '../config/env';
import { AppError } from '../utils/AppError';

export const notFoundHandler: RequestHandler = (req, res) => {
  res.status(404).json({ success: false, error: { code: 'ROUTE_NOT_FOUND', message: `Route ${req.method} ${req.originalUrl} not found` } });
};

/** Single place that converts every failure into the consistent { success:false, error:{code,message,details} } shape. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof AppError) {
    return res.status(err.status).json({ success: false, error: { code: err.code, message: err.message, details: err.details } });
  }

  if (err instanceof ZodError) {
    const details = err.issues.map((i) => ({ path: i.path.join('.'), code: i.message, message: i.message }));
    return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Validation failed', details } });
  }

  if (err instanceof mongoose.Error.ValidationError) {
    const details = Object.values(err.errors).map((e) => ({ path: e.path, code: e.message, message: e.message }));
    return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Validation failed', details } });
  }

  if (err instanceof mongoose.Error.CastError) {
    return res.status(400).json({ success: false, error: { code: 'INVALID_ID', message: `Invalid value for ${err.path}` } });
  }

  if (err instanceof multer.MulterError) {
    const code = err.code === 'LIMIT_FILE_SIZE' ? 'FILE_TOO_LARGE' : 'UPLOAD_ERROR';
    return res.status(400).json({ success: false, error: { code, message: err.message } });
  }

  if ((err as { code?: number }).code === 11000) {
    return res.status(409).json({ success: false, error: { code: 'DUPLICATE_KEY', message: 'A record with the same unique value already exists' } });
  }

  if (err instanceof SyntaxError && 'body' in err) {
    return res.status(400).json({ success: false, error: { code: 'INVALID_JSON', message: 'Request body is not valid JSON' } });
  }

  // eslint-disable-next-line no-console
  if (!env.isTest) console.error('[error]', err);
  return res.status(500).json({
    success: false,
    error: { code: 'INTERNAL_ERROR', message: env.isProd ? 'Something went wrong on the server' : String((err as Error)?.message ?? err) },
  });
};
