# ResQConnect API reference

Base URL (development): `http://localhost:5000/api` (the Vite dev server proxies `/api` and `/socket.io`).

## Conventions

* JSON in and out. Success: `{ "success": true, "data": …, "meta"?: { page, limit, total, pages } }`.
* Errors: `{ "success": false, "error": { "code": "EMERGENCY_NOT_ACKNOWLEDGED", "message": "…", "details": [ { "path": "location.lat", "code": "invalid_coordinates", "message": "…" } ] } }`.
  `code` values are stable; the web client translates them (English/Tamil).
* Authentication: `Authorization: Bearer <JWT>` from `POST /auth/login` or `/auth/register`.
  The user is re-loaded from the database on every request, so suspension and role changes apply immediately.
* Lists accept `page`, `limit` (max 100), `search`, `sort`, `order`.
* Multipart endpoints (reports with evidence, road reports, completion reports, clearance updates):
  send a `data` field containing the JSON body and up to 5 files in the `evidence` field (JPG/PNG/WebP/PDF, 5 MB each, content-sniffed).
  Plain JSON bodies work too when there are no files.
* Idempotency: `POST /emergencies` and `POST /sos` accept `clientRequestId` (8–80 chars). Repeating the same id returns the original record (HTTP 200) instead of creating a duplicate; the same id with a different body fails with `REQUEST_ID_CONFLICT`.
* Rate limits: general API, auth (login/register/password) and report creation have separate limits (`RATE_LIMIT_API`, `RATE_LIMIT_AUTH`, `RATE_LIMIT_REPORTS`).
* Files are only served through `GET /uploads/:filename` with a valid token.

## Roles

`citizen`, `volunteer`, `team_leader`, `admin`, `food_provider`, `shelter_coordinator`. Self-registration allows `citizen` (active immediately) and `volunteer`, `food_provider`, `shelter_coordinator` (start `pending` until an admin approves). `team_leader` and `admin` accounts can only be created or promoted by an admin until an admin approves them.
Role checks happen on the server for every route below; the UI only mirrors them.

## Endpoints

### Public / auth
| Method | Path | Who | Notes |
|---|---|---|---|
| GET | `/health` | public | liveness |
| GET | `/config/public` | public | emergency SMS number + acknowledgement deadline (used by the offline SMS page) |
| POST | `/auth/register` | public | `{name,email,password,phone?,role,skills?,preferredLanguage?}`; role is one of the self-register roles |
| POST | `/auth/login` | public | returns `{ token, user }` |
| GET | `/auth/me` | signed in | |
| PATCH | `/auth/me` | signed in | name, phone, preferredLanguage, skills, availability |
| POST | `/auth/change-password` | signed in | `{currentPassword,newPassword}` |
| GET | `/uploads/:filename` | signed in | authenticated file download |

### Emergencies and SOS
| Method | Path | Who | Notes |
|---|---|---|---|
| POST | `/emergencies` | citizen, admin | full report (type, description ≥10, affectedCount, severity, vulnerable, assistanceNeeds, contact, location, occurredAt) |
| POST | `/sos` | citizen, admin | simplified SOS; `kind: "sos"` |
| GET | `/emergencies` | signed in | filtered by role: citizens see their own, responders see assigned ones, admins all. Filters: `status, priority, type, kind, duplicates, mine, search` |
| GET | `/emergencies/:id` | signed in | detail; fields depend on role (admins get reporter, duplicate details, live recommendation, staffing) |
| PATCH | `/emergencies/:id` | owner citizen, admin | SOS/report update; stores a **revision** with before/after values and re-evaluates priority. Refused when resolved |
| GET | `/emergencies/:id/revisions` | signed in (role-filtered) | revision history |
| GET | `/emergencies/:id/recommendation` | admin | stored + live recommendation with reasons |
| GET | `/emergencies/:id/suggestions` | admin | advisory team/volunteer suggestions (skills, availability, workload) |
| POST | `/emergencies/:id/status` | volunteer, team_leader, admin | `{to: "acknowledged"|"in_progress", note?}`; transitions are validated |
| POST | `/emergencies/:id/priority` | admin | `{level, overrideReason?}`; reason **required** when `level` differs from the recommendation |
| PUT | `/emergencies/:id/requirements` | admin | `{requiredVolunteers, requiredSkills}` |
| POST | `/emergencies/:id/sms-prepared` | citizen | records that the user opened the SMS fallback (not that it was sent) |
| GET | `/emergencies/duplicates/pairs` | admin | possible duplicate pairs (`status=pending|related|confirmed_duplicate|not_duplicate|all`) |
| POST | `/emergencies/:id/duplicates` | admin | `{otherId, decision, note?}`; **never deletes or merges** |

