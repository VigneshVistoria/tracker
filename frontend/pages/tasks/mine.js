import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import AppShell from '../../components/AppShell';
import DeveloperTaskWorkboard from '../../components/DeveloperTaskWorkboard';
import styles from '../../styles/issues.module.css';
import { apiFetch } from '../../lib/api';
import { DEVELOPER_EQUIVALENT_ROLES } from '../../lib/status';
import LoadingState from '../../components/ui/LoadingState';

const VIEW_ROLES = ['admin', 'executive', 'program_manager', 'qa', 'client', ...DEVELOPER_EQUIVALENT_ROLES];

// Remembers which stat card (if any) is expanded below the table, the
// same simple localStorage pattern lib/theme.js already uses for the
// theme preference - null (collapsed) if nothing's been stored yet.
const ACTIVE_CARD_STORAGE_KEY = 'myTasksActiveCard';

export default function MyTasksPage() {
  const router = useRouter();

  const [user, setUser] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [outbound, setOutbound] = useState([]);
  const [inbound, setInbound] = useState([]);
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
    // Both ticket lists for every role (2026-10-07, same rules for all) -
    // each endpoint only ever returns the caller's own tickets. Only
    // Developer/Designer/DevOps can be a ticket's owner, so /mine is
    // simply empty for everyone else.
    Promise.all([
      apiFetch('/tasks/mine'),
      apiFetch('/task-dependency-tickets/mine'),
      apiFetch('/task-dependency-tickets/created-by-me'),
    ])
      .then(([taskList, outboundList, inboundList]) => {
        setTasks(taskList);
        setOutbound(outboundList);
        setInbound(inboundList);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [router]);

  if (!user) return null;

  return (
    <AppShell>
      <div className={styles.pageHeader}>
        <div>
          <h1 className={styles.pageTitle}>My Tasks</h1>
          <p className={styles.pageSubtitle}>
            Tasks assigned to you. Open a task to set Estimated Hours and Due Date, and file a Dependency
            Ticket if you&apos;re blocked.
          </p>
        </div>
      </div>

      {error && <div className={styles.error}>{error}</div>}

      {loading && <LoadingState />}

      {!loading && (
        <DeveloperTaskWorkboard
          tasks={tasks}
          outbound={outbound}
          inbound={inbound}
          loading={loading}
          storageKey={ACTIVE_CARD_STORAGE_KEY}
          userId={user.id}
          showCards={DEVELOPER_EQUIVALENT_ROLES.includes(user.role)}
        />
      )}
    </AppShell>
  );
}
