# Meridian Helpdesk

A small internal support-desk application. Organisations raise tickets, agents claim
and answer them, everyone comments.

This repository is the starting point for the Bilions Full Stack Developer internship
exercise. It runs. Read the brief for what to do with it.

---

## Submission (read these)

| Deliverable | File |
| ----------- | ---- |
| Part 1 — ranked code review + which five I fixed | [`REVIEW.md`](REVIEW.md) |
| Part 2 — decision notes | [`DECISIONS.md`](DECISIONS.md) |
| AI log | [`AI-LOG.md`](AI-LOG.md) |

The **five Part 1 fixes** are separate commits prefixed `fix(...)`, all landed
before the Part 2 work (prefixed `feat(part2: ...)`), so they are easy to review
in isolation. Run the server tests with `cd server && npm test`.

---

## Stack

| Layer    | Technology                                            |
| -------- | ----------------------------------------------------- |
| Client   | React 18, Vite, React Router, Redux Toolkit           |
| API      | Node 18+, Express 4, JSON Web Tokens                  |
| Database | MySQL 8                                               |

## Running it

You need Node 18 or newer, and either Docker or a local MySQL 8.

### 1. Database

```bash
docker compose up -d          # starts MySQL 8 on port 3306
```

Not using Docker? Create a database called `helpdesk` and a user that can reach it,
then edit `server/.env` to match. The compose file sets the server timezone to
`+05:30`; match that if you want the same behaviour we see.

### 2. API

```bash
cd server
npm install
npm run db:reset              # creates the schema and loads seed data
npm run dev                   # http://localhost:4000
```

`npm run db:reset` is safe to re-run at any time. It drops everything and rebuilds
from `db/schema.sql`, so you can always get back to a known state.

### 3. Client

```bash
cd client
npm install
npm run dev                   # http://localhost:5173
```

Vite proxies `/api` to the server on port 4000.

## Signing in

Every seeded account uses the password `Password123!`.

| Email                    | Role      | Organisation      |
| ------------------------ | --------- | ----------------- |
| `admin@northwind.test`   | admin     | Northwind Trading |
| `agent1@northwind.test`  | agent     | Northwind Trading |
| `agent2@northwind.test`  | agent     | Northwind Trading |
| `user1@northwind.test`   | requester | Northwind Trading |
| `admin@cobalt.test`      | admin     | Cobalt Logistics  |
| `agent1@cobalt.test`     | agent     | Cobalt Logistics  |
| `user1@cobalt.test`      | requester | Cobalt Logistics  |

There are two organisations in the seed data. They are separate customers and must
not be able to see each other's tickets.

## Roles

| Role        | Can                                                            |
| ----------- | -------------------------------------------------------------- |
| `requester` | Raise tickets, comment on their own organisation's tickets      |
| `agent`     | Everything a requester can, plus claim and answer any ticket    |
| `admin`     | Everything an agent can, plus delete tickets                    |

## API

| Method | Path                             | Notes                          |
| ------ | -------------------------------- | ------------------------------ |
| POST   | `/api/auth/login`                | Returns a JWT                  |
| POST   | `/api/auth/invite/accept`        | New joiner sets their password |
| GET    | `/api/tickets`                   | Paginated, 20 per page; `?breached=true` filters to breached |
| GET    | `/api/tickets/:id`               | Ticket plus its comments       |
| POST   | `/api/tickets`                   | Raise a ticket                 |
| PATCH  | `/api/tickets/:id/assign`        | Claim a ticket                 |
| DELETE | `/api/tickets/:id`               | Admin only                     |
| POST   | `/api/tickets/:id/comments`      | Add a comment                  |

## SLA breach tracking (Part 2)

Every ticket from the list and detail endpoints carries an `sla` object:

```json
"sla": { "breached": true, "responded": false, "targetHours": 24, "elapsedHours": 55 }
```

A ticket is **breached** when the time from creation to its first non-internal
agent/admin reply (or to now, if unanswered) exceeds the priority target in
`server/src/config.js` (`slaTargets`: P1 4h · P2 24h · P3 72h). The list shows a
red badge on breached rows and a "Breached only" filter; the detail page shows
the badge next to the subject. See [`DECISIONS.md`](DECISIONS.md) for the choices
behind the ambiguous parts of the spec.

## Layout

```
db/schema.sql                     tables
server/src/config.js              configuration and SLA targets
server/src/db/pool.js             mysql2 connection pool
server/src/middleware/auth.js     requireAuth, requireRole
server/src/routes/                auth, tickets, comments
server/src/services/              ticketService — all ticket SQL
server/scripts/reset-db.js        schema + deterministic seed
client/src/app/                   store, api helper
client/src/features/tickets/      TicketList, TicketDetail
client/src/features/auth/         Login
```

## Known state

This codebase was written quickly by a previous intern and merged without review.
It works well enough to demo. Nobody has been through it properly since.
