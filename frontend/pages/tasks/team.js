import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import AppShell from '../../components/AppShell';
import TeamTaskWorkboard from '../../components/TeamTaskWorkboard';
import styles from '../../styles/issues.module.css';

// Admin/Executive/Program Manager only - leadership-wide, same visibility
// grant TasksService.LEADERSHIP_ROLES gives those roles elsewhere (Task
// Backlog, findAllForUser). Not project-scoped: Admin, Executive, and
// Program Manager all see every project's tasks here, matching the
// dominant pattern used by Project Modules/Phases/Planning/Teams rather
// than Sprints' narrower one. Edit rights (reassign, due date, etc.) are
// enforced on the task detail page itself via the existing PM-only
// MUTATE_ROLES check - Admin and Executive can open any task from here but
// stay view-only, exactly as they are everywhere else in the Tasks module.
const VIEW_ROLES = ['admin', 'executive', 'program_manager'];

const ACTIVE_CARD_STORAGE_KEY = 'teamTasksActiveCard';

export default function TeamTasksPage() {
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
          <h1 className={styles.pageTitle}>Team Tasks</h1>
          <p className={styles.pageSubtitle}>
            Every team member&apos;s assigned tasks in one place.
            {user.role === 'program_manager'
              ? ' Open a task to reassign it, change its due date, or edit other details.'
              : ' View-only - open a task to see its full detail.'}
          </p>
        </div>
      </div>

      <TeamTaskWorkboard storageKey={ACTIVE_CARD_STORAGE_KEY} />
    </AppShell>
  );
}
