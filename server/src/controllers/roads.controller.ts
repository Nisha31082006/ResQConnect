import type { FilterQuery } from 'mongoose';
import { RoadBlockage, RoadClearanceReport } from '../models';
import type { IRoadBlockage, RoadBlockageDoc } from '../models/RoadBlockage';
import { toAttachments } from '../middleware/upload';
import { audit } from '../services/audit.service';
import { notifyRoles, notifyUsers } from '../services/notification.service';
import { badRequest, conflict, notFound } from '../utils/AppError';
import { latLngOf, pointFrom } from '../utils/geo';
import { idOf } from '../utils/ids';
import { asyncHandler, created, ok } from '../utils/http';
import { emitMapRefresh, emitToRoles } from '../sockets';

type Viewer = { id: string; role: string };

export function serializeBlockage(
  b: RoadBlockageDoc,
  viewer: Viewer,
  extra: { pendingClearance?: boolean; latestClearance?: { status: string; at: Date } | null } = {},
) {
  const ll = latLngOf(b.location);
  const reporterId = idOf(b.reportedBy);
  const privileged = viewer.role === 'admin' || reporterId === viewer.id;
  return {
    id: String(b._id),
    type: b.type,
    description: b.description,
    severity: b.severity,
    location: ll ? { ...ll, address: b.address } : null,
    photoUrl: b.photo ? `/api/uploads/${b.photo.filename}` : null,
    reportedAt: b.reportedAt,
    // Never present an unverified report as a confirmed fact: the client must show this flag prominently.
    verificationStatus: b.verificationStatus,
    verified: b.verificationStatus === 'verified',
    verificationNote: viewer.role === 'admin' ? b.verificationNote : undefined,
    status: b.status,
    clearedAt: b.clearedAt,
    clearancePending: Boolean(extra.pendingClearance),
    latestClearance: extra.latestClearance ?? null,
    reporterRole: b.reporterRole,
    mine: reporterId === viewer.id,
    ...(privileged && viewer.role === 'admin' ? { reportedBy: reporterId } : {}),
  };
}

async function clearanceInfo(ids: unknown[]) {
  const reports = await RoadClearanceReport.find({ blockage: { $in: ids } }).sort({ createdAt: -1 });
  const map = new Map<string, { pending: boolean; latest: { status: string; at: Date } }>();
  for (const r of reports) {
    const key = String(r.blockage);
    const entry = map.get(key) ?? { pending: false, latest: { status: r.status, at: r.createdAt } };
    if (r.status === 'pending') entry.pending = true;
    map.set(key, entry);
  }
  return map;
}

export const reportBlockage = asyncHandler(async (req, res) => {
  const user = req.user!;
  const b = req.body;
  const photo = toAttachments(req)[0];
  if (photo && !photo.mimeType.startsWith('image/')) throw badRequest('PHOTO_MUST_BE_IMAGE', 'The photo must be an image');
  const doc = await RoadBlockage.create({
    type: b.type,
    description: b.description,
    severity: b.severity,
    location: pointFrom(b.location),
    address: b.location.address,
    photo,
    reportedBy: user._id,
    reporterRole: user.role,
    reportedAt: b.reportedAt ?? new Date(),
  });
  await audit(user, 'road.report', 'RoadBlockage', doc._id, { type: doc.type }, req);
  await notifyRoles(['admin'], { type: 'road_reported', params: { type: doc.type, severity: doc.severity }, message: `New road blockage report (${doc.type}, ${doc.severity}) awaiting verification`, link: '/admin/roads', entityType: 'road', entityId: String(doc._id) });
  emitToRoles(['admin'], 'road:updated', { id: String(doc._id) });
  emitMapRefresh('road', String(doc._id));
  return created(res, serializeBlockage(doc, { id: String(user._id), role: user.role }));
});

export const listBlockages = asyncHandler(async (req, res) => {
  const user = req.user!;
  const viewer = { id: String(user._id), role: user.role };
  const filter: FilterQuery<IRoadBlockage> = {};
  if (req.query.status) filter.status = String(req.query.status);
  if (req.query.verification) filter.verificationStatus = String(req.query.verification);
  if (user.role !== 'admin') filter.verificationStatus = { $ne: 'rejected' };
  const items = await RoadBlockage.find(filter).sort({ reportedAt: -1 }).limit(300);
  const info = await clearanceInfo(items.map((i) => i._id));
  return ok(res, items.map((i) => serializeBlockage(i, viewer, { pendingClearance: info.get(String(i._id))?.pending, latestClearance: info.get(String(i._id))?.latest ?? null })));
});

export const getBlockage = asyncHandler(async (req, res) => {
  const user = req.user!;
  const b = await RoadBlockage.findById(req.params.id);
  if (!b || (user.role !== 'admin' && b.verificationStatus === 'rejected')) throw notFound('ROAD_NOT_FOUND');
  const reports = await RoadClearanceReport.find({ blockage: b._id }).sort({ createdAt: -1 }).populate('submittedBy', 'name');
  const info = await clearanceInfo([b._id]);
  return ok(res, {
    ...serializeBlockage(b, { id: String(user._id), role: user.role }, { pendingClearance: info.get(String(b._id))?.pending, latestClearance: info.get(String(b._id))?.latest ?? null }),
    // Original report and every clearance update are preserved and shown as history.
    clearanceHistory: reports.map((r) => ({
      id: String(r._id),
      status: r.status,
      note: r.note,
      photoUrl: r.photo ? `/api/uploads/${r.photo.filename}` : null,
      submittedBy: user.role === 'admin' ? (r.submittedBy as unknown as { name?: string })?.name : undefined,
      decisionReason: r.decisionReason,
      createdAt: r.createdAt,
      reviewedAt: r.reviewedAt,
    })),
  });
});

