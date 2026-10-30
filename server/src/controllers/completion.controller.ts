import type { FilterQuery } from 'mongoose';
import { Assignment, CompletionReport, Emergency, TeamMembership } from '../models';
import type { CompletionReportDoc, ICompletionReport } from '../models/CompletionReport';
import { toAttachments } from '../middleware/upload';
import { audit } from '../services/audit.service';
import { emitEmergencyEvent, getUserTeamIds, transitionEmergency, viewLevelFor } from '../services/emergency.service';
import { notifyRoles, notifyUsers } from '../services/notification.service';
import { badRequest, conflict, forbidden, notFound } from '../utils/AppError';
import { idOf } from '../utils/ids';
import { asyncHandler, created, ok, pageMeta, parsePaging } from '../utils/http';

export function serializeReport(r: CompletionReportDoc, withEvidence = true) {
  const em = r.emergency as unknown as { _id?: unknown; emergencyId?: string; type?: string; status?: string } | undefined;
  const by = r.submittedBy as unknown as { _id?: unknown; name?: string } | undefined;
  const team = r.team as unknown as { _id?: unknown; name?: string } | undefined;
  return {
    id: String(r._id),
    kind: r.kind,
    status: r.status,
    emergency: em && typeof em === 'object' && 'emergencyId' in em ? { id: String(em._id), emergencyId: em.emergencyId, type: em.type, status: em.status } : { id: idOf(r.emergency) },
    team: team && typeof team === 'object' && 'name' in team ? { id: String(team._id), name: team.name } : null,
    submittedBy: by && typeof by === 'object' && 'name' in by ? { id: String(by._id), name: by.name } : { id: idOf(r.submittedBy) },
    actionsPerformed: r.actionsPerformed,
    peopleAssisted: r.peopleAssisted,
    resourcesUsed: r.resourcesUsed,
    notes: r.notes,
    evidence: withEvidence ? r.evidence.map((e) => ({ filename: e.filename, originalName: e.originalName, mimeType: e.mimeType, url: `/api/uploads/${e.filename}` })) : [],
    reviewStartedAt: r.reviewStartedAt,
    decidedAt: r.decidedAt,
    decisionReason: r.decisionReason,
    createdAt: r.createdAt,
  };
}

const populateReport = async (q: ReturnType<typeof CompletionReport.find>): Promise<CompletionReportDoc[]> =>
  (await q.populate('emergency', 'emergencyId type status').populate('submittedBy', 'name').populate('team', 'name')) as unknown as CompletionReportDoc[];

export const submitReport = asyncHandler(async (req, res) => {
  const user = req.user!;
  const b = req.body as { emergencyId: string; kind: 'completion' | 'assistance'; actionsPerformed: string; peopleAssisted: number; resourcesUsed: string; notes?: string };
  const em = await Emergency.findById(b.emergencyId);
  if (!em) throw notFound('EMERGENCY_NOT_FOUND');
  const level = await viewLevelFor(user, em);
  if (level !== 'responder') throw forbidden('FORBIDDEN_RESOURCE', 'You are not assigned to this emergency');

  // Find the caller's active assignment for this emergency.
  const teamIds = await getUserTeamIds(user._id);
  const assignment = await Assignment.findOne({ emergency: em._id, status: 'active', $or: [{ team: { $in: teamIds } }, { volunteers: user._id }] });
  if (!assignment) throw forbidden('FORBIDDEN_RESOURCE', 'You have no active assignment for this emergency');

  if (b.kind === 'completion') {
    // Only the leader of the assigned team may submit completion; it cannot resolve the emergency by itself.
    if (user.role !== 'team_leader') throw forbidden('FORBIDDEN_ROLE', 'Only team leaders can submit completion reports');
    const isLeader = assignment.team ? await TeamMembership.exists({ team: assignment.team, user: user._id, role: 'leader', active: true }) : true;
    if (!isLeader) throw forbidden('FORBIDDEN_NOT_LEADER', 'Only the leader of the assigned team can submit completion reports');
    if (em.status !== 'in_progress') throw conflict('EMERGENCY_NOT_IN_PROGRESS', 'Work must be in progress before a completion report can be submitted');
  } else if (!['assigned', 'in_progress'].includes(em.status)) {
    throw conflict('EMERGENCY_NOT_ACTIVE', 'Assistance reports can only be added while the emergency is being handled');
  }

  const report = await CompletionReport.create({
    emergency: em._id,
    assignment: assignment._id,
    team: assignment.team,
    kind: b.kind,
    submittedBy: user._id,
    actionsPerformed: b.actionsPerformed,
    peopleAssisted: b.peopleAssisted,
    resourcesUsed: b.resourcesUsed,
    notes: b.notes,
    evidence: toAttachments(req),
  });

  if (b.kind === 'completion') {
    await transitionEmergency(em, 'completion_submitted', user, 'completion_report_submitted');
    await notifyRoles(['admin'], {
      type: 'completion_submitted',
      params: { emergencyId: em.emergencyId },
      message: `Completion report submitted for ${em.emergencyId} - verification needed`,
      link: '/admin/verification',
      entityType: 'completionReport',
      entityId: String(report._id),
    });
    await emitEmergencyEvent(em, 'completion:submitted', { reportId: String(report._id) });
  } else {
    await notifyRoles(['admin'], {
      type: 'assistance_report',
      params: { emergencyId: em.emergencyId },
      message: `Assistance report added to ${em.emergencyId}`,
      link: `/admin/emergencies/${em._id}`,
      entityType: 'completionReport',
      entityId: String(report._id),
    });
  }
  const populated = await populateReport(CompletionReport.find({ _id: report._id }));
  return created(res, serializeReport(populated[0]));
});

