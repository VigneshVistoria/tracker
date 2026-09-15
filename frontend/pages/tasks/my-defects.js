import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import AppShell from '../../components/AppShell';
import QaReviewWorkboard from '../../components/QaReviewWorkboard';
import styles from '../../styles/issues.module.css';

const ACTIVE_CARD_STORAGE_KEY = 'myDefectsActiveCard';

// QA sees their own defects; Admin/Program Manager see every QA person's
// defects tenant-wide instead, since they have no "my own" concept here
// (TasksService.findDefectQueue()). Only QA can reach Create Defect below -
// Admin/Program Manager get the same view-only access they have everywhere
// else in Tasks.
const VIEW_ROLES = ['qa', 'admin', 'program_manager'];

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
            {user.role === 'qa'
              ? "Defect tickets you raised, waiting on your feedback once the assignee submits them - unlike QA Review, this queue is scoped to just you, since a defect's feedback always routes back to whoever raised it."
              : 'Every defect ticket raised by QA across the tenant, waiting on the raiser\'s feedback once the assignee submits it.'}
          </p>
        </div>
        {user.role === 'qa' && (
          <Link href="/tasks/new-defect" className={`${styles.button} ${styles.buttonAccent}`}>
            Create Defect
          </Link>
        )}
      </div>

      <QaReviewWorkboard storageKey={ACTIVE_CARD_STORAGE_KEY} endpoint="/tasks/defect-queue" showDefectColumns />
    </AppShell>
  );
}
