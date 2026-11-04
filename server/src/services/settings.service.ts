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
    /** Optional so previously stored settings keep working; defaults are applied in the rule engine. */
    trappedAny?: number;
    trappedMany?: number;
    medicalAssistance?: number;
  };
}

/** Thresholds for the rule-based automation (all editable by admins in Settings). */
export interface AutomationConfig {
  zones: { radiusMeters: number; windowMinutes: number; minReports: number; sameTypeOnly: boolean };
  workload: { overloadedAt: number };
  teamFormation: { maxDistanceKm: number };
  shelter: { maxDistanceKm: number; nearFullPercent: number };
  food: { mealsPerPersonPerDay: number; days: number };
  followUp: { emergencyIdleMinutes: number; progressIdleMinutes: number; shelterStaleMinutes: number; repeatMinutes: number; maxReminders: number };
}

export interface AppSettings {
  priority: PriorityConfig;
  ackDeadlineSeconds: number;
  maxEscalationLevel: number;
  smsEmergencyNumber: string;
  duplicateRules: { radiusMeters: number; windowMinutes: number; similarityThreshold: number };
  automation: AutomationConfig;
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
    trappedAny: 10,
    trappedMany: 15,
    medicalAssistance: 8,
  },
};

export const defaultAutomation = (): AutomationConfig => ({
  zones: { radiusMeters: 1000, windowMinutes: 180, minReports: 3, sameTypeOnly: false },
  workload: { overloadedAt: 3 },
  teamFormation: { maxDistanceKm: 50 },
  shelter: { maxDistanceKm: 30, nearFullPercent: 90 },
  food: { mealsPerPersonPerDay: 3, days: 1 },
  followUp: { emergencyIdleMinutes: 30, progressIdleMinutes: 60, shelterStaleMinutes: 360, repeatMinutes: 120, maxReminders: 5 },
});

export const defaultSettings = (): AppSettings => ({
  priority: defaultPriorityConfig,
  ackDeadlineSeconds: env.ackDeadlineSeconds,
  maxEscalationLevel: 3,
  smsEmergencyNumber: env.smsEmergencyNumber,
  duplicateRules: { radiusMeters: 500, windowMinutes: 360, similarityThreshold: 0.35 },
  automation: defaultAutomation(),
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
    automation: {
      zones: { ...base.automation.zones, ...(stored.automation?.zones ?? {}) },
      workload: { ...base.automation.workload, ...(stored.automation?.workload ?? {}) },
      teamFormation: { ...base.automation.teamFormation, ...(stored.automation?.teamFormation ?? {}) },
      shelter: { ...base.automation.shelter, ...(stored.automation?.shelter ?? {}) },
      food: { ...base.automation.food, ...(stored.automation?.food ?? {}) },
      followUp: { ...base.automation.followUp, ...(stored.automation?.followUp ?? {}) },
    },
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
