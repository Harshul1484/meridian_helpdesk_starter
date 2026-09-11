import { useCallback, useEffect } from 'react';
import TicketView from './TicketView';

/**
 * Right-hand slide-in panel (Asana-style). The list stays visible and clickable
 * on the left - there is no dimming backdrop; clicking another row just swaps
 * the panel's ticket. Closes on the × button or Escape.
 */
export default function TicketPanel({ ticketId, onClose, onChange }) {
  const close = useCallback(() => {
    // Play the slide-out, then unmount.
    document.body.classList.add('panel-closing');
    setTimeout(() => {
      document.body.classList.remove('panel-closing');
      onClose();
    }, 180);
  }, [onClose]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('keydown', onKey);
    document.body.classList.add('panel-open'); // lets the list reflow beside the panel
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.classList.remove('panel-open');
      document.body.classList.remove('panel-closing');
    };
  }, [close]);

  return (
    <aside className="panel" role="dialog" aria-modal="false" aria-label="Ticket details">
      <div className="panel-header">
        <button className="panel-close" onClick={close} aria-label="Close panel" title="Close">
          →
        </button>
      </div>
      <div className="panel-body">
        <TicketView key={ticketId} ticketId={ticketId} onChange={onChange} />
      </div>
    </aside>
  );
}
