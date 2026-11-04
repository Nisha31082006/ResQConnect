import { Router } from 'express';
import fs from 'fs';
import { authenticate, requireRole } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { evidenceUpload, uploadPath } from '../middleware/upload';
import { apiLimiter, authLimiter, reportLimiter, webhookLimiter } from '../middleware/rateLimit';
import { asyncHandler } from '../utils/http';
import { notFound } from '../utils/AppError';
import { idParams } from '../validators/common';
import * as V from '../validators/operations.validators';
import * as EV from '../validators/emergency.validators';
import * as AV from '../validators/auth.validators';
import * as auto from '../controllers/automation.controller';
import * as auth from '../controllers/auth.controller';
import * as em from '../controllers/emergencies.controller';
import * as teams from '../controllers/teams.controller';
import * as assignments from '../controllers/assignments.controller';
import * as completion from '../controllers/completion.controller';
import * as shelters from '../controllers/shelters.controller';
import * as food from '../controllers/food.controller';
import * as roads from '../controllers/roads.controller';
import * as esc from '../controllers/escalations.controller';
import * as notif from '../controllers/notifications.controller';
import * as map from '../controllers/map.controller';
import * as admin from '../controllers/admin.controller';
import * as users from '../controllers/users.controller';
import * as sms from '../controllers/sms.controller';

const r = Router();
const anyAuth = authenticate;
const adminOnly = [authenticate, requireRole('admin')];
const responders = [authenticate, requireRole('admin', 'team_leader', 'volunteer')];

r.get('/health', (_req, res) => res.json({ success: true, data: { status: 'ok', time: new Date().toISOString() } }));
r.get('/config/public', admin.publicConfig);

/* ---- auth ---- */
r.post('/auth/register', authLimiter, validate({ body: AV.registerSchema }), auth.register);
r.post('/auth/login', authLimiter, validate({ body: AV.loginSchema }), auth.login);
r.get('/auth/me', anyAuth, auth.me);
r.patch('/auth/me', anyAuth, validate({ body: AV.updateProfileSchema }), auth.updateMe);
r.post('/auth/change-password', authLimiter, anyAuth, validate({ body: AV.changePasswordSchema }), auth.changePassword);

/* ---- private evidence files (authenticated) ---- */
r.get(
  '/uploads/:filename',
  anyAuth,
  asyncHandler(async (req, res) => {
    const file = uploadPath(String(req.params.filename));
    if (!fs.existsSync(file)) throw notFound('FILE_NOT_FOUND');
    res.sendFile(file);
  }),
);

/* ---- emergencies ---- */
const citizenOrAdmin = requireRole('citizen', 'admin');
r.post('/emergencies', reportLimiter, anyAuth, citizenOrAdmin, ...evidenceUpload, validate({ body: EV.createEmergencySchema }), em.createEmergency);
r.post('/sos', reportLimiter, anyAuth, citizenOrAdmin, ...evidenceUpload, validate({ body: EV.createSosSchema }), em.createSos);
r.get('/emergencies', anyAuth, validate({ query: EV.listEmergenciesQuery }), em.listEmergencies);
r.get('/emergencies/duplicates/pairs', ...adminOnly, em.listDuplicatePairs);
r.get('/emergencies/:id', anyAuth, validate({ params: idParams }), em.getEmergency);
r.patch('/emergencies/:id', reportLimiter, anyAuth, requireRole('citizen', 'admin'), validate({ params: idParams }), ...evidenceUpload, validate({ body: EV.updateEmergencySchema }), em.updateEmergency);
r.get('/emergencies/:id/revisions', anyAuth, validate({ params: idParams }), em.listRevisions);
r.get('/emergencies/:id/recommendation', ...adminOnly, validate({ params: idParams }), em.getRecommendation);
r.get('/emergencies/:id/suggestions', ...adminOnly, validate({ params: idParams }), em.getSuggestions);
r.post('/emergencies/:id/status', ...responders, validate({ params: idParams, body: EV.statusChangeSchema }), em.changeStatus);
r.post('/emergencies/:id/priority', ...adminOnly, validate({ params: idParams, body: EV.priorityDecisionSchema }), em.decidePriority);
r.put('/emergencies/:id/requirements', ...adminOnly, validate({ params: idParams, body: EV.requirementsSchema }), em.setRequirements);
r.post('/emergencies/:id/sms-prepared', anyAuth, requireRole('citizen'), validate({ params: idParams, body: EV.smsPreparedSchema }), em.markSmsPrepared);
r.post('/emergencies/:id/duplicates', ...adminOnly, validate({ params: idParams, body: EV.duplicateReviewSchema }), em.reviewDuplicate);

