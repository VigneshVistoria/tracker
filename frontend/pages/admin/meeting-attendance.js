import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import AppShell from '../../components/AppShell';
import LoadingState from '../../components/ui/LoadingState';
import styles from '../../styles/issues.module.css';
import { apiFetch } from '../../lib/api';
import { useToast } from '../../lib/toast';
import { redirectToSignIn } from '../../lib/session';
import { formatDate, formatDateTime } from '../../lib/formatDate';

// Matches MEETING_PAGE_ROLES / MEETING_SETTINGS_EDIT_ROLES (backend/src/
// meeting-attendance/meeting-attendance.ts).
// An Executive may open it only when Executives can mark Excused - the
// backend decides (403 otherwise).
const PAGE_ROLES = ['admin', 'program_manager', 'executive'];
const ROLE_LABEL = { admin: 'Admin', program_manager: 'Program Manager', executive: 'Executive', qa: 'QA', developer: 'Developer', designer: 'Designer', devops: 'DevOps' };

const OUTCOME = { on_time: 'On time', late: 'Late', short: 'Left early', absent: 'Absent' };
const MEETING_STATUS = { imported: '', no_report: 'No attendance report from Teams (yet)', cancelled: 'Cancelled' };
const mins = (sec) => `${Math.round(sec / 60)} min`;
const IMPORT_STATUS = { running: 'Running', done: 'Done', failed: 'Failed', skipped: 'Skipped' };
const DAY = { sunday: 'Sun', monday: 'Mon', tuesday: 'Tue', wednesday: 'Wed', thursday: 'Thu', friday: 'Fri', saturday: 'Sat' };

