import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import PortalShell from '../../../components/portal/PortalShell';
import { CategoryBadge, ReplyForm, SeverityBadge, StatusBadge, Stepper, Thread, TicketDetails } from '../../../components/portal/TicketParts';
import Breadcrumbs from '../../../components/ui/Breadcrumbs';
import LoadingState from '../../../components/ui/LoadingState';
import { apiFetch } from '../../../lib/api';
import { SEVERITY_BY_VALUE } from '../../../lib/clientTickets';
import styles from '../../../styles/portal.module.css';

function ClientTicket({ user }) {
  const router = useRouter();
  const { id } = router.query;
  const [ticket, setTicket] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    if (!id) return;
    apiFetch(`/client-portal/tickets/${id}`)
      .then(setTicket)
      .catch((err) => setError(err.message === 'Not found' ? 'This ticket does not exist or is not one of your company’s tickets.' : err.message));
  }, [id]);

  useEffect(load, [load]);

  const reply = async ({ body }) => {
    const updated = await apiFetch(`/client-portal/tickets/${id}/comments`, { method: 'POST', body: JSON.stringify({ body }) });
    setTicket(updated);
  };

  if (error) return <div className={styles.error} role="alert">{error}</div>;
  if (!ticket) return <LoadingState label="Loading ticket…" />;

  const severity = SEVERITY_BY_VALUE[ticket.severity];
  return (
    <>
      <Breadcrumbs items={[{ label: 'My Tickets', href: '/portal/tickets' }, { label: ticket.key }]} />
      <div className={styles.pageHeader}>
        <div>
          <div className={styles.cardTop}>
            <span className={styles.ticketKey}>{ticket.key}</span>
            <SeverityBadge severity={ticket.severity} />
            <CategoryBadge category={ticket.category} />
            <StatusBadge status={ticket.status} />
          </div>
          <h1 className={styles.pageTitle}>{ticket.title}</h1>
        </div>
      </div>

      <Stepper status={ticket.status} />

      <div className={styles.ticketLayout}>
        <div>
          <section className={styles.panel} aria-labelledby="conversation-heading">
            <h2 id="conversation-heading" className={styles.panelTitle}>Conversation</h2>
            <Thread comments={ticket.comments} events={ticket.events} viewerId={user.id} audience="client" />
            <ReplyForm
              onSubmit={reply}
              disabledReason={ticket.status === 'closed' ? 'This ticket is closed. If the problem comes back, report a new issue.' : null}
            />
          </section>
        </div>
        <aside>
          <section className={styles.panel} aria-labelledby="details-heading">
            <h2 id="details-heading" className={styles.panelTitle}>Details</h2>
            <TicketDetails ticket={ticket} />
            {ticket.status === 'submitted' && severity && (
              <p className={`${styles.muted} ${styles.note}`}>We have your ticket. {severity.target}.</p>
            )}
          </section>
        </aside>
      </div>
    </>
  );
}

export default function PortalTicketPage() {
  return <PortalShell>{(ctx) => <ClientTicket {...ctx} />}</PortalShell>;
}
