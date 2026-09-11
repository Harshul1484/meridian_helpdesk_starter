import { query } from '../db/pool.js';
import { config } from '../config.js';
import { evaluateSla } from './sla.js';

const PAGE_SIZE = 20;

// Columns the list UI can sort by. Whitelisting keeps sortBy/order out of the
// SQL string as raw values - they are interpolated into ORDER BY and cannot be
// parameterised, so an allow-list is the safe way to accept them.
const SORTABLE = {
  created_at: 't.created_at',
  updated_at: 't.updated_at',
  priority: 't.priority',
  status: 't.status',
};

// --- SLA (Part 2) ---------------------------------------------------------
// The "first response" that stops the SLA clock: the earliest non-internal
// comment written by an agent or admin. Internal notes and the requester's own
// messages do not count as a response to the customer. LEFT JOIN so tickets
// with no response yet survive with first_response_at = NULL.
const FIRST_RESPONSE_JOIN = `
       LEFT JOIN (
         SELECT c.ticket_id, MIN(c.created_at) AS first_response_at
           FROM comments c
           JOIN users au ON au.id = c.author_id
          WHERE c.is_internal = 0 AND au.role IN ('agent','admin')
          GROUP BY c.ticket_id
       ) fr ON fr.ticket_id = t.id`;

// Seconds on the SLA clock: creation -> first response, or -> now if none yet.
// UTC_TIMESTAMP() is used (not NOW()) because the seed and the comments route
// write UTC-naive timestamps while the DB session runs at +05:30; comparing
// against UTC keeps the elapsed time true. See DECISIONS.md.
const ELAPSED_SECONDS =
  'TIMESTAMPDIFF(SECOND, t.created_at, COALESCE(fr.first_response_at, UTC_TIMESTAMP()))';

// Target seconds by priority, sourced from config.slaTargets so the numbers
// live in one place. Used only for the breached-only filter (the badge itself
// is decided in JS by evaluateSla).
const TARGET_SECONDS_CASE = "CASE t.priority WHEN 'P1' THEN ? WHEN 'P2' THEN ? WHEN 'P3' THEN ? END";
const targetParams = [
  config.slaTargets.P1 * 3600,
  config.slaTargets.P2 * 3600,
  config.slaTargets.P3 * 3600,
];
const BREACH_CONDITION = `${ELAPSED_SECONDS} > ${TARGET_SECONDS_CASE}`;

/**
 * Paginated ticket list for the current organisation.
 *
 * Supports free-text search on subject, filtering by status and priority,
 * and sorting by any column the UI exposes in its dropdown.
 */
export async function listTickets({ orgId, page = 1, search = '', status, priority, sortBy = 'created_at', order = 'desc', breachedOnly = false }) {
  const where = ['t.org_id = ?'];
  const params = [orgId];

  if (search) {
    where.push('t.subject LIKE ?');
    params.push(`%${search}%`);
  }
  if (status) {
    where.push('t.status = ?');
    params.push(status);
  }
  if (priority) {
    where.push('t.priority = ?');
    params.push(priority);
  }

  const whereSql = where.join(' AND ');
  // Pages are 1-based: page 1 must start at offset 0. The original
  // `page * PAGE_SIZE` skipped the first 20 (newest) tickets entirely and left
  // the last reachable page blank.
  const safePage = Math.max(1, Math.floor(Number(page) || 1));
  const offset = (safePage - 1) * PAGE_SIZE;

  const sortCol = SORTABLE[sortBy] || SORTABLE.created_at;
  const sortDir = String(order).toLowerCase() === 'asc' ? 'ASC' : 'DESC';

  // The breach filter needs the same target params, injected in SQL text order.
  const breachSql = breachedOnly ? ` AND ${BREACH_CONDITION}` : '';
  const breachP = breachedOnly ? targetParams : [];

  const rows = await query(
    `SELECT t.id, t.subject, t.status, t.priority, t.created_at, t.updated_at,
            t.assignee_id, u.name AS assignee_name, r.name AS requester_name,
            fr.first_response_at,
            ${ELAPSED_SECONDS} AS elapsed_seconds
       FROM tickets t
       LEFT JOIN users u ON u.id = t.assignee_id
       JOIN users r ON r.id = t.requester_id${FIRST_RESPONSE_JOIN}
      WHERE ${whereSql}${breachSql}
      ORDER BY ${sortCol} ${sortDir}
      LIMIT ? OFFSET ?`,
    [...params, ...breachP, PAGE_SIZE, offset]
  );

  // Attach the comment count each row needs for the list badge, and the SLA
  // state each row carries for the breach badge.
  for (const row of rows) {
    const [{ c }] = await query('SELECT COUNT(*) AS c FROM comments WHERE ticket_id = ?', [row.id]);
    row.comment_count = c;
    row.sla = evaluateSla({
      priority: row.priority,
      elapsedSeconds: row.elapsed_seconds,
      responded: row.first_response_at != null,
    });
    delete row.elapsed_seconds;
    delete row.first_response_at;
  }

  const [{ total }] = await query(
    `SELECT COUNT(*) AS total
       FROM tickets t${breachedOnly ? FIRST_RESPONSE_JOIN : ''}
      WHERE ${whereSql}${breachSql}`,
    [...params, ...breachP]
  );

  return { rows, total, page: safePage, pageSize: PAGE_SIZE };
}

