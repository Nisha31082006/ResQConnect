import dotenv from 'dotenv';
import path from 'path';

// The single .env lives in the project root (ResQConnect/.env).
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

const num = (value: string | undefined, fallback: number): number => {
  const n = Number(value);
  return value !== undefined && value !== '' && Number.isFinite(n) ? n : fallback;
};
const bool = (value: string | undefined, fallback: boolean): boolean =>
  value === undefined || value === '' ? fallback : ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());

const jwtSecret = process.env.JWT_SECRET ?? '';
if (jwtSecret.length < 16) {
  throw new Error(
    'JWT_SECRET is missing or too short. Copy .env.example to .env (project root) and set JWT_SECRET to a long random string.',
  );
}
if (process.env.NODE_ENV === 'production' && jwtSecret.startsWith('REPLACE_WITH')) {
  throw new Error('JWT_SECRET still contains the placeholder value. Set a real random secret before running in production.');
}

const projectRoot = path.resolve(__dirname, '../../..');

export const env = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  isProd: process.env.NODE_ENV === 'production',
  isTest: process.env.NODE_ENV === 'test',
  port: num(process.env.PORT, 5000),
  clientOrigins: (process.env.CLIENT_ORIGIN ?? 'http://localhost:5173')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  mongoUri: process.env.MONGODB_URI ?? 'mongodb://127.0.0.1:27017/resqconnect',
  jwtSecret,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? '12h',
  bcryptRounds: num(process.env.BCRYPT_ROUNDS, 10),
  smsEmergencyNumber: process.env.SMS_EMERGENCY_NUMBER ?? '+910000000000',
  ackDeadlineSeconds: num(process.env.ACK_DEADLINE_SECONDS, 300),
  escalationCheckIntervalSeconds: num(process.env.ESCALATION_CHECK_INTERVAL_SECONDS, 30),
  smsInboundSecret: process.env.SMS_INBOUND_SECRET ?? '',
  uploadDir: path.resolve(projectRoot, process.env.UPLOAD_DIR ?? 'server/uploads'),
  maxUploadBytes: num(process.env.MAX_UPLOAD_MB, 5) * 1024 * 1024,
  rateLimitEnabled: bool(process.env.RATE_LIMIT_ENABLED, true),
  serveClient: bool(process.env.SERVE_CLIENT, false),
  clientDist: path.resolve(projectRoot, 'client/dist'),
};
