/** Smart automation: every recommendation is rule-based (distance, counts, thresholds) - no machine learning. */
const automation = {
  automation: {
    title: 'Smart Automation Dashboard', subtitle: 'Backend checks run every minute on real data. Nothing is dispatched, allocated or merged until you approve it.',
    rulesNote: 'Transparent rules, not AI: scores add up skills, availability, workload, distance and capacity, and every card shows the reasons.', updated: 'Updated {{time}}', runNow: 'Run checks now', runDone: 'Checks completed.', runPartial: 'Checks ran, but some steps reported errors.',
    openFull: 'Open full dashboard', filter: 'Filter', km: '{{km}} km',
    unit: { meals: 'meals', places: 'places' }, severity: { critical: 'Critical', warning: 'Warning' }, risk: { critical: 'Critical', high: 'High', medium: 'Medium', low: 'Low' },
    tiles: {
      teams: 'Emergencies needing teams', teamsHint: '{{count}} team(s) need members', workload: 'Overloaded / available', workloadHint: 'volunteers', zones: 'Zones to review', shortages: 'Resource shortages', criticalHint: '{{count}} critical',
      shelters: 'Shelter suggestions', sos: 'Unacknowledged SOS', overdueHint: '{{count}} overdue', followUps: 'Pending follow-ups',
    },
    teams: {
      title: 'Recommended rescue teams', help: 'Best volunteers for emergencies that still need people. Score = skills 40 + availability 20 + workload 20 + distance 20.', staffing: 'Staffing', topVolunteers: 'Top volunteers', topTeam: 'Best existing team', none: 'Every open emergency is staffed or waiting for acknowledgement.',
      review: 'Review and approve', reviewTitle: 'Review recommended team', panelTitle: 'Smart rescue team recommendation', advisory: 'These are recommendations only. Nobody is notified or dispatched until you approve the formation below.',
      needPriority: 'Confirm or override the priority first; no one can be assigned before that.', needAcknowledge: 'Acknowledge the emergency before assigning responders.', recommendedVolunteers: 'Recommended volunteers', score: 'score {{score}}',
      noCandidates: 'No suitable volunteers are available right now.', excluded: '{{overloaded}} overloaded and {{unavailable}} unavailable volunteer(s) were left out.', optionalTeam: 'Assign an existing team as well', optionalTeamHint: 'Teams are ranked by skills, availability, workload and distance.',
      addToTeam: 'Also add the selected volunteers to this team as members', approve: 'Approve and assign', approved: 'Formation approved and assigned.', missingSkills: 'Skills not covered: {{skills}}',
      gapsTitle: 'Teams that need additional members', noGaps: 'No team currently needs more members.', lacks: 'needs {{skill}}', teamFull: 'This team is at capacity; raise its capacity first.', manage: 'Manage teams',
    },
    workload: {
      title: 'Volunteer workload', help: 'Active tasks per volunteer from live assignments. {{count}} or more active tasks counts as overloaded. Tasks are never reassigned automatically.', tasks: 'Active tasks', alternatives: 'Suggested alternatives', noAlternatives: 'No alternative volunteers available.',
      none: 'No volunteers match this filter.', noAutoReassign: 'To move a task, reassign it manually from the emergency page.',
      state: { title: 'Status', overloaded: 'Overloaded', busy: 'Busy', available: 'Available', unavailable: 'Unavailable' },
    },
    zones: {
      title: 'Detected emergency zones', help: 'Nearby reports filed within the configured time window are grouped into possible zones (distance, type and time are compared).', neverMerge: 'Reports are never merged or deleted; a zone only references them.',
      area: 'Area', reports: 'Reports', people: 'People', risk: 'Risk', radius: 'radius {{m}} m', last: 'latest {{time}}', none: 'No zones detected.', review: 'Review', reviewTitle: 'Review emergency zone', markReviewed: 'Mark reviewed', dismiss: 'Dismiss',
      note: 'Review note', viewMap: 'View on map', possibleZone: 'Possible emergency zone', counts: '{{reports}} reports, {{people}} people', mapNote: 'Automatic grouping; review it on the dashboard.',
      status: { detected: 'Needs review', reviewed: 'Reviewed', dismissed: 'Dismissed', inactive: 'Inactive' },
    },
    resources: {
      food: 'Food (estimated need vs supply)', shelter: 'Shelter places', required: 'Required', available: 'Available', shortage: 'Shortage', capacity: 'Capacity', free: 'Free places', seeking: 'People seeking shelter',
      foodBasis: 'Need = people (open requests for food + people in shelters) × {{n}} meal(s). Supply = active provider stock that has not expired.', shelterBasis: '{{occupied}} people are currently in shelters. Places reserved by referrals are not counted as free.',
      alerts: 'Shortage alerts', kind: 'Alert', since: 'last checked {{time}}', where: 'Affected locations', none: 'No resource shortages right now.', acknowledge: 'Acknowledge', acknowledged: 'Acknowledged',
      kinds: { food_shortage: 'Food shortage', shelter_shortage: 'Not enough shelter places', shelter_near_capacity: 'Shelter full or nearly full' },
    },
    shelters: {
      title: 'Recommended shelters', help: 'Open shelters with enough free places, ranked by distance, spare capacity and matching facilities. Confirming reserves places only; the coordinator confirms arrival.',
      advisory: 'Suggestions only. Confirming creates an approved referral; nobody is registered in a shelter until the coordinator confirms their arrival.', alreadyPlanned: 'A shelter was already confirmed for {{people}} people.', peopleToPlace: '{{count}} people to place', neededFacilities: 'Needed facilities',
      distance: 'Distance', available: 'Free places', why: 'Why', confirm: 'Confirm shelter', confirmed: 'Shelter confirmed. The coordinator was notified.', missing: 'Missing', excluded: '{{insufficientCapacity}} shelter(s) without enough free places and {{tooFar}} too far away were left out.',
      none: 'No open shelter has enough free places nearby ({{insufficientCapacity}} too full, {{tooFar}} too far).', none2: 'No emergencies are waiting for a shelter.', noneSuitable: 'No suitable shelter', people: 'People', best: 'Best match', review: 'Review and confirm', reviewTitle: 'Review recommended shelters', panelTitle: 'Smart shelter recommendation',
    },
    sos: { title: 'Unacknowledged SOS alerts', help: 'SOS requests are escalated automatically once they wait longer than {{time}} (configurable). Escalation stops when the SOS is acknowledged.', waiting: 'Waiting', level: 'Escalation', levelN: 'Level {{n}}', none: 'Every SOS has been acknowledged.' },
    followUps: {
      title: 'Pending follow-ups', help: 'Reminders go to the responsible person (team leader, shelter coordinator or admins) and repeat at a set interval until the item is updated.', item: 'Item', idle: 'Without update', remindee: 'Reminded', admins: 'Admins', reminders: 'Reminders sent',
      none: 'Nothing is waiting for an update.', remindNow: 'Remind now', reminded: 'Reminder sent.', dismiss: 'Dismiss',
      kinds: { emergency_update: 'Emergency without update', rescue_progress: 'Rescue progress update', shelter_occupancy: 'Shelter occupancy refresh' },
    },
    settings: {
      zones: 'Smart zone detection', zonesHint: 'Reports within this distance and time window form a possible zone.', zoneRadius: 'Zone radius (m)', zoneWindow: 'Time window (minutes)', zoneMin: 'Minimum reports', zoneSameType: 'Same emergency type only',
      limits: 'Workload, recommendation and resource limits', overloadedAt: 'Overloaded at (active tasks)', overloadedAtHint: 'Volunteers at or above this count are flagged.', teamKm: 'Team search distance (km)', shelterKm: 'Shelter search distance (km)', nearFull: 'Shelter nearly full (%)',
      meals: 'Meals per person per day', mealsHint: 'Used to estimate food need.', days: 'Days to cover',
      followUps: 'Automatic follow-ups', fuEmergency: 'Emergency without update (min)', fuProgress: 'Rescue without progress (min)', fuShelter: 'Occupancy not refreshed (min)', fuRepeat: 'Repeat reminder every (min)', fuMax: 'Maximum reminders',
    },
  },
};
export default automation;
