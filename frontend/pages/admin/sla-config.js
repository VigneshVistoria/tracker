import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import AppShell from '../../components/AppShell';
import styles from '../../styles/issues.module.css';
import { apiFetch } from '../../lib/api';
import { useToast } from '../../lib/toast';

const KEY_DESCRIPTIONS = {
  Showstopper: 'Applied whenever a ticket is marked Showstopper - overrides priority.',
  Critical: 'Tickets with Priority = Critical (and not marked Showstopper).',
  High: 'Tickets with Priority = High.',
  Medium: 'Tickets with Priority = Medium.',
  Low: 'Tickets with Priority = Low.',
  Default: 'Tickets with no priority set at all.',
};

export default function SlaConfigPage() {
  const router = useRouter();
  const { showToast } = useToast();
  const [config, setConfig] = useState([]);
  const [hours, setHours] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(null);
  const [error, setError] = useState('');

  const load = () => {
    apiFetch('/sla-config')
      .then((rows) => {
        setConfig(rows);
        setHours(Object.fromEntries(rows.map((r) => [r.key, String(r.targetHours)])));
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
    if (JSON.parse(storedUser).role !== 'admin') {
      router.replace('/dashboard');
      return;
    }
    load();
  }, [router]);

  const handleSave = async (key) => {
    setError('');
    const targetHours = Number(hours[key]);
    if (!Number.isInteger(targetHours) || targetHours < 1) {
      setError('Target must be a whole number of hours, at least 1.');
      return;
    }
    setSaving(key);
    try {
      await apiFetch(`/sla-config/${encodeURIComponent(key)}`, {
        method: 'PATCH',
        body: JSON.stringify({ targetHours }),
      });
      showToast(`${key} SLA target updated`, 'success');
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(null);
    }
  };

  return (
    <AppShell>
      <div className={styles.pageHeader}>
        <div>
          <h1 className={styles.pageTitle}>SLA Configuration</h1>
          <p className={styles.pageSubtitle}>
            How many hours the team has to resolve a ticket, by priority - and for any ticket marked Showstopper,
            regardless of priority. Applies to every open ticket automatically; changes take effect immediately and
            are audit-logged.
          </p>
        </div>
      </div>

      {error && <div className={styles.error}>{error}</div>}
      {loading && <div className={styles.empty}>Loading...</div>}

      {!loading && (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Target</th>
                <th>Applies to</th>
                <th>Target (hours)</th>
                <th>Last updated</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {config.map((row) => (
                <tr key={row.key}>
                  <td style={{ fontWeight: 600 }}>{row.key}</td>
                  <td className={styles.issueMeta}>{KEY_DESCRIPTIONS[row.key]}</td>
                  <td>
                    <input
                      className={styles.input}
                      style={{ width: '100px' }}
                      type="number"
                      min="1"
                      value={hours[row.key] ?? ''}
                      onChange={(e) => setHours({ ...hours, [row.key]: e.target.value })}
                    />
                  </td>
                  <td className={styles.issueMeta}>
                    {row.updatedByEmail ? `${row.updatedByEmail}, ${new Date(row.updatedAt).toLocaleString()}` : '—'}
                  </td>
                  <td>
                    <button
                      className={styles.buttonSecondary}
                      type="button"
                      onClick={() => handleSave(row.key)}
                      disabled={saving === row.key || String(row.targetHours) === hours[row.key]}
                    >
                      {saving === row.key ? 'Saving...' : 'Save'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </AppShell>
  );
}
