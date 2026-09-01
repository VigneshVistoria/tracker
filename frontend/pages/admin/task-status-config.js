import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import AppShell from '../../components/AppShell';
import styles from '../../styles/issues.module.css';
import { apiFetch } from '../../lib/api';
import { useToast } from '../../lib/toast';

export default function TaskStatusConfigPage() {
  const router = useRouter();
  const { showToast } = useToast();
  const [config, setConfig] = useState([]);
  const [percents, setPercents] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(null);
  const [error, setError] = useState('');

  const load = () => {
    apiFetch('/task-status-config')
      .then((rows) => {
        setConfig(rows);
        setPercents(Object.fromEntries(rows.map((r) => [r.id, String(r.percent)])));
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

  const handleSave = async (row) => {
    setError('');
    const percent = Number(percents[row.id]);
    if (!Number.isInteger(percent) || percent < 0 || percent > 100) {
      setError('Percent must be a whole number between 0 and 100.');
      return;
    }
    setSaving(row.id);
    try {
      await apiFetch(`/task-status-config/${row.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ percent }),
      });
      showToast(`"${row.status}" % Complete updated`, 'success');
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
          <h1 className={styles.pageTitle}>Task Status Config</h1>
          <p className={styles.pageSubtitle}>
            The % Complete each Task status is worth. Every Task's % Complete on the Tasks page is looked up from
            this mapping live, so changes here apply immediately to every existing Task.
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
                <th>Status</th>
                <th>% Complete</th>
                <th>Last updated</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {config.map((row) => (
                <tr key={row.id}>
                  <td style={{ fontWeight: 600 }}>{row.status}</td>
                  <td>
                    <input
                      className={styles.input}
                      style={{ width: '100px' }}
                      type="number"
                      min="0"
                      max="100"
                      value={percents[row.id] ?? ''}
                      onChange={(e) => setPercents({ ...percents, [row.id]: e.target.value })}
                    />
                  </td>
                  <td className={styles.issueMeta}>
                    {row.updatedByEmail ? `${row.updatedByEmail}, ${new Date(row.updatedAt).toLocaleString()}` : '—'}
                  </td>
                  <td>
                    <button
                      className={styles.buttonSecondary}
                      type="button"
                      onClick={() => handleSave(row)}
                      disabled={saving === row.id || String(row.percent) === percents[row.id]}
                    >
                      {saving === row.id ? 'Saving...' : 'Save'}
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
