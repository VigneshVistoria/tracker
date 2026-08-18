import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import AppShell from '../../../components/AppShell';
import styles from '../../../styles/issues.module.css';
import { apiFetch } from '../../../lib/api';
import { useToast } from '../../../lib/toast';

export default function NewUser() {
  const router = useRouter();
  const { showToast } = useToast();
  const [projects, setProjects] = useState([]);
  const [form, setForm] = useState({
    email: '',
    password: '',
    fullName: '',
    role: 'developer',
    projectIds: [],
  });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    apiFetch('/projects').then(setProjects).catch(() => {});
  }, []);

  const handleChange = (e) => {
    setForm({ ...form, [e.target.name]: e.target.value });
  };

  const toggleProject = (id) => {
    setForm((prev) => {
      const has = prev.projectIds.includes(id);
      return {
        ...prev,
        projectIds: has
          ? prev.projectIds.filter((p) => p !== id)
          : [...prev.projectIds, id],
      };
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      await apiFetch('/users', {
        method: 'POST',
        body: JSON.stringify(form),
      });
      showToast(`User ${form.email} created`, 'success');
      router.push('/admin/users');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <AppShell>
      <div className={styles.pageHeader}>
        <div>
          <h1 className={styles.pageTitle}>New User</h1>
        </div>
      </div>

      <div className={styles.card}>
        {error && <div className={styles.error}>{error}</div>}

        <form onSubmit={handleSubmit}>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="email">Email</label>
            <input
              className={styles.input}
              id="email"
              name="email"
              type="email"
              required
              value={form.email}
              onChange={handleChange}
            />
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="fullName">Full name</label>
            <input
              className={styles.input}
              id="fullName"
              name="fullName"
              value={form.fullName}
              onChange={handleChange}
            />
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="password">Initial password</label>
            <input
              className={styles.input}
              id="password"
              name="password"
              type="password"
              required
              minLength={8}
              value={form.password}
              onChange={handleChange}
            />
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="role">Role</label>
            <select
              className={styles.select}
              id="role"
              name="role"
              value={form.role}
              onChange={handleChange}
            >
              <option value="admin">Admin</option>
              <option value="developer">Developer</option>
              <option value="qa">QA</option>
              <option value="executive">Executive</option>
            </select>
          </div>

          <div className={styles.field}>
            <label className={styles.label}>Assigned projects</label>
            {projects.length === 0 && (
              <p className={styles.helpText}>No projects yet — create one first from the Projects page.</p>
            )}
            {projects.map((p) => (
              <label key={p.id} className={styles.checkboxRow}>
                <input
                  type="checkbox"
                  checked={form.projectIds.includes(p.id)}
                  onChange={() => toggleProject(p.id)}
                />
                {p.name}
              </label>
            ))}
          </div>

          <div className={styles.actions}>
            <button className={`${styles.button} ${styles.buttonAccent}`} type="submit" disabled={loading}>
              {loading ? 'Creating...' : 'Create User'}
            </button>
            <Link href="/admin/users" className={styles.buttonSecondary}>
              Cancel
            </Link>
          </div>
        </form>
      </div>
    </AppShell>
  );
}
