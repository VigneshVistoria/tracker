import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import AppShell from '../../components/AppShell';
import styles from '../../styles/issues.module.css';
import { apiFetch } from '../../lib/api';
import { useToast } from '../../lib/toast';

const WEIGHT_FIELDS = [
  { key: 'qaFailedWeightPercent', label: 'QA Failed weight (penalty per item)' },
  { key: 'reopenedWeightPercent', label: 'Reopened weight (penalty per item)' },
  { key: 'lateDependencyWeightPercent', label: 'Late Dependency weight (penalty per item)' },
  { key: 'earlyCompletionBonusPercent', label: 'Early Completion bonus (per item)' },
];

export default function PerformanceScoringConfigPage() {
  const router = useRouter();
  const { showToast } = useToast();
  const [config, setConfig] = useState(null);
  const [tiers, setTiers] = useState([]);
  const [weightForm, setWeightForm] = useState({});
  const [mode, setMode] = useState('Tiered');
  const [flatPercent, setFlatPercent] = useState('10');
  const [newTier, setNewTier] = useState({ minDaysLate: '', maxDaysLate: '', penaltyPercent: '' });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const load = () => {
    apiFetch('/performance-scoring-config')
      .then(({ config, tiers }) => {
        setConfig(config);
        setTiers(tiers);
        setMode(config.overduePenaltyMode);
        setFlatPercent(String(config.flatOverduePenaltyPercent));
        setWeightForm(Object.fromEntries(WEIGHT_FIELDS.map((f) => [f.key, String(config[f.key])])));
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

  const handleSaveWeights = async () => {
    setError('');
    setSaving(true);
    try {
      await apiFetch('/performance-scoring-config', {
        method: 'PATCH',
        body: JSON.stringify({
          overduePenaltyMode: mode,
          flatOverduePenaltyPercent: Number(flatPercent),
          ...Object.fromEntries(WEIGHT_FIELDS.map((f) => [f.key, Number(weightForm[f.key])])),
        }),
      });
      showToast('Scoring configuration updated', 'success');
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleAddTier = async (e) => {
    e.preventDefault();
    setError('');
    try {
      await apiFetch('/performance-scoring-config/tiers', {
        method: 'POST',
        body: JSON.stringify({
          minDaysLate: Number(newTier.minDaysLate),
          maxDaysLate: newTier.maxDaysLate === '' ? undefined : Number(newTier.maxDaysLate),
          penaltyPercent: Number(newTier.penaltyPercent),
        }),
      });
      setNewTier({ minDaysLate: '', maxDaysLate: '', penaltyPercent: '' });
      showToast('Tier added', 'success');
      load();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleUpdateTier = async (id, field, value) => {
    setError('');
    try {
      await apiFetch(`/performance-scoring-config/tiers/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ [field]: value === '' ? null : Number(value) }),
      });
      load();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleDeleteTier = async (id) => {
    setError('');
    try {
      await apiFetch(`/performance-scoring-config/tiers/${id}`, { method: 'DELETE' });
      showToast('Tier removed', 'info');
      load();
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <AppShell>
      <div className={styles.pageHeader}>
        <div>
          <h1 className={styles.pageTitle}>Performance Scoring Configuration</h1>
          <p className={styles.pageSubtitle}>
            How the Performance Dashboard's score is weighted. Changes apply going forward only - existing scores are
            computed live and are never stored, so nothing is retroactively recalculated. Every change is audit-logged.
          </p>
        </div>
      </div>

      {error && <div className={styles.error}>{error}</div>}
      {loading && <div className={styles.empty}>Loading...</div>}

      {!loading && config && (
        <>
          <div className={styles.card}>
            <h3 style={{ marginTop: 0, fontSize: '1rem' }}>Overdue Penalty</h3>
            <div className={styles.field}>
              <label className={styles.label}>Mode</label>
              <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                <button
                  type="button"
                  className={mode === 'Tiered' ? styles.button : styles.buttonSecondary}
                  onClick={() => setMode('Tiered')}
                >
                  Tiered by days late
                </button>
                <button
                  type="button"
                  className={mode === 'Flat' ? styles.button : styles.buttonSecondary}
                  onClick={() => setMode('Flat')}
                >
                  Flat per-item
                </button>
              </div>
            </div>

            {mode === 'Flat' && (
              <div className={styles.field}>
                <label className={styles.label} htmlFor="flatPercent">Flat penalty % per overdue item</label>
                <input
                  className={styles.input}
                  id="flatPercent"
                  type="number"
                  min="0"
                  style={{ width: '120px' }}
                  value={flatPercent}
                  onChange={(e) => setFlatPercent(e.target.value)}
                />
              </div>
            )}

            {mode === 'Tiered' && (
              <>
                <p className={styles.helpText}>Tiers below are used, ordered by days late.</p>
                <div className={styles.tableWrap}>
                  <table className={styles.table}>
                    <thead>
                      <tr>
                        <th>Min Days Late</th>
                        <th>Max Days Late</th>
                        <th>Penalty %</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {tiers.map((tier) => (
                        <tr key={tier.id}>
                          <td>
                            <input
                              className={styles.input}
                              style={{ width: '90px' }}
                              type="number"
                              defaultValue={tier.minDaysLate}
                              onBlur={(e) => handleUpdateTier(tier.id, 'minDaysLate', e.target.value)}
                            />
                          </td>
                          <td>
                            <input
                              className={styles.input}
                              style={{ width: '90px' }}
                              type="number"
                              placeholder="unbounded"
                              defaultValue={tier.maxDaysLate ?? ''}
                              onBlur={(e) => handleUpdateTier(tier.id, 'maxDaysLate', e.target.value)}
                            />
                          </td>
                          <td>
                            <input
                              className={styles.input}
                              style={{ width: '90px' }}
                              type="number"
                              defaultValue={tier.penaltyPercent}
                              onBlur={(e) => handleUpdateTier(tier.id, 'penaltyPercent', e.target.value)}
                            />
                          </td>
                          <td>
                            <button className={styles.buttonSecondary} type="button" onClick={() => handleDeleteTier(tier.id)}>
                              Remove
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <form onSubmit={handleAddTier} style={{ marginTop: 'var(--space-4)', display: 'flex', gap: 'var(--space-3)', alignItems: 'flex-end' }}>
                  <div className={styles.field} style={{ margin: 0 }}>
                    <label className={styles.label}>Min Days Late</label>
                    <input
                      className={styles.input}
                      style={{ width: '90px' }}
                      type="number"
                      required
                      min="0"
                      value={newTier.minDaysLate}
                      onChange={(e) => setNewTier({ ...newTier, minDaysLate: e.target.value })}
                    />
                  </div>
                  <div className={styles.field} style={{ margin: 0 }}>
                    <label className={styles.label}>Max Days Late</label>
                    <input
                      className={styles.input}
                      style={{ width: '90px' }}
                      type="number"
                      min="0"
                      placeholder="unbounded"
                      value={newTier.maxDaysLate}
                      onChange={(e) => setNewTier({ ...newTier, maxDaysLate: e.target.value })}
                    />
                  </div>
                  <div className={styles.field} style={{ margin: 0 }}>
                    <label className={styles.label}>Penalty %</label>
                    <input
                      className={styles.input}
                      style={{ width: '90px' }}
                      type="number"
                      required
                      min="0"
                      value={newTier.penaltyPercent}
                      onChange={(e) => setNewTier({ ...newTier, penaltyPercent: e.target.value })}
                    />
                  </div>
                  <button className={styles.buttonSecondary} type="submit">Add Tier</button>
                </form>
              </>
            )}
          </div>

          <div className={styles.card}>
            <h3 style={{ marginTop: 0, fontSize: '1rem' }}>Other Weights</h3>
            {WEIGHT_FIELDS.map((f) => (
              <div className={styles.field} key={f.key}>
                <label className={styles.label} htmlFor={f.key}>{f.label}</label>
                <input
                  className={styles.input}
                  id={f.key}
                  type="number"
                  min="0"
                  style={{ width: '120px' }}
                  value={weightForm[f.key] ?? ''}
                  onChange={(e) => setWeightForm({ ...weightForm, [f.key]: e.target.value })}
                />
              </div>
            ))}
            <button className={`${styles.button} ${styles.buttonAccent}`} type="button" onClick={handleSaveWeights} disabled={saving}>
              {saving ? 'Saving...' : 'Save Configuration'}
            </button>
            {config.updatedByEmail && (
              <p className={styles.issueMeta} style={{ marginTop: 'var(--space-3)' }}>
                Last updated by {config.updatedByEmail} on {new Date(config.updatedAt).toLocaleString()}
              </p>
            )}
          </div>
        </>
      )}
    </AppShell>
  );
}