/**
 * Fetch a single ticket. When `orgId` is supplied the lookup is scoped to that
 * organisation, so a ticket belonging to another org reads as "not found"
 * instead of leaking across tenants. Callers that already do their own org
 * check (or intentionally run unscoped) may omit it.
 */
export async function getTicketById(id, orgId = null) {
  const where = ['t.id = ?'];
  const params = [id];
  if (orgId != null) {
    where.push('t.org_id = ?');
    params.push(orgId);
  }
  const rows = await query(
    `SELECT t.*, u.name AS assignee_name, r.name AS requester_name, r.email AS requester_email,
            fr.first_response_at,
            ${ELAPSED_SECONDS} AS elapsed_seconds
       FROM tickets t
       LEFT JOIN users u ON u.id = t.assignee_id
       JOIN users r ON r.id = t.requester_id${FIRST_RESPONSE_JOIN}
      WHERE ${where.join(' AND ')}`,
    params
  );
  const ticket = rows[0];
  if (!ticket) return null;
  ticket.sla = evaluateSla({
    priority: ticket.priority,
    elapsedSeconds: ticket.elapsed_seconds,
    responded: ticket.first_response_at != null,
  });
  delete ticket.elapsed_seconds;
  delete ticket.first_response_at;
  return ticket;
}

export async function listComments(ticketId) {
  return query(
    `SELECT c.id, c.body, c.is_internal, c.created_at, u.name AS author_name, u.role AS author_role
       FROM comments c
       JOIN users u ON u.id = c.author_id
      WHERE c.ticket_id = ?
      ORDER BY c.created_at ASC`,
    [ticketId]
  );
}

export async function createTicket({ orgId, subject, body, priority, requesterId }) {
  const result = await query(
    `INSERT INTO tickets (org_id, subject, body, priority, requester_id)
     VALUES (?, ?, ?, ?, ?)`,
    [orgId, subject, body, priority, requesterId]
  );
  return getTicketById(result.insertId);
}

export async function assignTicket(ticketId, assigneeId) {
  const ticket = await getTicketById(ticketId);
  if (!ticket) return null;

  if (ticket.assignee_id) {
    return { conflict: true, ticket };
  }

  // Look up the agent so the response carries a display name for the toast.
  const [agent] = await query('SELECT id, name FROM users WHERE id = ?', [assigneeId]);

  await query('UPDATE tickets SET assignee_id = ?, status = ? WHERE id = ?', [assigneeId, 'pending', ticketId]);
  return { conflict: false, assignedTo: agent, ticket: await getTicketById(ticketId) };
}

export async function deleteTicket(id) {
  await query('DELETE FROM tickets WHERE id = ?', [id]);
}

const STATUS_VALUES = ['open', 'pending', 'resolved', 'closed'];
const PRIORITY_VALUES = ['P1', 'P2', 'P3'];

/**
 * Users who can be assigned a ticket in this org (agents and admins).
 * Feeds the assignee dropdown on the ticket panel.
 */
export async function listAssignableUsers(orgId) {
  return query(
    `SELECT id, name, role FROM users
      WHERE org_id = ? AND role IN ('agent','admin')
      ORDER BY name`,
    [orgId]
  );
}

/**
 * Update a ticket's status, priority and/or assignee, scoped to the caller's
 * org. Only the fields present in `fields` are changed. Returns null if the
 * ticket isn't in this org, { error } for a bad value, or { ticket } on success.
 */
export async function updateTicket(id, orgId, fields) {
  const existing = await getTicketById(id, orgId);
  if (!existing) return null;

  const sets = [];
  const params = [];

  if (fields.status !== undefined) {
    if (!STATUS_VALUES.includes(fields.status)) return { error: 'Invalid status' };
    sets.push('status = ?');
    params.push(fields.status);
  }
  if (fields.priority !== undefined) {
    if (!PRIORITY_VALUES.includes(fields.priority)) return { error: 'Invalid priority' };
    sets.push('priority = ?');
    params.push(fields.priority);
  }
  if (fields.assigneeId !== undefined) {
    if (fields.assigneeId === null || fields.assigneeId === '') {
      sets.push('assignee_id = NULL');
    } else {
      // The assignee must be an agent/admin in the same org - stops cross-org
      // assignment and assigning to a requester.
      const [u] = await query(
        "SELECT id FROM users WHERE id = ? AND org_id = ? AND role IN ('agent','admin')",
        [fields.assigneeId, orgId]
      );
      if (!u) return { error: 'Invalid assignee' };
      sets.push('assignee_id = ?');
      params.push(fields.assigneeId);
    }
  }

  if (sets.length) {
    await query(`UPDATE tickets SET ${sets.join(', ')} WHERE id = ? AND org_id = ?`, [...params, id, orgId]);
  }
  return { ticket: await getTicketById(id, orgId) };
}
