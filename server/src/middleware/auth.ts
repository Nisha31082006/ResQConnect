import type { NextFunction, Request, RequestHandler, Response } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import { User, UserDoc } from '../models/User';
import type { Role } from '../models/shared';
import { forbidden, unauthorized } from '../utils/AppError';

declare module 'express-serve-static-core' {
  interface Request {
    user?: UserDoc;
  }
}

export function signToken(userId: string, role: Role): string {
  return jwt.sign({ sub: userId, role }, env.jwtSecret, { expiresIn: env.jwtExpiresIn } as jwt.SignOptions);
}

/** Verifies the JWT and loads the user from MongoDB (so suspended users and role changes apply immediately). */
export const authenticate: RequestHandler = async (req: Request, _res: Response, next: NextFunction) => {
  try {
    const header = req.headers.authorization ?? '';
    const [scheme, token] = header.split(' ');
    if (scheme !== 'Bearer' || !token) throw unauthorized();
    let payload: { sub: string };
    try {
      payload = jwt.verify(token, env.jwtSecret) as { sub: string };
    } catch {
      throw unauthorized('AUTH_INVALID_TOKEN', 'Invalid or expired token');
    }
    const user = await User.findById(payload.sub);
    if (!user) throw unauthorized('AUTH_INVALID_TOKEN', 'Invalid or expired token');
    if (user.status === 'suspended') throw forbidden('AUTH_SUSPENDED', 'This account has been suspended');
    if (user.status === 'pending') throw forbidden('AUTH_PENDING_APPROVAL', 'This account is awaiting administrator approval');
    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
};

/** Server-side role check. Must come after `authenticate`. */
export const requireRole =
  (...roles: Role[]): RequestHandler =>
  (req, _res, next) => {
    if (!req.user) return next(unauthorized());
    if (!roles.includes(req.user.role)) return next(forbidden('FORBIDDEN_ROLE', 'Your role cannot perform this action'));
    return next();
  };
