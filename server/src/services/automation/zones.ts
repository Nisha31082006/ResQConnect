import { Emergency, EmergencyZone } from '../../models';
import type { IEmergencyZone } from '../../models/EmergencyZone';
import { emitToRoles } from '../../sockets';
import type { AutomationConfig } from '../settings.service';
import { notifyRoles } from '../notification.service';
import { haversineMeters, latLngOf, type LatLng } from '../../utils/geo';

export interface ZonePoint {
  id: string;
  at: Date;
  type: string;
  people: number;
  kind: 'normal' | 'sos';
  ll: LatLng;
}

/**
 * Single-linkage clustering (pure, unit-tested): two reports are linked when they are within `radiusMeters`
 * of each other AND filed within `windowMinutes` of each other (and of the same type if `sameTypeOnly`).
 * Linked reports form a cluster; only clusters with at least `minReports` become possible zones.
 * This is a transparent distance/time rule - not machine learning.
 */
export function clusterReports(points: ZonePoint[], cfg: AutomationConfig['zones']): ZonePoint[][] {
  const parent = points.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < points.length; i += 1) {
    for (let j = i + 1; j < points.length; j += 1) {
      if (cfg.sameTypeOnly && points[i].type !== points[j].type) continue;
      if (Math.abs(points[i].at.getTime() - points[j].at.getTime()) > cfg.windowMinutes * 60000) continue;
      if (haversineMeters(points[i].ll, points[j].ll) <= cfg.radiusMeters) parent[find(i)] = find(j);
    }
  }
  const groups = new Map<number, ZonePoint[]>();
  points.forEach((p, i) => {
    const r = find(i);
    groups.set(r, [...(groups.get(r) ?? []), p]);
  });
  return [...groups.values()].filter((g) => g.length >= cfg.minReports);
}

export function summarizeCluster(g: ZonePoint[]) {
  const center = { lat: g.reduce((n, p) => n + p.ll.lat, 0) / g.length, lng: g.reduce((n, p) => n + p.ll.lng, 0) / g.length };
  const radiusMeters = Math.round(Math.max(100, ...g.map((p) => haversineMeters(center, p.ll))));
  const typeCounts: Record<string, number> = {};
  g.forEach((p) => (typeCounts[p.type] = (typeCounts[p.type] ?? 0) + 1));
  const dominantType = Object.entries(typeCounts).sort((a, b) => b[1] - a[1])[0][0];
  const peopleCount = g.reduce((n, p) => n + p.people, 0);
  const sosCount = g.filter((p) => p.kind === 'sos').length;
  const times = g.map((p) => p.at.getTime());
  return {
    center,
    radiusMeters,
    typeCounts,
    dominantType,
    peopleCount,
    sosCount,
    reportCount: g.length,
    riskLevel: zoneRisk(g.length, peopleCount, sosCount),
    firstReportAt: new Date(Math.min(...times)),
    lastReportAt: new Date(Math.max(...times)),
  };
}

/** critical: 2+ SOS or 100+ people; high: 1+ SOS, 5+ reports or 30+ people; otherwise medium. */
export function zoneRisk(reports: number, people: number, sos: number): IEmergencyZone['riskLevel'] {
  if (sos >= 2 || people >= 100) return 'critical';
  if (sos >= 1 || reports >= 5 || people >= 30) return 'high';
  return 'medium';
}

const RISK_RANK = { low: 1, medium: 2, high: 3, critical: 4 } as const;

