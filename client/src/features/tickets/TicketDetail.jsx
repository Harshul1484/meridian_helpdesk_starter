import { useParams } from 'react-router-dom';
import TicketView from './TicketView';

// Full-page ticket route (kept for deep links / opening a ticket in a new tab).
// The list opens tickets in a side panel instead; both render the same
// TicketView so they never drift.
export default function TicketDetail() {
  const { id } = useParams();
  return <TicketView ticketId={id} />;
}
