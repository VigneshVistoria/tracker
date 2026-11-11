import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import AppShell from '../../components/AppShell';
import LoadingState from '../../components/ui/LoadingState';
import styles from '../../styles/issues.module.css';
import { apiFetch } from '../../lib/api';
import { useToast } from '../../lib/toast';
import { redirectToSignIn } from '../../lib/session';

// Matches MEETING_PAGE_ROLES / MEETING_SETTINGS_EDIT_ROLES (backend/src/
// meeting-attendance/meeting-attendance.ts).
const PAGE_ROLES = ['admin', 'program_manager'];
const ROLE_LABEL = { admin: 'Admin', program_manager: 'Program Manager', executive: 'Executive', qa: 'QA', developer: 'Developer', designer: 'Designer', devops: 'DevOps' };

const NUMBER_FIELDS = [
  ['meetingLateMinutes', 'Late: joined more than (minutes) after the start', 'Joining exactly at this many minutes is still on time.'],
  ['meetingMinStayPercent', 'Attended: stayed at least (% of the meeting)', 'Less than this counts as not attended.'],
  ['meetingMinSample', 'Minimum meetings before C6 shows a value', 'Below this, C6 shows "Not enough data". Excused meetings do not count towards it.'],
  ['meetingImportDays', 'Each import looks back (days)', 'Teams can publish an attendance report a while after the meeting; older meetings already imported are kept.'],
];

