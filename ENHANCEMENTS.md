# Post-exercise enhancements

These changes were made **after** the graded exercise submission, as follow-on
product work. They are separate from the Part 1 / Part 2 deliverables (which are
described in [`REVIEW.md`](REVIEW.md) and [`DECISIONS.md`](DECISIONS.md)); the
exercise state is preserved in the commit history up to the `docs:` commit.

## What changed

1. **Tickets open in an Asana-style side panel.** Clicking a ticket in the list
   opens a right-hand slide-in panel instead of navigating away; the list stays
   visible and clickable on the left (no dimming), the open row is highlighted,
   and the open ticket is tracked in the URL (`?ticket=123`) so it is
   deep-linkable and closes on the browser back button or Escape. The full-page
   `/tickets/:id` route still exists (ctrl/⌘-click opens it in a new tab) — both
   render one shared `TicketView` component so they can't drift.

2. **List filters now work.** This resolves **Part 1 Finding #9**: the status,
   priority, sort, and search controls only re-queried on a page change. They now
   refetch on change and reset to page 1; the search box is debounced (300ms).

3. **Editable Status / Priority / Assignee.** Agents and admins can change these
   from the panel via dropdowns. New backend surface:
   - `GET /api/tickets/meta/assignees` — agents/admins in the caller's org.
   - `PATCH /api/tickets/:id` — updates any of `status`, `priority`, `assigneeId`.
     Agents/admins only, org-scoped, values validated against the enums, and an
     assignee must be an agent/admin in the same org. Requesters see the fields
     read-only. (This replaces the old "Claim this ticket" button in the UI; the
     `PATCH /:id/assign` endpoint is left in place.)

4. **Reply form styling fix** — the textarea and Reply button were misaligned.

## Note on the exercise's "five fixes" rule

The exercise asked for exactly five Part 1 fixes, and Finding #9 was deliberately
left documented-not-fixed. It is fixed **here**, as part of building the editable
panel (the new filter/panel UI needed the list to refetch correctly). It is in a
`feat:` commit after the exercise commits, not smuggled in as a sixth "fix". If
you are grading the original submission, review up to the `docs:` commit.

## Verified

Server guards all pass: requester `PATCH` → 403, cross-org → 404, invalid
status/priority → 400, cross-org assignee → 400, unassign → 200; existing `GET`
and claim endpoints unchanged. Client builds clean. SLA recomputes after a
priority change (e.g. moving a ticket to P1 tightens the 4h target).
