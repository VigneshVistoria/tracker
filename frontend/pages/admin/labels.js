import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import AppShell from '../../components/AppShell';
import styles from '../../styles/issues.module.css';
import { apiFetch } from '../../lib/api';
import { useToast } from '../../lib/toast';

export default function LabelsPage() {
  const router = useRouter();
  const { showToast } = useToast();
  const [labels, setLabels] = useState([]);
  const [newLabel, setNewLabel] = useState({ name: '', description: '' });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = () => {
    apiFetch('/labels')
      .then(setLabels)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    const storedUser = localStorage.getItem('user');
    if (!storedUser) {
      router.replace('/');
      return;
    }
    const role = JSON.parse(storedUser).role;
    if (role !== 'admin' && role !== 'program_manager') {
      router.replace('/dashboard');
      return;
    }
    load();
  }, [router]);

  const handleAdd = async (e) => {
    e.preventDefault();
    setError('');
    try {
      await apiFetch('/labels', {
        method: 'POST',
        body: JSON.stringify(newLabel),
      });
      setNewLabel({ name: '', description: '' });
      showToast('Label added', 'success');
      load();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleUpdate = async (id, field, value) => {
    setError('');
    try {
      await apiFetch(`/labels/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ [field]: value }),
      });
      load();
    } catch (err) {
      setError(err.message);
      load();
    }
  };

  const handleToggleActive = async (label) => {
    setError('');
    try {
      await apiFetch(`/labels/${label.id}/${label.isActive ? 'deactivate' : 'activate'}`, {
        method: 'PATCH',
      });
      showToast(label.isActive ? 'Label deactivated' : 'Label activated', 'info');
      load();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleDelete = async (label) => {
    if (!confirm(`Delete "${label.name}"? This cannot be undone.`)) return;
    setError('');
    try {
      await apiFetch(`/labels/${label.id}`, { method: 'DELETE' });
      showToast('Label deleted', 'info');
      load();
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <AppShell>
      <div className={styles.pageHeader}>
        <div>
          <h1 className={styles.pageTitle}>Labels</h1>
          <p className={styles.pageSubtitle}>
            Admin/Program Manager-managed catalog of labels/tags. Deactivate a label to hide it from future use
            without losing its history - every change here is audit-logged.
          </p>
        </div>
      </div>

      {error && <div className={styles.error}>{error}</div>}
      {loading && <div className={styles.empty}>Loading...</div>}

      {!loading && (
        <div className={styles.card}>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Description</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {labels.length === 0 && (
                  <tr>
                    <td colSpan={4} className={styles.empty}>No labels yet.</td>
                  </tr>
                )}
                {labels.map((label) => (
                  <tr key={label.id}>
                    <td>
                      <input
                        className={styles.input}
                        defaultValue={label.name}
                        onBlur={(e) => e.target.value !== label.name && handleUpdate(label.id, 'name', e.target.value)}
                      />
                    </td>
                    <td>
                      <input
                        className={styles.input}
                        defaultValue={label.description || ''}
                        placeholder="Optional"
                        onBlur={(e) => e.target.value !== (label.description || '') && handleUpdate(label.id, 'description', e.target.value)}
                      />
                    </td>
                    <td>
                      <span className={`${styles.badge} ${label.isActive ? styles.badgeQa : styles.badgeOpen}`}>
                        {label.isActive ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td style={{ display: 'flex', gap: 'var(--space-2)' }}>
                      <button className={styles.buttonSecondary} type="button" onClick={() => handleToggleActive(label)}>
                        {label.isActive ? 'Deactivate' : 'Activate'}
                      </button>
                      <button className={styles.buttonSecondary} type="button" onClick={() => handleDelete(label)}>
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <form onSubmit={handleAdd} style={{ marginTop: 'var(--space-4)', display: 'flex', gap: 'var(--space-3)', alignItems: 'flex-end' }}>
            <div className={styles.field} style={{ margin: 0, flex: 1 }}>
              <label className={styles.label}>Name</label>
              <input
                className={styles.input}
                required
                value={newLabel.name}
                onChange={(e) => setNewLabel({ ...newLabel, name: e.target.value })}
              />
            </div>
            <div className={styles.field} style={{ margin: 0, flex: 1 }}>
              <label className={styles.label}>Description</label>
              <input
                className={styles.input}
                placeholder="Optional"
                value={newLabel.description}
                onChange={(e) => setNewLabel({ ...newLabel, description: e.target.value })}
              />
            </div>
            <button className={styles.buttonSecondary} type="submit">Add Label</button>
          </form>
        </div>
      )}
    </AppShell>
  );
}
