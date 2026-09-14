import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { Maximize2, Minimize2 } from 'lucide-react';
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
  // Hides the sidebar/top nav (AppShell's fullScreen prop) so the task
  // table/tiles fill the whole screen - useful for screen-sharing in
  // meetings. Defaults on (confirmed with the user 2026-09) since this
  // page is opened for that purpose often enough to make it the default
  // rather than an extra click. Plain component state, not persisted -
  // it's a per-session view, not a standing preference.
  const [fullScreen, setFullScreen] = useState(true);

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
    <AppShell fullScreen={fullScreen}>
      <div className={styles.pageHeader}>
        <div>
          <h1 className={styles.pageTitle}>Team Tasks</h1>
        </div>
        <button
          type="button"
          className={styles.buttonSecondary}
          onClick={() => setFullScreen((v) => !v)}
        >
          {fullScreen ? <Minimize2 size={16} aria-hidden="true" /> : <Maximize2 size={16} aria-hidden="true" />}
          {fullScreen ? 'Exit Full Screen' : 'Full Screen'}
        </button>
      </div>

      <TeamTaskWorkboard storageKey={ACTIVE_CARD_STORAGE_KEY} fullScreen={fullScreen} />
    </AppShell>
  );
}