/* ---- users / volunteers ---- */
r.get('/users', ...adminOnly, validate({ query: V.listUsersQuery }), users.listUsers);
r.post('/users', ...adminOnly, validate({ body: V.adminCreateUserSchema }), users.createUser);
r.patch('/users/:id', ...adminOnly, validate({ params: idParams, body: V.adminUpdateUserSchema }), users.updateUser);
r.get('/volunteers', ...adminOnly, users.listVolunteers);
r.get('/users/me/location', authenticate, requireRole('volunteer', 'team_leader'), users.getMyLocation);
r.put('/users/me/location', authenticate, requireRole('volunteer', 'team_leader'), validate({ body: V.myLocationSchema }), users.updateMyLocation);

/* ---- teams ---- */
r.get('/teams', ...responders, teams.listTeams);
r.post('/teams', ...adminOnly, validate({ body: V.createTeamSchema }), teams.createTeam);
r.get('/teams/:id', ...responders, validate({ params: idParams }), teams.getTeam);
r.patch('/teams/:id', ...adminOnly, validate({ params: idParams, body: V.updateTeamSchema }), teams.updateTeam);
r.post('/teams/:id/members', ...adminOnly, validate({ params: idParams, body: V.addMembersSchema }), teams.addMembers);
r.delete('/teams/:id/members/:userId', ...adminOnly, teams.removeMember);
r.put('/teams/:id/location', authenticate, requireRole('team_leader'), validate({ params: idParams, body: V.teamLocationSchema }), teams.updateTeamLocation);

/* ---- assignments ---- */
r.get('/assignments', ...responders, assignments.listAssignments);
r.post('/assignments', ...adminOnly, validate({ body: V.createAssignmentSchema }), assignments.createAssignment);
r.post('/assignments/:id/reassign', ...adminOnly, validate({ params: idParams, body: V.reassignSchema }), assignments.reassign);
r.post('/assignments/:id/progress', authenticate, requireRole('team_leader', 'volunteer'), validate({ params: idParams, body: V.progressSchema }), assignments.addProgress);

/* ---- completion reports ---- */
r.get('/completion-reports', ...responders, completion.listReports);
r.post('/completion-reports', reportLimiter, authenticate, requireRole('team_leader', 'volunteer'), ...evidenceUpload, validate({ body: V.completionSchema }), completion.submitReport);
r.get('/completion-reports/:id', ...responders, validate({ params: idParams }), completion.getReport);
r.post('/completion-reports/:id/review', ...adminOnly, validate({ params: idParams }), completion.startReview);
r.post('/completion-reports/:id/decision', ...adminOnly, validate({ params: idParams, body: V.completionDecisionSchema }), completion.decideReport);

/* ---- shelters ---- */
r.get('/shelters', anyAuth, validate({ query: V.listSheltersQuery }), shelters.listShelters);
r.post('/shelters', ...adminOnly, validate({ body: V.createShelterSchema }), shelters.createShelter);
r.get('/shelters/:id', anyAuth, validate({ params: idParams }), shelters.getShelter);
r.patch('/shelters/:id', authenticate, requireRole('admin', 'shelter_coordinator'), validate({ params: idParams, body: V.updateShelterSchema }), shelters.updateShelter);
r.post('/shelters/:id/occupancy', authenticate, requireRole('admin', 'shelter_coordinator'), validate({ params: idParams, body: V.occupancySchema }), shelters.updateOccupancy);
r.post('/shelters/:id/referrals', ...adminOnly, validate({ params: idParams, body: V.referralSchema }), shelters.createReferral);
r.get('/shelters/:id/referrals', authenticate, requireRole('admin', 'shelter_coordinator'), validate({ params: idParams }), shelters.listReferrals);
r.post('/shelters/:id/referrals/:referralId/admit', authenticate, requireRole('admin', 'shelter_coordinator'), shelters.admitReferral);

/* ---- food ---- */
r.get('/food/providers', anyAuth, food.listProviders);
r.post('/food/providers', authenticate, requireRole('admin', 'food_provider'), validate({ body: V.providerSchema }), food.createProvider);
r.get('/food/providers/me', authenticate, requireRole('food_provider'), food.myProvider);
r.patch('/food/providers/:id', authenticate, requireRole('admin', 'food_provider'), validate({ params: idParams, body: V.providerUpdateSchema }), food.updateProvider);
r.get('/food/supplies', anyAuth, food.listSupplies);
r.post('/food/supplies', authenticate, requireRole('admin', 'food_provider'), validate({ body: V.supplyCreateSchema }), food.createSupply);
r.patch('/food/supplies/:id', authenticate, requireRole('admin', 'food_provider'), validate({ params: idParams, body: V.supplyUpdateSchema }), food.updateSupply);
r.post('/food/requests', authenticate, requireRole('admin', 'citizen', 'shelter_coordinator', 'team_leader', 'volunteer'), validate({ body: V.foodRequestSchema }), food.createRequest);
r.get('/food/allocations', anyAuth, validate({ query: V.listAllocationsQuery }), food.listAllocations);
r.post('/food/allocations/:id/approve', ...adminOnly, validate({ params: idParams, body: V.allocationApproveSchema }), food.approveAllocation);
r.post('/food/allocations/:id/reject', ...adminOnly, validate({ params: idParams, body: V.allocationRejectSchema }), food.rejectAllocation);
r.post('/food/allocations/:id/status', anyAuth, validate({ params: idParams, body: V.allocationStatusSchema }), food.updateAllocationStatus);

