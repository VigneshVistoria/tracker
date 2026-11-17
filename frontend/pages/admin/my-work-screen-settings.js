import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import AppShell from '../../components/AppShell';
import LoadingState from '../../components/ui/LoadingState';
import styles from '../../styles/issues.module.css';
import { apiFetch } from '../../lib/api';
import { useToast } from '../../lib/toast';
import { useConfirm } from '../../lib/confirm';
import { redirectToSignIn } from '../../lib/session';

// "New My work screen" (2026-11-17) - Admin and Program Manager (backend:
// MY_WORK_SCREEN_ROLES, audited). Default OFF: Developer, Designer and
// DevOps see the previous dashboard. On = everyone of those roles gets the
// Working / Submitted "My work" screen; pilot users get it while Off.
// Takes effect the next time the person opens their dashboard - no deploy.
const EDIT_ROLES = ['admin', 'program_manager'];
const ROLE_LABEL = { developer: 'Developer', designer: 'Designer', devops: 'DevOps' };

export default function MyWorkScreenSettingsPage() {
  const router = useRouter();
  const { showToast } = useToast();
  const confirmAction = useConfirm();
  const [data, setData] = useState(null);
  const [enabled, setEnabled] = useState(false);
  const [pilots, setPilots] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const apply = (body) => {
    setData(body);
    setEnabled(body.settings.enabled);
    setPilots(body.settings.pilotUserIds);
  };

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
    apiFetch('/my-work-screen/settings').then(apply).catch((err) => setError(err.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  const changed = data && (enabled !== data.settings.enabled || [...pilots].sort().join() !== [...data.settings.pilotUserIds].sort().join());
  const togglePilot = (id) => setPilots((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  const save = async () => {
    const ok = await confirmAction({
      title: 'Save the My work screen setting?',
      message: enabled
        ? 'Every Developer, Designer and DevOps user will see the new My work screen on their dashboard.'
        : pilots.length
          ? `Only the ${pilots.length} pilot user${pilots.length === 1 ? '' : 's'} will see the new My work screen; everyone else keeps the previous dashboard.`
          : 'Everyone keeps the previous dashboard.',
      confirmLabel: 'Save',
    });
    if (!ok) return;
    setBusy(true);
    setError('');
    try {
      apply(await apiFetch('/my-work-screen/settings', { method: 'PUT', body: JSON.stringify({ enabled, pilotUserIds: pilots }) }));
      showToast('My work screen setting saved', 'success');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AppShell>
      <div className={styles.pageHeader}>
        <div>
          <h1 className={styles.pageTitle}>New My work screen</h1>
          <p className={styles.pageSubtitle}>
            The dashboard for Developers, Designers and DevOps: one Working / Submitted list instead of the summary tiles. Off by
            default. Pilot users get it even while it is Off. Changes apply the next time someone opens their dashboard.
          </p>
        </div>
      </div>

      {error && <div className={styles.error} role="alert">{error}</div>}
      {!data && !error && <LoadingState />}

      {data && (
        <div className={styles.card}>
          <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className={styles.cardTitle}>New My work screen for everyone</legend>
            <label className={styles.checkboxRow}>
              <input type="radio" name="my-work-screen" checked={!enabled} onChange={() => setEnabled(false)} disabled={busy} />
              Off - previous dashboard (pilot users below still get the new screen)
            </label>
            <label className={styles.checkboxRow}>
              <input type="radio" name="my-work-screen" checked={enabled} onChange={() => setEnabled(true)} disabled={busy} />
              On - every Developer, Designer and DevOps user
            </label>
          </fieldset>

          <fieldset style={{ border: 0, padding: 0, margin: 'var(--space-4) 0 0' }} disabled={busy || enabled}>
            <legend className={styles.cardTitle}>Pilot users (optional)</legend>
            {enabled && <p className={styles.helpText}>Not needed while it is On for everyone.</p>}
            {data.users.length === 0 && <p className={styles.helpText}>No Developer, Designer or DevOps users yet.</p>}
            {data.users.map((u) => (
              <label key={u.id} className={styles.checkboxRow}>
                <input type="checkbox" checked={pilots.includes(u.id)} onChange={() => togglePilot(u.id)} />
                {u.name} ({ROLE_LABEL[u.role] || u.role})
              </label>
            ))}
          </fieldset>

          <div style={{ marginTop: 'var(--space-4)' }}>
            <button type="button" className={`${styles.button} ${styles.buttonAccent}`} disabled={!changed || busy} onClick={save}>
              {busy ? 'Saving...' : 'Save'}
            </button>
          </div>
        </div>
      )}
    </AppShell>
  );
}
