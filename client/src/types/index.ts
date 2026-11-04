export type Role = 'citizen' | 'volunteer' | 'team_leader' | 'admin' | 'food_provider' | 'shelter_coordinator';
export type PriorityLevel = 'critical' | 'high' | 'medium' | 'low';
export type EmergencyStatus = 'pending' | 'acknowledged' | 'assigned' | 'in_progress' | 'completion_submitted' | 'admin_verification' | 'resolved';

export interface User {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  role: Role;
  status: 'active' | 'pending' | 'suspended';
  preferredLanguage: 'en' | 'ta';
  skills: string[];
  availability: 'available' | 'busy' | 'unavailable';
  createdAt?: string;
}

export interface Reason { code: string; points: number; params?: Record<string, unknown> }
export interface LatLngAddr { lat: number; lng: number; address?: string }

export interface Emergency {
  id: string;
  emergencyId: string;
  kind: 'normal' | 'sos';
  source: string;
  type: string;
  description: string;
  affectedCount: number;
  dangerToLife: boolean;
  severity: string;
  vulnerable: Record<string, boolean>;
  assistanceNeeds: string[];
  citizenPriority?: PriorityLevel | null;
  trappedCount?: number;
  shelterPlan?: { shelter: string; people: number; confirmedAt: string } | null;
  contact: { name?: string; phone?: string };
  location: LatLngAddr | null;
  occurredAt: string;
  evidence: { filename: string; originalName?: string; mimeType: string; url: string }[];
  status: EmergencyStatus;
  statusHistory: { from?: string; to: string; byRole?: string; at: string; note?: string }[];
  acknowledgedAt?: string;
  resolvedAt?: string;
  recommendedPriority: { level: PriorityLevel; score: number; reasons: Reason[] };
  finalPriority: { level: PriorityLevel; overridden: boolean; overrideReason?: string; recommendedLevelAtDecision: PriorityLevel; decidedAt: string } | null;
  effectivePriority: { level: PriorityLevel; confirmed: boolean };
  priorityReviewNeeded: boolean;
  requiredVolunteers: number;
  requiredSkills: string[];
  revisionCount: number;
  sms: { prepared: boolean; preparedAt?: string; note?: string };
  createdAt: string;
  updatedAt: string;
  reporter?: { id: string; name?: string; email?: string; phone?: string } | null;
  duplicateOf?: string | null;
  duplicateCandidates?: { emergency: string; score: number; reasons: Reason[]; distanceMeters: number; similarity: number; reviewStatus: string }[];
  staffing?: { required: number; assigned: number; gap: number; teams: string[] };
  liveRecommendation?: { level: PriorityLevel; score: number; reasons: Reason[] };
  duplicateDetails?: { id: string; emergencyId: string; type: string; kind: string; status: string; description: string; createdAt: string }[];
  assignments?: AssignmentLite[];
  assignedTeams?: { name: string }[];
}

export interface AssignmentLite {
  id: string;
  status: string;
  team: { id: string; name: string } | null;
  volunteers: { id: string; name: string }[];
  instructions?: string;
  assignedAt: string;
  reassignReason?: string;
  progress: { note: string; percent?: number; at: string }[];
}
export interface Assignment extends AssignmentLite {
  emergency: { id: string; emergencyId?: string; type?: string; status?: string; kind?: string };
}

export interface Paged<T> { data: T[]; meta: { page: number; limit: number; total: number; pages: number } }

export interface Team {
  id: string; name: string; leader: { id: string; name: string | null }; skills: string[]; capacity: number; availability: string; notes?: string;
  active: boolean; memberCount: number; members: { id: string; name: string; skills: string[]; availability: string; role: string }[];
  workload: number; lastLocation: { lat: number; lng: number; at?: string } | null;
}

export interface Shelter {
  id: string; name: string; location: LatLngAddr | null; capacity: number; occupancy: number; available: number; facilities: string[];
  accessibilityNotes?: string; contact: { name?: string; phone?: string }; status: 'open' | 'full' | 'closed'; coordinator?: string | null;
}

