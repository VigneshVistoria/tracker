import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import AppShell, { resetRequirementsMe } from '../../components/AppShell';
import LoadingState from '../../components/ui/LoadingState';
import styles from '../../styles/issues.module.css';
import { apiFetch } from '../../lib/api';
import { useToast } from '../../lib/toast';
import { useConfirm } from '../../lib/confirm';
import { redirectToSignIn } from '../../lib/session';

// Requirements traceability switch "requirements_tree" (2026-11-25) - Admin
// and Program Manager (backend: REQUIREMENTS_SETTINGS_ROLES, audited).
// Default OFF: no Requirements link, and every Requirements page and API
// answers "not found". On: Admin, PM and Executive see every project's SRS;
// QA only the projects they are on.
const EDIT_ROLES = ['admin', 'program_manager'];

export default function RequirementsSettingsPage() {
  const router = useRouter();
  const { showToast } = useToast();
  const confirmAction = useConfirm();
  const [saved, setSaved] = useState(null);
  const [on, setOn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

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
    apiFetch('/requirements/settings')
      .then((body) => {
        setSaved(body.requirementsTree);
        setOn(body.requirementsTree);
      })
      .catch((err) => setError(err.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  const save = async () => {
    const ok = await confirmAction({
      title: on ? 'Switch Requirements on?' : 'Switch Requirements off?',
      message: on
        ? 'Admin, Program Manager and Executive will see Requirements for every project; QA and BA for the projects they are on. BA, PM and Admin edit stories; QA, PM and Admin record Pass/Fail. The BA role can be given to users.'
        : 'The Requirements link and pages disappear for everyone, and BA users have nothing to use. Nothing is deleted; switching it back on shows everything as it was.',
      confirmLabel: on ? 'Switch on' : 'Switch off',
    });
    if (!ok) return;
    setBusy(true);
    setError('');
    try {
      const body = await apiFetch('/requirements/settings', { method: 'PUT', body: JSON.stringify({ requirementsTree: on }) });
      setSaved(body.requirementsTree);
      setOn(body.requirementsTree);
      resetRequirementsMe();
      showToast(`Requirements switched ${body.requirementsTree ? 'on' : 'off'}`, 'success');
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
          <h1 className={styles.pageTitle}>Requirements</h1>
          <p className={styles.pageSubtitle}>
            The SRS traceability tree: SRS → Epic → User story → Acceptance criteria → linked tickets, with progress from criteria passed. Off by default.
            The menu link appears on the next page you open.
          </p>
        </div>
      </div>

      {error && <div className={styles.error} role="alert">{error}</div>}
      {saved === null && !error && <LoadingState />}

      {saved !== null && (
        <div className={styles.card}>
          <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className={styles.cardTitle}>Requirements (requirements_tree)</legend>
            <label className={styles.checkboxRow}>
              <input type="radio" name="requirements-tree" checked={!on} onChange={() => setOn(false)} disabled={busy} />
              Off - nobody sees Requirements
            </label>
            <label className={styles.checkboxRow}>
              <input type="radio" name="requirements-tree" checked={on} onChange={() => setOn(true)} disabled={busy} />
              On - Admin, Program Manager, Executive, and QA and BA on their projects
            </label>
          </fieldset>
          <div style={{ marginTop: 'var(--space-4)' }}>
            <button type="button" className={`${styles.button} ${styles.buttonAccent}`} disabled={on === saved || busy} onClick={save}>
              {busy ? 'Saving...' : 'Save'}
            </button>
          </div>
        </div>
      )}
    </AppShell>
  );
}
