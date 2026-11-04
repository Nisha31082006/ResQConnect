import cron, { type ScheduledTask } from 'node-cron';
import { env } from '../config/env';
import { runAutomation } from '../services/automation/runner';

let task: ScheduledTask | null = null;

/**
 * node-cron scheduler for the automation checks (zones, shortages, follow-ups, escalations).
 * Expression comes from AUTOMATION_CRON (default every minute). Runs inside the API process while it is running;
 * with several instances each one runs the pass, which is safe because every alert/follow-up is keyed (one OPEN record per key).
 */
export function startAutomationJob(): void {
  if (task || !env.automationEnabled) return;
  if (!cron.validate(env.automationCron)) {
    // eslint-disable-next-line no-console
    console.warn(`[automation] invalid AUTOMATION_CRON "${env.automationCron}" - scheduler not started`);
    return;
  }
  task = cron.schedule(env.automationCron, () => {
    runAutomation()
      .then((r) => r.errors.length && console.error('[automation] step errors:', r.errors)) // eslint-disable-line no-console
      .catch((err) => console.error('[automation] run failed:', (err as Error).message)); // eslint-disable-line no-console
  });
  runAutomation().catch(() => undefined);
}

export function stopAutomationJob(): void {
  task?.stop();
  task = null;
}
