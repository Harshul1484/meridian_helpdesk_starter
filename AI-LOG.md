# AI log

**Assistant used:** Claude Code (Claude Opus). I used it throughout — to read
the codebase, draft the Part 1 findings, write the five fixes and the Part 2
feature, and to help word these documents. I ran everything myself against a
local Docker MySQL + the seeded data and checked the output rather than trusting
it. The places it was wrong or would have misled me, and how I caught them:

**1. The SLA timezone — the one that would have shipped a wrong metric.**
The obvious approach the model reached for first was to compute elapsed time
with SQL `NOW()` (or a JS `Date.now()` against the DB timestamps). That is
subtly wrong here: the seed and the comments route write **UTC-naive**
timestamps, but the Docker MySQL session runs at `+05:30`, so `NOW()` is 5.5
hours ahead of the stored values. I caught it by actually querying both —
`NOW()` = `2026-09-12 01:53` vs `UTC_TIMESTAMP()` = `2026-09-11 20:23` — and
seeing that `NOW()` inflated every ticket's age by 5.5h, which flips borderline
P2 tickets to "breached". I switched to `UTC_TIMESTAMP()` and re-checked the
breach counts. This also became Part 1 Finding #11.

**2. "invite/accept just breaks login" — an incomplete first take.**
The first characterisation of the invite bug was that storing the password
unhashed only prevents the user from logging in (a functional bug). On a second
read that undersells it: because the endpoint is unauthenticated and stores
whatever string you send, an attacker can send a **self-computed bcrypt hash**
and take over any account. I corrected the finding's severity from "broken
feature" to "unauthenticated account takeover" — and it changed my decision to
document rather than half-fix it (hashing alone doesn't close it).

**3. Over-eager fixing.** The assistant was happy to keep fixing issues past the
top five (the assign race, the internal-comment leak, the filter refetch bug
were all easy). The brief explicitly tests restraint — "a candidate who quietly
fixes fifteen…". I held it to exactly five and documented the rest, and
specifically kept the Part 2 refetch change scoped to the new control so it
didn't silently absorb Finding #9.

**4. Mechanical slips I had to correct.** A couple of code edits were proposed
with the wrong indentation and didn't apply cleanly the first time (the DELETE
route edit), which the tooling rejected — corrected on the retry. Minor, but the
kind of thing that's worth not rubber-stamping.

**What I verified rather than assumed:** login for both orgs; page 1 returns the
newest tickets after the offset fix; cross-org read → 404; requester delete →
403 and cross-org admin delete → 404 while an in-org admin delete still returns
204 (no collateral damage); a malicious `sortBy` returns normal results instead
of erroring; `?breached=true` returns only breached rows and the counts line up
with a hand-written SQL aggregate; the SLA unit tests pass (`npm test`); and the
client builds. Every claim in these documents I checked against the running app
or a direct SQL query.

"No errors" would not be a credible log — the timezone one in particular would
have produced a plausible-looking but wrong feature if I hadn't measured it.
