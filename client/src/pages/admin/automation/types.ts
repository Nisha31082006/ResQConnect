import type { PriorityLevel } from '../../../types';

export interface ReasonItem { code: string; params?: Record<string, unknown> }

export interface VolunteerRec { id: string; name: string; role: string; skills: string[]; availability: string; activeTasks: number; teamId: string | null; teamName: string | null; score: number; reasons: ReasonItem[]; distanceKm: number | null }
export interface TeamRec { id: string; name: string; size: number; capacity: number; openSlots: number; skills: string[]; workload: number; distanceKm: number | null; score: number; reasons: ReasonItem[] }
export interface TeamRecommendation {
  emergency: { id: string; emergencyId: string; type: string; status: string; affectedCount: number; requiredVolunteers: number; requiredSkills: string[]; priority: PriorityLevel; priorityConfirmed: boolean };
  staffing: { required: number; assigned: number; gap: number };
  volunteers: VolunteerRec[];
  proposedFormation: { size: number; volunteerIds: string[]; members: { id: string; name: string; score: number }[]; coveredSkills: string[]; missingSkills: string[] };
  teams: TeamRec[];
  excluded: { overloaded: number; unavailable: number };
  canApprove: boolean;
}
export interface TeamRecRow { emergency: TeamRecommendation['emergency']; staffing: TeamRecommendation['staffing']; topVolunteers: VolunteerRec[]; proposedFormation: TeamRecommendation['proposedFormation']; topTeam: TeamRec | null }
export interface TeamGap { team: { id: string; name: string; size: number; capacity: number; openSlots: number }; shortfall: number; missingSkills: string[]; emergencies: { id: string; emergencyId: string; type: string; required: number }[]; suggestions: { id: string; name: string; skills: string[]; score: number; reasons: ReasonItem[]; distanceKm: number | null }[] }

export type LoadState = 'overloaded' | 'busy' | 'available' | 'unavailable';
export interface Alternative { id: string; name: string; skills: string[]; activeTasks: number; state: LoadState; sharedSkills: string[]; distanceKm: number | null }
export interface VolunteerLoad { id: string; name: string; role: string; skills: string[]; availability: string; teamName: string | null; activeTasks: number; state: LoadState; tasks: { assignmentId: string; emergencyId: string; emergencyRef: string; type: string; status: string; priority: string | null }[]; alternatives: Alternative[] }

export interface Zone { id: string; center: { lat: number; lng: number } | null; radiusMeters: number; reportCount: number; peopleCount: number; sosCount: number; typeCounts: Record<string, number>; dominantType: string; riskLevel: 'critical' | 'high' | 'medium' | 'low'; status: 'detected' | 'reviewed' | 'dismissed' | 'inactive'; firstReportAt: string; lastReportAt: string; reviewNote?: string; reviewedAt?: string; emergencyIds: string[]; emergencies?: { id: string; emergencyId: string; type: string; affectedCount: number; status: string; kind: string }[] }

export interface ResourceAlert { id: string; kind: 'food_shortage' | 'shelter_shortage' | 'shelter_near_capacity'; severity: 'warning' | 'critical'; status: string; required: number; available: number; shortage: number; unit: string; locations: { kind: string; refId: string; name: string; people: number; required?: number; free?: number }[]; lastDetectedAt: string; acknowledgedAt?: string }
export interface ResourceSnapshot { food: { required: number; available: number; shortage: number; unit: string; mealsPerPerson: number; providers: number }; shelter: { capacity: number; occupancy: number; freeSpaces: number; peopleSeekingShelter: number; shelters: number } }

export interface ShelterRec { id: string; name: string; address?: string; distanceKm: number; capacity: number; occupancy: number; reserved: number; availableSpaces: number; facilities: string[]; matchedFacilities: string[]; missingFacilities: string[]; score: number; reasons: ReasonItem[] }
export interface ShelterRecommendation { emergency: { id: string; emergencyId: string; type: string; affectedCount: number; shelterRequested: boolean }; people: number; neededFacilities: string[]; shelters: ShelterRec[]; excluded: { insufficientCapacity: number; tooFar: number }; planned: { shelter: string; people: number } | null }
export interface ShelterRecRow { emergency: ShelterRecommendation['emergency']; people: number; best: ShelterRec | null; alternatives: number; excluded: ShelterRecommendation['excluded'] }

export interface SosRow { id: string; emergencyId: string; type: string; affectedCount: number; address: string | null; waitedSeconds: number; overdue: boolean; escalationLevel: number; openEscalations: number }
export interface FollowUp { id: string; kind: 'emergency_update' | 'rescue_progress' | 'shelter_occupancy'; label: string; idleMinutes: number; reminderCount: number; lastRemindedAt?: string; assignees: string[]; emergencyId: string | null; shelterId: string | null }

export interface Overview {
  generatedAt: string;
  summary: { emergenciesNeedingTeams: number; teamsNeedingMembers: number; overloadedVolunteers: number; availableVolunteers: number; zonesToReview: number; criticalShortages: number; openShortages: number; shelterRecommendations: number; unacknowledgedSos: number; overdueSos: number; pendingFollowUps: number };
  teamRecommendations: { total: number; items: TeamRecRow[] };
  teamsNeedingMembers: TeamGap[];
  workload: { summary: { total: number; overloaded: number; busy: number; available: number; unavailable: number; overloadedAt: number }; volunteers: VolunteerLoad[] };
  zones: Zone[];
  resourceAlerts: ResourceAlert[];
  resources: ResourceSnapshot;
  shelterRecommendations: { total: number; items: ShelterRecRow[] };
  unacknowledgedSos: { deadlineSeconds: number; items: SosRow[] };
  followUps: FollowUp[];
}