export const verifyBlockage = asyncHandler(async (req, res) => {
  const b = await RoadBlockage.findById(req.params.id);
  if (!b) throw notFound('ROAD_NOT_FOUND');
  if (b.verificationStatus !== 'unverified') throw conflict('ROAD_ALREADY_REVIEWED', 'This report has already been reviewed');
  const { verify, note } = req.body as { verify: boolean; note?: string };
  b.verificationStatus = verify ? 'verified' : 'rejected';
  b.verifiedBy = req.user!._id;
  b.verifiedAt = new Date();
  b.verificationNote = note;
  await b.save();
  await audit(req.user, verify ? 'road.verify' : 'road.reject', 'RoadBlockage', b._id, { note }, req);
  await notifyUsers([b.reportedBy], { type: verify ? 'road_verified' : 'road_rejected', params: { type: b.type }, message: verify ? 'Your road blockage report was verified' : 'Your road blockage report could not be verified', entityType: 'road', entityId: String(b._id) });
  emitToRoles(['admin'], 'road:updated', { id: String(b._id) });
  emitMapRefresh('road', String(b._id));
  return ok(res, serializeBlockage(b, { id: String(req.user!._id), role: 'admin' }));
});

export const submitClearance = asyncHandler(async (req, res) => {
  const user = req.user!;
  const b = await RoadBlockage.findById(req.params.id);
  if (!b || b.verificationStatus === 'rejected') throw notFound('ROAD_NOT_FOUND');
  if (b.status === 'cleared') throw conflict('ROAD_ALREADY_CLEARED', 'This blockage is already marked as cleared');
  if (await RoadClearanceReport.exists({ blockage: b._id, status: 'pending' })) throw conflict('CLEARANCE_PENDING', 'A clearance update is already waiting for verification');
  const photo = toAttachments(req)[0];
  if (photo && !photo.mimeType.startsWith('image/')) throw badRequest('PHOTO_MUST_BE_IMAGE');
  const report = await RoadClearanceReport.create({ blockage: b._id, submittedBy: user._id, note: req.body.note, photo });
  // The blockage stays active/unchanged until an administrator verifies the clearance.
  await audit(user, 'road.clearance_submit', 'RoadBlockage', b._id, { reportId: String(report._id) }, req);
  await notifyRoles(['admin'], { type: 'road_clearance_submitted', params: { type: b.type }, message: 'A road clearance update needs verification', link: '/admin/roads', entityType: 'road', entityId: String(b._id) });
  emitToRoles(['admin'], 'road:updated', { id: String(b._id) });
  emitMapRefresh('road', String(b._id));
  return created(res, { id: String(report._id), status: report.status });
});

export const listPendingClearances = asyncHandler(async (_req, res) => {
  const reports = await RoadClearanceReport.find({ status: 'pending' }).sort({ createdAt: 1 }).populate('blockage').populate('submittedBy', 'name');
  return ok(
    res,
    reports.map((r) => {
      const b = r.blockage as unknown as RoadBlockageDoc;
      return {
        id: String(r._id),
        note: r.note,
        photoUrl: r.photo ? `/api/uploads/${r.photo.filename}` : null,
        submittedBy: (r.submittedBy as unknown as { name?: string })?.name,
        createdAt: r.createdAt,
        blockage: b ? { id: String(b._id), type: b.type, severity: b.severity, description: b.description, location: latLngOf(b.location), verificationStatus: b.verificationStatus } : null,
      };
    }),
  );
});

export const decideClearance = asyncHandler(async (req, res) => {
  const report = await RoadClearanceReport.findById(req.params.reportId);
  if (!report) throw notFound('CLEARANCE_NOT_FOUND');
  if (report.status !== 'pending') throw conflict('CLEARANCE_ALREADY_DECIDED');
  const b = await RoadBlockage.findById(report.blockage);
  if (!b) throw notFound('ROAD_NOT_FOUND');
  const { approve, reason } = req.body as { approve: boolean; reason?: string };
  report.status = approve ? 'approved' : 'rejected';
  report.reviewedBy = req.user!._id;
  report.reviewedAt = new Date();
  report.decisionReason = reason;
  await report.save();
  if (approve) {
    b.status = 'cleared';
    b.clearedAt = new Date();
    if (b.verificationStatus === 'unverified') {
      b.verificationStatus = 'verified';
      b.verifiedBy = req.user!._id;
      b.verifiedAt = new Date();
    }
    await b.save();
  }
  await audit(req.user, approve ? 'road.clearance_approve' : 'road.clearance_reject', 'RoadBlockage', b._id, { reportId: String(report._id), reason }, req);
  await notifyUsers([report.submittedBy], { type: approve ? 'clearance_approved' : 'clearance_rejected', params: { type: b.type, reason }, message: approve ? 'Your road clearance update was verified' : `Your road clearance update was rejected: ${reason}`, entityType: 'road', entityId: String(b._id) });
  emitToRoles(['admin'], 'road:updated', { id: String(b._id) });
  emitMapRefresh('road', String(b._id));
  return ok(res, serializeBlockage(b, { id: String(req.user!._id), role: 'admin' }, { latestClearance: { status: report.status, at: report.createdAt } }));
});
