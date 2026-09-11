import { useEffect, useState } from 'react';
import { useSelector } from 'react-redux';
import { api } from '../../app/api';

/**
 * The contents of a single ticket: subject + SLA badge, meta, body, claim
 * control, comments and the reply form. Shared by the full-page route
 * (TicketDetail) and the slide-in panel (TicketPanel) so the two never drift.
 *
 * `onChange` is called after a claim or a new comment so a parent list can
 * refresh the affected row (assignee, comment count, SLA).
 */
const STATUS_OPTS = ['open', 'pending', 'resolved', 'closed'];
const PRIORITY_OPTS = ['P1', 'P2', 'P3'];

export default function TicketView({ ticketId, onChange }) {
  const user = useSelector((s) => s.auth.user);
  const canEdit = user?.role === 'agent' || user?.role === 'admin';

  const [ticket, setTicket] = useState(null);
  const [comments, setComments] = useState([]);
  const [assignees, setAssignees] = useState([]);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState(null);

  useEffect(() => {
    setTicket(null);
    setError(null);
    api(`/tickets/${ticketId}`)
      .then((data) => {
        setTicket(data.ticket);
        setComments(data.comments);
      })
      .catch((e) => setError(e.message));
  }, [ticketId]);

  // Load the assignable users once (agents/admins only).
  useEffect(() => {
    if (!canEdit) return;
    api('/tickets/meta/assignees').then(setAssignees).catch(() => {});
  }, [canEdit]);

  async function patch(fields) {
    try {
      const updated = await api(`/tickets/${ticketId}`, {
        method: 'PATCH',
        body: JSON.stringify(fields),
      });
      setTicket(updated);
      onChange?.();
    } catch (e) {
      setError(e.message);
    }
  }

  async function addComment(e) {
    e.preventDefault();
    if (!draft.trim()) return;
    const created = await api(`/tickets/${ticketId}/comments`, {
      method: 'POST',
      body: JSON.stringify({ body: draft, isInternal: false }),
    });
    setComments([...comments, { ...created, author_name: user.name, author_role: user.role }]);
    setDraft('');
    onChange?.();
  }

  if (error) return <p className="error">{error}</p>;
  if (!ticket) return <p>Loading…</p>;

  return (
    <div className="ticket-detail">
      <h1>
        {ticket.subject}
        {ticket.sla?.breached && (
          <span
            className="sla-badge"
            title={`Response target ${ticket.sla.targetHours}h · ${ticket.sla.elapsedHours}h elapsed${ticket.sla.responded ? ' to first response' : ' with no response yet'}`}
          >
            SLA breached
          </span>
        )}
      </h1>
      <p className="meta">
        #{ticket.id} · requested by {ticket.requester_name} ({ticket.requester_email})
      </p>

      <div className="props">
        <div className="prop">
          <span className="prop-label">Status</span>
          {canEdit ? (
            <select value={ticket.status} onChange={(e) => patch({ status: e.target.value })}>
              {STATUS_OPTS.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          ) : (
            <span>{ticket.status}</span>
          )}
        </div>
        <div className="prop">
          <span className="prop-label">Priority</span>
          {canEdit ? (
            <select value={ticket.priority} onChange={(e) => patch({ priority: e.target.value })}>
              {PRIORITY_OPTS.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          ) : (
            <span>{ticket.priority}</span>
          )}
        </div>
        <div className="prop">
          <span className="prop-label">Assignee</span>
          {canEdit ? (
            <select
              value={ticket.assignee_id || ''}
              onChange={(e) => patch({ assigneeId: e.target.value ? Number(e.target.value) : null })}
            >
              <option value="">Unassigned</option>
              {assignees.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}{a.id === user.id ? ' (me)' : ''}
                </option>
              ))}
            </select>
          ) : (
            <span>{ticket.assignee_name || '—'}</span>
          )}
        </div>
      </div>

      <p className="body">{ticket.body}</p>

      <h2>Comments</h2>
      <ul className="comments">
        {comments.map((c) => (
          <li key={c.id} className={c.is_internal ? 'internal' : ''}>
            <strong>{c.author_name}</strong>
            <span className="when">{new Date(c.created_at).toLocaleString()}</span>
            <div className="comment-body">{c.body}</div>
          </li>
        ))}
      </ul>

      <form className="reply-form" onSubmit={addComment}>
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={4}
          placeholder="Write a reply…"
        />
        <button type="submit">Reply</button>
      </form>
    </div>
  );
}
