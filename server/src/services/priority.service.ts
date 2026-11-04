import type { EmergencyStatus, PriorityLevel, Severity } from '../models/shared';
import type { PriorityConfig } from './settings.service';

export interface PriorityInput {
  kind: 'normal' | 'sos';
  dangerToLife: boolean;
  affectedCount: number;
  severity: Severity;
  /** People reported as trapped (extra points: they cannot self-evacuate). */
  trappedCount?: number;
  /** Medical assistance requested (assistance need "medical_aid", injured people or a medical emergency). */
  medicalNeeded?: boolean;
  /** Used to infer medical need when `medicalNeeded` is not given (the Emergency document is passed in directly). */
  assistanceNeeds?: string[];
  type?: string;
  vulnerable?: { children?: boolean; elderly?: boolean; disabled?: boolean; pregnant?: boolean; injured?: boolean };
  status: EmergencyStatus;
  createdAt?: Date;
  acknowledgedAt?: Date | null;
}

export interface PriorityReason {
  code: string;
  points: number;
  params?: Record<string, unknown>;
}

export interface PriorityRecommendation {
  level: PriorityLevel;
  score: number;
  reasons: PriorityReason[];
}

const IN_PROGRESS_STATUSES: EmergencyStatus[] = ['assigned', 'in_progress', 'completion_submitted', 'admin_verification'];

/**
 * Transparent rule-based priority recommendation.
 * Every rule that contributes points is returned as a reason (code + points) so admins can see exactly why.
 * This function only RECOMMENDS; an administrator must confirm or override (see emergency controller).
 */
export function recommendPriority(input: PriorityInput, config: PriorityConfig, deadlineSeconds: number, now: Date = new Date()): PriorityRecommendation {
  const w = config.weights;
  const reasons: PriorityReason[] = [];
  const add = (code: string, points: number, params?: Record<string, unknown>) => {
    if (points !== 0) reasons.push({ code, points, ...(params ? { params } : {}) });
  };

  if (input.kind === 'sos') add('sos_request', w.sos);
  if (input.dangerToLife) add('danger_to_life', w.dangerToLife);

  add(`severity_${input.severity}`, w.severity[input.severity] ?? 0);

  const tier = [...w.affectedTiers].sort((a, b) => b.min - a.min).find((t) => input.affectedCount >= t.min);
  if (tier) add('people_affected', tier.points, { count: input.affectedCount });

  const v = input.vulnerable ?? {};
  const groups = (['children', 'elderly', 'disabled', 'pregnant', 'injured'] as const).filter((g) => v[g]);
  if (groups.length > 0) add('vulnerable_people', Math.min(w.vulnerableMax, groups.length * w.vulnerablePerGroup), { groups });

  const trapped = input.trappedCount ?? 0;
  if (trapped > 0) add('trapped_persons', trapped >= 5 ? (w.trappedMany ?? 15) : (w.trappedAny ?? 10), { count: trapped });
  const medical = input.medicalNeeded ?? (Boolean(input.assistanceNeeds?.includes('medical_aid')) || input.type === 'medical');
  if (medical) add('medical_assistance', w.medicalAssistance ?? 8);

  const unacknowledged = !input.acknowledgedAt && input.status === 'pending';
  if (unacknowledged) {
    const waitedSeconds = Math.max(0, (now.getTime() - (input.createdAt ?? now).getTime()) / 1000);
    if (waitedSeconds >= deadlineSeconds) add('waiting_overdue', w.waitFullDeadline, { minutes: Math.floor(waitedSeconds / 60) });
    else if (waitedSeconds >= deadlineSeconds / 2) add('waiting_unacknowledged', w.waitHalfDeadline, { minutes: Math.floor(waitedSeconds / 60) });
  }

  if (IN_PROGRESS_STATUSES.includes(input.status)) add('assistance_in_progress', w.assistanceInProgress);

  const score = Math.max(0, reasons.reduce((sum, r) => sum + r.points, 0));
  const level = levelForScore(score, config);
  return { level, score, reasons };
}

export function levelForScore(score: number, config: PriorityConfig): PriorityLevel {
  const t = config.thresholds;
  if (score >= t.critical) return 'critical';
  if (score >= t.high) return 'high';
  if (score >= t.medium) return 'medium';
  return 'low';
}

export const PRIORITY_RANK: Record<PriorityLevel, number> = { critical: 4, high: 3, medium: 2, low: 1 };
