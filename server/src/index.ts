import http from 'http';
import { env } from './config/env';
import { connectDatabase } from './config/db';
import { createApp } from './app';
import { initSocket } from './sockets';
import { startEscalationJob } from './jobs/escalationJob';
import { startAutomationJob } from './jobs/automationJob';
import { allModels } from './models';

async function main() {
  await connectDatabase();
  // Make sure indexes (unique ids, 2dsphere, idempotency) exist before accepting traffic.
  await Promise.all((allModels as unknown as { modelName: string; syncIndexes: () => Promise<unknown> }[]).map((m) => m.syncIndexes().catch((e: Error) => console.warn(`[indexes] ${m.modelName}: ${e.message}`))));

  const app = createApp();
  const server = http.createServer(app);
  initSocket(server);
  startEscalationJob();
  startAutomationJob();

  server.listen(env.port, () => {
    // eslint-disable-next-line no-console
    console.log(`\nResQConnect API listening on http://localhost:${env.port}  (health: /api/health)\n`);
  });

  const shutdown = () => server.close(() => process.exit(0));
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('\nFailed to start server:\n', (err as Error).message, '\n');
  process.exit(1);
});
