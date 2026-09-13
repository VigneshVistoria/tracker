import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import AppShell from '../../components/AppShell';
import QaReviewWorkboard from '../../components/QaReviewWorkboard';
import styles from '../../styles/issues.module.css';

const ACTIVE_CARD_STORAGE_KEY = 'myDefectsActiveCard';

const VIEW_ROLES = ['qa'];

export default function MyDefectsPage() {
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
          <h1 className={styles.pageTitle}>My Defects</h1>
          <p className={styles.pageSubtitle}>
            Defect tickets you raised, waiting on your feedback once the assignee submits them - unlike QA Review,
            this queue is scoped to just you, since a defect's feedback always routes back to whoever raised it.
          </p>
        </div>
        <Link href="/tasks/new-defect" className={`${styles.button} ${styles.buttonAccent}`}>
          Create Defect
        </Link>
      </div>

      <QaReviewWorkboard storageKey={ACTIVE_CARD_STORAGE_KEY} endpoint="/tasks/defect-queue" />
    </AppShell>
  );
}