export const listReports = asyncHandler(async (req, res) => {
  const user = req.user!;
  const { page, limit, skip } = parsePaging(req.query as Record<string, unknown>);
  const filter: FilterQuery<ICompletionReport> = {};
  if (req.query.status) filter.status = String(req.query.status);
  if (req.query.kind) filter.kind = String(req.query.kind);
  if (req.query.emergencyId) filter.emergency = String(req.query.emergencyId);
  if (user.role !== 'admin') filter.submittedBy = user._id;
  const [items, total] = await Promise.all([populateReport(CompletionReport.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit)), CompletionReport.countDocuments(filter)]);
  return ok(res, items.map((r) => serializeReport(r)), pageMeta(page, limit, total));
});

export const getReport = asyncHandler(async (req, res) => {
  const [r] = await populateReport(CompletionReport.find({ _id: req.params.id }));
  if (!r) throw notFound('REPORT_NOT_FOUND');
  if (req.user!.role !== 'admin' && idOf(r.submittedBy) !== String(req.user!._id)) throw forbidden('FORBIDDEN_RESOURCE');
  return ok(res, serializeReport(r));
});

export const startReview = asyncHandler(async (req, res) => {
  const report = await CompletionReport.findById(req.params.id);
  if (!report) throw notFound('REPORT_NOT_FOUND');
  if (report.kind !== 'completion' || report.status !== 'submitted') throw conflict('REPORT_NOT_REVIEWABLE', 'Only newly submitted completion reports can be moved to review');
  const em = await Emergency.findById(report.emergency);
  if (!em) throw notFound('EMERGENCY_NOT_FOUND');
  await transitionEmergency(em, 'admin_verification', req.user!, 'verification_started');
  report.status = 'under_review';
  report.reviewedBy = req.user!._id;
  report.reviewStartedAt = new Date();
  await report.save();
  await audit(req.user, 'completion.review_start', 'CompletionReport', report._id, { emergency: em.emergencyId }, req);
  const [r] = await populateReport(CompletionReport.find({ _id: report._id }));
  return ok(res, serializeReport(r));
});

/** Approve (-> Resolved) or reject with a reason (-> back to In Progress). Only administrators can do this. */
export const decideReport = asyncHandler(async (req, res) => {
  const user = req.user!;
  const { approve, reason } = req.body as { approve: boolean; reason?: string };
  const report = await CompletionReport.findById(req.params.id);
  if (!report) throw notFound('REPORT_NOT_FOUND');
  if (report.kind !== 'completion') throw badRequest('REPORT_NOT_VERIFIABLE', 'Only completion reports are verified');
  if (!['submitted', 'under_review'].includes(report.status)) throw conflict('REPORT_ALREADY_DECIDED', 'This report has already been decided');
  const em = await Emergency.findById(report.emergency);
  if (!em) throw notFound('EMERGENCY_NOT_FOUND');
  if (em.status === 'completion_submitted') await transitionEmergency(em, 'admin_verification', user, 'verification_started');
  if (em.status !== 'admin_verification') throw conflict('EMERGENCY_NOT_IN_VERIFICATION', 'The emergency is not awaiting verification');

  report.reviewedBy = user._id;
  report.decidedAt = new Date();
  report.decisionReason = reason;
  const leader = idOf(report.submittedBy);

  if (approve) {
    report.status = 'approved';
    await report.save();
    await transitionEmergency(em, 'resolved', user, reason ?? 'completion_verified');
    await Assignment.updateMany({ emergency: em._id, status: 'active' }, { status: 'completed', endedAt: new Date() });
    await notifyUsers([leader], { type: 'completion_approved', params: { emergencyId: em.emergencyId }, message: `Completion of ${em.emergencyId} was verified`, link: `/responder/emergencies/${em._id}`, entityType: 'emergency', entityId: String(em._id) });
    if (em.reporter) await notifyUsers([idOf(em.reporter)], { type: 'emergency_resolved', params: { emergencyId: em.emergencyId }, message: `Your report ${em.emergencyId} has been resolved`, link: `/citizen/requests/${em._id}`, entityType: 'emergency', entityId: String(em._id) });
  } else {
    report.status = 'rejected';
    await report.save();
    await transitionEmergency(em, 'in_progress', user, `completion_rejected: ${reason}`);
    await notifyUsers([leader], { type: 'completion_rejected', params: { emergencyId: em.emergencyId, reason }, message: `Completion of ${em.emergencyId} was rejected: ${reason}`, link: `/responder/emergencies/${em._id}`, entityType: 'emergency', entityId: String(em._id) });
  }
  await audit(user, approve ? 'completion.approve' : 'completion.reject', 'CompletionReport', report._id, { emergency: em.emergencyId, reason }, req);
  await emitEmergencyEvent(em, 'completion:verified', { approved: approve });
  const [r] = await populateReport(CompletionReport.find({ _id: report._id }));
  return ok(res, serializeReport(r));
});
