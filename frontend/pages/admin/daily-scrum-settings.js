import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import AppShell from '../../components/AppShell';
import styles from '../../styles/issues.module.css';
import { apiFetch } from '../../lib/api';
import { formatDateTime } from '../../lib/formatDate';
import { useToast } from '../../lib/toast';
import LoadingState from '../../components/ui/LoadingState';

// Backend mirror: DailyScrumController.ROLES_ALLOWED_TO_EDIT_SCRUM_SETTINGS.
const EDIT_ROLES = ['admin', 'program_manager'];

// Every zone the browser knows - the backend checks the name again.
function timeZoneOptions(current) {
  let zones = [];
  try {
    zones = Intl.supportedValuesOf('timeZone');
  } catch (e) {
    zones = [];
  }
  return current && !zones.includes(current) ? [current, ...zones] : zones;
}

function nowInZone(timeZone) {
  try {
    return new Intl.DateTimeFormat('en-GB', { timeZone, weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }).format(new Date());
  } catch (e) {
    return null;
  }
}

export default function DailyScrumSettingsPage() {
  const router = useRouter();
  const { showToast } = useToast();
  const [settings, setSettings] = useState(null);
  const [form, setForm] = useState({ timeZone: '', workdayStart: '', workdayEnd: '' });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const load = () => {
    apiFetch('/daily-scrum/settings')
      .then((s) => {
        setSettings(s);
        setForm({ timeZone: s.timeZone, workdayStart: s.workdayStart, workdayEnd: s.workdayEnd });
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    const storedUser = localStorage.getItem('user');
    if (!storedUser) {
      router.replace('/');
      return;
    }
    if (!EDIT_ROLES.includes(JSON.parse(storedUser).role)) {
      router.replace('/dashboard');
      return;
    }
    load();
  }, [router]);

  const zones = useMemo(() => timeZoneOptions(form.timeZone), [form.timeZone]);
  const preview = form.timeZone ? nowInZone(form.timeZone) : null;
  const unchanged =
    settings && form.timeZone === settings.timeZone && form.workdayStart === settings.workdayStart && form.workdayEnd === settings.workdayEnd;

  const handleSave = async (e) => {
    e.preventDefault();
    setError('');
    if (form.workdayStart >= form.workdayEnd) {
      setError('Working hours start must be before working hours end.');
      return;
    }
    setSaving(true);
    try {
      await apiFetch('/daily-scrum/settings', { method: 'PATCH', body: JSON.stringify(form) });
      showToast('Daily Scrum settings saved', 'success');
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <AppShell>
      <div className={styles.pageHeader}>
        <div>
          <h1 className={styles.pageTitle}>Daily Scrum Settings</h1>
          <p className={styles.pageSubtitle}>
            The team&apos;s time zone decides &quot;today&quot; and the &quot;since last working day&quot; window on Daily Scrum: it starts
            at 00:00 on the last working day (Monday to Friday). Working hours are shown for information only.
          </p>
        </div>
      </div>

      {error && (
        <div className={styles.error} role="alert">
          {error}
        </div>
      )}
      {loading && <LoadingState />}

      {!loading && settings && (
        <form className={styles.card} onSubmit={handleSave} style={{ maxWidth: '640px' }}>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="dsTimeZone">
              Time zone
            </label>
            <select
              id="dsTimeZone"
              className={styles.select}
              value={form.timeZone}
              onChange={(e) => setForm({ ...form, timeZone: e.target.value })}
              aria-describedby="dsTimeZoneHelp"
            >
              {zones.map((z) => (
                <option key={z} value={z}>
                  {z.replace(/_/g, ' ')}
                </option>
              ))}
            </select>
            {preview && (
              <p id="dsTimeZoneHelp" className={styles.helpText}>
                Time there now: {preview}
              </p>
            )}
          </div>

          <div className={styles.fieldGrid2}>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="dsWorkdayStart">
                Working hours start
              </label>
              <input
                id="dsWorkdayStart"
                className={styles.input}
                type="time"
                value={form.workdayStart}
                onChange={(e) => setForm({ ...form, workdayStart: e.target.value })}
                required
              />
            </div>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="dsWorkdayEnd">
                Working hours end
              </label>
              <input
                id="dsWorkdayEnd"
                className={styles.input}
                type="time"
                value={form.workdayEnd}
                onChange={(e) => setForm({ ...form, workdayEnd: e.target.value })}
                required
              />
            </div>
          </div>
          <p className={styles.helpText} style={{ marginTop: 0 }}>
            For information only - working hours never shorten the &quot;since last working day&quot; window.
          </p>

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
      )}
    </AppShell>
  );
}
