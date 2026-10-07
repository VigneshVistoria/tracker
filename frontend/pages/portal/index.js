import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Inbox, Eye, CheckCircle2, Loader, Plus, Ticket } from 'lucide-react';
import PortalShell from '../../components/portal/PortalShell';
import { TicketCard } from '../../components/portal/TicketParts';
import Button from '../../components/ui/Button';
import StatCard from '../../components/ui/StatCard';
import EmptyState from '../../components/ui/EmptyState';
import LoadingState from '../../components/ui/LoadingState';
import { apiFetch } from '../../lib/api';
import { isOpen } from '../../lib/clientTickets';
import styles from '../../styles/portal.module.css';

function greeting(date = new Date()) {
  const h = date.getHours();
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

function firstName(fullName) {
  return (fullName || '').trim().split(/\s+/)[0] || '';
}

function startOfMonth(date = new Date()) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function PortalHome({ me, user }) {
  const [tickets, setTickets] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    apiFetch('/client-portal/tickets')
      .then(setTickets)
      .catch((err) => setError(err.message));
  }, []);

  const open = (tickets || []).filter(isOpen);
  const inProgress = open.filter((t) => t.status === 'in_progress');
  const review = open.filter((t) => t.status === 'client_review');
  const monthStart = startOfMonth();
  const resolved = (tickets || []).filter((t) => t.status === 'closed' && t.closedAt && new Date(t.closedAt) >= monthStart);
  const name = firstName(user.fullName);

  return (
    <>
      <section className={styles.hero}>
        <div>
          <p className={styles.kicker}>{me.portalClient.name}</p>
          <h1 className={styles.heroTitle}>
            {greeting()}
            {name ? `, ${name}` : ''}.
          </h1>
          {tickets && (
            <p className={styles.pageSubtitle}>
              {review.length > 0
                ? `${review.length} ${review.length === 1 ? 'fix is' : 'fixes are'} ready for your review.`
                : 'Nothing is waiting on you right now.'}
            </p>
          )}
        </div>
        <div className={styles.heroActions}>
          <Button href="/portal/tickets/new" leftIcon={Plus} size="lg">Report an issue</Button>
          <p className={styles.muted}>Showstopper response within 1 hour</p>
        </div>
      </section>

      {error && <div className={styles.error} role="alert">{error}</div>}
      {!tickets && !error && <LoadingState label="Loading your tickets…" />}

      {tickets && (
        <>
          <div className={styles.stats}>
            <StatCard label="Open tickets" value={open.length} icon={Inbox} accent="primary" />
            <StatCard label="In progress" value={inProgress.length} icon={Loader} accent="neutral" />
            <StatCard label="Ready for your review" value={review.length} icon={Eye} accent="warning" />
            <StatCard label="Resolved this month" value={resolved.length} icon={CheckCircle2} accent="success" />
          </div>

          <section aria-labelledby="open-tickets-heading">
            <div className={styles.sectionHeader}>
              <h2 id="open-tickets-heading" className={styles.sectionTitle}>Your open tickets</h2>
              {open.length > 0 && <Link href="/portal/tickets">View all</Link>}
            </div>
            {open.length === 0 ? (
              <EmptyState
                icon={Ticket}
                title="No open tickets"
                description="When you report an issue it appears here, and you can follow it until it's fixed."
              />
            ) : (
              <ul className={styles.grid} role="list">
                {open.slice(0, 6).map((t) => (
                  <li key={t.id}>
                    <TicketCard ticket={t} href={`/portal/tickets/${t.id}`} />
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </>
  );
}

export default function PortalHomePage() {
  return <PortalShell>{(ctx) => <PortalHome {...ctx} />}</PortalShell>;
}
