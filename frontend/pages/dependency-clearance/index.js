import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import AppShell from '../../components/AppShell';
import styles from '../../styles/issues.module.css';
import { apiFetch } from '../../lib/api';
import { DEVELOPER_EQUIVALENT_ROLES } from '../../lib/status';
import { formatDate } from '../../lib/formatDate';

const VIEW_ROLES = DEVELOPER_EQUIVALENT_ROLES;

export default function DependencyClearancePage() {
  const router = useRouter();

  const [user, setUser] = useState(null);
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const storedUser = localStorage.getItem('user');
    if (!storedUser) {
      router.replace('/');
      return;
    }
    const parsed = JSON.parse(storedUser);
    if (!VIEW_ROLES.includes(parsed.role)) {
      router.replace('/dashboard');
      return;
    }
    setUser(parsed);
    setLoading(true);
    apiFetch('/task-dependency-tickets/mine')
      .then(setTickets)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [router]);

  if (!user) return null;

  return (
    <AppShell>
      <div className={styles.pageHeader}>
        <div>
          <h1 className={styles.pageTitle}>Dependency Clearance</h1>
          <p className={styles.pageSubtitle}>
            Dependency Tickets routed to you by task Assignees waiting on your work.
          </p>
        </div>
      </div>

      {error && <div className={styles.error}>{error}</div>}

      {loading && <div className={styles.empty}>Loading...</div>}

      {!loading && tickets.length === 0 && (
        <div className={styles.card}>
          <div className={styles.empty}>No dependency tickets are waiting on you right now.</div>
        </div>
      )}

      {!loading && tickets.map((ticket) => (
        <div key={ticket.id} className={styles.card} style={{ marginBottom: 'var(--space-3)' }}>
          <p style={{ margin: 0 }}>{ticket.description}</p>
          <p className={styles.issueMeta} style={{ margin: 'var(--space-1) 0 0' }}>
            Filed by {ticket.createdByEmail} &middot; {formatDate(ticket.createdAt)}
          </p>
          <div className={styles.actions} style={{ marginTop: 'var(--space-3)' }}>
            <Link href={`/tasks/${ticket.parentTaskId}`} className={styles.backLink} target="_blank" rel="noopener noreferrer">
              View parent task &rarr;
            </Link>
          </div>
        </div>
      ))}
    </AppShell>
  );
}
