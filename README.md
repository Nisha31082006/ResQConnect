# ResQConnect — Smart Disaster Response and Emergency Coordination Platform

A full-stack, role-based platform for reporting emergencies, coordinating rescue teams, shelters, food and road information, and keeping working when the network does not. English and Tamil throughout.

* **Frontend:** React 18, Vite, TypeScript, Tailwind CSS, React Router, i18next, Leaflet + OpenStreetMap, Socket.IO client, IndexedDB offline queue
* **Backend:** Node.js, Express, TypeScript, MongoDB (Mongoose, GeoJSON + 2dsphere), Zod validation, JWT, Socket.IO, multer uploads
* **Monorepo:** npm workspaces — `server/` and `client/`, one `.env` in the project root

> Demonstration software. It is **not** a certified emergency service; in real emergencies also call your local emergency number. See [Known limitations](#known-limitations).

---

## 1. Features

| # | Feature | Where |
|---|---|---|
| 1 | Emergency report form (type, description, people affected, severity, vulnerable groups, assistance needs, contact, GPS / map pin / place search, time, photos) | Citizen → *Report emergency* |
| 2 | One-screen SOS form | Citizen → *SOS* (also a floating SOS button on mobile) |
| 3 | Rule-based priority **recommendation** with visible reasons; admin must confirm or override (override needs a reason, stored + audit-logged) | Admin → emergency detail |
| 4 | Offline reports in IndexedDB, sent automatically when back online, idempotent (`clientRequestId`), SMS fallback page/card | Citizen forms, `/emergency-sms` |
| 5 | Duplicate **detection** (distance, time, type, text similarity). Never deletes or merges; admin marks related / confirmed duplicate / not duplicate | Admin → *Possible duplicates* |
| 6 | Admin-created teams, **manual** allocation (suggestions are advisory), staffing gap, reassignment with mandatory reason + history | Admin → *Teams*, emergency detail |
| 7 | Completion workflow: Pending → Acknowledged → Assigned → In progress → Completion submitted → Admin verification → Resolved, with timestamped trail; only an admin can resolve | Responder + Admin → *Completion verification* |
| 8 | Food coordination with atomic over-allocation prevention | Food provider, Admin → *Food* |
| 9 | Shelter coordination with capacity validation (also under concurrent updates) and referral → arrival confirmation | Shelter coordinator, Admin → *Shelters* |
| 10 | Road blockage reports, shown as *unverified* until an admin verifies; "cleared" claims need admin verification | *Road blockages* |
| 11 | SOS escalation scheduler (server side, levels, each raised once, stored) | Admin → *SOS escalations* |
| 12 | Live map (Leaflet/OSM) with role-based visibility, filters, legend, real-time refresh | *Live map* |
| 13 | SOS/report **update** with full revision history (before/after) and priority re-evaluation | Citizen → request detail |
| 14 | Tamil / English UI (language switcher, per-user preference, translated errors, validation, notifications) | everywhere |

Also: JWT auth with server-side RBAC on every route, pagination + search, in-app + real-time notifications, rate limiting, security headers, audit log, settings page, seed data, accessible responsive UI (keyboard focus, labels, ARIA, colour + icon status badges), loading/empty/error states.

### Roles
`citizen`, `volunteer`, `team_leader`, `admin`, `food_provider`, `shelter_coordinator`.
Self-registration: citizen (active at once) and volunteer / food provider / shelter coordinator (pending until an admin approves). Team leaders and admins are created or promoted by an admin.

---

## 2. Windows 11 + VS Code setup (PowerShell)

### 2.1 Install prerequisites
1. **Node.js 18.18 or newer (20 LTS recommended)** — https://nodejs.org (the installer adds `node` and `npm` to PATH). Check:
   ```powershell
   node -v
   npm -v
   ```
2. **MongoDB** — choose **one**:
   * **A. Local MongoDB Community Server** — https://www.mongodb.com/try/download/community → install as a Windows Service (default port 27017). Optionally MongoDB Compass to look at the data.
   * **B. MongoDB Atlas (free tier)** — create a cluster, a database user, allow your IP under *Network Access*, and copy the connection string.
3. **VS Code** — https://code.visualstudio.com (optional extensions: ESLint is not required; *Tailwind CSS IntelliSense* is handy).

> If PowerShell blocks npm scripts ("running scripts is disabled"), run once:  
> `Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned`

### 2.2 Get the project
Unzip `ResQConnect.zip`, then:
```powershell
cd path\to\ResQConnect
code .
```
Use the VS Code terminal (**Terminal → New Terminal**, PowerShell).

### 2.3 Configure the environment
```powershell
Copy-Item .env.example .env
```
Edit `.env`:
* `MONGODB_URI` — keep `mongodb://127.0.0.1:27017/resqconnect` for local MongoDB, or paste your Atlas string (replace `<db-user>`/`<db-password>`; URL-encode special characters in the password).
* `JWT_SECRET` — **must** be changed to a long random value:
  ```powershell
  node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
  ```
* `SMS_EMERGENCY_NUMBER` — placeholder `+910000000000`; set your real response number (admins can also change it in *Settings*).
* Everything else has working defaults. `.env` is never committed or zipped.

### 2.4 Install, seed, run
```powershell
npm install
npm run seed      # demo data (wipes the configured database - development only)
npm run dev       # API on :5000 + web app on :5173
```
Open **http://localhost:5173**. The API health check is http://localhost:5000/api/health.

Production-style run (single server serving the built client):
```powershell
npm run build
$env:SERVE_CLIENT="true"; $env:NODE_ENV="production"; npm start
```
(set `SERVE_CLIENT=true` and `NODE_ENV=production` in `.env` instead if you prefer; production refuses the placeholder `JWT_SECRET`, and `npm run seed` refuses to run in production.)

### 2.5 Demo accounts (password for all: `Demo@1234`)
| Role | Email |
|---|---|
| Admin | `admin@resqconnect.test` |
| Citizen | `citizen@resqconnect.test`, `citizen2@resqconnect.test` |
| Team leader | `leader@resqconnect.test`, `leader2@resqconnect.test` |
| Volunteer | `volunteer@resqconnect.test` … `volunteer4@resqconnect.test` |
| Food provider | `food@resqconnect.test` |
| Shelter coordinator | `shelter@resqconnect.test` |

The login page lists them and fills the form on click. Seed data: 2 teams, 3 shelters, a food provider with supplies, 5 emergencies (3 SOS, one deliberately old so escalation is visible), road blockages and a pending food request.

### 2.6 A suggested 5-minute demo
1. Sign in as **citizen** → *SOS* → send. Open *My requests* → detail (priority shows "not yet confirmed").
2. Browser DevTools → *Network → Offline*, send another SOS: it is stored on the device with the SMS fallback card. Go back online: it syncs once (check *My requests*).
3. Sign in as **admin** → *Emergencies* → open the report → **Acknowledge**, read the recommendation reasons, **Confirm** (or override with a reason) → pick a team → **Assign**.
4. Sign in as the **team leader** → *My assignments* → acknowledge, start work, add progress, submit completion.
5. Admin → *Completion verification* → start review → approve (emergency becomes *Resolved*).
6. Switch language (top bar) to **தமிழ்**.

---

## 3. Commands

| Command | What it does |
|---|---|
| `npm run dev` | API (tsx watch) + Vite dev server |
| `npm run seed` | reset DB and load demo data (not in production) |
| `npm run typecheck` | TypeScript check, server and client |
| `npm run build` | compile server to `server/dist`, build client to `client/dist` |
| `npm test` | server tests then client tests |
| `npm run test:server` / `npm run test:client` | one side only |

### Tests
* **Server (Vitest + Supertest + real Socket.IO):** auth, validation, RBAC for all six roles, priority rules, override reasons, idempotent reports, duplicate detection (never deletes), team assignment and reassignment, workflow transitions, food and shelter limits, roads and clearance, escalation levels, SOS revisions, notifications, role-scoped map, Socket.IO room security.
  By default tests start an in-memory MongoDB (`mongodb-memory-server`; the first run downloads a MongoDB binary, so you need internet once). To use a MongoDB you already run:
  ```powershell
  $env:TEST_MONGODB_URI="mongodb://127.0.0.1:27017/resq_test"; npm run test:server
  ```
  (use a throw-away database name - tests wipe it).
* **Client (Vitest + jsdom + fake-indexeddb):** offline queue (storage, ordering, retry with the same request id, rejection handling) and translations (English/Tamil key parity, placeholder parity, every key used in source exists, all enum values translated).

---

## 4. Project structure
```
ResQConnect/
├─ package.json            npm workspaces + root scripts
├─ .env.example            copy to .env (never committed)
├─ docs/API.md             REST + Socket.IO reference
├─ server/
│  ├─ src/
│  │  ├─ config/ models/ validators/ middleware/ routes/ controllers/
│  │  ├─ services/         priority, duplicates, assignment, emergency, escalation, notifications, audit, settings
│  │  ├─ jobs/             escalation scheduler
│  │  ├─ sockets/          authenticated Socket.IO + rooms
│  │  └─ scripts/seed.ts
│  ├─ tests/               Vitest suites
│  └─ uploads/             evidence files (git-ignored)
└─ client/
   ├─ public/              manifest, service worker (app shell only)
   └─ src/
      ├─ pages/            public, citizen, responder, admin, food, shelter, shared
      ├─ components/ context/ hooks/ services/ utils/ layouts/
      ├─ i18n/locales/     en + ta
      └─ __tests__/
```
API documentation: [`docs/API.md`](docs/API.md).

---

## 5. Security notes
* Passwords hashed with bcrypt; JWT checked against the database on each request (suspended users lose access immediately).
* Every endpoint enforces role and ownership on the server (citizens can only read/update their own reports, responders only assigned work, etc.). Socket.IO connections are authenticated and joined only to rooms they may see.
* Zod validation on all input; helmet; CORS allow-list; rate limits for API, auth and report creation; uploads limited to JPG/PNG/WebP/PDF ≤ 5 MB with content (magic-byte) checks, random file names, served only to signed-in users.
* Audit log for sensitive actions. `.env` is git-ignored and excluded from the ZIP.

---

## 6. Known limitations
These are deliberate, honest boundaries of this version:

1. **SMS is a fallback, not a gateway.** The app prepares a message and opens the phone's SMS app (`sms:` link). It cannot send or confirm delivery, and the UI never says "sent". Receiving SMS into the system needs an SMS gateway (Twilio, Textlocal…) posting to `/api/sms/inbound`; that endpoint exists but returns 501 until `SMS_INBOUND_SECRET` is set, and no gateway is bundled.
2. **Offline photos are not queued.** Offline reports store text and location only; attachments chosen while offline are dropped (the UI warns). The offline queue lives in one browser profile on one device.
3. **Offline map tiles are not cached**; the map needs internet. Forms still work with manual coordinates when tiles/GPS/search fail. Place search uses the public Nominatim service (rate-limited; for production use your own geocoder).
4. **Escalation scheduler runs inside the API process.** If the server is stopped, nothing escalates; on restart it catches up on overdue SOS (each level still raised once). Notifications are in-app/real-time only - no push, e-mail or SMS to responders.
5. **Rule-based priority and duplicate detection are heuristics** (weights editable in code/settings), not machine learning; text similarity is simple token overlap, best for English/transliterated text.
6. **Single-instance real-time:** Socket.IO uses the in-memory adapter. Scaling to several API instances needs a Redis adapter.
7. **Testing environment caveat:** the automated tests were executed in a sandbox where the MongoDB binary download is blocked, so they were run against FerretDB (a MongoDB-compatible server) via `TEST_MONGODB_URI`. 3 tests that require true MongoDB semantics (partial unique index races and atomic `findOneAndUpdate` under concurrency: idempotency, shelter and food concurrency) are skipped automatically on such a backend. **On a real MongoDB they run** - please run `npm run test:server` on your machine. The admin dashboard's aggregate "free shelter places" figure was also wrong under FerretDB (an aggregation difference); that figure is unverified on real MongoDB.
8. No payment, identity verification, or production-grade moderation. The UI language of user-written content is not translated.
9. Accessibility was designed in (labels, focus, contrast, non-colour cues) but not audited with a screen-reader/WCAG tool.

---

## 7. Troubleshooting
| Problem | Fix |
|---|---|
| `JWT_SECRET is missing or too short` | You did not create `.env` or did not set `JWT_SECRET` (≥ 32 chars). |
| `MongooseServerSelectionError` | MongoDB is not running (start the *MongoDB* Windows service) or the Atlas IP allow-list / password is wrong. |
| Port 5000 or 5173 already in use | Change `PORT` in `.env` (the Vite proxy follows it) or stop the other program. |
| `npm run seed` says refusing in production | Remove `NODE_ENV=production` from `.env`. |
| Tests hang on first run | `mongodb-memory-server` is downloading MongoDB; wait or set `TEST_MONGODB_URI`. |
| Map is grey | No internet for OpenStreetMap tiles; markers and forms still work. |
| Browser location is denied | Allow location for the site, or tap the map / type coordinates. |
