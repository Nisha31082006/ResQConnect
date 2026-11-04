import { Emergency, FoodProvider, FoodSupply, ResourceAlert, Shelter } from '../../models';
import type { IResourceAlert } from '../../models/ResourceAlert';
import { emitToRoles } from '../../sockets';
import type { AutomationConfig } from '../settings.service';
import { notifyRoles } from '../notification.service';
import { latLngOf } from '../../utils/geo';
import { needsShelter, reservedByShelter } from './shelters';

type Loc = IResourceAlert['locations'][number];
export interface AlertCandidate {
  key: string;
  kind: IResourceAlert['kind'];
  severity: 'warning' | 'critical';
  required: number;
  available: number;
  shortage: number;
  unit: string;
  locations: Loc[];
}

/** required - available, never negative. e.g. required 200, available 120 -> shortage 80 (unit-tested). */
export const shortageOf = (required: number, available: number) => Math.max(0, required - available);

/** critical when less than half of the requirement can be met (or nothing is available). */
export const shortageSeverity = (required: number, available: number): 'warning' | 'critical' => (required > 0 && available / required < 0.5 ? 'critical' : 'warning');

export const needsFood = (em: { assistanceNeeds?: string[]; type?: string }) => (em.assistanceNeeds ?? []).some((a) => a === 'food' || a === 'drinking_water') || em.type === 'food_water';

/** Reads real data (emergencies, shelters, provider supplies) and returns the alert conditions that currently hold. */
export async function evaluateResources(cfg: AutomationConfig, now: Date = new Date()): Promise<{ candidates: AlertCandidate[]; snapshot: ResourceSnapshot }> {
  const perPerson = cfg.food.mealsPerPersonPerDay * cfg.food.days;
  const [openEms, shelters, providers, supplies, reserved] = await Promise.all([
    Emergency.find({ status: { $ne: 'resolved' } }),
    Shelter.find({ status: { $ne: 'closed' } }),
    FoodProvider.find({ status: 'active' }).select('_id'),
    FoodSupply.find({ active: true }),
    reservedByShelter(),
  ]);
  const activeProviders = new Set(providers.map((p) => String(p._id)));
  const available = supplies
    .filter((s) => activeProviders.has(String(s.provider)) && (!s.availableUntil || s.availableUntil > now))
    .reduce((sum, s) => sum + s.quantityAvailable, 0);

  // ---- food demand: people waiting for food in open emergencies + people already sheltered
  const demand: Loc[] = [];
  for (const e of openEms.filter(needsFood)) {
    const ll = latLngOf(e.location);
    demand.push({ kind: 'emergency', refId: String(e._id), name: `${e.emergencyId}${e.address ? ` – ${e.address}` : ''}`, lat: ll?.lat, lng: ll?.lng, people: e.affectedCount, required: e.affectedCount * perPerson });
  }
  for (const s of shelters.filter((x) => x.occupancy > 0)) {
    const ll = latLngOf(s.location);
    demand.push({ kind: 'shelter', refId: String(s._id), name: s.name, lat: ll?.lat, lng: ll?.lng, people: s.occupancy, required: s.occupancy * perPerson });
  }
  const foodRequired = demand.reduce((n, d) => n + (d.required ?? 0), 0);
  const foodShortage = shortageOf(foodRequired, available);

  const candidates: AlertCandidate[] = [];
  if (foodShortage > 0) {
    candidates.push({ key: 'food:all', kind: 'food_shortage', severity: shortageSeverity(foodRequired, available), required: foodRequired, available, shortage: foodShortage, unit: 'meals', locations: demand.sort((a, b) => (b.required ?? 0) - (a.required ?? 0)).slice(0, 10) });
  }

  // ---- shelter demand vs free places
  const freeOf = (s: (typeof shelters)[number]) => Math.max(0, s.capacity - s.occupancy - (reserved.get(String(s._id)) ?? 0));
  const openShelters = shelters.filter((s) => s.status === 'open');
  const totalFree = openShelters.reduce((n, s) => n + freeOf(s), 0);
  const seekers = openEms.filter((e) => needsShelter(e) && !e.shelterPlan?.shelter);
  const shelterRequired = seekers.reduce((n, e) => n + e.affectedCount, 0);
  const shelterShortage = shortageOf(shelterRequired, totalFree);
  if (shelterShortage > 0) {
    candidates.push({
      key: 'shelter:all',
      kind: 'shelter_shortage',
      severity: shortageSeverity(shelterRequired, totalFree),
      required: shelterRequired,
      available: totalFree,
      shortage: shelterShortage,
      unit: 'places',
      locations: seekers.map((e) => {
        const ll = latLngOf(e.location);
        return { kind: 'emergency' as const, refId: String(e._id), name: `${e.emergencyId}${e.address ? ` – ${e.address}` : ''}`, lat: ll?.lat, lng: ll?.lng, people: e.affectedCount, required: e.affectedCount };
      }).slice(0, 10),
    });
  }

  // ---- per shelter: full or almost full
  for (const s of shelters) {
    const pct = s.capacity > 0 ? (s.occupancy / s.capacity) * 100 : 100;
    const committed = s.occupancy + (reserved.get(String(s._id)) ?? 0);
    if (pct >= cfg.shelter.nearFullPercent || s.status === 'full') {
      const ll = latLngOf(s.location);
      candidates.push({
        key: `shelter:${s._id}`,
        kind: 'shelter_near_capacity',
        severity: pct >= 100 || s.status === 'full' ? 'critical' : 'warning',
        required: committed,
        available: s.capacity,
        shortage: Math.max(0, committed - s.capacity),
        unit: 'places',
        locations: [{ kind: 'shelter', refId: String(s._id), name: s.name, lat: ll?.lat, lng: ll?.lng, people: s.occupancy, free: freeOf(s) }],
      });
    }
  }

  const snapshot: ResourceSnapshot = {
    food: { required: foodRequired, available, shortage: foodShortage, unit: 'meals', mealsPerPerson: perPerson, providers: activeProviders.size },
    shelter: { capacity: shelters.reduce((n, s) => n + s.capacity, 0), occupancy: shelters.reduce((n, s) => n + s.occupancy, 0), freeSpaces: totalFree, peopleSeekingShelter: shelterRequired, shelters: shelters.length },
  };
  return { candidates, snapshot };
}

