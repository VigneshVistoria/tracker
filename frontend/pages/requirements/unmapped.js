import TicketMapper from '../../components/requirements/TicketMapper';

// Requirements Stage 2 (2026-11-25): the project's tickets not linked to
// any story of the SRS yet - PM/Admin.
export default function RequirementsUnmappedPage() {
  return <TicketMapper unmappedOnly />;
}
