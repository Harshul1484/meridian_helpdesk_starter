import express from 'express';
import { requireAuth, requireRole } from '../middleware/auth.js';
import {
  listTickets,
  getTicketById,
  createTicket,
  assignTicket,
  deleteTicket,
  listComments,
  listAssignableUsers,
  updateTicket,
} from '../services/ticketService.js';

const router = express.Router();

// Users who can be assigned tickets in the caller's org (for the assignee
// dropdown). Two path segments, so it never collides with GET '/:id'.
router.get('/meta/assignees', requireAuth, async (req, res, next) => {
  try {
    res.json(await listAssignableUsers(req.user.orgId));
  } catch (err) {
    next(err);
  }
});

router.get('/', requireAuth, async (req, res, next) => {
  try {
    const result = await listTickets({
      orgId: req.user.orgId,
      page: Number(req.query.page || 1),
      search: req.query.search || '',
      status: req.query.status,
      priority: req.query.priority,
      sortBy: req.query.sortBy || 'created_at',
      order: req.query.order || 'desc',
      breachedOnly: req.query.breached === 'true' || req.query.breached === '1',
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.get('/:id', requireAuth, async (req, res, next) => {
  try {
    // Scope to the caller's org: a ticket in another organisation must read as
    // "not found", never return its body, requester email, or comments.
    const ticket = await getTicketById(Number(req.params.id), req.user.orgId);
    if (!ticket) return res.status(404).json({ error: 'Not found' });

    const comments = await listComments(ticket.id);
    res.json({ ticket, comments });
  } catch (err) {
    next(err);
  }
});

router.post('/', requireAuth, async (req, res, next) => {
  try {
    const { subject, body, priority } = req.body;
    if (!subject || !body) {
      return res.status(400).json({ error: 'subject and body are required' });
    }
    const ticket = await createTicket({
      orgId: req.user.orgId,
      subject,
      body,
      priority: priority || 'P3',
      requesterId: req.user.id,
    });
    res.status(201).json(ticket);
  } catch (err) {
    next(err);
  }
});

// Edit a ticket's status / priority / assignee. Agents and admins only,
// scoped to the caller's org.
router.patch('/:id', requireAuth, requireRole('agent', 'admin'), async (req, res, next) => {
  try {
    const { status, priority, assigneeId } = req.body;
    const fields = {};
    if (status !== undefined) fields.status = status;
    if (priority !== undefined) fields.priority = priority;
    if (assigneeId !== undefined) fields.assigneeId = assigneeId;

    const result = await updateTicket(Number(req.params.id), req.user.orgId, fields);
    if (!result) return res.status(404).json({ error: 'Not found' });
    if (result.error) return res.status(400).json({ error: result.error });
    res.json(result.ticket);
  } catch (err) {
    next(err);
  }
});

router.patch('/:id/assign', requireAuth, async (req, res, next) => {
  try {
    const result = await assignTicket(Number(req.params.id), req.user.id);
    if (!result) return res.status(404).json({ error: 'Not found' });
    if (result.conflict) {
      return res.status(409).json({ error: 'Ticket already assigned', ticket: result.ticket });
    }
    res.json(result.ticket);
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', requireAuth, requireRole('admin'), async (req, res, next) => {
  try {
    // Scope the lookup to the caller's org so an admin cannot delete another
    // customer's tickets; a foreign ticket reads as "not found".
    const ticket = await getTicketById(Number(req.params.id), req.user.orgId);
    if (!ticket) return res.status(404).json({ error: 'Not found' });
    await deleteTicket(ticket.id);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

export default router;
