import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import AppShell from '../../components/AppShell';
import LoadingState from '../../components/ui/LoadingState';
import styles from '../../styles/issues.module.css';
import { apiFetch } from '../../lib/api';
import { useToast } from '../../lib/toast';
import { useConfirm } from '../../lib/confirm';
import { redirectToSignIn } from '../../lib/session';

// Hand over to development switch (2026-11-12) - Admin and Program Manager
// (backend: DESIGN_HANDOVER_SWITCH_ROLES, audited). Per project, OFF by
// default: when on, a Designer's task offers "Hand over to development".
// Off stops new handovers; ones already waiting can still be decided.
const EDIT_ROLES = ['admin', 'program_manager'];

export default function DesignHandoverSettingsPage() {
  const router = useRouter();
  const { showToast } = useToast();
  const confirmAction = useConfirm();
  const [projects, setProjects] = useState(null);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState('');

  const load = () =>
    apiFetch('/design-handovers/projects')
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
    const enabled = !project.designHandoverEnabled;
    const ok = await confirmAction({
      title: `${enabled ? 'Turn on' : 'Turn off'} Hand over to development for ${project.name}?`,
      message: enabled
        ? 'Designers on this project can hand a design task to a developer. When the developer accepts, the design task moves to Pass and they build it in one of their tasks.'
        : 'No new handovers can be started. Handovers already waiting can still be accepted, rejected or cancelled.',
      confirmLabel: enabled ? 'Turn on' : 'Turn off',
    });
    if (!ok) return;
    setBusy(project.id);
    setError('');
    try {
      await apiFetch(`/design-handovers/projects/${project.id}`, { method: 'PATCH', body: JSON.stringify({ enabled }) });
      showToast(`Hand over to development is ${enabled ? 'on' : 'off'} for ${project.name}`, 'success');
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
          <h1 className={styles.pageTitle}>Hand over to development</h1>
          <p className={styles.pageSubtitle}>
            When a project has this on, a designer (or a Program Manager for them) can hand a design task to a developer with notes and
            links. The developer accepts by linking one of their tasks or creating one; the design task then moves to Pass without a QA
            round. Design tasks closed this way don&apos;t count in KPI, Non-Compliance or Performance Tracking for now.
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
                  <th>Hand over to development</th>
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
                    <td>{p.designHandoverEnabled ? 'On' : 'Off'}</td>
                    <td>
                      <button
                        className={p.designHandoverEnabled ? styles.buttonSecondary : `${styles.button} ${styles.buttonAccent}`}
                        type="button"
                        disabled={busy !== null}
                        onClick={() => toggle(p)}
                        aria-label={`${p.designHandoverEnabled ? 'Turn off' : 'Turn on'} Hand over to development for ${p.name}`}
                      >
                        {busy === p.id ? 'Saving...' : p.designHandoverEnabled ? 'Turn off' : 'Turn on'}
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
