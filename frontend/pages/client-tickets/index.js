import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { Lock, Search, Ticket } from 'lucide-react';
import AppShell from '../../components/AppShell';
import { SeverityBadge, StatusBadge } from '../../components/portal/TicketParts';
import Input from '../../components/ui/Input';
import Select from '../../components/ui/Select';
import EmptyState from '../../components/ui/EmptyState';
import LoadingState from '../../components/ui/LoadingState';
import { apiFetch } from '../../lib/api';
import { formatRelativeTime } from '../../lib/formatDate';
import { usePortalMe } from '../../lib/clientTickets';
import styles from '../../styles/portal.module.css';

const FILTERS = [
  { key: 'open', label: 'Open', match: (t) => t.status !== 'closed' },
  { key: 'submitted', label: 'New', match: (t) => t.status === 'submitted' },
  { key: 'in_progress', label: 'In progress', match: (t) => t.status === 'in_progress' },
  { key: 'client_review', label: 'Client reviewing', match: (t) => t.status === 'client_review' },
  { key: 'closed', label: 'Closed', match: (t) => t.status === 'closed' },
  { key: 'all', label: 'All', match: () => true },
];

// Team view of client portal tickets (Stage 2): Admin, PM and members of
// a client team. The backend only returns the caller's clients' tickets.
export default function ClientTicketsPage() {
  const router = useRouter();
  const me = usePortalMe();
  const [user, setUser] = useState(null);
  const [tickets, setTickets] = useState(null);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('open');
  const [clientId, setClientId] = useState('');
  const [mineOnly, setMineOnly] = useState(false);
  const [query, setQuery] = useState('');

  useEffect(() => {
    const stored = localStorage.getItem('user');
    if (!stored) {
      router.replace('/');
      return;
    }
    setUser(JSON.parse(stored));
  }, [router]);

  useEffect(() => {
    if (!me) return;
    if (!me.canSeeClientTickets) {
      router.replace('/dashboard');
      return;
    }
    apiFetch('/client-portal/tickets')
      .then(setTickets)
      .catch((err) => setError(err.message));
  }, [me, router]);

  const scoped = useMemo(() => {
    if (!tickets || !user) return [];
    return tickets
      .filter((t) => !clientId || t.clientId === Number(clientId))
      .filter((t) => !mineOnly || t.assigneeUserId === user.id);
  }, [tickets, user, clientId, mineOnly]);

  const visible = useMemo(() => {
    const match = FILTERS.find((f) => f.key === filter).match;
    const q = query.trim().toLowerCase();
    return scoped
      .filter(match)
      .filter((t) => !q || `${t.key} ${t.title} ${t.moduleName || ''} ${t.clientName || ''}`.toLowerCase().includes(q));
  }, [scoped, filter, query]);

  if (!user || !me?.canSeeClientTickets) return null;
  const clients = me.teamClients;
  const showClient = clients.length > 1;

  return (
    <AppShell>
      <div className={styles.pageHeader}>
        <div>
          <h1 className={styles.pageTitle}>Client tickets</h1>
          <p className={styles.pageSubtitle}>Tickets raised by clients through the client portal.</p>
          {clients.length > 0 && !['admin', 'program_manager'].includes(user.role) && (
            <p className={styles.muted}>
              <Lock size={13} aria-hidden="true" /> You are on the {clients.map((c) => c.name).join(', ')} team, so you only see{' '}
              {clients.length === 1 ? 'their' : 'those clients’'} tickets.
            </p>
          )}
        </div>
      </div>

      {error && <div className={styles.error} role="alert">{error}</div>}
      {!tickets && !error && <LoadingState label="Loading client tickets…" />}

      {tickets && (
        <>
          <div className={styles.toolbar}>
            <Input
              className={styles.search}
              label="Search"
              leftIcon={Search}
              placeholder="Number, title, module or client"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            {showClient && (
              <Select label="Client" value={clientId} onChange={(e) => setClientId(e.target.value)}>
                <option value="">All clients</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </Select>
            )}
            <label className={styles.checkbox}>
              <input type="checkbox" checked={mineOnly} onChange={(e) => setMineOnly(e.target.checked)} />
              Assigned to me
            </label>
          </div>
          <div className={`${styles.chips} ${styles.toolbar}`} role="group" aria-label="Filter by status">
            {FILTERS.map((f) => (
              <button key={f.key} type="button" className={styles.chip} aria-pressed={filter === f.key} onClick={() => setFilter(f.key)}>
                {f.label}
                <span className={styles.chipCount}>{scoped.filter(f.match).length}</span>
              </button>
            ))}
          </div>

          <p className="sr-only" role="status">{visible.length} tickets shown</p>
          {visible.length === 0 ? (
            <EmptyState icon={Ticket} title="No tickets here" description="Nothing matches these filters." />
          ) : (
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th scope="col">Ticket</th>
                    <th scope="col">Title</th>
                    {showClient && <th scope="col">Client</th>}
                    <th scope="col">Severity</th>
                    <th scope="col">Module</th>
                    <th scope="col">Status</th>
                    <th scope="col">Assignee</th>
                    <th scope="col">Updated</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((t) => (
                    <tr key={t.id}>
                      <td className={styles.nowrap}><Link href={`/client-tickets/${t.id}`}>{t.key}</Link></td>
                      <td>{t.title}</td>
                      {showClient && <td>{t.clientName}</td>}
                      <td><SeverityBadge severity={t.severity} /></td>
                      <td>{t.moduleName || '—'}</td>
                      <td><StatusBadge status={t.status} audience="team" /></td>
                      <td>{t.assigneeName || <span className={styles.muted}>Unassigned</span>}</td>
                      <td className={styles.nowrap}><time dateTime={t.lastActivityAt}>{formatRelativeTime(t.lastActivityAt)}</time></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </AppShell>
  );
}
