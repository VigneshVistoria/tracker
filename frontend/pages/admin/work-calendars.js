import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import AppShell from '../../components/AppShell';
import LoadingState from '../../components/ui/LoadingState';
import Modal from '../../components/ui/Modal';
import Button from '../../components/ui/Button';
import styles from '../../styles/issues.module.css';
import { apiFetch } from '../../lib/api';
import { useToast } from '../../lib/toast';
import { useConfirm } from '../../lib/confirm';
import { redirectToSignIn } from '../../lib/session';
import { formatDate } from '../../lib/formatDate';

// Matches WorkCalendarService.assertEditor (PERFORMANCE_TRACKING_SETTINGS_ROLES).
const EDIT_ROLES = ['admin', 'program_manager'];
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const daysText = (days) => (days.length ? days.map((d) => DAY_NAMES[d]).join(', ') : 'none');

// Work Calendars (Performance Tracking B4, 2026-10-30) - Admin and Program
// Manager. Each person's time zone, core hours, days off and country;
// their leave; and holidays per country. Used by the performance metrics
// (working days, and C1 response time in working hours). Every change is
// recorded.
export default function WorkCalendarsPage() {
  const router = useRouter();
  const { showToast } = useToast();
  const confirmAction = useConfirm();
  const [page, setPage] = useState(null);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState(null);
  const [leave, setLeave] = useState({ userId: '', startDate: '', endDate: '', note: '' });
  const [holiday, setHoliday] = useState({ country: 'somaliland', date: '', name: '' });

  const load = () =>
    apiFetch('/work-calendars')
      .then(setPage)
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

  const run = async (key, fn, message) => {
    setBusy(key);
    setError('');
    try {
      const next = await fn();
      setPage(next);
      showToast(message, 'success');
      return true;
    } catch (err) {
      setError(err.message);
      return false;
    } finally {
      setBusy(null);
    }
  };

  const resetPerson = async (p) => {
    const ok = await confirmAction({ title: `Put ${p.name} back on the default calendar?`, message: 'Their own time zone, hours, days off and country are removed.', confirmLabel: 'Use default' });
    if (ok) run(`reset${p.userId}`, () => apiFetch(`/work-calendars/people/${p.userId}`, { method: 'DELETE' }), `${p.name} uses the default calendar`);
  };

  const addLeave = async (e) => {
    e.preventDefault();
    if (!leave.userId || !leave.startDate || !leave.endDate) {
      setError('Pick the person and both dates.');
      return;
    }
    const ok = await run(
      'leave',
      () => apiFetch('/work-calendars/leave', { method: 'POST', body: JSON.stringify({ ...leave, userId: Number(leave.userId), note: leave.note || undefined }) }),
      'Leave added',
    );
    if (ok) setLeave({ userId: '', startDate: '', endDate: '', note: '' });
  };

  const addHoliday = async (e) => {
    e.preventDefault();
    if (!holiday.date || !holiday.name.trim()) {
      setError('Give the holiday a date and a name.');
      return;
    }
    const ok = await run('holiday', () => apiFetch('/work-calendars/holidays', { method: 'POST', body: JSON.stringify(holiday) }), 'Holiday added');
    if (ok) setHoliday({ ...holiday, date: '', name: '' });
  };

  const countryLabel = (c) => page?.countries.find((x) => x.value === c)?.label || '-';

  return (
    <AppShell>
      <div className={styles.pageHeader}>
        <div>
          <h1 className={styles.pageTitle}>Work Calendars</h1>
          <p className={styles.pageSubtitle}>
            Each person&apos;s working hours, days off, leave and country holidays. The performance metrics count only their working time.
            {page && ` Default: ${page.defaults.timeZone}, ${page.defaults.workStart}-${page.defaults.workEnd}, ${daysText(page.defaults.weekendDays)} off.`}
          </p>
        </div>
      </div>

      {error && <div className={styles.error} role="alert">{error}</div>}
      {!page && !error && <LoadingState />}

      {page && (
        <>
          <div className={styles.card} style={{ marginBottom: 'var(--space-4)' }}>
            <h2 className={styles.cardTitle}>People</h2>
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Person</th>
                    <th>Time zone</th>
                    <th>Hours</th>
                    <th>Days off</th>
                    <th>Country</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {page.people.map((p) => (
                    <tr key={p.userId}>
                      <td>
                        {p.name}
                        {!p.own && <span className={styles.issueMeta}> (default)</span>}
                      </td>
                      <td>{p.timeZone}</td>
                      <td>
                        {p.workStart}-{p.workEnd}
                      </td>
                      <td>{daysText(p.weekendDays)}</td>
                      <td>{countryLabel(p.country)}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        <button className={styles.buttonSecondary} type="button" disabled={busy !== null} onClick={() => setEditing(p)} aria-label={`Edit the calendar of ${p.name}`}>
                          Edit
                        </button>{' '}
                        {p.own && (
                          <button className={styles.buttonSecondary} type="button" disabled={busy !== null} onClick={() => resetPerson(p)} aria-label={`Put ${p.name} back on the default calendar`}>
                            Use default
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className={styles.card} style={{ marginBottom: 'var(--space-4)' }}>
            <h2 className={styles.cardTitle}>Leave</h2>
            <form onSubmit={addLeave} style={{ display: 'flex', gap: 'var(--ds-space-2)', flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 'var(--ds-space-3)' }}>
              <div className={styles.field}>
                <label className={styles.label} htmlFor="leavePerson">Person</label>
                <select id="leavePerson" className={styles.input} value={leave.userId} onChange={(e) => setLeave({ ...leave, userId: e.target.value })}>
                  <option value="">Choose...</option>
                  {page.people.map((p) => (
                    <option key={p.userId} value={p.userId}>{p.name}</option>
                  ))}
                </select>
              </div>
              <div className={styles.field}>
                <label className={styles.label} htmlFor="leaveFrom">First day</label>
                <input id="leaveFrom" className={styles.input} type="date" value={leave.startDate} onChange={(e) => setLeave({ ...leave, startDate: e.target.value })} />
              </div>
              <div className={styles.field}>
                <label className={styles.label} htmlFor="leaveTo">Last day</label>
                <input id="leaveTo" className={styles.input} type="date" value={leave.endDate} onChange={(e) => setLeave({ ...leave, endDate: e.target.value })} />
              </div>
              <div className={styles.field}>
                <label className={styles.label} htmlFor="leaveNote">Note (optional)</label>
                <input id="leaveNote" className={styles.input} maxLength={500} value={leave.note} onChange={(e) => setLeave({ ...leave, note: e.target.value })} />
              </div>
              <div className={styles.field}>
                <button className={`${styles.button} ${styles.buttonAccent}`} type="submit" disabled={busy !== null}>
                  {busy === 'leave' ? 'Adding...' : 'Add leave'}
                </button>
              </div>
            </form>
            {page.leave.length === 0 ? (
              <p className={styles.helpText}>No leave entered.</p>
            ) : (
              <ul style={{ margin: 0, paddingLeft: 'var(--ds-space-5)' }}>
                {page.leave.map((l) => (
                  <li key={l.id} style={{ marginBottom: 'var(--ds-space-1)' }}>
                    {l.name}: {formatDate(l.startDate)}
                    {l.endDate !== l.startDate && ` - ${formatDate(l.endDate)}`}
                    {l.note && ` (${l.note})`}{' '}
                    <button
                      className={styles.buttonSecondary}
                      type="button"
                      disabled={busy !== null}
                      onClick={() => run(`l${l.id}`, () => apiFetch(`/work-calendars/leave/${l.id}/remove`, { method: 'PATCH' }), 'Leave removed')}
                      aria-label={`Remove leave of ${l.name} from ${l.startDate}`}
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className={styles.card}>
            <h2 className={styles.cardTitle}>Country holidays</h2>
            <p className={styles.helpText} style={{ marginTop: 0 }}>
              A holiday counts only for people whose country is set to it. Holidays for everyone stay on Performance Metrics Settings.
            </p>
            <form onSubmit={addHoliday} style={{ display: 'flex', gap: 'var(--ds-space-2)', flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 'var(--ds-space-3)' }}>
              <div className={styles.field}>
                <label className={styles.label} htmlFor="holCountry">Country</label>
                <select id="holCountry" className={styles.input} value={holiday.country} onChange={(e) => setHoliday({ ...holiday, country: e.target.value })}>
                  {page.countries.map((c) => (
                    <option key={c.value} value={c.value}>{c.label}</option>
                  ))}
                </select>
              </div>
              <div className={styles.field}>
                <label className={styles.label} htmlFor="holDate">Date</label>
                <input id="holDate" className={styles.input} type="date" value={holiday.date} onChange={(e) => setHoliday({ ...holiday, date: e.target.value })} />
              </div>
              <div className={styles.field}>
                <label className={styles.label} htmlFor="holName">Name</label>
                <input id="holName" className={styles.input} maxLength={200} value={holiday.name} onChange={(e) => setHoliday({ ...holiday, name: e.target.value })} />
              </div>
              <div className={styles.field}>
                <button className={`${styles.button} ${styles.buttonAccent}`} type="submit" disabled={busy !== null}>
                  {busy === 'holiday' ? 'Adding...' : 'Add holiday'}
                </button>
              </div>
            </form>
            {page.countries.map((c) => {
              const list = page.holidays.filter((h) => h.country === c.value);
              return (
                <div key={c.value} style={{ marginBottom: 'var(--ds-space-3)' }}>
                  <h3 className={styles.label} style={{ margin: 0 }}>{c.label}</h3>
                  {list.length === 0 ? (
                    <p className={styles.helpText} style={{ margin: 0 }}>None entered.</p>
                  ) : (
                    <ul style={{ margin: 0, paddingLeft: 'var(--ds-space-5)' }}>
                      {list.map((h) => (
                        <li key={h.id}>
                          {formatDate(h.date)} - {h.name}{' '}
                          <button
                            className={styles.buttonSecondary}
                            type="button"
                            disabled={busy !== null}
                            onClick={() => run(`h${h.id}`, () => apiFetch(`/work-calendars/holidays/${h.id}`, { method: 'DELETE' }), 'Holiday removed')}
                            aria-label={`Remove ${h.name} on ${h.date}`}
                          >
                            Remove
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}

      {editing && page && (
        <EditCalendar
          person={editing}
          countries={page.countries}
          onClose={() => setEditing(null)}
          onSave={async (body) => {
            const ok = await run('edit', () => apiFetch(`/work-calendars/people/${editing.userId}`, { method: 'PATCH', body: JSON.stringify(body) }), `Calendar saved for ${editing.name}`);
            if (ok) setEditing(null);
          }}
          busy={busy === 'edit'}
        />
      )}
    </AppShell>
  );
}

function EditCalendar({ person, countries, onClose, onSave, busy }) {
  const [form, setForm] = useState({ timeZone: person.timeZone, workStart: person.workStart, workEnd: person.workEnd, weekendDays: person.weekendDays, country: person.country || '' });
  const toggleDay = (d) => setForm((f) => ({ ...f, weekendDays: f.weekendDays.includes(d) ? f.weekendDays.filter((x) => x !== d) : [...f.weekendDays, d] }));
  return (
    <Modal
      open
      onClose={busy ? () => {} : onClose}
      title={`Calendar for ${person.name}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => onSave({ ...form, country: form.country || null })} loading={busy}>
            Save
          </Button>
        </>
      }
    >
      <div className={styles.field}>
        <label className={styles.label} htmlFor="calZone">Time zone (e.g. Africa/Addis_Ababa, Asia/Kolkata)</label>
        <input id="calZone" className={styles.input} value={form.timeZone} onChange={(e) => setForm({ ...form, timeZone: e.target.value })} />
      </div>
      <div style={{ display: 'flex', gap: 'var(--ds-space-3)' }}>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="calStart">Core hours from</label>
          <input id="calStart" className={styles.input} type="time" value={form.workStart} onChange={(e) => setForm({ ...form, workStart: e.target.value })} />
        </div>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="calEnd">to</label>
          <input id="calEnd" className={styles.input} type="time" value={form.workEnd} onChange={(e) => setForm({ ...form, workEnd: e.target.value })} />
        </div>
      </div>
      <fieldset style={{ border: 0, padding: 0, margin: '0 0 var(--ds-space-3)' }}>
        <legend className={styles.label}>Days off every week</legend>
        <div style={{ display: 'flex', gap: 'var(--ds-space-3)', flexWrap: 'wrap' }}>
          {DAY_NAMES.map((name, d) => (
            <label key={d}>
              <input type="checkbox" checked={form.weekendDays.includes(d)} onChange={() => toggleDay(d)} /> {name}
            </label>
          ))}
        </div>
      </fieldset>
      <div className={styles.field}>
        <label className={styles.label} htmlFor="calCountry">Country (for its holidays)</label>
        <select id="calCountry" className={styles.input} value={form.country} onChange={(e) => setForm({ ...form, country: e.target.value })}>
          <option value="">None</option>
          {countries.map((c) => (
            <option key={c.value} value={c.value}>{c.label}</option>
          ))}
        </select>
      </div>
    </Modal>
  );
}