Status flow: `pending → acknowledged → assigned → in_progress → completion_submitted → admin_verification → resolved` (a rejected completion returns to `in_progress`). Only an admin decision resolves an emergency.

### Teams, assignments, completion
| Method | Path | Who | Notes |
|---|---|---|---|
| GET/POST | `/teams` | responders / admin | admin creates teams; leaders and volunteers only see their own team |
| GET | `/teams/:id` | responders | |
| PATCH | `/teams/:id` | admin | name, leader, skills, capacity, availability, active |
| POST | `/teams/:id/members` | admin | `{userIds}`; a volunteer can belong to one team |
| DELETE | `/teams/:id/members/:userId` | admin | leader cannot be removed |
| PUT | `/teams/:id/location` | team_leader | share last known position |
| GET | `/volunteers` | admin | volunteer directory with teams and workload |
| GET | `/assignments` | responders | own active assignments (admin: all) |
| POST | `/assignments` | admin | `{emergencyId, teamId?, volunteerIds?, instructions?}`; refused until priority is confirmed and the emergency acknowledged. Response meta includes the staffing gap |
| POST | `/assignments/:id/reassign` | admin | `{teamId?, volunteerIds?, reason}`; reason mandatory, old assignment kept as history |
| POST | `/assignments/:id/progress` | volunteer, team_leader | `{note, percent?}`; only the leader may set `percent` |
| GET/POST | `/completion-reports` | responders | POST (volunteer, team_leader): `kind: completion|assistance` (+evidence). Only team leaders may file `completion` |
| GET | `/completion-reports/:id` | owner, admin | |
| POST | `/completion-reports/:id/review` | admin | starts verification (`admin_verification`) |
| POST | `/completion-reports/:id/decision` | admin | `{approve, reason?}`; reason required on reject; approve ⇒ `resolved` |

### Shelters
| Method | Path | Who | Notes |
|---|---|---|---|
| GET | `/shelters` | signed in | `availableOnly`, `status`, `mine` (coordinator) |
| GET | `/shelters/:id` | signed in | |
| POST | `/shelters` | admin | |
| PATCH | `/shelters/:id` | admin, coordinator (own) | capacity cannot go below occupancy |
| POST | `/shelters/:id/occupancy` | admin, coordinator (own) | `{occupancy}` or `{delta}`; atomic, never below 0 or above capacity (`OCCUPANCY_EXCEEDS_CAPACITY`) |
| POST | `/shelters/:id/referrals` | admin | `{people, emergencyId?, note?}`; refused when the shelter lacks free places |
| GET | `/shelters/:id/referrals` | admin, coordinator | |
| POST | `/shelters/:id/referrals/:referralId/admit` | admin, coordinator | arrival confirmation increases occupancy (capacity-checked) |

### Food
| Method | Path | Who | Notes |
|---|---|---|---|
| GET/POST | `/food/providers` | signed in / admin, food_provider | |
| GET | `/food/providers/me` | food_provider | |
| PATCH | `/food/providers/:id` | admin, owner | |
| GET/POST | `/food/supplies` | signed in (providers: own) / admin, food_provider | `quantityTotal`, `quantityAvailable` maintained by the server |
| PATCH | `/food/supplies/:id` | admin, owner | total cannot drop below what is allocated |
| POST | `/food/requests` | citizen, shelter_coordinator, responders, admin | `{emergencyId? | community, quantityRequested, unit, deliveryAddress?}` |
| GET | `/food/allocations` | signed in (scoped) | |
| POST | `/food/allocations/:id/approve` | admin | `{supplyId, quantity}`; atomic reservation, `FOOD_OVER_ALLOCATION` when stock is insufficient |
| POST | `/food/allocations/:id/reject` | admin | `{note}` |
| POST | `/food/allocations/:id/status` | admin, owning provider | `dispatched`, `delivered` (`quantitySupplied` ≤ approved), `cancelled` (requester may cancel while still requested; admin/provider while requested, approved or dispatched) |

