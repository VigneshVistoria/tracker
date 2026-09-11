import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import AppShell from '../../components/AppShell';
import QaReviewWorkboard from '../../components/QaReviewWorkboard';
import styles from '../../styles/issues.module.css';
import { apiFetch } from '../../lib/api';

const ACTIVE_CARD_STORAGE_KEY = 'qaReviewActiveCard';

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

      <QaReviewWorkboard tasks={tasks} loading={loading} storageKey={ACTIVE_CARD_STORAGE_KEY} />
    </AppShell>
  );
}
