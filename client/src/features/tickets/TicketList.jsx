import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useSelector } from 'react-redux';
import { api } from '../../app/api';
import TicketPanel from './TicketPanel';

const STATUSES = ['', 'open', 'pending', 'resolved', 'closed'];
const PRIORITIES = ['', 'P1', 'P2', 'P3'];

export default function TicketList() {
  const user = useSelector((s) => s.auth.user);

  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [status, setStatus] = useState('');
  const [priority, setPriority] = useState('');
  const [sortBy, setSortBy] = useState('created_at');
  const [breachedOnly, setBreachedOnly] = useState(false);
  const [loading, setLoading] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  // The open ticket lives in the URL (?ticket=123) so the panel is
  // deep-linkable and the browser back button closes it.
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedId = searchParams.get('ticket');

  // Debounce the search box so we don't fire a request on every keystroke.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  // Refetch whenever the page, any filter, the sort, or reloadKey changes.
  // (Fixes the original bug where only page changes triggered a refetch.)
  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams({ page, search: debouncedSearch, status, priority, sortBy, order: 'desc' });
    if (breachedOnly) params.set('breached', 'true');
    api(`/tickets?${params.toString()}`)
      .then((data) => {
        setRows(data.rows);
        setTotal(data.total);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [page, debouncedSearch, status, priority, sortBy, breachedOnly, reloadKey]);

  // Any filter change goes back to page 1 so results aren't hidden on a later page.
  function onFilterChange(setter) {
    return (value) => { setter(value); setPage(1); };
  }

  function openTicket(id) {
    setSearchParams((prev) => {
      const p = new URLSearchParams(prev);
      p.set('ticket', String(id));
      return p;
    });
  }

  function closeTicket() {
    setSearchParams((prev) => {
      const p = new URLSearchParams(prev);
      p.delete('ticket');
      return p;
    });
    setReloadKey((k) => k + 1); // pick up any change made in the panel
  }

  async function handleDelete(id) {
    await api(`/tickets/${id}`, { method: 'DELETE' });
    setRows(rows.filter((r) => r.id !== id));
    if (String(id) === selectedId) closeTicket();
  }

  const pageCount = Math.ceil(total / 20);

  return (
    <div className="ticket-list">
      <h1>Tickets</h1>

      <div className="filters">
        <input
          placeholder="Search subject…"
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
        />
        <select value={status} onChange={(e) => onFilterChange(setStatus)(e.target.value)}>
          {STATUSES.map((s) => (
            <option key={s} value={s}>{s || 'Any status'}</option>
          ))}
        </select>
        <select value={priority} onChange={(e) => onFilterChange(setPriority)(e.target.value)}>
          {PRIORITIES.map((p) => (
            <option key={p} value={p}>{p || 'Any priority'}</option>
          ))}
        </select>
        <select value={sortBy} onChange={(e) => onFilterChange(setSortBy)(e.target.value)}>
          <option value="created_at">Created</option>
          <option value="updated_at">Updated</option>
          <option value="priority">Priority</option>
          <option value="status">Status</option>
        </select>
        <label className="breached-filter">
          <input
            type="checkbox"
            checked={breachedOnly}
            onChange={(e) => { setBreachedOnly(e.target.checked); setPage(1); }}
          />
          Breached only
        </label>
      </div>

      {loading && <p>Loading…</p>}

      <table>
        <thead>
          <tr>
            <th>#</th><th>Subject</th><th>Status</th><th>Priority</th>
            <th>Assignee</th><th>Comments</th><th>Created</th><th />
          </tr>
        </thead>
        <tbody>
          {rows.map((t) => (
            <tr key={t.id} className={String(t.id) === selectedId ? 'selected' : ''}>
              <td>{t.id}</td>
              <td>
                <a
                  href={`/tickets/${t.id}`}
                  className="ticket-link"
                  onClick={(e) => {
                    if (e.metaKey || e.ctrlKey || e.button === 1) return; // allow open-in-new-tab
                    e.preventDefault();
                    openTicket(t.id);
                  }}
                >
                  {t.subject}
                </a>
                {t.sla?.breached && (
                  <span className="sla-badge" title={`Response target ${t.sla.targetHours}h`}>
                    SLA breached
                  </span>
                )}
              </td>
              <td>{t.status}</td>
              <td>{t.priority}</td>
              <td>{t.assignee_name || '—'}</td>
              <td>{t.comment_count}</td>
              <td>{new Date(t.created_at).toLocaleString()}</td>
              <td>
                {user?.role === 'admin' && (
                  <button onClick={() => handleDelete(t.id)}>Delete</button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="pager">
        <button disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button>
        <span>Page {page} of {pageCount || 1} · {total} tickets</span>
        <button disabled={page >= pageCount} onClick={() => setPage(page + 1)}>Next</button>
      </div>

      {selectedId && (
        <TicketPanel
          ticketId={selectedId}
          onClose={closeTicket}
          onChange={() => setReloadKey((k) => k + 1)}
        />
      )}
    </div>
  );
}
