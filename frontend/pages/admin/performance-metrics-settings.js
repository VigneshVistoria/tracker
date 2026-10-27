import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import AppShell from '../../components/AppShell';
import styles from '../../styles/issues.module.css';
import { apiFetch } from '../../lib/api';
import { formatDate, formatDateTime } from '../../lib/formatDate';
import { useToast } from '../../lib/toast';
import LoadingState from '../../components/ui/LoadingState';
import { redirectToSignIn } from '../../lib/session';

// Backend mirror: PerformanceMetricsController.ROLES_ALLOWED_TO_EDIT_METRIC_SETTINGS.
const EDIT_ROLES = ['admin', 'program_manager'];

// 0 = Sunday ... 6 = Saturday, shown Monday first.
const DAYS = [
  { value: 1, label: 'Monday' },
  { value: 2, label: 'Tuesday' },
  { value: 3, label: 'Wednesday' },
  { value: 4, label: 'Thursday' },
  { value: 5, label: 'Friday' },
  { value: 6, label: 'Saturday' },
  { value: 0, label: 'Sunday' },
];

const NUMBER_FIELDS = [
  { key: 'dueDateWorkingDays', label: 'Due date must be set within (working days after assignment)', step: 1, min: 0, max: 30, help: '1 = by the end of the next working day.' },
  { key: 'onTimeOkPercent', label: 'Date set on time: OK at or above (%)', step: 0.5, min: 0, max: 100 },
  { key: 'changesOkPerTask', label: 'Due date changes: OK at or below (changes per task)', step: 0.05, min: 0, max: 100 },
  { key: 'qaAcceptanceOkPercent', label: 'QA acceptance: OK at or above (%)', step: 0.5, min: 0, max: 100 },
  { key: 'windowDays', label: 'Rolling period (days)', step: 1, min: 7, max: 366, help: 'Ends on the report’s To date (today by default).' },
  { key: 'minSample', label: 'Minimum tasks or submissions for a status', step: 1, min: 1, max: 1000, help: 'Below this, the report shows "Not enough data".' },
];

const SWITCHES = [
  { key: 'alreadyDatedCountsOnTime', label: 'A task that already has a Due date when assigned (e.g. reassigned) counts as on time' },
  { key: 'othersSettingDateCountsOnTime', label: 'A Due date set by a PM (not the assignee) counts as on time for the assignee' },
  { key: 'includePeerReview', label: 'Count Peer Review decisions in QA acceptance' },
  { key: 'countEscalatedAsDecided', label: 'Count rounds QA escalated to the PM as decided' },
];

function timeZoneOptions(current) {
  let zones = [];
  try {
    zones = Intl.supportedValuesOf('timeZone');
  } catch (e) {
    zones = [];
  }
  return current && !zones.includes(current) ? [current, ...zones] : zones;
}

function toForm(s) {
  return { ...s, excludedStatuses: s.excludedStatuses.join(', ') };
}