/* ---- roads ---- */
r.get('/roads', anyAuth, roads.listBlockages);
r.post('/roads', reportLimiter, authenticate, requireRole('citizen', 'volunteer', 'team_leader', 'admin'), ...evidenceUpload, validate({ body: V.roadReportSchema }), roads.reportBlockage);
r.get('/roads/clearances/pending', ...adminOnly, roads.listPendingClearances);
r.post('/roads/clearances/:reportId/decision', ...adminOnly, validate({ body: V.clearanceDecisionSchema }), roads.decideClearance);
r.get('/roads/:id', anyAuth, validate({ params: idParams }), roads.getBlockage);
r.post('/roads/:id/verify', ...adminOnly, validate({ params: idParams, body: V.roadVerifySchema }), roads.verifyBlockage);
r.post('/roads/:id/clearance', reportLimiter, authenticate, requireRole('volunteer', 'team_leader', 'admin'), validate({ params: idParams }), ...evidenceUpload, validate({ body: V.clearanceSchema }), roads.submitClearance);

/* ---- escalations ---- */
r.get('/escalations', ...adminOnly, validate({ query: V.listEscalationsQuery }), esc.listEscalations);
r.get('/escalations/monitor', ...adminOnly, esc.monitor);
r.post('/escalations/run', ...adminOnly, esc.runNow);
r.post('/escalations/:id/acknowledge', ...adminOnly, validate({ params: idParams, body: V.escalationNoteSchema }), esc.acknowledgeEscalation);
r.post('/escalations/:id/resolve', ...adminOnly, validate({ params: idParams, body: V.escalationNoteSchema }), esc.resolveEscalation);

/* ---- notifications / map ---- */
r.get('/notifications', anyAuth, validate({ query: V.listNotificationsQuery }), notif.listNotifications);
r.post('/notifications/read-all', anyAuth, notif.markAllRead);
r.post('/notifications/:id/read', anyAuth, validate({ params: idParams }), notif.markRead);
r.get('/map', anyAuth, validate({ query: V.mapQuery }), map.getMapData);

/* ---- admin ---- */
r.get('/admin/stats', ...adminOnly, admin.dashboardStats);
r.get('/admin/settings', ...adminOnly, admin.getAppSettings);
r.put('/admin/settings', ...adminOnly, validate({ body: V.settingsSchema }), admin.putAppSettings);
r.get('/admin/audit', ...adminOnly, validate({ query: V.listAuditQuery }), admin.listAudit);

/* ---- smart automation (admin only; recommendations never change data without an explicit admin action) ---- */
r.get('/automation/overview', ...adminOnly, auto.overview);
r.post('/automation/run', ...adminOnly, auto.runChecks);
r.get('/automation/team-recommendations', ...adminOnly, auto.teamRecommendations);
r.get('/automation/team-gaps', ...adminOnly, auto.teamGaps);
r.get('/automation/emergencies/:id/team-recommendation', ...adminOnly, validate({ params: idParams }), auto.teamRecommendationFor);
r.post('/automation/team-formation/approve', ...adminOnly, validate({ body: V.approveFormationSchema }), auto.approveFormation);
r.get('/automation/zones', ...adminOnly, auto.listZones);
r.get('/automation/zones/:id', ...adminOnly, validate({ params: idParams }), auto.getZone);
r.post('/automation/zones/:id/review', ...adminOnly, validate({ params: idParams, body: V.zoneReviewSchema }), auto.reviewZone);
r.get('/automation/resource-alerts', ...adminOnly, auto.listResourceAlerts);
r.post('/automation/resource-alerts/:id/acknowledge', ...adminOnly, validate({ params: idParams }), auto.acknowledgeAlert);
r.get('/automation/shelter-recommendations', ...adminOnly, auto.shelterRecommendations);
r.get('/automation/emergencies/:id/shelter-recommendation', ...adminOnly, validate({ params: idParams }), auto.shelterRecommendationFor);
r.post('/automation/emergencies/:id/shelter/confirm', ...adminOnly, validate({ params: idParams, body: V.confirmShelterSchema }), auto.confirmShelter);
r.get('/automation/workload', ...adminOnly, auto.workload);
r.get('/automation/sos', ...adminOnly, auto.sosMonitor);
r.get('/automation/follow-ups', ...adminOnly, auto.listFollowUps);
r.post('/automation/follow-ups/:id/remind', ...adminOnly, validate({ params: idParams }), auto.remindFollowUp);
r.post('/automation/follow-ups/:id/dismiss', ...adminOnly, validate({ params: idParams }), auto.dismissFollowUp);

/* ---- optional inbound SMS webhook ---- */
r.post('/sms/inbound', webhookLimiter, validate({ body: V.smsInboundSchema }), sms.inboundSms);

export const apiRouter = Router();
apiRouter.use(apiLimiter);
apiRouter.use(r);
