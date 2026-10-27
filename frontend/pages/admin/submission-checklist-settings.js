import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import AppShell from '../../components/AppShell';
import LoadingState from '../../components/ui/LoadingState';
import styles from '../../styles/issues.module.css';
import { apiFetch } from '../../lib/api';
import { useToast } from '../../lib/toast';
import { redirectToSignIn } from '../../lib/session';
import { CHECKLIST_LABELS } from '../../components/SubmissionChecklist';

// Submission checklist settings (defect triage Stage 2, 2026-10-27) - Admin
// and Program Manager (backend: SubmissionChecklistController). Per project:
// the switch (off by default). Tenant-wide: the root causes, which items are
// required for defect fixes and for tasks, which artifact types count as the
// change link / self-test evidence, and the minimum text length. Each round
// keeps what was submitted, so editing these never changes history. Mirrors
// backend/src/tasks/submission-checklist.ts.
const EDIT_ROLES = ['admin', 'program_manager'];
const ITEM_MAX = 100;
const MAX_ITEMS = 30;
const MIN_TEXT_MAX = 200;
// Mirrors TaskArtifactType (task-qa-review.entity.ts).
const ARTIFACT_TYPES = ['APK Build', 'Build Pipeline Link', 'Deployment Report', 'Pull Request Link', 'Screenshot', 'Demo Video', 'Technical Documentation'];
const ITEMS = ['rootCause', 'changeLink', 'testSteps', 'testData', 'evidence', 'affectedAreas', 'buildConfirmation'];