// C6 meeting attendance (2026-11-11). Admin edits; Program Manager sees
// the settings read-only. Every save is recorded (before and after).
export default function MeetingAttendancePage() {
  const router = useRouter();
  const { showToast } = useToast();
  const [page, setPage] = useState(null);
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState('');
  const [isAdmin, setIsAdmin] = useState(false);

  const load = () =>
    apiFetch('/meeting-attendance/settings')
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
    const role = JSON.parse(stored).role;
    if (!PAGE_ROLES.includes(role)) {
      router.replace('/dashboard');
      return;
    }
    setIsAdmin(role === 'admin');
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  const set = (key, value) => setForm((f) => ({ ...f, [key]: value }));
  const toggleIn = (key, value) =>
    setForm((f) => ({ ...f, [key]: f[key].includes(value) ? f[key].filter((v) => v !== value) : [...f[key], value] }));

  const save = async (e) => {
    e.preventDefault();
    const body = { ...form };
    for (const [key, label] of NUMBER_FIELDS) {
      const [min, max] = page.limits[key];
      const n = Number(body[key]);
      if (!Number.isInteger(n) || n < min || n > max) {
        setError(`${label} must be a whole number from ${min} to ${max}.`);
        return;
      }
      body[key] = n;
    }
    body.meetingExcuseReasons = body.meetingExcuseReasons.map((r) => r.trim()).filter(Boolean);
    // A series whose organiser was unticked goes with them.
    body.meetingTrackedSeries = body.meetingTrackedSeries.filter((s) => body.meetingOrganiserUserIds.includes(s.organiserUserId));
    setBusy('save');
    setError('');
    try {
      await apiFetch('/meeting-attendance/settings', { method: 'PATCH', body: JSON.stringify(body) });
      showToast('Meeting attendance settings saved', 'success');
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  };

  const fieldset = { border: 0, padding: 0, margin: '0 0 var(--ds-space-4)' };
  const inline = { display: 'flex', gap: 'var(--ds-space-2)', alignItems: 'center' };
  const personName = (id) => page.choices.organisers.find((o) => o.id === id)?.name || `#${id}`;

  return (
    <AppShell>
      <div className={styles.pageHeader}>
        <div>
          <h1 className={styles.pageTitle}>Meeting Attendance (C6)</h1>
          <p className={styles.pageSubtitle}>
            Attendance at the tracked Teams meetings, read from Microsoft Teams. Only people on the invite are expected. Shown on the scorecard;
            counted in scores only if you switch that on. Part of <Link href="/admin/performance-tracking-settings">Performance Tracking</Link>.
          </p>
        </div>
      </div>

      {error && <div className={styles.error} role="alert">{error}</div>}
      {!page && !error && <LoadingState />}

      {page && form && (
        <form className={styles.card} onSubmit={save}>
          <h2 className={styles.cardTitle}>Settings</h2>
          {!isAdmin && <p className={styles.helpText} style={{ marginTop: 0 }}>Only an Admin can change these settings.</p>}
          <fieldset disabled={!isAdmin || busy !== null} style={{ border: 0, padding: 0, margin: 0 }}>
            <fieldset style={fieldset}>
              <legend className={styles.label}>Switches</legend>
              <label style={inline}>
                <input type="checkbox" checked={form.meetingAttendanceEnabled} onChange={(e) => set('meetingAttendanceEnabled', e.target.checked)} />
                C6 on: import attendance and show it (default: off)
              </label>
              <label style={inline}>
                <input type="checkbox" checked={form.meetingCountInScores} onChange={(e) => set('meetingCountInScores', e.target.checked)} />
                Count C6 in the Collaboration score (default: off - shown only)
              </label>
            </fieldset>

            <fieldset style={fieldset}>
              <legend className={styles.label}>Projects C6 is measured in (the project must also have Performance Tracking on)</legend>
              {page.choices.projects.map((p) => (
                <label key={p.id} style={inline}>
                  <input type="checkbox" checked={form.meetingAttendanceProjectIds.includes(p.id)} onChange={() => toggleIn('meetingAttendanceProjectIds', p.id)} />
                  {p.name}
                  {!p.performanceTrackingEnabled && <span className={styles.helpText}>(tracking off)</span>}
                </label>
              ))}
            </fieldset>

            <div className={styles.field} style={{ maxWidth: 560 }}>
              <label className={styles.label} htmlFor="maOrganiser">Organisers whose Teams meetings are read</label>
              <select
                id="maOrganiser"
                className={styles.input}
                value=""
                onChange={(e) => e.target.value && set('meetingOrganiserUserIds', [...form.meetingOrganiserUserIds, Number(e.target.value)])}
              >
                <option value="">Add an organiser...</option>
                {page.choices.organisers
                  .filter((o) => !form.meetingOrganiserUserIds.includes(o.id))
                  .map((o) => (
                    <option key={o.id} value={o.id}>{o.name} ({ROLE_LABEL[o.role] || o.role})</option>
                  ))}
              </select>
              <p className={styles.helpText}>
                Microsoft Teams must also allow the tracker to read each organiser&apos;s meetings (the Tracker-C6 access policy, granted by the M365 admin).
              </p>
              {form.meetingOrganiserUserIds.length === 0 && <p className={styles.helpText}>No organisers yet.</p>}
              {form.meetingOrganiserUserIds.map((id) => (
                <div key={id} style={{ ...inline, marginBottom: 'var(--ds-space-1)' }}>
                  <span>{personName(id)}</span>
                  <button className={styles.buttonSecondary} type="button" onClick={() => set('meetingOrganiserUserIds', form.meetingOrganiserUserIds.filter((x) => x !== id))}>
                    Remove
                  </button>
                </div>
              ))}
            </div>

            <fieldset style={fieldset}>
              <legend className={styles.label}>Tracked meeting series (only these meetings count)</legend>
              {form.meetingTrackedSeries.length === 0 && <p className={styles.helpText}>No meeting series yet.</p>}
              {form.meetingTrackedSeries.map((s) => (
                <div key={s.seriesId} style={{ ...inline, marginBottom: 'var(--ds-space-1)' }}>
                  <span>
                    {s.subject || '(no subject)'} - organised by {personName(s.organiserUserId)}
                  </span>
                  <button className={styles.buttonSecondary} type="button" onClick={() => set('meetingTrackedSeries', form.meetingTrackedSeries.filter((x) => x.seriesId !== s.seriesId))}>
                    Remove
                  </button>
                </div>
              ))}
            </fieldset>

            <fieldset style={fieldset}>
              <legend className={styles.label}>Who can mark a missed or late meeting as Excused (default: Program Manager)</legend>
              {page.choices.excuseRoles.map((r) => (
                <label key={r} style={inline}>
                  <input type="checkbox" checked={form.meetingExcuseRoles.includes(r)} onChange={() => toggleIn('meetingExcuseRoles', r)} />
                  {ROLE_LABEL[r] || r}
                </label>
              ))}
            </fieldset>

            <div className={styles.field} style={{ maxWidth: 560 }}>
              <label className={styles.label} htmlFor="maReasons">Excuse reasons, one per line (excused meetings never count)</label>
              <textarea
                id="maReasons"
                className={styles.textarea}
                rows={4}
                value={form.meetingExcuseReasons.join('\n')}
                onChange={(e) => set('meetingExcuseReasons', e.target.value.split('\n'))}
              />
            </div>

            {NUMBER_FIELDS.map(([key, label, help]) => (
              <div key={key} className={styles.field} style={{ maxWidth: 560 }}>
                <label className={styles.label} htmlFor={`ma-${key}`}>{label}</label>
                <input
                  id={`ma-${key}`}
                  className={styles.input}
                  style={{ width: '8rem' }}
                  type="number"
                  min={page.limits[key][0]}
                  max={page.limits[key][1]}
                  value={form[key]}
                  onChange={(e) => set(key, e.target.value)}
                  aria-describedby={`ma-${key}-help`}
                />
                <p id={`ma-${key}-help`} className={styles.helpText}>{help}</p>
              </div>
            ))}
          </fieldset>

          {isAdmin && (
            <div className={styles.actions}>
              <button className={`${styles.button} ${styles.buttonAccent}`} type="submit" disabled={busy !== null}>
                {busy === 'save' ? 'Saving...' : 'Save'}
              </button>
            </div>
          )}
        </form>
      )}
    </AppShell>
  );
}