/** Detect zones from real reports, then sync with stored zones. Reports are only referenced - never merged or deleted. */
export async function detectZones(cfg: AutomationConfig, now: Date = new Date()) {
  const since = new Date(now.getTime() - cfg.zones.windowMinutes * 60000);
  const ems = await Emergency.find({ status: { $ne: 'resolved' }, createdAt: { $gte: since } }).select('type affectedCount kind location createdAt');
  const points: ZonePoint[] = ems.flatMap((e) => {
    const ll = latLngOf(e.location);
    return ll ? [{ id: String(e._id), at: e.createdAt, type: e.type, people: e.affectedCount, kind: e.kind, ll }] : [];
  });
  const clusters = clusterReports(points, cfg.zones);

  const stored = await EmergencyZone.find({ status: { $in: ['detected', 'reviewed', 'dismissed'] } });
  const used = new Set<string>();
  let created = 0;
  let updated = 0;
  let reopened = 0;

  for (const g of clusters) {
    const ids = g.map((p) => p.id);
    const s = summarizeCluster(g);
    let best: (typeof stored)[number] | undefined;
    let bestOverlap = 0;
    for (const z of stored) {
      if (used.has(String(z._id))) continue;
      const overlap = z.emergencies.filter((e) => ids.includes(String(e))).length;
      if (overlap > bestOverlap) {
        best = z;
        bestOverlap = overlap;
      }
    }
    const fields = {
      emergencies: ids,
      center: { type: 'Point' as const, coordinates: [s.center.lng, s.center.lat] },
      radiusMeters: s.radiusMeters,
      reportCount: s.reportCount,
      peopleCount: s.peopleCount,
      sosCount: s.sosCount,
      typeCounts: s.typeCounts,
      dominantType: s.dominantType,
      riskLevel: s.riskLevel,
      firstReportAt: s.firstReportAt,
      lastReportAt: s.lastReportAt,
      lastDetectedAt: now,
    };
    if (best) {
      used.add(String(best._id));
      const grew = s.reportCount > best.reportCount;
      const riskUp = RISK_RANK[s.riskLevel] > RISK_RANK[best.riskLevel];
      best.set(fields);
      if (best.status === 'dismissed' && (grew || riskUp)) {
        best.status = 'detected';
        reopened += 1;
        await announce(best, 'zone_reopened');
      }
      await best.save();
      updated += 1;
    } else {
      const z = await EmergencyZone.create({ ...fields, status: 'detected', firstDetectedAt: now });
      used.add(String(z._id));
      created += 1;
      await announce(z, 'zone_detected');
    }
  }
  // Zones whose reports no longer cluster (resolved or outside the window) become inactive; history is kept.
  let deactivated = 0;
  for (const z of stored) {
    if (!used.has(String(z._id))) {
      z.status = 'inactive';
      await z.save();
      deactivated += 1;
    }
  }
  if (created || reopened || deactivated || updated) emitToRoles(['admin'], 'automation:updated', { area: 'zones' });
  return { created, updated, reopened, deactivated, clusters: clusters.length };
}

async function announce(z: InstanceType<typeof EmergencyZone>, type: string) {
  await notifyRoles(['admin'], {
    type,
    params: { reports: z.reportCount, people: z.peopleCount, dominantType: z.dominantType, risk: z.riskLevel },
    message: `Possible emergency zone: ${z.reportCount} reports, ${z.peopleCount} people (${z.dominantType})`,
    link: '/admin/automation',
    entityType: 'zone',
    entityId: String(z._id),
  });
  emitToRoles(['admin'], 'zone:detected', { id: String(z._id), riskLevel: z.riskLevel });
}

export const serializeZone = (z: InstanceType<typeof EmergencyZone>, members?: { id: string; emergencyId: string; type: string; affectedCount: number; status: string; kind: string; lat?: number; lng?: number }[]) => {
  const ll = latLngOf(z.center);
  return {
    id: String(z._id),
    center: ll,
    radiusMeters: z.radiusMeters,
    reportCount: z.reportCount,
    peopleCount: z.peopleCount,
    sosCount: z.sosCount,
    typeCounts: z.typeCounts,
    dominantType: z.dominantType,
    riskLevel: z.riskLevel,
    status: z.status,
    firstReportAt: z.firstReportAt,
    lastReportAt: z.lastReportAt,
    lastDetectedAt: z.lastDetectedAt,
    reviewedAt: z.reviewedAt,
    reviewNote: z.reviewNote,
    emergencyIds: z.emergencies.map(String),
    ...(members ? { emergencies: members } : {}),
  };
};
