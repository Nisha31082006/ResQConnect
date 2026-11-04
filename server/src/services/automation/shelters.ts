import { Emergency, Shelter, ShelterReferral } from '../../models';
import type { EmergencyDoc } from '../../models/Emergency';
import type { AutomationConfig } from '../settings.service';
import { haversineMeters, latLngOf } from '../../utils/geo';

/** Which shelter facilities does this emergency need? (transparent mapping, unit-tested) */
export function neededFacilities(em: Pick<EmergencyDoc, 'assistanceNeeds' | 'vulnerable' | 'type'>): string[] {
  const need = new Set<string>();
  const a = em.assistanceNeeds ?? [];
  if (a.includes('food')) need.add('food');
  if (a.includes('drinking_water')) need.add('water');
  if (a.includes('medical_aid') || em.vulnerable?.injured || em.type === 'medical') need.add('medical');
  if (a.includes('blankets')) need.add('bedding');
  if (em.vulnerable?.disabled) need.add('wheelchair_access');
  if (em.vulnerable?.children || em.vulnerable?.pregnant) need.add('women_children_area');
  return [...need];
}

export const needsShelter = (em: Pick<EmergencyDoc, 'assistanceNeeds' | 'type'>) => (em.assistanceNeeds ?? []).includes('shelter') || em.type === 'shelter_needed';

export interface ShelterScoreInput {
  distanceKm: number;
  maxDistanceKm: number;
  free: number;
  people: number;
  needed: string[];
  facilities: string[];
}

/** Pure score (max 100): distance 50 + spare capacity 20 + facilities 30. */
export function scoreShelter(i: ShelterScoreInput) {
  const reasons: { code: string; params?: Record<string, unknown> }[] = [];
  const distancePts = Math.round(50 * Math.max(0, 1 - i.distanceKm / i.maxDistanceKm));
  reasons.push({ code: 'distance', params: { km: i.distanceKm } });
  const margin = Math.min(1, (i.free - i.people) / Math.max(1, i.people));
  const capacityPts = Math.round(20 * Math.max(0, margin));
  reasons.push({ code: 'capacity_ok', params: { free: i.free, people: i.people } });
  const have = new Set(i.facilities);
  const matched = i.needed.filter((f) => have.has(f));
  const missing = i.needed.filter((f) => !have.has(f));
  const facilityPts = i.needed.length ? Math.round((matched.length / i.needed.length) * 30) : 15;
  if (i.needed.length) reasons.push(matched.length ? { code: 'facilities_match', params: { matched, missing } } : { code: 'facilities_missing', params: { missing } });
  return { score: distancePts + capacityPts + facilityPts, reasons, matched, missing };
}

/** Places already promised to people (approved referrals not yet admitted) so we never over-recommend. */
export async function reservedByShelter(): Promise<Map<string, number>> {
  const refs = await ShelterReferral.find({ status: 'referred' }).select('shelter people');
  const m = new Map<string, number>();
  refs.forEach((r) => m.set(String(r.shelter), (m.get(String(r.shelter)) ?? 0) + r.people));
  return m;
}

/** Recommendation only: nothing is allocated and nobody is registered until an admin confirms and a coordinator admits. */
export async function recommendShelters(em: EmergencyDoc, cfg: AutomationConfig, peopleOverride?: number) {
  const people = Math.max(1, peopleOverride ?? em.affectedCount);
  const from = latLngOf(em.location);
  const needed = neededFacilities(em);
  const reserved = await reservedByShelter();
  const shelters = await Shelter.find({ status: 'open' });
  let excludedCapacity = 0;
  let excludedDistance = 0;
  const rows = [];
  for (const s of shelters) {
    const free = Math.max(0, s.capacity - s.occupancy - (reserved.get(String(s._id)) ?? 0));
    const ll = latLngOf(s.location);
    const distanceKm = from && ll ? Math.round((haversineMeters(from, ll) / 1000) * 10) / 10 : Infinity;
    if (free < people) {
      excludedCapacity += 1;
      continue;
    }
    if (distanceKm > cfg.shelter.maxDistanceKm) {
      excludedDistance += 1;
      continue;
    }
    const sc = scoreShelter({ distanceKm, maxDistanceKm: cfg.shelter.maxDistanceKm, free, people, needed, facilities: s.facilities });
    rows.push({
      id: String(s._id),
      name: s.name,
      address: s.address,
      location: ll,
      distanceKm,
      capacity: s.capacity,
      occupancy: s.occupancy,
      reserved: reserved.get(String(s._id)) ?? 0,
      availableSpaces: free,
      facilities: s.facilities,
      matchedFacilities: sc.matched,
      missingFacilities: sc.missing,
      score: sc.score,
      reasons: sc.reasons,
      coordinatorAssigned: Boolean(s.coordinator),
    });
  }
  rows.sort((a, b) => b.score - a.score || a.distanceKm - b.distanceKm);
  return {
    emergency: { id: String(em._id), emergencyId: em.emergencyId, type: em.type, affectedCount: em.affectedCount, shelterRequested: needsShelter(em) },
    people,
    neededFacilities: needed,
    shelters: rows.slice(0, 5),
    excluded: { insufficientCapacity: excludedCapacity, tooFar: excludedDistance },
    planned: em.shelterPlan?.shelter ? { shelter: String(em.shelterPlan.shelter), people: em.shelterPlan.people, confirmedAt: em.shelterPlan.confirmedAt } : null,
    notice: 'recommendation_only',
  };
}

/** Dashboard card: open emergencies that asked for shelter and have no confirmed plan, each with the best match. */
export async function shelterOverview(cfg: AutomationConfig, limit = 8) {
  const ems = await Emergency.find({ status: { $ne: 'resolved' }, 'shelterPlan.shelter': { $exists: false }, $or: [{ assistanceNeeds: 'shelter' }, { type: 'shelter_needed' }] }).sort({ priorityRank: -1, createdAt: 1 }).limit(limit);
  const items = [];
  for (const e of ems) {
    const rec = await recommendShelters(e, cfg);
    items.push({ emergency: rec.emergency, people: rec.people, best: rec.shelters[0] ?? null, alternatives: Math.max(0, rec.shelters.length - 1), excluded: rec.excluded });
  }
  return { total: ems.length, items };
}
