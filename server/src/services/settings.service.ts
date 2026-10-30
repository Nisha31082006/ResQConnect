import { env } from '../config/env';
import { Setting } from '../models';

export interface PriorityConfig {
  /** Minimum score for each level; anything lower is "low". */
  thresholds: { critical: number; high: number; medium: number };
  weights: {
    sos: number;
    dangerToLife: number;
    severity: { low: number; medium: number; high: number; severe: number };
    /** [minimum affected people, points] checked from highest to lowest */
    affectedTiers: { min: number; points: number }[];
    vulnerablePerGroup: number;
    vulnerableMax: number;
    waitHalfDeadline: number;
    waitFullDeadline: number;
    assistanceInProgress: number;
  };
}

export interface AppSettings {
  priority: PriorityConfig;
  ackDeadlineSeconds: number;
  maxEscalationLevel: number;
  smsEmergencyNumber: string;
  duplicateRules: { radiusMeters: number; windowMinutes: number; similarityThreshold: number };
}

export const defaultPriorityConfig: PriorityConfig = {
  thresholds: { critical: 70, high: 45, medium: 20 },
  weights: {
    sos: 40,
    dangerToLife: 30,
    severity: { low: 0, medium: 7, high: 14, severe: 20 },
    affectedTiers: [
      { min: 50, points: 20 },
      { min: 10, points: 12 },
      { min: 3, points: 6 },
      { min: 1, points: 2 },
    ],
    vulnerablePerGroup: 5,
    vulnerableMax: 15,
    waitHalfDeadline: 8,
    waitFullDeadline: 15,
    assistanceInProgress: -10,
  },
};

export const defaultSettings = (): AppSettings => ({
  priority: defaultPriorityConfig,
  ackDeadlineSeconds: env.ackDeadlineSeconds,
  maxEscalationLevel: 3,
  smsEmergencyNumber: env.smsEmergencyNumber,
  duplicateRules: { radiusMeters: 500, windowMinutes: 360, similarityThreshold: 0.35 },
});

const KEY = 'app';

function mergeSettings(base: AppSettings, stored: Partial<AppSettings> | undefined): AppSettings {
  if (!stored) return base;
  return {
    ...base,
    ...stored,
    priority: {
      thresholds: { ...base.priority.thresholds, ...(stored.priority?.thresholds ?? {}) },
      weights: { ...base.priority.weights, ...(stored.priority?.weights ?? {}) },
    },
    duplicateRules: { ...base.duplicateRules, ...(stored.duplicateRules ?? {}) },
  };
}

export async function getSettings(): Promise<AppSettings> {
  const doc = await Setting.findOne({ key: KEY }).lean();
  return mergeSettings(defaultSettings(), doc?.value as Partial<AppSettings> | undefined);
}

export async function updateSettings(patch: Partial<AppSettings>, userId: unknown): Promise<AppSettings> {
  const current = await getSettings();
  const next = mergeSettings(current, patch);
  await Setting.findOneAndUpdate({ key: KEY }, { value: next, updatedBy: userId }, { upsert: true, new: true, setDefaultsOnInsert: true });
  return next;
}