export interface FoodSupply { id: string; provider?: string; foodType: string; unit: 'meals' | 'packages'; quantityTotal: number; quantityAvailable: number; availableUntil?: string; notes?: string; active: boolean }
export interface FoodProvider { id: string; name: string; description?: string; location: LatLngAddr | null; operatingHours: string; contact: { name?: string; phone?: string }; status: string }
export interface FoodAllocation {
  id: string; status: string; community?: string; unit: string; quantityRequested: number; quantityApproved?: number; quantitySupplied?: number;
  deliveryAddress?: string; decisionNote?: string; emergency?: { id: string; emergencyId: string } | null; provider?: { id: string; name: string } | null;
  supply?: { id: string; foodType: string } | null; requestedBy?: { id: string; name: string } | null; history: { status: string; at: string; note?: string }[]; createdAt: string;
}

export interface Road {
  id: string; type: string; description: string; severity: string; location: LatLngAddr | null; photoUrl: string | null; reportedAt: string;
  verificationStatus: 'unverified' | 'verified' | 'rejected'; verified: boolean; verificationNote?: string; status: 'active' | 'cleared';
  clearancePending: boolean; mine: boolean;
  clearanceHistory?: { id: string; status: string; note: string; photoUrl: string | null; submittedBy?: string; decisionReason?: string; createdAt: string }[];
}

export interface AppNotification { id: string; type: string; message: string; params?: Record<string, unknown>; link?: string; read: boolean; createdAt: string }

export interface CompletionReport {
  id: string; kind: 'completion' | 'assistance'; status: string; emergency: { id: string; emergencyId?: string; type?: string; status?: string };
  team: { id: string; name: string } | null; submittedBy: { id: string; name?: string }; actionsPerformed: string; peopleAssisted: number;
  resourcesUsed: string; notes?: string; evidence: { url: string; originalName?: string; mimeType: string }[]; decisionReason?: string; createdAt: string; decidedAt?: string;
}

export interface EscalationItem {
  id: string; level: number; status: 'open' | 'acknowledged' | 'resolved'; triggeredAt: string; elapsedSeconds: number; deadlineSeconds: number; note?: string;
  emergency: { id: string; emergencyId: string; type: string; description: string; status: string; affectedCount: number; createdAt: string } | null;
}

export interface MapData {
  emergencies: { id: string; emergencyId: string; kind: 'normal' | 'sos'; type: string; status: string; priority: PriorityLevel; priorityConfirmed: boolean; affectedCount: number; lat: number; lng: number; description?: string; address?: string }[];
  shelters: { id: string; name: string; lat: number; lng: number; address?: string; capacity: number; occupancy: number; available: number; status: string; facilities: string[]; phone?: string }[];
  food: { id: string; name: string; lat: number; lng: number; address?: string; operatingHours: string; available: number }[];
  roads: { id: string; type: string; severity: string; description: string; lat: number; lng: number; verified: boolean; verificationStatus: string; status: string; clearancePending: boolean }[];
  teams: { id: string; name: string; lat: number; lng: number; availability: string }[];
  zones?: { id: string; lat: number; lng: number; radiusMeters: number; reportCount: number; peopleCount: number; riskLevel: string; dominantType: string; status: string }[];
}

export interface AppSettings {
  ackDeadlineSeconds: number; maxEscalationLevel: number; smsEmergencyNumber: string;
  duplicateRules: { radiusMeters: number; windowMinutes: number; similarityThreshold: number };
  priority: { thresholds: { critical: number; high: number; medium: number } };
  automation: {
    zones: { radiusMeters: number; windowMinutes: number; minReports: number; sameTypeOnly: boolean };
    workload: { overloadedAt: number };
    teamFormation: { maxDistanceKm: number };
    shelter: { maxDistanceKm: number; nearFullPercent: number };
    food: { mealsPerPersonPerDay: number; days: number };
    followUp: { emergencyIdleMinutes: number; progressIdleMinutes: number; shelterStaleMinutes: number; repeatMinutes: number; maxReminders: number };
  };
}
