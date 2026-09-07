import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import AppShell from '../../components/AppShell';
import DeveloperTaskWorkboard from '../../components/DeveloperTaskWorkboard';
import styles from '../../styles/issues.module.css';
import { apiFetch } from '../../lib/api';

const VIEW_ROLES = ['admin', 'executive', 'program_manager', 'qa', 'developer'];

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
    const isDeveloper = parsed.role === 'developer';
    Promise.all([
      apiFetch('/tasks/mine'),
      isDeveloper ? apiFetch('/task-dependency-tickets/mine') : Promise.resolve([]),
      isDeveloper ? apiFetch('/task-dependency-tickets/created-by-me') : Promise.resolve([]),
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

      {loading && <div className={styles.empty}>Loading...</div>}

      {!loading && (
        <DeveloperTaskWorkboard
          tasks={tasks}
          outbound={outbound}
          inbound={inbound}
          loading={loading}
          storageKey={ACTIVE_CARD_STORAGE_KEY}
          showCards={user.role === 'developer'}
        />
      )}
    </AppShell>
  );
}
