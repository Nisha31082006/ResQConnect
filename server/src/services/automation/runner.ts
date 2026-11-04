import { getSettings } from '../settings.service';
import { runEscalationCheck } from '../escalation.service';
import { detectZones } from './zones';
import { syncResourceAlerts } from './resources';
import { syncFollowUps } from './followUps';

let running = false;

export interface AutomationRunResult {
  at: Date;
  skipped?: boolean;
  escalations?: { created: number };
  zones?: Awaited<ReturnType<typeof detectZones>>;
  resources?: Awaited<ReturnType<typeof syncResourceAlerts>>;
  followUps?: Awaited<ReturnType<typeof syncFollowUps>>;
  errors: { step: string; message: string }[];
}

/**
 * One full automation pass (backend only): SOS escalation, zone detection, resource shortage detection and follow-ups.
 * Every step is isolated so one failure never blocks the others. Re-entrancy is guarded.
 */
export async function runAutomation(now: Date = new Date()): Promise<AutomationRunResult> {
  if (running) return { at: now, skipped: true, errors: [] };
  running = true;
  const result: AutomationRunResult = { at: now, errors: [] };
  try {
    const settings = await getSettings();
    const step = async <T>(name: string, fn: () => Promise<T>): Promise<T | undefined> => {
      try {
        return await fn();
      } catch (err) {
        result.errors.push({ step: name, message: (err as Error).message });
        return undefined;
      }
    };
    result.escalations = await step('escalations', () => runEscalationCheck(now));
    result.zones = await step('zones', () => detectZones(settings.automation, now));
    result.resources = await step('resources', () => syncResourceAlerts(settings.automation, now));
    result.followUps = await step('followUps', () => syncFollowUps(settings.automation, now));
    return result;
  } finally {
    running = false;
  }
}