export default function PerformanceMetricsSettingsPage() {
  const router = useRouter();
  const { showToast } = useToast();
  const [settings, setSettings] = useState(null);
  const [form, setForm] = useState(null);
  const [holidays, setHolidays] = useState([]);
  const [newHoliday, setNewHoliday] = useState({ date: '', name: '' });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const load = () =>
    Promise.all([apiFetch('/performance-metrics/settings'), apiFetch('/performance-metrics/holidays')])
      .then(([s, h]) => {
        setSettings(s);
        setForm(toForm(s));
        setHolidays(h);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));

  useEffect(() => {
    const storedUser = localStorage.getItem('user');
    if (!storedUser) {
      redirectToSignIn(router);
      return;
    }
    if (!EDIT_ROLES.includes(JSON.parse(storedUser).role)) {
      router.replace('/dashboard');
      return;
    }
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  const zones = useMemo(() => timeZoneOptions(form?.timeZone), [form?.timeZone]);

  const payloadFrom = (f) => ({
    timeZone: f.timeZone,
    weekendDays: [...f.weekendDays].sort(),
    excludedStatuses: f.excludedStatuses
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean),
    ...Object.fromEntries(NUMBER_FIELDS.map((n) => [n.key, Number(f[n.key])])),
    ...Object.fromEntries(SWITCHES.map((n) => [n.key, !!f[n.key]])),
  });
  const unchanged = settings && form && JSON.stringify(payloadFrom(form)) === JSON.stringify(payloadFrom(toForm(settings)));

  const toggleWeekend = (day) => {
    const set = new Set(form.weekendDays);
    if (set.has(day)) set.delete(day);
    else set.add(day);
    setForm({ ...form, weekendDays: [...set].sort() });
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setError('');
    if (form.weekendDays.length >= 7) {
      setError('At least one day of the week must be a working day.');
      return;
    }
    setSaving(true);
    try {
      await apiFetch('/performance-metrics/settings', { method: 'PATCH', body: JSON.stringify(payloadFrom(form)) });
      showToast('Performance metric settings saved', 'success');
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const addHoliday = async (e) => {
    e.preventDefault();
    setError('');
    try {
      await apiFetch('/performance-metrics/holidays', { method: 'POST', body: JSON.stringify(newHoliday) });
      setNewHoliday({ date: '', name: '' });
      showToast('Holiday added', 'success');
      await load();
    } catch (err) {
      setError(err.message);
    }
  };

  const removeHoliday = async (h) => {
    if (!window.confirm(`Remove ${h.name} (${formatDate(h.date)})?`)) return;
    setError('');
    try {
      await apiFetch(`/performance-metrics/holidays/${h.id}`, { method: 'DELETE' });
      showToast('Holiday removed', 'success');
      await load();
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <AppShell>
      <div className={styles.pageHeader}>
        <div>
          <h1 className={styles.pageTitle}>Performance Metrics Settings</h1>
          <p className={styles.pageSubtitle}>
            Rules and thresholds for the Performance metrics on the Non-Compliance Report. Every change is recorded in the audit log and applies to
            the whole history straight away.
          </p>
        </div>
      </div>

      {error && (
        <div className={styles.error} role="alert">
          {error}
        </div>
      )}
      {loading && <LoadingState />}

      {!loading && form && (
        <>
          <form className={styles.card} onSubmit={handleSave} style={{ maxWidth: '720px', marginBottom: 'var(--ds-space-4)' }}>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="pmTimeZone">
                Time zone for working days
              </label>
              <select id="pmTimeZone" className={styles.input} value={form.timeZone} onChange={(e) => setForm({ ...form, timeZone: e.target.value })}>
                {zones.map((z) => (
                  <option key={z} value={z}>
                    {z.replace(/_/g, ' ')}
                  </option>
                ))}
              </select>
            </div>

            <fieldset className={styles.field} style={{ border: 0, padding: 0, margin: 0 }}>
              <legend className={styles.label}>Weekend days (never working days)</legend>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--ds-space-3)' }}>
                {DAYS.map((d) => (
                  <label key={d.value} className={styles.checkboxRow}>
                    <input type="checkbox" checked={form.weekendDays.includes(d.value)} onChange={() => toggleWeekend(d.value)} />
                    {d.label}
                  </label>
                ))}
              </div>
            </fieldset>

            <div className={styles.fieldGrid2}>
              {NUMBER_FIELDS.map((f) => (
                <div key={f.key} className={styles.field}>
                  <label className={styles.label} htmlFor={`pm-${f.key}`}>
                    {f.label}
                  </label>
                  <input
                    id={`pm-${f.key}`}
                    className={styles.input}
                    type="number"
                    step={f.step}
                    min={f.min}
                    max={f.max}
                    value={form[f.key]}
                    onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
                    aria-describedby={f.help ? `pm-${f.key}-help` : undefined}
                    required
                  />
                  {f.help && (
                    <p id={`pm-${f.key}-help`} className={styles.helpText}>
                      {f.help}
                    </p>
                  )}
                </div>
              ))}
            </div>

            <div className={styles.field}>
              <label className={styles.label} htmlFor="pmExcluded">
                Leave out tasks in these statuses (comma separated)
              </label>
              <input
                id="pmExcluded"
                className={styles.input}
                value={form.excludedStatuses}
                onChange={(e) => setForm({ ...form, excludedStatuses: e.target.value })}
              />
            </div>

            <fieldset className={styles.field} style={{ border: 0, padding: 0, margin: 0 }}>
              <legend className={styles.label}>Rules</legend>
              {SWITCHES.map((f) => (
                <label key={f.key} className={styles.checkboxRow}>
                  <input type="checkbox" checked={!!form[f.key]} onChange={(e) => setForm({ ...form, [f.key]: e.target.checked })} />
                  {f.label}
                </label>
              ))}
            </fieldset>

            <p className={styles.issueMeta}>
              {settings.isDefault
                ? 'Using the default settings - nothing has been saved yet.'
                : `Last changed${settings.updatedByName ? ` by ${settings.updatedByName}` : ''}, ${formatDateTime(settings.updatedAt)}.`}
            </p>

            <div className={styles.actions}>
              <button className={`${styles.button} ${styles.buttonAccent}`} type="submit" disabled={saving || unchanged}>
                {saving ? 'Saving...' : 'Save'}
              </button>
            </div>
          </form>

          <section className={styles.card} style={{ maxWidth: '720px' }} aria-labelledby="pmHolidaysHeading">
            <h2 id="pmHolidaysHeading" className={styles.label} style={{ fontSize: 'var(--ds-text-lg)' }}>
              Holidays
            </h2>
            <p className={styles.helpText}>
              Public holidays are skipped when counting working days. Ethiopian holidays move each year, so enter each one by date.
            </p>
            {holidays.length === 0 ? (
              <div className={styles.empty}>No holidays entered - only the weekend days above are skipped.</div>
            ) : (
              <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 var(--ds-space-3)' }}>
                {holidays.map((h) => (
                  <li
                    key={h.id}
                    style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 'var(--ds-space-2) 0', borderBottom: '1px solid var(--ds-border)' }}
                  >
                    <span>
                      <strong>{formatDate(h.date)}</strong> - {h.name}
                    </span>
                    <button type="button" className={styles.buttonSecondary} onClick={() => removeHoliday(h)} aria-label={`Remove ${h.name}, ${formatDate(h.date)}`}>
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <form onSubmit={addHoliday} className={styles.fieldGrid2}>
              <div className={styles.field}>
                <label className={styles.label} htmlFor="pmHolidayDate">
                  Date
                </label>
                <input
                  id="pmHolidayDate"
                  className={styles.input}
                  type="date"
                  value={newHoliday.date}
                  onChange={(e) => setNewHoliday({ ...newHoliday, date: e.target.value })}
                  required
                />
              </div>
              <div className={styles.field}>
                <label className={styles.label} htmlFor="pmHolidayName">
                  Name
                </label>
                <input
                  id="pmHolidayName"
                  className={styles.input}
                  value={newHoliday.name}
                  maxLength={120}
                  onChange={(e) => setNewHoliday({ ...newHoliday, name: e.target.value })}
                  required
                />
              </div>
              <div className={styles.actions}>
                <button className={`${styles.button} ${styles.buttonAccent}`} type="submit">
                  Add holiday
                </button>
              </div>
            </form>
          </section>
        </>
      )}
    </AppShell>
  );
}
