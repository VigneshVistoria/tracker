import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import AppShell from '../../components/AppShell';
import LoadingState from '../../components/ui/LoadingState';
import styles from '../../styles/issues.module.css';
import { apiFetch } from '../../lib/api';
import { useToast } from '../../lib/toast';
import { useConfirm } from '../../lib/confirm';
import { redirectToSignIn } from '../../lib/session';

// PM review gate settings (2026-10-13) - Admin only (backend:
// PmReviewsController). Per project: when on, a developer's task
// submission waits for a Program Manager before QA. Turning a project off
// sends every ticket still waiting for the PM there straight on to QA.
// Tenant-wide: after how many working days the PMs get a reminder, and
// whether Admins get a second one at twice that.
export default function PmReviewSettingsPage() {
  const router = useRouter();
  const { showToast } = useToast();
  const confirmAction = useConfirm();
  const [settings, setSettings] = useState(null);
  const [days, setDays] = useState('2');
  const [toAdmin, setToAdmin] = useState(true);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState('');

  const load = () =>
    apiFetch('/pm-review/settings')
      .then((s) => {
        setSettings(s);
        setDays(String(s.reminder.workingDays));
        setToAdmin(s.reminder.toAdmin);
      })
      .catch((err) => setError(err.message));

  useEffect(() => {
    const stored = localStorage.getItem('user');
    if (!stored) {
      redirectToSignIn(router);
      return;
    }
    if (JSON.parse(stored).role !== 'admin') {
      router.replace('/dashboard');
      return;
    }
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  const toggle = async (project) => {
    const enabled = !project.pmReviewEnabled;
    if (!enabled && project.waitingCount > 0) {
      const ok = await confirmAction({
        title: `Turn off PM review for ${project.name}?`,
        message: `${project.waitingCount} ${project.waitingCount === 1 ? 'ticket is' : 'tickets are'} waiting for the PM in this project. ${project.waitingCount === 1 ? 'It moves' : 'They move'} straight on to QA, as if the PM had sent ${project.waitingCount === 1 ? 'it' : 'them'}.`,
        confirmLabel: 'Turn off',
      });
      if (!ok) return;
    }
    setBusy(`p${project.id}`);
    setError('');
    try {
      const res = await apiFetch(`/pm-review/projects/${project.id}`, { method: 'PATCH', body: JSON.stringify({ enabled }) });
      const moved = res.movedToQaTaskIds?.length || 0;
      showToast(
        enabled
          ? `PM review is on for ${project.name} - new submissions go to the PM first`
          : `PM review is off for ${project.name}${moved ? ` - ${moved} waiting ${moved === 1 ? 'ticket' : 'tickets'} sent to QA` : ''}`,
        'success',
      );
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  };

  const saveReminder = async (e) => {
    e.preventDefault();
    const n = Number(days);
    if (!Number.isInteger(n) || n < 1 || n > 30) {
      setError('Working days must be a whole number from 1 to 30.');
      return;
    }
    setBusy('reminder');
    setError('');
    try {
      await apiFetch('/pm-review/reminder-settings', { method: 'PATCH', body: JSON.stringify({ workingDays: n, toAdmin }) });
      showToast('Reminder settings saved', 'success');
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
          <h1 className={styles.pageTitle}>PM Review Settings</h1>
          <p className={styles.pageSubtitle}>
            When a project has PM review on, a developer&apos;s task submission waits for a Program Manager before QA sees it.
            Defects and Peer Review tasks always skip it. Time waiting for the PM never counts against the developer.
          </p>
        </div>
      </div>

      {error && <div className={styles.error} role="alert">{error}</div>}
      {!settings && !error && <LoadingState />}

      {settings && (
        <>
          <div className={styles.card} style={{ marginBottom: 'var(--space-4)' }}>
            <h2 className={styles.cardTitle}>Projects</h2>
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Project</th>
                    <th>PM review</th>
                    <th>Waiting for PM</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {settings.projects.length === 0 && (
                    <tr>
                      <td colSpan={4} className={styles.empty}>No projects yet.</td>
                    </tr>
                  )}
                  {settings.projects.map((p) => (
                    <tr key={p.id}>
                      <td>{p.name}</td>
                      <td>{p.pmReviewEnabled ? 'On' : 'Off'}</td>
                      <td>{p.waitingCount}</td>
                      <td>
                        <button
                          className={p.pmReviewEnabled ? styles.buttonSecondary : `${styles.button} ${styles.buttonAccent}`}
                          type="button"
                          disabled={busy !== null}
                          onClick={() => toggle(p)}
                          aria-label={`${p.pmReviewEnabled ? 'Turn off' : 'Turn on'} PM review for ${p.name}`}
                        >
                          {busy === `p${p.id}` ? 'Saving...' : p.pmReviewEnabled ? 'Turn off' : 'Turn on'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <form className={styles.card} onSubmit={saveReminder}>
            <h2 className={styles.cardTitle}>Reminders</h2>
            <p className={styles.helpText} style={{ marginTop: 0 }}>
              In-app reminders for tickets that wait too long for the PM. Each goes out once per ticket.
            </p>
            <div className={styles.field} style={{ maxWidth: 320 }}>
              <label className={styles.label} htmlFor="pmReminderDays">Remind the Program Managers after more than (working days)</label>
              <input
                id="pmReminderDays"
                className={styles.input}
                type="number"
                min={1}
                max={30}
                value={days}
                onChange={(e) => setDays(e.target.value)}
              />
            </div>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="pmReminderToAdmin" style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
                <input id="pmReminderToAdmin" type="checkbox" checked={toAdmin} onChange={(e) => setToAdmin(e.target.checked)} />
                Also remind Admins after more than {Number(days) > 0 ? Number(days) * 2 : '2×'} working days
              </label>
            </div>
            <div className={styles.actions}>
              <button className={`${styles.button} ${styles.buttonAccent}`} type="submit" disabled={busy !== null}>
                {busy === 'reminder' ? 'Saving...' : 'Save'}
              </button>
            </div>
          </form>
        </>
      )}
    </AppShell>
  );
}
