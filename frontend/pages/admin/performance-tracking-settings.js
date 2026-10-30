import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import AppShell from '../../components/AppShell';
import LoadingState from '../../components/ui/LoadingState';
import styles from '../../styles/issues.module.css';
import { apiFetch } from '../../lib/api';
import { useToast } from '../../lib/toast';
import { useConfirm } from '../../lib/confirm';
import { redirectToSignIn } from '../../lib/session';
import { formatDate } from '../../lib/formatDate';

// Matches PERFORMANCE_TRACKING_SETTINGS_ROLES (backend/src/performance-
// tracking/performance-tracking.ts).
const EDIT_ROLES = ['admin', 'program_manager'];

const PHASE_LABEL = { off: 'Off', baseline: 'Baseline (no scores yet)', scoring: 'Scoring' };
const CLOCK_LABEL = {
  dependency_overdue_or_blocker: 'When a dependency goes overdue or a blocker flag is set (default)',
  blocker_flag: 'Only when a blocker flag is set',
  dependency_created: 'When the dependency ticket is filed',
};
const NC_LABEL = {
  side_by_side: 'Keep the Non-Compliance report next to the scorecard (default)',
  scorecard_only: 'Scorecard only',
};
const SOURCE_LABEL = {
  owned_dependency: 'A dependency ticket the person owns',
  marked_request: 'An item marked as a request to the person',
};
const ROLE_LABEL = { admin: 'Admin', program_manager: 'Program Manager', executive: 'Executive', qa: 'QA', developer: 'Developer' };

const NUMBER_FIELDS = [
  ['baselineDays', 'Baseline length after switch-on (days)', 'Scores show "Baseline" until this many days after a project is first switched on.'],
  ['earlyWarningWorkingDays', 'D3 early warning: risk raised at least (working days) before the Due date', ''],
  ['dateMovesFlagCount', 'D4: count tasks whose committed date moved at least (times)', ''],
  ['statusFreshWorkingDays', 'C5: an in-progress task is fresh if updated within (working days)', ''],
  ['chasesPerTasks', 'O3: report chases per (tasks due)', ''],
  ['reopenWindowDays', 'Q3: a reopen counts within (days) of the Pass', ''],
  ['chaseCooldownHours', 'Chase: one per task per person within (hours)', ''],
  ['progressNoteMin', 'Progress note: at least (characters)', ''],
];

