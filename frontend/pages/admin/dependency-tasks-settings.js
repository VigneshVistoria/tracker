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
// Dependency attachments (2026-11-14): its own switch per project (backend:
// DEPENDENCY_ATTACHMENTS_SWITCH_ROLES, same roles), also OFF by default.
const EDIT_ROLES = ['admin', 'program_manager'];

const SWITCHES = {
  tasks: {
    field: 'dependencyTasksEnabled',
    name: 'dependency tasks',
    path: (id) => `/task-dependency-tickets/projects/${id}`,
    onText: 'From now on, a dependency ticket raised for someone in the team also creates a task for them, to estimate, commit a due date and resolve. Tickets already raised stay as they are.',
    offText: 'New dependency tickets will no longer create a task. Tasks already created keep working until they are resolved.',
  },
  attachments: {
    field: 'dependencyAttachmentsEnabled',
    name: 'dependency attachments',
    path: (id) => `/task-dependency-tickets/attachment-switches/${id}`,
    onText: 'Whoever raises a dependency can attach files (images, PDF, Word, Excel), and whoever resolves it can add a note and files. Both sides see and download them.',
    offText: 'No new files or resolution notes can be added. Files already attached stay visible and downloadable.',
  },
};

export default function DependencyTasksSettingsPage() {
  const router = useRouter();
  const { showToast } = useToast();
  const confirmAction = useConfirm();
  const [projects, setProjects] = useState(null);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState('');

  const load = () =>
    Promise.all([apiFetch('/task-dependency-tickets/projects'), apiFetch('/task-dependency-tickets/attachment-switches')])
      .then(([tasks, attachments]) => {
        const byId = new Map(attachments.map((a) => [a.id, !!a.dependencyAttachmentsEnabled]));
        setProjects(tasks.map((p) => ({ ...p, dependencyAttachmentsEnabled: !!byId.get(p.id) })));
      })
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

  const toggle = async (project, kind = 'tasks') => {
    const sw = SWITCHES[kind];
    const enabled = !project[sw.field];
    const ok = await confirmAction({
      title: `${enabled ? 'Turn on' : 'Turn off'} ${sw.name} for ${project.name}?`,
      message: enabled ? sw.onText : sw.offText,
      confirmLabel: enabled ? 'Turn on' : 'Turn off',
    });
    if (!ok) return;
    setBusy(`${kind}-${project.id}`);
    setError('');
    try {
      await apiFetch(sw.path(project.id), { method: 'PATCH', body: JSON.stringify({ enabled }) });
      const label = sw.name.charAt(0).toUpperCase() + sw.name.slice(1);
      showToast(`${label} are ${enabled ? 'on' : 'off'} for ${project.name}`, 'success');
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
            Dependency tasks don&apos;t count in KPI, Non-Compliance or Performance Tracking for now. Dependency attachments is a separate
            switch: files when raising a dependency, and a note and files when resolving it.
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
                  <th>Dependency attachments</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {projects.length === 0 && (
                  <tr>
                    <td colSpan={5} className={styles.empty}>No projects yet.</td>
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
                        onClick={() => toggle(p, 'tasks')}
                        aria-label={`${p.dependencyTasksEnabled ? 'Turn off' : 'Turn on'} dependency tasks for ${p.name}`}
                      >
                        {busy === `tasks-${p.id}` ? 'Saving...' : p.dependencyTasksEnabled ? 'Turn off' : 'Turn on'}
                      </button>
                    </td>
                    <td>{p.dependencyAttachmentsEnabled ? 'On' : 'Off'}</td>
                    <td>
                      <button
                        className={p.dependencyAttachmentsEnabled ? styles.buttonSecondary : `${styles.button} ${styles.buttonAccent}`}
                        type="button"
                        disabled={busy !== null}
                        onClick={() => toggle(p, 'attachments')}
                        aria-label={`${p.dependencyAttachmentsEnabled ? 'Turn off' : 'Turn on'} dependency attachments for ${p.name}`}
                      >
                        {busy === `attachments-${p.id}` ? 'Saving...' : p.dependencyAttachmentsEnabled ? 'Turn off' : 'Turn on'}
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
