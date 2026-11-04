import type { Types } from 'mongoose';
import { Emergency } from '../models';
import type { EmergencyDoc } from '../models/Emergency';
import { haversineMeters, latLngOf, textSimilarity } from '../utils/geo';
import { getSettings, type AppSettings } from './settings.service';

export interface DuplicateRules {
  radiusMeters: number;
  windowMinutes: number;
  similarityThreshold: number;
}

export interface DuplicateComparable {
  type: string;
  description: string;
  location: { coordinates: number[] };
  createdAt: Date;
}

export interface DuplicateScore {
  isMatch: boolean;
  score: number;
  distanceMeters: number;
  similarity: number;
  minutesApart: number;
  reasons: { code: string; points: number; params?: Record<string, unknown> }[];
}

/**
 * Pure scoring function. A pair is a *potential* duplicate when it is within the radius and the time window and
 * either has the same type or a sufficiently similar description. Nothing is ever deleted or merged automatically.
 */
export function scoreDuplicate(a: DuplicateComparable, b: DuplicateComparable, rules: DuplicateRules): DuplicateScore {
  const pa = latLngOf(a.location);
  const pb = latLngOf(b.location);
  const distanceMeters = pa && pb ? haversineMeters(pa, pb) : Number.POSITIVE_INFINITY;
  const minutesApart = Math.abs(a.createdAt.getTime() - b.createdAt.getTime()) / 60000;
  const similarity = textSimilarity(a.description, b.description);
  const sameType = a.type === b.type;

  const within = distanceMeters <= rules.radiusMeters;
  const inWindow = minutesApart <= rules.windowMinutes;
  const textMatch = similarity >= rules.similarityThreshold;
  const isMatch = within && inWindow && (sameType || textMatch);

  const reasons: DuplicateScore['reasons'] = [];
  let score = 0;
  if (within) {
    const pts = Math.round((1 - distanceMeters / rules.radiusMeters) * 40);
    score += pts;
    reasons.push({ code: 'within_distance', points: pts, params: { meters: Math.round(distanceMeters) } });
  }
  if (sameType) {
    score += 25;
    reasons.push({ code: 'same_type', points: 25 });
  }
  if (similarity > 0) {
    const pts = Math.round(similarity * 25);
    score += pts;
    if (textMatch) reasons.push({ code: 'similar_description', points: pts, params: { percent: Math.round(similarity * 100) } });
  }
  if (inWindow) {
    const pts = Math.round((1 - minutesApart / rules.windowMinutes) * 10);
    score += pts;
    reasons.push({ code: 'close_in_time', points: pts, params: { minutes: Math.round(minutesApart) } });
  }
  return { isMatch, score, distanceMeters: Number.isFinite(distanceMeters) ? distanceMeters : -1, similarity, minutesApart, reasons };
}

const idEq = (a: Types.ObjectId | string, b: Types.ObjectId | string) => String(a) === String(b);

/**
 * Compare a (new or edited) emergency with other ACTIVE emergencies inside the time window and record the matches
 * on both reports. Existing review decisions are preserved. Returns the ids of newly flagged emergencies.
 */
export async function detectDuplicates(emergency: EmergencyDoc, settings?: AppSettings): Promise<EmergencyDoc[]> {
  const rules = (settings ?? (await getSettings())).duplicateRules;
  const since = new Date(emergency.createdAt.getTime() - rules.windowMinutes * 60000);
  const until = new Date(emergency.createdAt.getTime() + rules.windowMinutes * 60000);

  const candidates = await Emergency.find({
    _id: { $ne: emergency._id },
    status: { $ne: 'resolved' },
    createdAt: { $gte: since, $lte: until },
  }).limit(500);

  const newlyFlagged: EmergencyDoc[] = [];
  for (const other of candidates) {
    const result = scoreDuplicate(emergency, other, rules);
    if (!result.isMatch) continue;

    const entry = {
      score: result.score,
      reasons: result.reasons,
      distanceMeters: Math.round(result.distanceMeters),
      similarity: Number(result.similarity.toFixed(2)),
    };
    const upsert = (doc: EmergencyDoc, otherId: Types.ObjectId): boolean => {
      const existing = doc.duplicateCandidates.find((c) => idEq(c.emergency, otherId));
      if (existing) {
        existing.score = entry.score;
        existing.reasons = entry.reasons;
        existing.distanceMeters = entry.distanceMeters;
        existing.similarity = entry.similarity;
        return false; // keep reviewStatus / reviewer history untouched
      }
      doc.duplicateCandidates.push({
        emergency: otherId,
        ...entry,
        reviewStatus: 'pending',
        detectedAt: new Date(),
      });
      return true;
    };
    const aNew = upsert(emergency, other._id);
    const bNew = upsert(other, emergency._id);
    if (bNew) await other.save();
    if (aNew || bNew) newlyFlagged.push(other);
  }
  if (newlyFlagged.length > 0 || emergency.isModified('duplicateCandidates')) await emergency.save();
  return newlyFlagged;
}
