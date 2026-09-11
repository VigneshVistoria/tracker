import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import AppShell from '../../components/AppShell';
import QaReviewWorkboard from '../../components/QaReviewWorkboard';
import styles from '../../styles/issues.module.css';

const ACTIVE_CARD_STORAGE_KEY = 'qaReviewActiveCard';

const VIEW_ROLES = ['admin', 'executive', 'program_manager', 'qa'];

export default function QaReviewQueuePage() {
  const router = useRouter();

  const [user, setUser] = useState(null);

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

      <QaReviewWorkboard storageKey={ACTIVE_CARD_STORAGE_KEY} />
    </AppShell>
  );
}