// "Mon-Fri 09:00 (UTC)" style summary of a Teams recurrence.
function seriesWhen(s) {
  const p = s.pattern || {};
  const days = (p.daysOfWeek || []).map((d) => DAY[d] || d).join(', ');
  const kind = p.type === 'daily' ? 'Every day' : days || p.type || '';
  const time = s.startTime ? new Date(s.startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
  return `${kind}${time ? ` at ${time}` : ''}${s.rangeEnd ? `, until ${formatDate(s.rangeEnd)}` : ''}`;
}

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
  const [myId, setMyId] = useState(null);
  // Series picker: the organiser being looked up, and what Teams returned.
  const [picker, setPicker] = useState(null);
  const [meetings, setMeetings] = useState(null);
  // Excuse form: { id, reason, note } for the row being excused.
  const [excuse, setExcuse] = useState(null);

  const load = () =>
    Promise.all([apiFetch('/meeting-attendance/settings'), apiFetch('/meeting-attendance/meetings?days=28')])
      .then(([p, m]) => {
        setPage(p);
        setForm(JSON.parse(JSON.stringify(p.settings)));
        setMeetings(m);
      })
      .catch((err) => setError(err.message));

  const saveExcuse = async (e) => {
    e.preventDefault();
    setBusy('excuse');
    setError('');
    try {
      await apiFetch(`/meeting-attendance/attendance/${excuse.id}/excuse`, { method: 'POST', body: JSON.stringify({ reason: excuse.reason, note: excuse.note }) });
      showToast('Marked Excused', 'success');
      setExcuse(null);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  };

  const removeExcuse = async (row) => {
    if (!window.confirm(`Remove the Excused mark for ${row.name}? The meeting will count again.`)) return;
    setBusy('excuse');
    setError('');
    try {
      await apiFetch(`/meeting-attendance/attendance/${row.id}/excuse`, { method: 'DELETE' });
      showToast('Excused mark removed', 'success');
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  };

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
    setMyId(JSON.parse(stored).id);
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

  const findSeries = async (organiserUserId) => {
    setBusy('series');
    setError('');
    try {
      const list = await apiFetch(`/meeting-attendance/series?organiserUserId=${organiserUserId}`);
      setPicker({ organiserUserId, list });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  };

  const addSeries = (s) =>
    setForm((f) =>
      f.meetingTrackedSeries.some((x) => x.seriesId === s.seriesId)
        ? f
        : { ...f, meetingTrackedSeries: [...f.meetingTrackedSeries, { organiserUserId: s.organiserUserId, seriesId: s.seriesId, subject: s.subject }] },
    );

  const importNow = async () => {
    setBusy('import');
    setError('');
    try {
      const r = await apiFetch('/meeting-attendance/import', { method: 'POST' });
      if (r.status === 'done') showToast(`Imported: ${r.meetingsFound} meetings, ${r.rowsWritten} attendance rows`, 'success');
      else setError(r.status === 'skipped' ? 'Another import is still going - try again in a minute.' : `Import failed: ${r.error}`);
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
                  <button
                    className={styles.buttonSecondary}
                    type="button"
                    onClick={() => findSeries(id)}
                    disabled={!page.settings.meetingOrganiserUserIds.includes(id)}
                    title={page.settings.meetingOrganiserUserIds.includes(id) ? undefined : 'Save first'}
                  >
                    {busy === 'series' ? 'Reading Teams...' : 'Find their meetings'}
                  </button>
                  <button className={styles.buttonSecondary} type="button" onClick={() => set('meetingOrganiserUserIds', form.meetingOrganiserUserIds.filter((x) => x !== id))}>
                    Remove
                  </button>
                </div>
              ))}
            </div>

            {picker && (
              <div className={styles.field} style={{ maxWidth: 720 }} aria-live="polite">
                <p className={styles.label}>Recurring Teams meetings organised by {personName(picker.organiserUserId)}</p>
                {picker.list.length === 0 && <p className={styles.helpText}>Teams has no recurring online meetings organised by this person.</p>}
                {picker.list.map((s) => {
                  const added = form.meetingTrackedSeries.some((x) => x.seriesId === s.seriesId);
                  return (
                    <div key={s.seriesId} style={{ ...inline, marginBottom: 'var(--ds-space-1)' }}>
                      <span>
                        {s.subject || '(no subject)'} <span className={styles.helpText}>{seriesWhen(s)}</span>
                      </span>
                      <button className={styles.buttonSecondary} type="button" disabled={added} onClick={() => addSeries(s)}>
                        {added ? 'Tracked' : 'Track this'}
                      </button>
                    </div>
                  );
                })}
                <button className={styles.buttonSecondary} type="button" onClick={() => setPicker(null)}>
                  Close list
                </button>
              </div>
            )}

            <fieldset style={fieldset}>
              <legend className={styles.label}>Tracked meeting series (only these meetings count; save after adding)</legend>
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

      {meetings && (
        <div className={styles.card} style={{ marginTop: 'var(--ds-space-4)' }}>
          <h2 className={styles.cardTitle}>Meetings (last {meetings.days} days)</h2>
          <p className={styles.helpText} style={{ marginTop: 0 }}>
            Only people on the invite are listed. Late = joined more than {page?.settings.meetingLateMinutes} minutes after the start; left early = stayed
            less than {page?.settings.meetingMinStayPercent}% of the meeting. Excused meetings never count either way.
            {!meetings.canExcuse && ' Your role cannot mark meetings Excused.'}
          </p>
          {meetings.meetings.length === 0 && <p className={styles.helpText}>No meetings imported yet.</p>}
          {meetings.meetings.map((m) => (
            <details key={m.id} style={{ marginBottom: 'var(--ds-space-2)' }}>
              <summary>
                <strong>{m.subject || '(no subject)'}</strong> - {formatDateTime(m.startAt)}
                {m.status === 'imported'
                  ? ` - ${m.attendance.filter((a) => a.outcome === 'on_time').length} of ${m.attendance.length} on time`
                  : ` - ${MEETING_STATUS[m.status]}`}
              </summary>
              {m.attendance.length > 0 && (
                <div className={styles.tableWrap}>
                  <table className={styles.table}>
                    <thead>
                      <tr>
                        <th>Person</th>
                        <th>Result</th>
                        <th>Joined</th>
                        <th>Time in meeting</th>
                        <th>Excused</th>
                      </tr>
                    </thead>
                    <tbody>
                      {m.attendance.map((a) => (
                        <tr key={a.id}>
                          <td>{a.name}</td>
                          <td>{OUTCOME[a.outcome] || a.outcome}</td>
                          <td>{a.firstJoinAt ? formatDateTime(a.firstJoinAt) : '-'}</td>
                          <td>{a.attendedSeconds ? mins(a.attendedSeconds) : '-'}</td>
                          <td>
                            {a.excused ? (
                              <>
                                {a.excuseReason}
                                {a.excuseNote && <div className={styles.issueMeta}>{a.excuseNote}</div>}
                                <div className={styles.issueMeta}>
                                  by {a.excusedByName}, {formatDateTime(a.excusedAt)}
                                </div>
                                {meetings.canExcuse && a.userId !== myId && (
                                  <button className={styles.buttonSecondary} type="button" disabled={busy !== null} onClick={() => removeExcuse(a)}>
                                    Remove
                                  </button>
                                )}
                              </>
                            ) : excuse?.id === a.id ? (
                              <form onSubmit={saveExcuse} style={{ display: 'grid', gap: 'var(--ds-space-1)' }}>
                                <label className={styles.label} htmlFor={`ex-r-${a.id}`}>Reason</label>
                                <select id={`ex-r-${a.id}`} className={styles.input} value={excuse.reason} onChange={(e) => setExcuse({ ...excuse, reason: e.target.value })} required>
                                  {meetings.excuseReasons.map((r) => (
                                    <option key={r} value={r}>{r}</option>
                                  ))}
                                </select>
                                <label className={styles.label} htmlFor={`ex-n-${a.id}`}>Note (optional)</label>
                                <input id={`ex-n-${a.id}`} className={styles.input} maxLength={500} value={excuse.note} onChange={(e) => setExcuse({ ...excuse, note: e.target.value })} />
                                <div style={inline}>
                                  <button className={styles.button} type="submit" disabled={busy !== null}>{busy === 'excuse' ? 'Saving...' : 'Mark Excused'}</button>
                                  <button className={styles.buttonSecondary} type="button" onClick={() => setExcuse(null)}>Cancel</button>
                                </div>
                              </form>
                            ) : (
                              meetings.canExcuse &&
                              a.outcome !== 'on_time' &&
                              a.userId !== myId && (
                                <button
                                  className={styles.buttonSecondary}
                                  type="button"
                                  disabled={busy !== null}
                                  onClick={() => setExcuse({ id: a.id, reason: meetings.excuseReasons[0], note: '' })}
                                  aria-label={`Excuse ${a.name}`}
                                >
                                  Excuse
                                </button>
                              )
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </details>
          ))}
        </div>
      )}

      {page && (
        <div className={styles.card} style={{ marginTop: 'var(--ds-space-4)' }}>
          <h2 className={styles.cardTitle}>Imports from Teams</h2>
          <p className={styles.helpText} style={{ marginTop: 0 }}>
            Runs every night at 01:30 (East Africa Time) while C6 is on, looking back {page.settings.meetingImportDays} days. Read-only - nothing is changed in Teams.
          </p>
          <div className={styles.actions} style={{ justifyContent: 'flex-start' }}>
            <button className={styles.button} type="button" onClick={importNow} disabled={busy !== null || !page.settings.meetingAttendanceEnabled}>
              {busy === 'import' ? 'Importing...' : 'Import now'}
            </button>
            {!page.settings.meetingAttendanceEnabled && <span className={styles.helpText}>C6 is off - switch it on (and save) to import.</span>}
          </div>
          {(page.imports || []).length === 0 ? (
            <p className={styles.helpText}>No imports yet.</p>
          ) : (
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Started</th>
                    <th>Trigger</th>
                    <th>Result</th>
                    <th>Meetings</th>
                    <th>Reports</th>
                    <th>Rows</th>
                  </tr>
                </thead>
                <tbody>
                  {page.imports.map((r) => (
                    <tr key={r.id}>
                      <td>{formatDateTime(r.startedAt)}</td>
                      <td>{r.trigger === 'nightly' ? 'Nightly' : `Import now${r.userId ? ` (${personName(r.userId)})` : ''}`}</td>
                      <td>
                        {IMPORT_STATUS[r.status] || r.status}
                        {r.error && <div className={styles.issueMeta}>{r.error}</div>}
                      </td>
                      <td>{r.meetingsFound}</td>
                      <td>{r.reportsRead}</td>
                      <td>{r.rowsWritten}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </AppShell>
  );
}
