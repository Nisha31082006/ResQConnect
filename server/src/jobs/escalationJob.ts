import { env } from '../config/env';
import { runEscalationCheck } from '../services/escalation.service';

let timer: NodeJS.Timeout | null = null;

/**
 * In-process scheduler (setInterval). It is started once from index.ts after MongoDB is connected.
 * Limitations (documented in README): it only runs while the server process is running; with several server
 * instances every instance runs the check, which is safe because escalation records have a unique
 * (emergency, level) index, so each level is created exactly once.
 */
export function startEscalationJob(): void {
  if (timer) return;
  const run = () => {
    runEscalationCheck().catch((err) => {
      // eslint-disable-next-line no-console
      console.error('[escalation] check failed:', (err as Error).message);
    });
  };
  timer = setInterval(run, Math.max(5, env.escalationCheckIntervalSeconds) * 1000);
  timer.unref();
  run();
}

export function stopEscalationJob(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
