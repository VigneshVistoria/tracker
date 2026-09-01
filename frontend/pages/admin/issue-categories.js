import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import AppShell from '../../components/AppShell';
import styles from '../../styles/issues.module.css';
import { apiFetch } from '../../lib/api';
import { useToast } from '../../lib/toast';

export default function IssueCategoriesPage() {
  const router = useRouter();
  const { showToast } = useToast();
  const [categories, setCategories] = useState([]);
  const [newCategory, setNewCategory] = useState({ name: '', description: '' });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = () => {
    apiFetch('/issue-categories')
      .then(setCategories)
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
      await apiFetch('/issue-categories', {
        method: 'POST',
        body: JSON.stringify(newCategory),
      });
      setNewCategory({ name: '', description: '' });
      showToast('Issue category added', 'success');
      load();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleUpdate = async (id, field, value) => {
    setError('');
    try {
      await apiFetch(`/issue-categories/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ [field]: value }),
      });
      load();
    } catch (err) {
      setError(err.message);
      load();
    }
  };

  const handleToggleActive = async (category) => {
    setError('');
    try {
      await apiFetch(`/issue-categories/${category.id}/${category.isActive ? 'deactivate' : 'activate'}`, {
        method: 'PATCH',
      });
      showToast(category.isActive ? 'Category deactivated' : 'Category activated', 'info');
      load();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleDelete = async (category) => {
    if (!confirm(`Delete "${category.name}"? This cannot be undone.`)) return;
    setError('');
    try {
      await apiFetch(`/issue-categories/${category.id}`, { method: 'DELETE' });
      showToast('Category deleted', 'info');
      load();
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <AppShell>
      <div className={styles.pageHeader}>
        <div>
          <h1 className={styles.pageTitle}>Issue Categories</h1>
          <p className={styles.pageSubtitle}>
            Admin/Program Manager-managed catalog of issue categories. Deactivate a category to hide it from future
            use without losing its history - every change here is audit-logged.
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
                {categories.length === 0 && (
                  <tr>
                    <td colSpan={4} className={styles.empty}>No issue categories yet.</td>
                  </tr>
                )}
                {categories.map((category) => (
                  <tr key={category.id}>
                    <td>
                      <input
                        className={styles.input}
                        defaultValue={category.name}
                        onBlur={(e) => e.target.value !== category.name && handleUpdate(category.id, 'name', e.target.value)}
                      />
                    </td>
                    <td>
                      <input
                        className={styles.input}
                        defaultValue={category.description || ''}
                        placeholder="Optional"
                        onBlur={(e) => e.target.value !== (category.description || '') && handleUpdate(category.id, 'description', e.target.value)}
                      />
                    </td>
                    <td>
                      <span className={`${styles.badge} ${category.isActive ? styles.badgeQa : styles.badgeOpen}`}>
                        {category.isActive ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td style={{ display: 'flex', gap: 'var(--space-2)' }}>
                      <button className={styles.buttonSecondary} type="button" onClick={() => handleToggleActive(category)}>
                        {category.isActive ? 'Deactivate' : 'Activate'}
                      </button>
                      <button className={styles.buttonSecondary} type="button" onClick={() => handleDelete(category)}>
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
                value={newCategory.name}
                onChange={(e) => setNewCategory({ ...newCategory, name: e.target.value })}
              />
            </div>
            <div className={styles.field} style={{ margin: 0, flex: 1 }}>
              <label className={styles.label}>Description</label>
              <input
                className={styles.input}
                placeholder="Optional"
                value={newCategory.description}
                onChange={(e) => setNewCategory({ ...newCategory, description: e.target.value })}
              />
            </div>
            <button className={styles.buttonSecondary} type="submit">Add Category</button>
          </form>
        </div>
      )}
    </AppShell>
  );
}
