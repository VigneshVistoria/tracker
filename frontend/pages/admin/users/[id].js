import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import AppShell from '../../../components/AppShell';
import styles from '../../../styles/issues.module.css';
import { apiFetch } from '../../../lib/api';
import { useToast } from '../../../lib/toast';

export default function EditUser() {
  const router = useRouter();
  const { id } = router.query;
  const { showToast } = useToast();

  const [projects, setProjects] = useState([]);
  const [form, setForm] = useState({
    fullName: '',
    role: 'developer',
    password: '',
    projectIds: [],
    isProgramManager: false,
  });
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!id) return;

    Promise.all([apiFetch(`/users/${id}`), apiFetch('/projects')])
      .then(([user, allProjects]) => {
        setEmail(user.email);
        setForm({
          fullName: user.fullName || '',
          role: user.role,
          password: '',
          projectIds: (user.projects || []).map((p) => p.id),
          isProgramManager: Boolean(user.isProgramManager),
        });
        setProjects(allProjects);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [id]);

  const handleChange = (e) => {
    setForm({ ...form, [e.target.name]: e.target.value });
  };

  const toggleProject = (pid) => {
    setForm((prev) => {
      const has = prev.projectIds.includes(pid);
      return {
        ...prev,
        projectIds: has
          ? prev.projectIds.filter((p) => p !== pid)
          : [...prev.projectIds, pid],
      };
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSaving(true);

    try {
      const payload = { ...form };
      if (!payload.password) delete payload.password;
      await apiFetch(`/users/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      });
      showToast('User updated', 'success');
      setForm((prev) => ({ ...prev, password: '' }));
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <AppShell><div className={styles.empty}>Loading...</div></AppShell>;
  }

  return (
    <AppShell>
      <div className={styles.pageHeader}>
        <div>
          <h1 className={styles.pageTitle}>Edit User</h1>
          <p className={styles.pageSubtitle}>{email}</p>
        </div>
      </div>

      <div className={styles.card}>
        {error && <div className={styles.error}>{error}</div>}

        <form onSubmit={handleSubmit}>
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
            <p className={styles.helpText}>
              Developers and QA see issues in their assigned projects. Executives get read-only
              access to the Dashboard and Weekly Reports only.
            </p>
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="password">Reset password (optional)</label>
            <input
              className={styles.input}
              id="password"
              name="password"
              type="password"
              minLength={8}
              placeholder="Leave blank to keep current password"
              value={form.password}
              onChange={handleChange}
            />
          </div>

          <div className={styles.field}>
            <label className={styles.label}>Assigned projects</label>
            {projects.length === 0 && <p className={styles.helpText}>No projects yet.</p>}
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

          <div className={styles.field}>
            <label className={styles.checkboxRow}>
              <input
                type="checkbox"
                checked={form.isProgramManager}
                onChange={(e) => setForm({ ...form, isProgramManager: e.target.checked })}
              />
              Program Manager
            </label>
            <p className={styles.helpText}>
              Only one person can be the Program Manager at a time - the only person who can approve
              or send back issues submitted for review. Checking this box here will automatically
              un-check it for whoever currently holds it.
            </p>
          </div>

          <div className={styles.actions}>
            <button className={`${styles.button} ${styles.buttonAccent}`} type="submit" disabled={saving}>
              {saving ? 'Saving...' : 'Save changes'}
            </button>
            <Link href="/admin/users" className={styles.buttonSecondary}>
              Back to list
            </Link>
          </div>
        </form>
      </div>
    </AppShell>
  );
}
