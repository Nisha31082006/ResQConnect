import os from 'os';
import path from 'path';
import fs from 'fs';

// Must run before any application module reads process.env.
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-test-secret-test-secret-123456';
process.env.RATE_LIMIT_ENABLED = 'false';
process.env.BCRYPT_ROUNDS = '4';
process.env.ACK_DEADLINE_SECONDS = '300';
process.env.SMS_INBOUND_SECRET = '';
process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'resq-uploads-'));