### Roads
| Method | Path | Who | Notes |
|---|---|---|---|
| GET | `/roads` | signed in | `status`, `verification`; non-admins never see rejected reports. Every item carries `verified` – clients must show unverified reports as unverified |
| POST | `/roads` | citizen, responders, admin | blockage report (+1 photo); starts `unverified` |
| GET | `/roads/:id` | signed in | includes `clearanceHistory` |
| POST | `/roads/:id/verify` | admin | `{verify, note?}` |
| POST | `/roads/:id/clearance` | volunteer, team_leader, admin | `{note}` (+photo). A **claim only**: the road stays blocked until an admin accepts it |
| GET | `/roads/clearances/pending` | admin | |
| POST | `/roads/clearances/:reportId/decision` | admin | `{approve, reason?}` |

### Escalation, notifications, map, admin
| Method | Path | Who | Notes |
|---|---|---|---|
| GET | `/escalations` | admin | log |
| GET | `/escalations/monitor` | admin | unacknowledged SOS with live waiting time |
| POST | `/escalations/run` | admin | run one scheduler pass now |
| POST | `/escalations/:id/acknowledge` · `/resolve` | admin | |
| GET | `/notifications` | signed in | own only; `unread=true` |
| POST | `/notifications/read-all` · `/:id/read` | signed in | |
| GET | `/map` | signed in | `emergencies, shelters, food, roads, teams` – **role-scoped** (citizens: no personal data, no other people's emergencies; responders: assigned emergencies; admins: everything) |
| GET | `/admin/stats` | admin | dashboard counters |
| GET/PUT | `/admin/settings` | admin | ack deadline, max level, SMS number, duplicate rules, priority thresholds |
| GET | `/admin/audit` | admin | `action`, `entityType` filters |
| GET/POST/PATCH | `/users`, `/users/:id` | admin | list/create/update role & status |
| POST | `/sms/inbound` | gateway | returns 501 unless `SMS_INBOUND_SECRET` is configured; then needs header `x-sms-secret` |

## Real-time (Socket.IO)

Connect to the server origin with `auth: { token }`. Rooms: `user:<id>`, `role:<role>`, `team:<id>`. Events carry minimal payloads (ids only); clients re-fetch through the REST API so authorisation always applies.
Events: `emergency:created`, `sos:created`, `sos:updated`, `emergency:updated`, `emergency:status`, `priority:confirmed`, `assignment:changed`, `team:changed`, `completion:submitted`, `completion:verified`, `shelter:updated`, `food:updated`, `road:updated`, `escalation:triggered`, `escalation:updated`, `notification:new`, `map:refresh`.

## Priority rules (recommendation only)

Score = SOS +40, danger to life +30, severity (low 0 / medium 7 / high 14 / severe 20), people-affected tiers (3+ → 6, 10+ → 12, 50+ → 20), vulnerable groups, waiting time without acknowledgement, assistance already in progress. Thresholds (critical/high/medium) are configurable in Settings. The result is stored as `recommendedPriority` with every contributing rule; `finalPriority` exists only after an admin confirms or overrides. Until then the effective priority is flagged `confirmed: false`.

## SOS escalation

A scheduler in the API process checks pending SOS every `ESCALATION_CHECK_INTERVAL_SECONDS`. Level *n* is raised once when waiting time ≥ deadline × 2^(n−1), up to `maxEscalationLevel`. A unique (emergency, level) record makes it safe across restarts and multiple instances. Acknowledging the SOS stops further levels.
