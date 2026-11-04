/** Additions to existing sections (merged deeply into the base translations). */
const extras = {
  nav: { automation: 'Smart automation' },
  priority: { citizenSelected: 'Selected by citizen', citizenNone: 'Not specified', systemRecommended: 'System recommended', differs: 'The citizen’s choice differs from the rule-based recommendation. The recommendation is based on severity, people affected, trapped persons and medical needs.' },
  citizen: { trappedCount: 'People trapped', trappedHint: 'How many people cannot get out on their own (0 if none).', yourPriority: 'How urgent do you think this is?', yourPriorityHint: 'Optional. Your choice is kept, but the team also gets a system recommendation, and an administrator decides.', prioritySkip: 'Not sure' },
  profile: { baseLocation: 'Base location', baseLocationHint: 'Share where you are based so administrators can see how far you are from an emergency. Only administrators use it, for recommendations.', locationSaved: 'Saved location: {{lat}}, {{lng}}' },
  map: { layer: { zones: 'Possible zones' }, legend: { zone: 'Possible emergency zone' } },
  fields: { trappedCount: 'People trapped', citizenPriority: 'Priority chosen by citizen' },
  reason: {
    trapped_persons: '{{count}} people trapped', medical_assistance: 'Medical assistance needed', no_skill_required: 'No specific skills required', location_unknown: 'Location not shared', far_away: '{{km}} km away (beyond the search distance)', distance: '{{km}} km away',
    capacity_ok: '{{free}} free places for {{people}} people', facilities_match: 'Has: {{matched}}', facilities_missing: 'Lacks: {{missing}}',
  },
  notificationTypes: {
    resource_shortage: 'Shortage detected ({{kind}}): required {{required}}, available {{available}}, shortage {{shortage}}', resource_alert_escalated: 'Shortage became critical ({{kind}}): shortage {{shortage}}',
    zone_detected: 'Possible emergency zone: {{reports}} reports, {{people}} people', zone_reopened: 'A dismissed zone grew: {{reports}} reports, {{people}} people',
    followup_emergency_update: '{{label}} has had no update for {{idleMinutes}} min', followup_rescue_progress: 'Please post a rescue progress update for {{label}} ({{idleMinutes}} min without update)', followup_shelter_occupancy: 'Please refresh the occupancy of {{label}} ({{idleMinutes}} min since the last update)',
    followup_created: 'Follow-up opened: {{label}}',
  },
  errors: {
    PRIORITY_NOT_CONFIRMED: 'Confirm or override the priority before assigning responders.', ZONE_NOT_FOUND: 'Zone not found.', ZONE_INACTIVE: 'This zone is no longer active.', ALERT_NOT_FOUND: 'Alert not found.', FOLLOWUP_NOT_FOUND: 'Follow-up not found or already closed.',
    SHELTER_ALREADY_PLANNED: 'A shelter was already confirmed for this emergency.', SHELTER_NOT_SUITABLE: 'This shelter is closed, too far or does not have enough free places.', VOLUNTEER_UNAVAILABLE: 'This volunteer is marked unavailable.', TEAM_REQUIRED: 'Choose a team first.',
  },
};
export default extras;
