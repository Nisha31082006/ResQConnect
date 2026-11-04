import type { NextFunction, Request, RequestHandler, Response } from 'express';

export const asyncHandler =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler =>
  (req, res, next) => {
    fn(req, res, next).catch(next);
  };

export interface PageMeta {
  page: number;
  limit: number;
  total: number;
  pages: number;
}

export const ok = (res: Response, data: unknown, meta?: object, status = 200) =>
  res.status(status).json({ success: true, data, ...(meta ? { meta } : {}) });

export const created = (res: Response, data: unknown, meta?: object) => ok(res, data, meta, 201);

export function parsePaging(query: Record<string, unknown>, defaults = { page: 1, limit: 10, maxLimit: 100 }) {
  const page = Math.max(1, parseInt(String(query.page ?? defaults.page), 10) || defaults.page);
  const limit = Math.min(defaults.maxLimit, Math.max(1, parseInt(String(query.limit ?? defaults.limit), 10) || defaults.limit));
  return { page, limit, skip: (page - 1) * limit };
}

export const pageMeta = (page: number, limit: number, total: number): PageMeta => ({
  page,
  limit,
  total,
  pages: Math.max(1, Math.ceil(total / limit)),
});

/** Escape user text for safe use inside a RegExp (search boxes). */
export const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
