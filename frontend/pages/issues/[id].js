import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import AppShell from '../../components/AppShell';
import styles from '../../styles/issues.module.css';
import { apiFetch } from '../../lib/api';
import { getSocket } from '../../lib/socket';
import { useToast } from '../../lib/toast';
import { badgeClassFor, STATUS_OPTIONS, MODE_OPTIONS } from '../../lib/status';

export default function IssueDetail() {
  const router = useRouter();
  const { id } = router.query;
  const { showToast } = useToast();

  const [issue, setIssue] = useState(null);
  const [users, setUsers] = useState([]);
  const [projects, setProjects] = useState([]);
  const [form, setForm] = useState({
    title: '',
    description: '',
    status: 'Open',
    assigneeUserId: '',
    projectId: '',
    mode: 'Manual',
    showstopper: false,
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!id) return;

    Promise.all([
      apiFetch(`/issues/${id}`),
      apiFetch('/users/assignable'),
      apiFetch('/projects'),
    ])
      .then(([data, allUsers, allProjects]) => {
        setIssue(data);
        setUsers(allUsers);
        setProjects(allProjects);
        setForm({
          title: data.title,
          description: data.description || '',
          status: data.status,
          assigneeUserId: data.assigneeUserId || '',
          projectId: data.projectId || '',
          mode: data.mode || 'Manual',
          showstopper: Boolean(data.showstopper),
        });
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [id]);

  // If someone else updates this same issue elsewhere, reflect it live.
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;
    const onUpdated = (updated) => {
      if (String(updated.id) === String(id)) {
        setIssue(updated);
        showToast('This issue was just updated', 'info');
      }
    };
    socket.on('issue:updated', onUpdated);
    return () => socket.off('issue:updated', onUpdated);
  }, [id, showToast]);

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    setForm({ ...form, [name]: type === 'checkbox' ? checked : value });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSaving(true);

    try {
      const updated = await apiFetch(`/issues/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          title: form.title,
          description: form.description,
          status: form.status,
          assigneeUserId: form.assigneeUserId ? Number(form.assigneeUserId) : null,
          projectId: form.projectId ? Number(form.projectId) : null,
          mode: form.mode,
          showstopper: form.showstopper,
        }),
      });
      setIssue(updated);
      showToast('Changes saved', 'success');
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <AppShell><div className={styles.empty}>Loading...</div></AppShell>;
  }

  if (!issue) {
    return (
      <AppShell>
        <div className={styles.error}>{error || 'Issue not found.'}</div>
        <Link href="/issues" className={styles.backLink}>← Back to issues</Link>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className={styles.pageHeader}>
        <div>
          <h1 className={styles.pageTitle}>
            <span className={styles.issueId}>#{issue.id}</span>
            {issue.title}
          </h1>
          <p className={styles.pageSubtitle}>Opened by {issue.createdByEmail}</p>
        </div>
        <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
          {issue.showstopper && (
            <span className={styles.badge} style={{ background: 'var(--color-red-tint)', color: 'var(--color-red-dark)' }}>
              Showstopper
            </span>
          )}
          <span className={`${styles.badge} ${badgeClassFor(issue.status, styles)}`}>
            {issue.status}
          </span>
        </div>
      </div>

      <div className={styles.card}>
        {error && <div className={styles.error}>{error}</div>}

        <form onSubmit={handleSubmit}>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="title">Title</label>
            <input
              className={styles.input}
              id="title"
              name="title"
              value={form.title}
              onChange={handleChange}
            />
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="description">Description</label>
            <textarea
              className={styles.textarea}
              id="description"
              name="description"
              value={form.description}
              onChange={handleChange}
            />
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="status">Status</label>
            <select
              className={styles.select}
              id="status"
              name="status"
              value={form.status}
              onChange={handleChange}
            >
              {STATUS_OPTIONS.map((option) => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="projectId">Project</label>
            <select
              className={styles.select}
              id="projectId"
              name="projectId"
              value={form.projectId}
              onChange={handleChange}
            >
              <option value="">No project</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="assigneeUserId">Assignee</label>
            <select
              className={styles.select}
              id="assigneeUserId"
              name="assigneeUserId"
              value={form.assigneeUserId}
              onChange={handleChange}
            >
              <option value="">Unassigned</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>{u.fullName || u.email}</option>
              ))}
            </select>
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="mode">Mode</label>
            <select
              className={styles.select}
              id="mode"
              name="mode"
              value={form.mode}
              onChange={handleChange}
            >
              {MODE_OPTIONS.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>

          <div className={styles.field}>
            <label className={styles.checkboxRow}>
              <input
                type="checkbox"
                name="showstopper"
                checked={form.showstopper}
                onChange={handleChange}
              />
              Showstopper (critical, blocking issue)
            </label>
          </div>

          {issue.closedOn && (
            <p className={styles.helpText}>
              Closed on {new Date(issue.closedOn).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}
            </p>
          )}

          <div className={styles.actions}>
            <button className={`${styles.button} ${styles.buttonAccent}`} type="submit" disabled={saving}>
              {saving ? 'Saving...' : 'Save changes'}
            </button>
            <Link href="/issues" className={styles.buttonSecondary}>
              Back to list
            </Link>
          </div>
        </form>
      </div>
    </AppShell>
  );
}
