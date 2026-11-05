import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import AppShell from '../../components/AppShell';
import LoadingState from '../../components/ui/LoadingState';
import styles from '../../styles/issues.module.css';
import { apiFetch } from '../../lib/api';
import { useToast } from '../../lib/toast';
import { useConfirm } from '../../lib/confirm';
import { redirectToSignIn } from '../../lib/session';

// Dependency tasks switch (Stage 2, 2026-11-05) - Admin and Program Manager
// (backend: DEPENDENCY_TASKS_SWITCH_ROLES). Per project, OFF by default:
// when on, a dependency ticket raised for someone in the team also creates
// a task for them (estimate, committed due date, progress notes, Resolve).
// Switching affects new tickets only; existing ones and their tasks stay.
const EDIT_ROLES = ['admin', 'program_manager'];

export default function DependencyTasksSettingsPage() {
  const router = useRouter();
  const { showToast } = useToast();
  const confirmAction = useConfirm();
  const [projects, setProjects] = useState(null);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState('');

  const load = () =>
    apiFetch('/task-dependency-tickets/projects')
      .then(setProjects)
      .catch((err) => setError(err.message));

  useEffect(() => {
    const stored = localStorage.getItem('user');
    if (!stored) {
      redirectToSignIn(router);
      return;
    }
    if (!EDIT_ROLES.includes(JSON.parse(stored).role)) {
      router.replace('/dashboard');
      return;
    }
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  const toggle = async (project) => {
    const enabled = !project.dependencyTasksEnabled;
    const ok = await confirmAction({
      title: `${enabled ? 'Turn on' : 'Turn off'} dependency tasks for ${project.name}?`,
      message: enabled
        ? 'From now on, a dependency ticket raised for someone in the team also creates a task for them, to estimate, commit a due date and resolve. Tickets already raised stay as they are.'
        : 'New dependency tickets will no longer create a task. Tasks already created keep working until they are resolved.',
      confirmLabel: enabled ? 'Turn on' : 'Turn off',
    });
    if (!ok) return;
    setBusy(project.id);
    setError('');
    try {
      await apiFetch(`/task-dependency-tickets/projects/${project.id}`, { method: 'PATCH', body: JSON.stringify({ enabled }) });
      showToast(`Dependency tasks are ${enabled ? 'on' : 'off'} for ${project.name}`, 'success');
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <AppShell>
      <div className={styles.pageHeader}>
        <div>
          <h1 className={styles.pageTitle}>Dependency Tasks</h1>
          <p className={styles.pageSubtitle}>
            When a project has this on, a dependency ticket raised for someone in the team also creates a task for them. They give an
            estimate and a due date, post progress notes, and Resolve it when done (no review). The parent task stays blocked until then.
            Dependency tasks don&apos;t count in KPI, Non-Compliance or Performance Tracking for now.
          </p>
        </div>
      </div>

      {error && <div className={styles.error} role="alert">{error}</div>}
      {!projects && !error && <LoadingState />}

      {projects && (
        <div className={styles.card}>
          <h2 className={styles.cardTitle}>Projects</h2>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Project</th>
                  <th>Dependency tasks</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {projects.length === 0 && (
                  <tr>
                    <td colSpan={3} className={styles.empty}>No projects yet.</td>
                  </tr>
                )}
                {projects.map((p) => (
                  <tr key={p.id}>
                    <td>{p.name}</td>
                    <td>{p.dependencyTasksEnabled ? 'On' : 'Off'}</td>
                    <td>
                      <button
                        className={p.dependencyTasksEnabled ? styles.buttonSecondary : `${styles.button} ${styles.buttonAccent}`}
                        type="button"
                        disabled={busy !== null}
                        onClick={() => toggle(p)}
                        aria-label={`${p.dependencyTasksEnabled ? 'Turn off' : 'Turn on'} dependency tasks for ${p.name}`}
                      >
                        {busy === p.id ? 'Saving...' : p.dependencyTasksEnabled ? 'Turn off' : 'Turn on'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </AppShell>
  );
}
