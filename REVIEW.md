# Part 1 — Code review

Reviewed as a pull request I was asked to sign off. Line numbers refer to the
**unmodified starter** (commit `chore: import unmodified starter`).

Findings are ranked by real risk to *this* application, most important first.
I **fixed the five highest-ranked** — with one deliberate exception noted below.

## Ranking at a glance

| # | Finding | File | Severity | Fixed? |
|---|---------|------|----------|--------|
| 1 | `DELETE /tickets/:id` has no admin check and no org scope | `routes/tickets.js:75` | Critical | [x] Fixed |
| 2 | `invite/accept` stores password unhashed & is unauthenticated → account takeover | `routes/auth.js:42` | Critical | [ ] Documented (needs refactor) |
| 3 | `GET /tickets/:id` leaks tickets across organisations (IDOR) | `routes/tickets.js:31` | Critical | [x] Fixed |
| 4 | Stored XSS: comment body rendered as raw HTML | `TicketDetail.jsx:65` | High | [x] Fixed |
| 5 | SQL injection via `sortBy` / `order` | `services/ticketService.js:38` | High | [x] Fixed |
| 6 | Pagination offset off-by-one hides the newest 20 tickets | `services/ticketService.js:29` | High | [x] Fixed (in place of #2) |
| 7 | Secrets committed; weak JWT secret fallback | `server/.env`, `config.js:16` | High | [ ] Documented |
| 8 | Internal comments shown to requesters | `services/ticketService.js:69`, `TicketDetail.jsx` | Medium‑High | [ ] Documented |
| 9 | List filters/sort never trigger a refetch | `TicketList.jsx:31` | Medium | [ ] Documented |
| 10 | `PATCH /:id/assign`: no org scope, no role check, non‑atomic | `routes/tickets.js:62`, `services/ticketService.js:89` | Medium | [ ] Documented |
| 11 | Timezone inconsistency in stored timestamps | `reset-db.js`, `comments.js:19`, schema | Medium | [ ] Documented |
| 12 | N+1 queries for comment counts | `services/ticketService.js:44` | Low‑Medium | [ ] Documented |
| — | Minor notes (index keys, CORS, rate‑limit, input validation) | various | Low | [ ] Documented |

**Which five I fixed:** #1, #3, #4, #5, #6. See "A note on the fix set" after the findings.

Findings #1, #3 and #10 are the same underlying problem — routes trust the
authenticated user without checking *which org* they belong to or *what role*
they hold. I list them separately because they have different blast radii and
different fixes, but they should be read together.

---

## 1. `DELETE /tickets/:id` — any user, any org can delete any ticket [x] FIXED

- **Where:** `server/src/routes/tickets.js:75`
- **What is wrong:** The route is guarded by `requireAuth` only — no
  `requireRole('admin')` — and `getTicketById(Number(req.params.id))` is called
  without an org filter.
- **Why it matters here:** The README says only admins delete, and orgs "must
  not be able to see each other's tickets." Both promises are broken on one
  line. A **Cobalt requester** — the lowest-privilege account — can delete every
  **Northwind** ticket by iterating ids. The client only hides the Delete button
  from non-admins (`TicketList.jsx:88`), so the UI looks safe while the endpoint
  is wide open. Destructive, cross-tenant, and needs nothing but a normal login.
- **How to fix:** Add `requireRole('admin')` and scope the lookup to
  `req.user.orgId` so a foreign ticket returns 404.
- **Severity:** Critical.

## 2. `POST /api/auth/invite/accept` — unhashed password + unauthenticated [ ] DOCUMENTED

- **Where:** `server/src/routes/auth.js:42-54` (the write is line 49).
- **What is wrong:** The endpoint takes `{ userId, password }` with **no
  authentication**, and writes `password` straight into `password_hash` with no
  hashing: `UPDATE users SET password_hash = ? WHERE id = ?`.
- **Why it matters here:** Two separate failures. (a) A genuine new joiner who
  accepts an invite has their password stored in plaintext and can then never
  log in, because `login` does `bcrypt.compare(password, hash)` against a value
  that isn't a bcrypt hash — the invite flow is broken. (b) Because `userId` is
  a small integer and there is no auth, anyone can overwrite **any** user's
  `password_hash`. Sending a plaintext value bricks that account (silent DoS);
  sending a self-computed bcrypt hash (trivial to generate) is a full
  **account takeover of any user in any org, including an admin**,
  unauthenticated. This is the finding that **cannot be seen from the UI** —
  there is no client screen for it; it is only visible by reading.
- **How to fix:** The password must be bcrypt-hashed. But hashing alone does
  **not** close the hole — the endpoint still lets an unauthenticated caller set
  a known password on any account. The correct fix needs an **unguessable,
  single-use invite token** issued at invite time (a new column or `invites`
  table) and verified here instead of trusting a raw `userId`. That is a schema
  change / larger refactor, so per the brief I have **documented it and fixed
  the next one down (#6)** rather than ship a half-fix that looks secure but
  isn't.
- **Severity:** Critical. Arguably co-#1: it is unauthenticated where #1 needs a
  login. I placed it second only because weaponising it into takeover needs a
  crafted request, whereas #1 is a one-liner any logged-in user can fire.

## 3. `GET /tickets/:id` — cross-org ticket read (IDOR) [x] FIXED

- **Where:** `server/src/routes/tickets.js:31-41` (lookup at line 33).
- **What is wrong:** `getTicketById(Number(req.params.id))` runs with no org
  filter and the route never compares `ticket.org_id` to `req.user.orgId`.
- **Why it matters here:** Any authenticated user can read **any** ticket in
  **any** organisation by id — subject, body, the requester's email, and the
  entire comment thread including internal notes (see #8). Two competitors on the
  same instance can read each other's support tickets. Note the sibling route
  `POST /:ticketId/comments` (`comments.js:16`) *does* check the org — so this is
  an inconsistency someone already knew to guard elsewhere.
- **How to fix:** Pass `req.user.orgId` into the lookup so foreign tickets 404.
- **Severity:** Critical. Related to #1 (same missing org scope) and #10.

## 4. Stored XSS — comment body rendered as raw HTML [x] FIXED

- **Where:** `client/src/features/tickets/TicketDetail.jsx:65`
- **What is wrong:** `<div dangerouslySetInnerHTML={{ __html: c.body }} />`
  renders attacker-controlled comment text as HTML.
- **Why it matters here:** Any requester or agent can post a comment containing
  `<img src=x onerror=...>`. It executes in the browser of **every colleague who
  opens that ticket**. The JWT is kept in `localStorage` (`store.js`,
  key `helpdesk.session`), so the script can read and exfiltrate it — a
  requester can steal an agent's or admin's token and escalate. Stored XSS with
  a token-theft payoff.
- **How to fix:** Render the body as a text node (`{c.body}`); there is no
  reason comments are HTML. (Deeper mitigation, out of scope: move the JWT out of
  `localStorage`.)
- **Severity:** High.

## 5. SQL injection via `sortBy` / `order` [x] FIXED

- **Where:** `server/src/services/ticketService.js:38` —
  `ORDER BY t.${sortBy} ${order}`.
- **What is wrong:** `sortBy` and `order` come straight from `req.query` and are
  interpolated into the SQL string. `ORDER BY` values cannot be parameterised, so
  these are a live injection point.
- **Why it matters here:** Even though `pool.query` disallows stacked statements,
  a crafted `?sortBy=(CASE WHEN … THEN … END)` / `?order=` turns the list into a
  boolean- or time-based extraction primitive that can read data the WHERE clause
  was meant to keep out (including other orgs' rows), or simply error the query.
  The normal UI only sends four fixed values, so it is invisible in normal use —
  another read-only-to-find issue.
- **How to fix:** Whitelist `sortBy` against real columns and coerce `order` to
  `ASC`/`DESC`. The UI's four options map unchanged.
- **Severity:** High.

## 6. Pagination offset is off-by-one — page 1 hides the newest tickets [x] FIXED

- **Where:** `server/src/services/ticketService.js:29` — `offset = page * PAGE_SIZE`.
- **What is wrong:** Pages are 1-based, so with the default `page = 1` the offset
  is 20, not 0.
- **Why it matters here:** The **20 newest tickets are never shown** on the
  default view, and the last reachable page (`Math.ceil(total/20)` on the client)
  is blank. Every user hits this on every visit; it silently drops the rows they
  most want to see. This is the most impactful *functional* bug in the codebase.
- **How to fix:** `offset = (page - 1) * PAGE_SIZE`, and clamp `page` to ≥ 1.
- **Severity:** High.

## 7. Secrets committed to the repo; weak JWT fallback [ ] DOCUMENTED

- **Where:** `server/.env` (real `JWT_SECRET` and DB password), `config.js:16`
  (`|| 'dev-secret-change-me'`), `docker-compose.yml:13`; `.gitignore` does not
  list `.env`.
- **What is wrong:** A live JWT signing secret and DB password ship in the repo,
  and the app silently falls back to a publicly known secret if the env var is
  missing.
- **Why it matters here:** Anyone with the repo can forge a valid token for any
  user/org/role and bypass **every** auth control above — this underpins all of
  #1–#5. If the app is ever run without `.env`, the fallback secret is equally
  forgeable.
- **How to fix:** Rotate the secret, load it from a secret manager, add `.env` to
  `.gitignore`, and make `config.js` throw on boot if `JWT_SECRET` is unset
  instead of falling back.
- **Why not in my five:** The real remedy is operational (rotate + secret store),
  and I can't simply delete the committed `.env` — the app needs it to reach the
  seeded DB, and the brief requires it to run out of the box. Flagged as a
  deploy-blocker rather than a code one-liner. *(I could not fully verify the
  "run without .env" fallback path without breaking the running instance, so I am
  reasoning about it from the code.)*
- **Severity:** High.

## 8. Internal comments are shown to requesters [ ] DOCUMENTED

- **Where:** `services/ticketService.js:69-77` (`listComments` returns every
  comment) and `TicketDetail.jsx` (renders them all; the CSS even styles
  `.internal` differently).
- **What is wrong:** `is_internal = 1` comments are meant to be agent-only, but
  the detail endpoint returns them to everyone on the org, including the
  requester who raised the ticket.
- **Why it matters here:** Support's private triage notes ("escalating", "same
  root cause as…") are visible to the customer. The data model and the CSS both
  imply these should be hidden; only the query forgot. Reachable from the UI: log
  in as `user1@…` and open a ticket that has an internal note.
- **How to fix:** Filter internal comments unless the viewer is an agent/admin in
  the ticket's org (do it in `listComments`, driven by the caller's role).
- **Severity:** Medium-High (confidentiality). Related to #3 (same detail
  response).

## 9. List filters and sort never trigger a refetch [ ] DOCUMENTED

- **Where:** `client/src/features/tickets/TicketList.jsx:31` — the effect's
  dependency array is `[page]`.
- **What is wrong:** Changing search, status, priority, or sort updates state but
  does not re-run the fetch; the new values are only sent the next time `page`
  changes.
- **Why it matters here:** The filter bar looks broken — typing a search or
  picking a status appears to do nothing until you click Next/Previous. A core
  advertised feature is effectively dead.
- **How to fix:** Include the filter values in the dependency array (and reset to
  page 1 when they change). **Note:** Part 2's "Breached only" control needed a
  working refetch, so I wired *that* control correctly; I deliberately left the
  pre-existing controls untouched to respect the five-fix limit — see DECISIONS.md.
- **Severity:** Medium.

## 10. `PATCH /:id/assign` — no org scope, no role check, non-atomic [ ] DOCUMENTED

- **Where:** `routes/tickets.js:62-73`; `services/ticketService.js:89-102`.
- **What is wrong:** Three things. (a) No org scope — a user can claim a ticket in
  another org. (b) No role check — the README says only agents/admins claim, but
  `requireAuth` alone lets a requester self-assign (the client even shows them the
  "Claim this ticket" button). (c) The claim is a read-then-write
  (`getTicketById` then `UPDATE`), so two agents claiming at once can both pass
  the `assignee_id` check and the second silently wins.
- **Why it matters here:** Cross-org tampering (flip another customer's ticket to
  "pending" and assign it) and lost claims under concurrency. Lower blast radius
  than deleting or reading, which is why it sits here and not with #1/#3.
- **How to fix:** Scope to org, add `requireRole('agent','admin')`, and make the
  claim atomic: `UPDATE … SET assignee_id = ? WHERE id = ? AND assignee_id IS
  NULL` and check `affectedRows`.
- **Severity:** Medium. Same authorization family as #1 and #3.

## 11. Timezone inconsistency in stored timestamps [ ] DOCUMENTED

- **Where:** `scripts/reset-db.js` (writes `new Date(...).toISOString()` = UTC),
  `routes/comments.js:19` (same), vs. schema `DEFAULT CURRENT_TIMESTAMP` and
  `NOW()` which run at the container's `+05:30`; `docker-compose.yml:8`.
- **What is wrong:** Some datetimes are stored as UTC wall-clock and others at
  `+05:30`, in the same columns.
- **Why it matters here:** Any elapsed-time calculation is off by 5.5h depending
  on which path wrote the row — including **SLA (Part 2)**. A ticket created
  through the API (`created_at` via DB default, `+05:30`) and one from the seed
  (UTC) are not on the same clock. It also makes `toLocaleString()` on the client
  ambiguous.
- **How to fix:** Pick one zone (UTC) and enforce it everywhere: set the mysql2
  connection `timezone`, and stamp `created_at` explicitly in `createTicket` as
  the seed and comments already do.
- **Why not in my five / how it shaped Part 2:** It's latent and needs a
  consistent-timestamps pass. For Part 2 I sidestepped it by measuring elapsed
  time in SQL with `UTC_TIMESTAMP()` against the UTC-naive seed timestamps — see
  DECISIONS.md. I'm flagging it because it's the kind of bug that silently
  corrupts a metric.
- **Severity:** Medium (latent, environment-dependent).

## 12. N+1 queries for comment counts [ ] DOCUMENTED

- **Where:** `services/ticketService.js:44-47` — a `COUNT(*)` per row inside the
  list loop.
- **What is wrong:** 20 extra round-trips per list page, plus the total query.
- **Why it matters here:** Fine at demo scale, but it's the pattern that makes the
  list slow first under load. A single `LEFT JOIN (… GROUP BY ticket_id)` returns
  the counts in the main query.
- **Severity:** Low-Medium (performance). Not in scope; volume isn't the metric.

## Minor notes (not individually ranked)

- `TicketList.jsx:79` uses the array index as the React `key`; `key={t.id}` is
  safer once rows can be filtered/deleted.
- `index.js:9` — `cors()` allows all origins. Low risk here (JWT is a header, not
  a cookie) but worth pinning to the client origin.
- No rate limiting / lockout on `POST /auth/login`; also `bcrypt.compare` only
  runs when the user exists, a small user-enumeration timing signal.
- `POST /tickets` doesn't validate `priority` against the enum, and
  `POST /comments` trusts `isInternal` from the body (a requester could post an
  "internal" comment).

---

## A note on the fix set (why these five)

The brief asks for the five *highest-ranked* fixes. My top five by risk are
#1, #2, #3, #4, #5. **#2 (invite/accept) cannot be fixed correctly without a
larger refactor** — an unguessable single-use invite token backed by a schema
change — and a hashing-only patch would look secure while still allowing
unauthenticated takeover. Following the brief's "fix the next one down"
guidance, I documented #2 and implemented **#6 (pagination)** instead. So the
five shipped fixes are **#1, #3, #4, #5, #6**, each in its own commit prefixed
`fix(...)`, all before the Part 2 `feat(part2: ...)` commits.

I checked each fix for collateral damage against the running seed: page 1 now
returns the newest tickets; an admin can still delete their own org's tickets
(204) while a requester gets 403 and a cross-org admin gets 404; cross-org reads
404; a malicious `sortBy` returns normal results instead of an error; comments
still render (as text).

Where I'm less sure: the exact ordering of #5 (SQLi, needs a crafted request)
versus #6 (pagination, hits every user every day) is a genuine judgment call —
a reviewer who weights "impact on normal users" over "attacker-only" could swap
them. I ranked security above the functional bug but wouldn't argue hard if you
flipped that pair.
