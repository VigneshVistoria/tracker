import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import AppShell from '../../components/AppShell';
import styles from '../../styles/issues.module.css';
import { apiFetch } from '../../lib/api';
import { DEVELOPER_EQUIVALENT_ROLES } from '../../lib/status';
import DependencyTicketBoard from '../../components/taskViews/DependencyTicketBoard';

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

      <DependencyTicketBoard
        tickets={tickets}
        direction="outbound"
        title="Waiting on you"
        storageKey="dependencyClearanceTickets"
        userId={user.id}
        loading={loading}
      />
    </AppShell>
  );
}