// Performance Tracking settings (B1, 2026-10-30) - Admin and Program
// Manager (backend: PerformanceTrackingController). The per-project switch
// and every rule still waiting for the Technical Director, each with its
// default. Saving is audited (before and after).
export default function PerformanceTrackingSettingsPage() {
  const router = useRouter();
  const { showToast } = useToast();
  const confirmAction = useConfirm();
  const [page, setPage] = useState(null);
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState('');

  const load = () =>
    apiFetch('/performance-tracking/settings')
      .then((p) => {
        setPage(p);
        setForm(JSON.parse(JSON.stringify(p.settings)));
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

  const toggle = async (project) => {
    const enabled = !project.performanceTrackingEnabled;
    const ok = await confirmAction(
      enabled
        ? {
            title: `Switch Performance Tracking on for ${project.name}?`,
            message: `${project.performanceTrackingSince ? 'Tracking resumes - the Baseline is not restarted.' : 'This starts the Baseline.'} From now on in ${project.name}: the assignee's Due date is a commitment that needs approval to change; risk/blocker flags, Chase and progress notes appear; new dependency tickets need a needed-by date; new tasks need a type, and Features need a requirement ID and client impact before QA.`,
            confirmLabel: 'Switch on',
          }
        : {
            title: `Switch Performance Tracking off for ${project.name}?`,
            message: 'The tracking cards disappear and nothing new is collected. History is kept, and the go-live date stays if you switch it on again.',
            confirmLabel: 'Switch off',
          },
    );
    if (!ok) return;
    setBusy(`p${project.id}`);
    setError('');
    try {
      await apiFetch(`/performance-tracking/projects/${project.id}`, { method: 'PATCH', body: JSON.stringify({ enabled }) });
      showToast(`Performance Tracking is ${enabled ? 'on' : 'off'} for ${project.name}`, 'success');
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  };

  const set = (key, value) => setForm((f) => ({ ...f, [key]: value }));
  const setBand = (key, i, value) => setForm((f) => ({ ...f, [key]: f[key].map((b, j) => (j === i ? value : b)) }));
  const toggleIn = (key, value) =>
    setForm((f) => ({ ...f, [key]: f[key].includes(value) ? f[key].filter((v) => v !== value) : [...f[key], value] }));

  const save = async (e) => {
    e.preventDefault();
    const body = { ...form };
    for (const [key] of NUMBER_FIELDS) {
      const [min, max] = page.limits[key];
      const n = Number(body[key]);
      if (!Number.isInteger(n) || n < min || n > max) {
        setError(`${NUMBER_FIELDS.find(([k]) => k === key)[1]} must be a whole number from ${min} to ${max}.`);
        return;
      }
      body[key] = n;
    }
    body.percentBands = body.percentBands.map(Number);
    body.breachBands = body.breachBands.map(Number);
    if (body.requestSources.length === 0 || body.chaseRoles.length === 0) {
      setError('Pick at least one request source and at least one role that can chase.');
      return;
    }
    setBusy('save');
    setError('');
    try {
      await apiFetch('/performance-tracking/settings', { method: 'PATCH', body: JSON.stringify(body) });
      showToast('Performance Tracking settings saved', 'success');
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  };

  const fieldset = { border: 0, padding: 0, margin: '0 0 var(--ds-space-4)' };
  const inline = { display: 'flex', gap: 'var(--ds-space-2)', alignItems: 'center' };

  return (
    <AppShell>
      <div className={styles.pageHeader}>
        <div>
          <h1 className={styles.pageTitle}>Performance Tracking Settings</h1>
          <p className={styles.pageSubtitle}>
            Switch tracking on per project, and set the rules the scorecard uses. Rules marked &quot;default&quot; are waiting for the
            Technical Director&apos;s review - change them here at any time; every save is recorded.
          </p>
        </div>
      </div>

      {error && <div className={styles.error} role="alert">{error}</div>}
      {!page && !error && <LoadingState />}

      {page && form && (
        <>
          <div className={styles.card} style={{ marginBottom: 'var(--space-4)' }}>
            <h2 className={styles.cardTitle}>Projects</h2>
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Project</th>
                    <th>Tracking</th>
                    <th>Go-live date</th>
                    <th>Baseline ends</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {page.projects.length === 0 && (
                    <tr>
                      <td colSpan={5} className={styles.empty}>No projects yet.</td>
                    </tr>
                  )}
                  {page.projects.map((p) => (
                    <tr key={p.id}>
                      <td>{p.name}</td>
                      <td>{PHASE_LABEL[p.phase]}</td>
                      <td>{p.performanceTrackingSince ? formatDate(p.performanceTrackingSince) : '-'}</td>
                      <td>{p.baselineEndsAt ? formatDate(p.baselineEndsAt) : '-'}</td>
                      <td>
                        <button
                          className={p.performanceTrackingEnabled ? styles.buttonSecondary : `${styles.button} ${styles.buttonAccent}`}
                          type="button"
                          disabled={busy !== null}
                          onClick={() => toggle(p)}
                          aria-label={`${p.performanceTrackingEnabled ? 'Switch off' : 'Switch on'} Performance Tracking for ${p.name}`}
                        >
                          {busy === `p${p.id}` ? 'Saving...' : p.performanceTrackingEnabled ? 'Switch off' : 'Switch on'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <form className={styles.card} onSubmit={save}>
            <h2 className={styles.cardTitle}>Rules</h2>
            <p className={styles.helpText} style={{ marginTop: 0 }}>
              {page.isDefault ? 'Nothing has been saved yet - all rules are at their defaults.' : `Last saved ${formatDate(page.updatedAt)}.`}
            </p>

            <fieldset style={fieldset}>
              <legend className={styles.label}>Q1 first-time QA acceptance</legend>
              <label style={inline}>
                <input type="checkbox" checked={form.notReadyDeclaredDependencyExempt} onChange={(e) => set('notReadyDeclaredDependencyExempt', e.target.checked)} />
                &quot;Not ready for testing&quot; does not count against the submitter when the cause is a dependency recorded on the task beforehand and
                owned by someone else (default: on)
              </label>
            </fieldset>

            <div className={styles.field} style={{ maxWidth: 560 }}>
              <label className={styles.label} htmlFor="ptClock">O1 blocker raise lag: the clock starts</label>
              <select id="ptClock" className={styles.input} value={form.blockerLagClockStart} onChange={(e) => set('blockerLagClockStart', e.target.value)}>
                {page.choices.blockerLagClockStart.map((v) => (
                  <option key={v} value={v}>{CLOCK_LABEL[v] || v}</option>
                ))}
              </select>
            </div>

            <fieldset style={fieldset}>
              <legend className={styles.label}>Score bands for percent metrics (score 5, 4, 3, 2 at or above; below the last = 1). Default 95 / 85 / 70 / 50</legend>
              <div style={inline}>
                {form.percentBands.map((b, i) => (
                  <input
                    key={i}
                    className={styles.input}
                    style={{ width: '6rem' }}
                    type="number"
                    min={0}
                    max={100}
                    value={b}
                    onChange={(e) => setBand('percentBands', i, e.target.value)}
                    aria-label={`Percent needed for score ${5 - i}`}
                  />
                ))}
              </div>
            </fieldset>

            <fieldset style={fieldset}>
              <legend className={styles.label}>Score bands for breach counts (score 5, 4, 3, 2 at or below; more than the last = 1). Default 0 / 1 / 2 / 3</legend>
              <div style={inline}>
                {form.breachBands.map((b, i) => (
                  <input
                    key={i}
                    className={styles.input}
                    style={{ width: '6rem' }}
                    type="number"
                    min={0}
                    value={b}
                    onChange={(e) => setBand('breachBands', i, e.target.value)}
                    aria-label={`Most breaches allowed for score ${5 - i}`}
                  />
                ))}
              </div>
            </fieldset>

            <div className={styles.field} style={{ maxWidth: 560 }}>
              <label className={styles.label} htmlFor="ptNc">Non-Compliance report</label>
              <select id="ptNc" className={styles.input} value={form.nonComplianceDisplay} onChange={(e) => set('nonComplianceDisplay', e.target.value)}>
                {page.choices.nonComplianceDisplay.map((v) => (
                  <option key={v} value={v}>{NC_LABEL[v] || v}</option>
                ))}
              </select>
            </div>

            <fieldset style={fieldset}>
              <legend className={styles.label}>C1 response time: a &quot;request&quot; to a person is (default: both)</legend>
              {page.choices.requestSources.map((v) => (
                <label key={v} style={inline}>
                  <input type="checkbox" checked={form.requestSources.includes(v)} onChange={() => toggleIn('requestSources', v)} />
                  {SOURCE_LABEL[v] || v}
                </label>
              ))}
            </fieldset>

            <fieldset style={fieldset}>
              <legend className={styles.label}>Who can Chase a task&apos;s assignee (never the assignee; default: all of these)</legend>
              {page.choices.chaseRoles.map((v) => (
                <label key={v} style={inline}>
                  <input type="checkbox" checked={form.chaseRoles.includes(v)} onChange={() => toggleIn('chaseRoles', v)} />
                  {ROLE_LABEL[v] || v}
                </label>
              ))}
            </fieldset>

            {NUMBER_FIELDS.map(([key, label, help]) => (
              <div key={key} className={styles.field} style={{ maxWidth: 560 }}>
                <label className={styles.label} htmlFor={`pt-${key}`}>{label}</label>
                <input
                  id={`pt-${key}`}
                  className={styles.input}
                  style={{ width: '8rem' }}
                  type="number"
                  min={page.limits[key][0]}
                  max={page.limits[key][1]}
                  value={form[key]}
                  onChange={(e) => set(key, e.target.value)}
                  aria-describedby={help ? `pt-${key}-help` : undefined}
                />
                {help && <p id={`pt-${key}-help`} className={styles.helpText}>{help}</p>}
              </div>
            ))}

            <div className={styles.actions}>
              <button className={`${styles.button} ${styles.buttonAccent}`} type="submit" disabled={busy !== null}>
                {busy === 'save' ? 'Saving...' : 'Save'}
              </button>
            </div>
          </form>
        </>
      )}
    </AppShell>
  );
}
