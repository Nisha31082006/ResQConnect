import type { FilterQuery } from 'mongoose';
import { Emergency, FoodProvider, FoodSupply, RescueTeam, RoadBlockage, RoadClearanceReport, Shelter, TeamMembership } from '../models';
import type { IEmergency } from '../models/Emergency';
import { effectivePriority, emergencyScope } from '../services/emergency.service';
import { PRIORITY_RANK } from '../services/priority.service';
import { latLngOf } from '../utils/geo';
import { asyncHandler, ok } from '../utils/http';

/**
 * One endpoint feeds the whole map. Visibility is decided here, on the server:
 *  - admin: every emergency with exact coordinates, all teams (with last shared location), all roads.
 *  - citizen: only their OWN emergencies (other citizens' reports are never exposed).
 *  - volunteer / team leader: emergencies assigned to them or their team, and their own team's location.
 *  - everyone: shelters, active food points and non-rejected road reports (public safety information).
 * Unverified road reports carry `verified:false` so the UI can render them differently.
 */
export const getMapData = asyncHandler(async (req, res) => {
  const user = req.user!;
  const q = req.query as { type?: string; priority?: string; status?: string };

  let emergencies: unknown[] = [];
  const scope = await emergencyScope(user);
  if (scope) {
    const filter: FilterQuery<IEmergency> = { ...scope, status: q.status ? q.status : { $ne: 'resolved' } };
    if (q.type) filter.type = q.type;
    if (q.priority) filter.priorityRank = PRIORITY_RANK[q.priority as keyof typeof PRIORITY_RANK];
    const items = await Emergency.find(filter).sort({ createdAt: -1 }).limit(500);
    emergencies = items
      .map((em) => {
        const ll = latLngOf(em.location);
        if (!ll) return null;
        const p = effectivePriority(em);
        return {
          id: String(em._id),
          emergencyId: em.emergencyId,
          kind: em.kind,
          type: em.type,
          status: em.status,
          priority: p.level,
          priorityConfirmed: p.confirmed,
          affectedCount: em.affectedCount,
          lat: ll.lat,
          lng: ll.lng,
          createdAt: em.createdAt,
          ...(user.role === 'admin' || user.role === 'citizen' || user.role === 'volunteer' || user.role === 'team_leader'
            ? { description: em.description.slice(0, 160), address: em.address }
            : {}),
        };
      })
      .filter(Boolean);
  }

  const shelters = (await Shelter.find({ status: { $ne: 'closed' } }).limit(300)).map((s) => {
    const ll = latLngOf(s.location)!;
    return { id: String(s._id), name: s.name, lat: ll.lat, lng: ll.lng, address: s.address, capacity: s.capacity, occupancy: s.occupancy, available: Math.max(0, s.capacity - s.occupancy), status: s.status, facilities: s.facilities, phone: s.contact?.phone };
  });

  const providers = await FoodProvider.find({ status: 'active' }).limit(300);
  const supplies = await FoodSupply.aggregate([
    { $match: { provider: { $in: providers.map((p) => p._id) }, active: true } },
    { $group: { _id: '$provider', available: { $sum: '$quantityAvailable' } } },
  ]);
  const food = providers.map((p) => {
    const ll = latLngOf(p.location)!;
    return { id: String(p._id), name: p.name, lat: ll.lat, lng: ll.lng, address: p.address, operatingHours: p.operatingHours, available: supplies.find((s) => String(s._id) === String(p._id))?.available ?? 0 };
  });

  const roadFilter: FilterQuery<{ status: string; verificationStatus: string }> = { verificationStatus: { $ne: 'rejected' } };
  roadFilter.status = 'active';
  const roadItems = await RoadBlockage.find(roadFilter).limit(300);
  const pendingClearance = await RoadClearanceReport.find({ blockage: { $in: roadItems.map((r) => r._id) }, status: 'pending' }).select('blockage');
  const recentlyCleared = await RoadBlockage.find({ status: 'cleared', clearedAt: { $gte: new Date(Date.now() - 24 * 3600 * 1000) } }).limit(100);
  const roads = [...roadItems, ...recentlyCleared].map((r) => {
    const ll = latLngOf(r.location)!;
    return {
      id: String(r._id),
      type: r.type,
      severity: r.severity,
      description: r.description,
      lat: ll.lat,
      lng: ll.lng,
      verified: r.verificationStatus === 'verified',
      verificationStatus: r.verificationStatus,
      status: r.status,
      clearancePending: pendingClearance.some((p) => String(p.blockage) === String(r._id)),
      reportedAt: r.reportedAt,
    };
  });

  let teams: unknown[] = [];
  if (user.role === 'admin' || user.role === 'team_leader' || user.role === 'volunteer') {
    let teamFilter: FilterQuery<{ _id: unknown }> = { active: true, lastLocation: { $exists: true } };
    if (user.role !== 'admin') {
      const mine = await TeamMembership.find({ user: user._id, active: true }).select('team');
      teamFilter = { ...teamFilter, _id: { $in: mine.map((m) => m.team) } };
    }
    teams = (await RescueTeam.find(teamFilter)).flatMap((t) => {
      const ll = latLngOf(t.lastLocation);
      return ll ? [{ id: String(t._id), name: t.name, lat: ll.lat, lng: ll.lng, availability: t.availability, updatedAt: t.lastLocationAt }] : [];
    });
  }

  return ok(res, { emergencies, shelters, food, roads, teams, generatedAt: new Date() });
});
