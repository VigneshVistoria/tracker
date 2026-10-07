import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import AppShell from '../../components/AppShell';
import { CategoryBadge, ReplyForm, SeverityBadge, StatusBadge, Stepper, Thread, TicketDetails } from '../../components/portal/TicketParts';
import Breadcrumbs from '../../components/ui/Breadcrumbs';
import Button from '../../components/ui/Button';
import Select from '../../components/ui/Select';
import LoadingState from '../../components/ui/LoadingState';
import { apiFetch } from '../../lib/api';
import { useToast } from '../../lib/toast';
import { STATUSES, TEAM_STATUS_OPTIONS, usePortalMe } from '../../lib/clientTickets';
import styles from '../../styles/portal.module.css';

// One client ticket, team side (Stage 2): reply or add an internal note,
// change status, assign to someone on this client's team.
export default function ClientTicketTeamPage() {
  const router = useRouter();
  const { id } = router.query;
  const me = usePortalMe();
  const { showToast } = useToast();
  const [user, setUser] = useState(null);
  const [ticket, setTicket] = useState(null);
  const [team, setTeam] = useState([]);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [assignee, setAssignee] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem('user');
    if (!stored) {
      router.replace('/');
      return;
    }
    setUser(JSON.parse(stored));
  }, [router]);

  const apply = useCallback((t) => {
    setTicket(t);
    setStatus(t.status);
    setAssignee(t.assigneeUserId ? String(t.assigneeUserId) : '');
  }, []);

  const canSee = me?.canSeeClientTickets;
  // Loads once per ticket - keyed on the ticket id and access only, so a
  // re-render never refetches and wipes an unsaved status/assignee choice.
  useEffect(() => {
    if (canSee === undefined || !id) return;
    if (!canSee) {
      router.replace('/dashboard');
      return;
    }
    apiFetch(`/client-portal/tickets/${id}`)
      .then((t) => {
        apply(t);
        return apiFetch(`/client-portal/clients/${t.clientId}`).then((c) => setTeam(c.team));
      })
      .catch((err) => setError(err.message === 'Not found' ? 'This ticket does not exist or belongs to a client you are not on.' : err.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canSee, id]);

  // A reply refreshes the conversation but keeps any unsaved status/assignee choice.
  const reply = async ({ body, isInternal }) => {
    setTicket(await apiFetch(`/client-portal/tickets/${id}/comments`, { method: 'POST', body: JSON.stringify({ body, isInternal }) }));
  };

  const save = async (e) => {
    e.preventDefault();
    const changes = {};
    if (status !== ticket.status) changes.status = status;
    const nextAssignee = assignee ? Number(assignee) : null;
    if (nextAssignee !== ticket.assigneeUserId) changes.assigneeUserId = nextAssignee;
    if (Object.keys(changes).length === 0) return;
    setSaving(true);
    try {
      apply(await apiFetch(`/client-portal/tickets/${id}`, { method: 'PATCH', body: JSON.stringify(changes) }));
      showToast('Ticket updated', 'success');
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  if (!user) return null;
  // The current status stays selectable even if it isn't one the team sets.
  const statusOptions = [...new Set([ticket?.status, ...TEAM_STATUS_OPTIONS].filter(Boolean))];

  return (
    <AppShell>
      {error && <div className={styles.error} role="alert">{error}</div>}
      {!ticket && !error && <LoadingState label="Loading ticket…" />}
      {ticket && (
        <>
          <Breadcrumbs items={[{ label: 'Client tickets', href: '/client-tickets' }, { label: ticket.key }]} />
          <div className={styles.pageHeader}>
            <div>
              <div className={styles.cardTop}>
                <span className={styles.ticketKey}>{ticket.key}</span>
                <SeverityBadge severity={ticket.severity} />
                <CategoryBadge category={ticket.category} />
                <StatusBadge status={ticket.status} audience="team" />
              </div>
              <h1 className={styles.pageTitle}>{ticket.title}</h1>
              <p className={styles.pageSubtitle}>{ticket.clientName}</p>
            </div>
          </div>

          <Stepper status={ticket.status} />

          <div className={styles.ticketLayout}>
            <div>
              <section className={styles.panel} aria-labelledby="details-heading">
                <h2 id="details-heading" className={styles.panelTitle}>Details</h2>
                <TicketDetails ticket={ticket} />
              </section>
              <section className={styles.panel} aria-labelledby="conversation-heading">
                <h2 id="conversation-heading" className={styles.panelTitle}>Conversation</h2>
                <Thread comments={ticket.comments} events={ticket.events} viewerId={user.id} audience="team" />
                <ReplyForm onSubmit={reply} allowInternal />
              </section>
            </div>
            <aside>
              <form className={`${styles.panel} ${styles.sideActions}`} onSubmit={save} aria-labelledby="work-heading">
                <h2 id="work-heading" className={styles.panelTitle}>Work this ticket</h2>
                <Select label="Status" value={status} onChange={(e) => setStatus(e.target.value)}>
                  {statusOptions.map((s) => (
                    <option key={s} value={s} disabled={!TEAM_STATUS_OPTIONS.includes(s)}>
                      {STATUSES[s]?.team || s}
                    </option>
                  ))}
                </Select>
                <Select label="Assignee" value={assignee} onChange={(e) => setAssignee(e.target.value)} hint={`Only ${ticket.clientName} team members`}>
                  <option value="">Unassigned</option>
                  {team.map((m) => (
                    <option key={m.userId} value={m.userId}>{m.name} ({m.teamRole === 'qa' ? 'QA' : m.teamRole === 'pm' ? 'PM' : 'Developer'})</option>
                  ))}
                </Select>
                <Button type="submit" loading={saving} disabled={status === ticket.status && (assignee ? Number(assignee) : null) === ticket.assigneeUserId}>
                  Save changes
                </Button>
                <p className={styles.muted}>The client is notified when the status changes. Internal notes are never shown to them.</p>
              </form>
            </aside>
          </div>
        </>
      )}
    </AppShell>
  );
}
