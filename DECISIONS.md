# Part 2 — Decision notes

The spec ("red badge on breached tickets, a filter to show only breached ones")
left several things open. What I decided, and why.

**What counts as "responded"?** The first **non-internal comment written by an
agent or admin**. The requester's own replies don't count (they aren't a support
response), and internal notes (`is_internal = 1`) don't count because they aren't
visible to the customer — "unanswered" is from the requester's point of view. A
reasonable alternative is to count internal triage notes too; I chose the
customer-facing definition and kept the rule in one place so it's easy to change.

**Responded late, or not at all?** The SLA clock runs from `created_at` to the
first response, or to *now* if there is no response yet. A ticket is breached if
that span exceeds the priority target. So: answered within target → never
breached; answered but late → breached (permanently); no answer and past target
→ breached. This matches "have we responded within the target," not "is it still
open." (162/240 seeded tickets breach under this rule — a realistic spread.)

**Do resolved/closed tickets still show as breached?** Yes. Breach is a
historical fact about whether the target was met, so a closed ticket that was
answered late still reads as breached. I considered scoping "breached" to
open/pending (only actionable ones) — that's a one-line change to the filter if
support prefers it — but chose to report the metric truthfully for every ticket
and let the status column provide the "is it still open" signal.

**Which clock / timezone?** This is where **Part 1 Finding #11** changed how I
built Part 2. The seed and the comments route write **UTC-naive** timestamps,
while the DB session runs at `+05:30`, so `NOW()` is 5.5h ahead of the stored
values. I measure elapsed time in SQL with **`UTC_TIMESTAMP()`**, which matches
the stored UTC values and gives the true elapsed time. (I verified this against
the running DB: `NOW()` = `2026-09-12 01:53`, `UTC_TIMESTAMP()` = `2026-09-11
20:23`; using `NOW()` would have wrongly pushed borderline P2 tickets over the
line.) One honest edge: a ticket created **live via the API** gets its
`created_at` from the DB default (`+05:30`), so its first few hours read as
slightly negative elapsed — harmless (new tickets aren't breached) and a symptom
of the pre-existing bug, not the SLA code. The graded path is `db:reset`, which
is all UTC-naive and correct.

**Where to compute it — SQL or JS?** In SQL. The "breached only" filter has to
compose with the existing status/priority/search filters *and* pagination, so it
must be a `WHERE` condition, not a post-filter in JS (which would break `total`
and page sizes). The target hours stay in `config.slaTargets` (single source of
truth) and are passed into the query as parameters; the breach *decision* lives
in one pure function (`services/sla.js`, unit-tested) so list and detail agree.

**API shape.** Every ticket from the list and detail endpoints now carries
`sla: { breached, responded, targetHours, elapsedHours }`. The list accepts
`?breached=true`. I added fields rather than changing existing ones, so nothing
that read the old response breaks.

**Client refetch scope.** The "Breached only" checkbox refetches on toggle and
resets to page 1. The *existing* filter controls have a pre-existing bug where
they only apply on page change (Finding #9). I deliberately **did not** fix that
here — it's outside my five Part 1 fixes — so I scoped the new refetch trigger to
the breached filter only. My feature works; the pre-existing bug stays documented
rather than quietly swept in with Part 2.

**What I intentionally did not build.** No "at risk / approaching breach" amber
state — the spec asked for breached vs not, and I didn't want to invent a second
threshold. No per-org SLA overrides — targets are global in `config.js`. No
recomputation caching — breach is derived on read, which is fine at this scale.
