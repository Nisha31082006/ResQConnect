import type { RequestHandler } from 'express';
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import multer from 'multer';
import { env } from '../config/env';
import { badRequest } from '../utils/AppError';

const ALLOWED: Record<string, string[]> = {
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/png': ['.png'],
  'image/webp': ['.webp'],
  'application/pdf': ['.pdf'],
};

fs.mkdirSync(env.uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, env.uploadDir),
  filename: (_req, file, cb) => cb(null, `${randomUUID()}${path.extname(file.originalname).toLowerCase()}`),
});

const uploader = multer({
  storage,
  limits: { fileSize: env.maxUploadBytes, files: 5 },
  fileFilter: (_req, file, cb) => {
    const exts = ALLOWED[file.mimetype];
    const ext = path.extname(file.originalname).toLowerCase();
    if (!exts || !exts.includes(ext)) return cb(badRequest('UNSUPPORTED_FILE_TYPE', 'Only JPG, PNG, WebP images and PDF files are allowed'));
    return cb(null, true);
  },
});

/** Verify the real file signature (the declared mimetype alone can be spoofed). */
function matchesSignature(file: string, mime: string): boolean {
  const fd = fs.openSync(file, 'r');
  const buf = Buffer.alloc(12);
  fs.readSync(fd, buf, 0, 12, 0);
  fs.closeSync(fd);
  switch (mime) {
    case 'image/jpeg':
      return buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
    case 'image/png':
      return buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    case 'image/webp':
      return buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WEBP';
    case 'application/pdf':
      return buf.subarray(0, 4).toString('ascii') === '%PDF';
    default:
      return false;
  }
}

const removeFiles = (files: Express.Multer.File[]) => files.forEach((f) => fs.promises.unlink(f.path).catch(() => undefined));

const verifySignatures: RequestHandler = (req, _res, next) => {
  const files = collect(req);
  const bad = files.find((f) => !matchesSignature(f.path, f.mimetype));
  if (bad) {
    removeFiles(files);
    return next(badRequest('INVALID_FILE_CONTENT', 'The uploaded file content does not match its type'));
  }
  return next();
};

function collect(req: Express.Request): Express.Multer.File[] {
  const f = (req as { files?: unknown }).files;
  if (Array.isArray(f)) return f as Express.Multer.File[];
  return [];
}

/** Multipart JSON convention: JSON in the `data` field, files in `evidence`. For plain JSON requests the body is untouched. */
const parseDataField: RequestHandler = (req, _res, next) => {
  if (req.is('multipart/form-data') && typeof req.body?.data === 'string') {
    try {
      req.body = JSON.parse(req.body.data);
    } catch {
      removeFiles(collect(req));
      return next(badRequest('INVALID_JSON', 'The "data" field must contain valid JSON'));
    }
  }
  return next();
};

export const evidenceUpload: RequestHandler[] = [uploader.array('evidence', 5), verifySignatures, parseDataField];

export const toAttachments = (req: Express.Request) =>
  collect(req).map((f) => ({ filename: f.filename, originalName: f.originalname, mimeType: f.mimetype, size: f.size, uploadedAt: new Date() }));

export const uploadPath = (filename: string) => path.join(env.uploadDir, path.basename(filename));