export interface ResourceSnapshot {
  food: { required: number; available: number; shortage: number; unit: string; mealsPerPerson: number; providers: number };
  shelter: { capacity: number; occupancy: number; freeSpaces: number; peopleSeekingShelter: number; shelters: number };
}

/**
 * Persist the evaluation: one OPEN alert per key. New alerts and severity increases notify admins once;
 * unchanged conditions only refresh numbers (no repeated notifications); cleared conditions are resolved.
 */
export async function syncResourceAlerts(cfg: AutomationConfig, now: Date = new Date()) {
  const { candidates, snapshot } = await evaluateResources(cfg, now);
  const open = await ResourceAlert.find({ status: 'open' });
  let created = 0;
  let escalated = 0;
  let resolved = 0;

  for (const c of candidates) {
    const existing = open.find((a) => a.key === c.key);
    if (existing) {
      const worse = existing.severity === 'warning' && c.severity === 'critical';
      existing.set({ severity: c.severity, required: c.required, available: c.available, shortage: c.shortage, unit: c.unit, locations: c.locations, lastDetectedAt: now });
      await existing.save();
      if (worse) {
        escalated += 1;
        await announce(existing, 'resource_alert_escalated');
      }
    } else {
      const doc = await ResourceAlert.create({ ...c, status: 'open', firstDetectedAt: now, lastDetectedAt: now });
      created += 1;
      await announce(doc, 'resource_shortage');
    }
  }
  for (const a of open) {
    if (!candidates.some((c) => c.key === a.key)) {
      a.status = 'resolved';
      a.resolvedAt = now;
      await a.save();
      resolved += 1;
    }
  }
  if (created || escalated || resolved) emitToRoles(['admin'], 'automation:updated', { area: 'resources' });
  return { created, escalated, resolved, open: candidates.length, snapshot };
}

async function announce(a: InstanceType<typeof ResourceAlert>, type: string) {
  const first = a.locations[0]?.name;
  await notifyRoles(['admin'], {
    type,
    params: { kind: a.kind, required: a.required, available: a.available, shortage: a.shortage, unit: a.unit, location: first ?? '', severity: a.severity },
    message: `${a.kind.replace(/_/g, ' ')}: required ${a.required}, available ${a.available}, shortage ${a.shortage}`,
    link: '/admin/automation',
    entityType: 'resource_alert',
    entityId: String(a._id),
  });
  emitToRoles(['admin'], 'resource:alert', { id: String(a._id), kind: a.kind, severity: a.severity, shortage: a.shortage });
}

export const serializeAlert = (a: InstanceType<typeof ResourceAlert>) => ({
  id: String(a._id),
  key: a.key,
  kind: a.kind,
  severity: a.severity,
  status: a.status,
  required: a.required,
  available: a.available,
  shortage: a.shortage,
  unit: a.unit,
  locations: a.locations,
  firstDetectedAt: a.firstDetectedAt,
  lastDetectedAt: a.lastDetectedAt,
  resolvedAt: a.resolvedAt,
  acknowledgedAt: a.acknowledgedAt,
});
