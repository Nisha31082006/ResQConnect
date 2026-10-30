import type { Request } from 'express';
import type { Types } from 'mongoose';
import { AuditLog } from '../models';

export interface Actor {
  id?: Types.ObjectId | string;
  role: string;
}

/** Record an important action. Auditing must never break the user's request, so failures are only logged. */
export async function audit(
  actor: Actor | undefined,
  action: string,
  entityType: string,
  entityId?: unknown,
  details: Record<string, unknown> = {},
  req?: Request,
): Promise<void> {
  try {
    await AuditLog.create({
      actor: actor?.id,
      actorRole: actor?.role ?? 'system',
      action,
      entityType,
      entityId: entityId === undefined ? undefined : String(entityId),
      details,
      ip: req?.ip,
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[audit] failed to write audit log', (err as Error).message);
  }
}
