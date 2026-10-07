import { useEffect, useMemo, useState } from 'react';
import { Plus, Search } from 'lucide-react';
import PortalShell from '../../../components/portal/PortalShell';
import { TicketCard } from '../../../components/portal/TicketParts';
import Button from '../../../components/ui/Button';
import Input from '../../../components/ui/Input';
import EmptyState from '../../../components/ui/EmptyState';
import LoadingState from '../../../components/ui/LoadingState';
import { apiFetch } from '../../../lib/api';
import styles from '../../../styles/portal.module.css';

const FILTERS = [
  { key: 'open', label: 'Open', match: (t) => t.status !== 'closed' },
  { key: 'review', label: 'Pending your review', match: (t) => t.status === 'client_review' },
  { key: 'closed', label: 'Closed', match: (t) => t.status === 'closed' },
  { key: 'all', label: 'All', match: () => true },
];

function MyTickets({ me }) {
  const [tickets, setTickets] = useState(null);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('open');
  const [query, setQuery] = useState('');

  useEffect(() => {
    apiFetch('/client-portal/tickets')
      .then(setTickets)
      .catch((err) => setError(err.message));
  }, []);

  const visible = useMemo(() => {
    if (!tickets) return [];
    const match = FILTERS.find((f) => f.key === filter).match;
    const q = query.trim().toLowerCase();
    return tickets
      .filter(match)
      .filter((t) => !q || `${t.key} ${t.title} ${t.moduleName || ''}`.toLowerCase().includes(q));
  }, [tickets, filter, query]);

  return (
    <>
      <div className={styles.pageHeader}>
        <div>
          <p className={styles.kicker}>{me.portalClient.name}</p>
          <h1 className={styles.pageTitle}>My Tickets</h1>
          <p className={styles.pageSubtitle}>Every ticket raised by your company.</p>
        </div>
        <Button href="/portal/tickets/new" leftIcon={Plus}>New ticket</Button>
      </div>

      {error && <div className={styles.error} role="alert">{error}</div>}
      {!tickets && !error && <LoadingState label="Loading your tickets…" />}

      {tickets && (
        <>
          <div className={styles.toolbar}>
            <Input
              className={styles.search}
              label="Search"
              leftIcon={Search}
              placeholder="Number, title or module"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <div className={styles.chips} role="group" aria-label="Filter tickets">
              {FILTERS.map((f) => (
                <button
                  key={f.key}
                  type="button"
                  className={styles.chip}
                  aria-pressed={filter === f.key}
                  onClick={() => setFilter(f.key)}
                >
                  {f.label}
                  <span className={styles.chipCount}>{tickets.filter(f.match).length}</span>
                </button>
              ))}
            </div>
          </div>

          <p className="sr-only" role="status">{visible.length} tickets shown</p>
          {visible.length === 0 ? (
            <EmptyState icon={Search} title="No tickets match" description="Try another filter or search." />
          ) : (
            <ul className={styles.grid} role="list">
              {visible.map((t) => (
                <li key={t.id}>
                  <TicketCard ticket={t} href={`/portal/tickets/${t.id}`} />
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </>
  );
}

export default function PortalTicketsPage() {
  return <PortalShell>{(ctx) => <MyTickets {...ctx} />}</PortalShell>;
}
