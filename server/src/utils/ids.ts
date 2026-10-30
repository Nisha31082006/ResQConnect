import { randomBytes } from 'crypto';

/** String id of a value that may be an ObjectId, a string or a populated document. */
export function idOf(value: unknown): string {
  if (value && typeof value === 'object' && '_id' in (value as Record<string, unknown>)) return String((value as { _id: unknown })._id);
  return String(value);
}

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no easily-confused characters

/** Human-friendly unique-ish ID, e.g. RQ-261017-7K3QF. Uniqueness is enforced by a DB index (callers retry). */
export function generateEmergencyId(now: Date = new Date()): string {
  const yy = String(now.getUTCFullYear()).slice(2);
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(now.getUTCDate()).padStart(2, '0');
  const bytes = randomBytes(5);
  let suffix = '';
  for (let i = 0; i < 5; i += 1) suffix += ALPHABET[bytes[i] % ALPHABET.length];
  return `RQ-${yy}${mm}${dd}-${suffix}`;
}
