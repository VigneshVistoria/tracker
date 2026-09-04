import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import AppShell from '../../components/AppShell';
import styles from '../../styles/issues.module.css';
import { apiFetch } from '../../lib/api';

const VIEW_ROLES = ['admin', 'executive', 'program_manager', 'qa'];

export default function QaReviewQueuePage() {
  const router = useRouter();

  const [user, setUser] = useState(null);
  const [tasks, setTasks] = useState([]);
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
    apiFetch('/tasks/qa-queue')
      .then(setTasks)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [router]);

  if (!user) return null;

  return (
    <AppShell>
      <div className={styles.pageHeader}>
        <div>
          <h1 className={styles.pageTitle}>QA Review</h1>
          <p className={styles.pageSubtitle}>
            Tasks the Assignee has submitted for QA testing, waiting on your review.
          </p>
        </div>
      </div>

      {error && <div className={styles.error}>{error}</div>}

      {loading && <div className={styles.empty}>Loading...</div>}

      {!loading && tasks.length === 0 && (
        <div className={styles.card}>
          <div className={styles.empty}>No tasks are waiting on QA review right now.</div>
        </div>
      )}

      {!loading && tasks.map((task) => (
        <div key={task.id} className={styles.card} style={{ marginBottom: 'var(--space-3)' }}>
          <p style={{ margin: 0 }}>{task.description}</p>
          <p className={styles.issueMeta} style={{ margin: 'var(--space-1) 0 0' }}>
            {task.projectName} &middot; {task.moduleName} &middot; {task.phaseName}
          </p>
          <p className={styles.issueMeta} style={{ margin: 'var(--space-1) 0 0' }}>
            Assignee: {task.assigneeEmail || 'Unassigned'}
          </p>
          <div className={styles.actions} style={{ marginTop: 'var(--space-3)' }}>
            <Link href={`/tasks/${task.id}`} className={styles.backLink}>
              Review task &rarr;
            </Link>
          </div>
        </div>
      ))}
    </AppShell>
  );
}