export default function SubmissionChecklistSettingsPage() {
  const router = useRouter();
  const { showToast } = useToast();
  const [page, setPage] = useState(null);
  const [minText, setMinText] = useState('10');
  const [newCause, setNewCause] = useState('');
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState('');

  const load = () =>
    apiFetch('/submission-checklist/settings')
      .then((p) => {
        setPage(p);
        setMinText(String(p.settings.minTextLength));
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

  const save = async (next, message) => {
    setBusy('settings');
    setError('');
    try {
      const saved = await apiFetch('/submission-checklist/settings', { method: 'PATCH', body: JSON.stringify(next) });
      setPage((p) => ({ ...p, settings: saved }));
      setMinText(String(saved.minTextLength));
      showToast(message, 'success');
      return true;
    } catch (err) {
      setError(err.message);
      return false;
    } finally {
      setBusy(null);
    }
  };

  const toggleProject = async (project) => {
    const enabled = !project.submissionChecklistEnabled;
    setBusy(`p${project.id}`);
    setError('');
    try {
      await apiFetch(`/submission-checklist/projects/${project.id}`, { method: 'PATCH', body: JSON.stringify({ enabled }) });
      showToast(
        enabled ? `Submission checklist is on for ${project.name} - from the next submission` : `Submission checklist is off for ${project.name}`,
        'success',
      );
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  };

  if (!page) {
    return (
      <AppShell>
        {error ? (
          <div className={styles.error} role="alert">
            {error}
          </div>
        ) : (
          <LoadingState />
        )}
      </AppShell>
    );
  }

  const s = page.settings;
  const toggleRequired = (kind, item) => {
    const list = s.required[kind];
    const next = list.includes(item) ? list.filter((i) => i !== item) : [...list, item];
    save({ ...s, required: { ...s.required, [kind]: next } }, `${CHECKLIST_LABELS[item]} is now ${next.includes(item) ? 'required' : 'optional'} for ${kind === 'defect' ? 'defect fixes' : 'tasks'}`);
  };
  const toggleType = (key, type) => {
    const list = s[key];
    save({ ...s, [key]: list.includes(type) ? list.filter((t) => t !== type) : [...list, type] }, 'Saved');
  };
  const moveCause = (index, delta) => {
    const next = [...s.rootCauses];
    const [item] = next.splice(index, 1);
    next.splice(index + delta, 0, item);
    save({ ...s, rootCauses: next }, 'Order saved');
  };
  const addCause = async (e) => {
    e.preventDefault();
    const label = newCause.trim();
    if (!label) return;
    if (s.rootCauses.some((c) => c.label.toLowerCase() === label.toLowerCase())) {
      setError(`"${label}" is already on the list.`);
      return;
    }
    if (await save({ ...s, rootCauses: [...s.rootCauses, { label, needsNote: false }] }, `Added "${label}"`)) setNewCause('');
  };
  const saveMinText = (e) => {
    e.preventDefault();
    const n = Number(minText);
    if (!Number.isInteger(n) || n < 1 || n > MIN_TEXT_MAX) {
      setError(`Minimum length must be a whole number from 1 to ${MIN_TEXT_MAX}.`);
      return;
    }
    save({ ...s, minTextLength: n }, 'Minimum length saved');
  };

  return (
    <AppShell>
      <div className={styles.pageHeader}>
        <div>
          <h1 className={styles.pageTitle}>Submission Checklist Settings</h1>
          <p className={styles.pageSubtitle}>
            When a project has the checklist on, a developer can&apos;t submit a task or defect fix for QA until the required items are
            done - the form and the server name exactly what is missing. Peer Review submissions are not affected.
          </p>
        </div>
      </div>

      {error && (
        <div className={styles.error} role="alert">
          {error}
        </div>
      )}

      <div className={styles.card} style={{ marginBottom: 'var(--space-4)' }}>
        <h2 className={styles.cardTitle}>Projects</h2>
        <p className={styles.helpText} style={{ marginTop: 0 }}>
          Off by default. Applies from the next submission - rounds already submitted are not re-checked.
        </p>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Project</th>
                <th>Submission checklist</th>
              </tr>
            </thead>
            <tbody>
              {page.projects.map((p) => (
                <tr key={p.id}>
                  <td>{p.name}</td>
                  <td>
                    <button
                      type="button"
                      className={p.submissionChecklistEnabled ? `${styles.button} ${styles.buttonAccent}` : styles.buttonSecondary}
                      onClick={() => toggleProject(p)}
                      disabled={busy !== null}
                      aria-pressed={p.submissionChecklistEnabled}
                      aria-label={`Submission checklist for ${p.name}: ${p.submissionChecklistEnabled ? 'on' : 'off'}`}
                    >
                      {busy === `p${p.id}` ? 'Saving...' : p.submissionChecklistEnabled ? 'On' : 'Off'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className={styles.card} style={{ marginBottom: 'var(--space-4)' }}>
        <h2 className={styles.cardTitle}>Required items</h2>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Item</th>
                <th>Defect fixes</th>
                <th>Tasks</th>
              </tr>
            </thead>
            <tbody>
              {ITEMS.map((item) => (
                <tr key={item}>
                  <td>{CHECKLIST_LABELS[item]}</td>
                  <td>
                    <input
                      type="checkbox"
                      checked={s.required.defect.includes(item)}
                      onChange={() => toggleRequired('defect', item)}
                      disabled={busy !== null}
                      aria-label={`${CHECKLIST_LABELS[item]} required for defect fixes`}
                    />
                  </td>
                  <td>
                    {item === 'rootCause' ? (
                      <span className={styles.issueMeta}>Defects only</span>
                    ) : (
                      <input
                        type="checkbox"
                        checked={s.required.task.includes(item)}
                        onChange={() => toggleRequired('task', item)}
                        disabled={busy !== null}
                        aria-label={`${CHECKLIST_LABELS[item]} required for tasks`}
                      />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <form onSubmit={saveMinText} className={styles.actions} style={{ alignItems: 'end' }}>
          <div className={styles.field} style={{ marginBottom: 0 }}>
            <label className={styles.label} htmlFor="ckMinText">
              Minimum characters for text items
            </label>
            <input id="ckMinText" className={styles.input} type="number" min={1} max={MIN_TEXT_MAX} value={minText} onChange={(e) => setMinText(e.target.value)} style={{ maxWidth: 120 }} />
          </div>
          <button className={`${styles.button} ${styles.buttonAccent}`} type="submit" disabled={busy !== null}>
            Save
          </button>
        </form>
      </div>

      <div className={styles.card} style={{ marginBottom: 'var(--space-4)' }}>
        <h2 className={styles.cardTitle}>Artifact types</h2>
        {[
          ['linkArtifactTypes', 'Count as the "What changed" link'],
          ['evidenceArtifactTypes', 'Count as evidence of self-test (pasted screenshots always count)'],
        ].map(([key, title]) => (
          <fieldset key={key} style={{ border: 0, padding: 0, margin: '0 0 var(--space-3)' }}>
            <legend className={styles.label} style={{ padding: 0 }}>
              {title}
            </legend>
            {ARTIFACT_TYPES.map((t) => (
              <label key={t} style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-1)', marginRight: 'var(--space-4)' }}>
                <input
                  type="checkbox"
                  checked={s[key].includes(t)}
                  onChange={() => toggleType(key, t)}
                  disabled={busy !== null || (s[key].length === 1 && s[key].includes(t))}
                />
                {t}
              </label>
            ))}
          </fieldset>
        ))}
      </div>

      <div className={styles.card} style={{ marginBottom: 'var(--space-4)' }}>
        <h2 className={styles.cardTitle}>Root causes (defect fixes)</h2>
        <p className={styles.helpText} style={{ marginTop: 0 }}>
          Shown in this order. &quot;Needs a note&quot; asks the developer to explain. At least one is needed.
        </p>
        <ol style={{ margin: '0 0 var(--space-4)', paddingLeft: 'var(--space-5)' }}>
          {s.rootCauses.map((c, i) => (
            <li key={c.label} style={{ marginBottom: 'var(--space-2)' }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
                <span>{c.label}</span>
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-1)' }}>
                  <input
                    type="checkbox"
                    checked={c.needsNote}
                    onChange={() =>
                      save({ ...s, rootCauses: s.rootCauses.map((x, j) => (j === i ? { ...x, needsNote: !x.needsNote } : x)) }, `"${c.label}" ${c.needsNote ? 'no longer needs' : 'now needs'} a note`)
                    }
                    disabled={busy !== null}
                  />
                  Needs a note
                </label>
                <button className={styles.buttonSecondary} type="button" onClick={() => moveCause(i, -1)} disabled={busy !== null || i === 0} aria-label={`Move "${c.label}" up`}>
                  Up
                </button>
                <button
                  className={styles.buttonSecondary}
                  type="button"
                  onClick={() => moveCause(i, 1)}
                  disabled={busy !== null || i === s.rootCauses.length - 1}
                  aria-label={`Move "${c.label}" down`}
                >
                  Down
                </button>
                <button
                  className={styles.buttonSecondary}
                  type="button"
                  onClick={() => save({ ...s, rootCauses: s.rootCauses.filter((x) => x.label !== c.label) }, `Removed "${c.label}"`)}
                  disabled={busy !== null || s.rootCauses.length === 1}
                  aria-label={`Remove "${c.label}"`}
                >
                  Remove
                </button>
              </span>
            </li>
          ))}
        </ol>
        <form onSubmit={addCause} className={styles.actions} style={{ alignItems: 'end' }}>
          <div className={styles.field} style={{ marginBottom: 0, flex: '1 1 260px' }}>
            <label className={styles.label} htmlFor="ckNewCause">
              New root cause
            </label>
            <input
              id="ckNewCause"
              className={styles.input}
              value={newCause}
              maxLength={ITEM_MAX}
              onChange={(e) => setNewCause(e.target.value)}
              placeholder="e.g. Performance regression"
              disabled={busy !== null || s.rootCauses.length >= MAX_ITEMS}
            />
          </div>
          <button className={`${styles.button} ${styles.buttonAccent}`} type="submit" disabled={busy !== null || !newCause.trim() || s.rootCauses.length >= MAX_ITEMS}>
            Add
          </button>
        </form>
      </div>
    </AppShell>
  );
}
