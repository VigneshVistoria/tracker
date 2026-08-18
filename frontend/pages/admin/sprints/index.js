import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import AppShell from '../../../components/AppShell';
import styles from '../../../styles/issues.module.css';
import { apiFetch } from '../../../lib/api';
import { useToast } from '../../../lib/toast';
import { getSocket } from '../../../lib/socket';

const STATUS_BADGE_STYLE = {
  Planned: { background: 'var(--color-slate-tint, #eef0f2)', color: 'var(--color-ink-soft)' },
  Active: { background: 'var(--status-open-tint)', color: 'var(--color-teal-dark)' },
  Completed: { background: 'var(--status-review-tint)', color: 'var(--color-plum-dark)' },
};

export default function SprintsListPage() {
  const router = useRouter();
  const { showToast } = useToast();
  const [projects, setProjects] = useState([]);
  const [projectId, setProjectId] = useState('');
  const [sprints, setSprints] = useState([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: '', goal: '', startDate: '', endDate: '' });
  const [error, setError] = useState('');
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    const storedUser = localStorage.getItem('user');
    if (!storedUser) {
      router.replace('/');
      return;
    }
    setIsAdmin(JSON.parse(storedUser).role === 'admin');
    apiFetch('/projects')
      .then((data) => {
        setProjects(data);
        if (data.length > 0) setProjectId(String(data[0].id));
      })
      .catch((err) => setError(err.message));
  }, [router]);

  const loadSprints = (pid) => {
    if (!pid) return;
    setLoading(true);
    apiFetch(`/sprints?projectId=${pid}`)
      .then(setSprints)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadSprints(projectId);
  }, [projectId]);

  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;
    const onChange = (sprint) => {
      if (String(sprint.projectId) === String(projectId)) loadSprints(projectId);
    };
    const onDeleted = () => loadSprints(projectId);
    socket.on('sprint:created', onChange);
    socket.on('sprint:updated', onChange);
    socket.on('sprint:deleted', onDeleted);
    return () => {
      socket.off('sprint:created', onChange);
      socket.off('sprint:updated', onChange);
      socket.off('sprint:deleted', onDeleted);
    };
  }, [projectId]);

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!projectId) return;
    setError('');
    setCreating(true);
    try {
      await apiFetch('/sprints', {
        method: 'POST',
        body: JSON.stringify({
          projectId: Number(projectId),
          name: form.name,
          goal: form.goal || undefined,
          startDate: form.startDate || undefined,
          endDate: form.endDate || undefined,
        }),
      });
      showToast('Sprint created', 'success');
      setForm({ name: '', goal: '', startDate: '', endDate: '' });
      loadSprints(projectId);
    } catch (err) {
      setError(err.message);
    } finally {
      setCreating(false);
    }
  };

  return (
    <AppShell>
      <div className={styles.pageHeader}>
        <div>
          <h1 className={styles.pageTitle}>Sprints</h1>
          <p className={styles.pageSubtitle}>Plan work into sprints, per project.</p>
        </div>
      </div>

      {error && <div className={styles.error}>{error}</div>}

      <div className={styles.card}>
        <div className={styles.field} style={{ marginBottom: 0 }}>
          <label className={styles.label} htmlFor="projectId">Project</label>
          <select
            className={styles.select}
            id="projectId"
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
          >
            {projects.length === 0 && <option value="">No projects yet</option>}
            {projects.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>
      </div>

      {isAdmin && projectId && (
        <div className={styles.card}>
          <h3 style={{ marginTop: 0, fontSize: '1rem' }}>Create a sprint</h3>
          <form onSubmit={handleCreate}>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="name">Name</label>
              <input
                className={styles.input}
                id="name"
                required
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="e.g. Sprint 12"
              />
            </div>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="goal">Goal (optional)</label>
              <input
                className={styles.input}
                id="goal"
                value={form.goal}
                onChange={(e) => setForm({ ...form, goal: e.target.value })}
                placeholder="What this sprint is meant to achieve"
              />
            </div>
            <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
              <div className={styles.field} style={{ flex: 1 }}>
                <label className={styles.label} htmlFor="startDate">Start date</label>
                <input
                  className={styles.input}
                  id="startDate"
                  type="date"
                  value={form.startDate}
                  onChange={(e) => setForm({ ...form, startDate: e.target.value })}
                />
              </div>
              <div className={styles.field} style={{ flex: 1 }}>
                <label className={styles.label} htmlFor="endDate">End date</label>
                <input
                  className={styles.input}
                  id="endDate"
                  type="date"
                  value={form.endDate}
                  onChange={(e) => setForm({ ...form, endDate: e.target.value })}
                />
              </div>
            </div>
            <button className={`${styles.button} ${styles.buttonAccent}`} type="submit" disabled={creating}>
              {creating ? 'Creating...' : 'Create Sprint'}
            </button>
          </form>
        </div>
      )}

      <div className={styles.card}>
        <h3 style={{ marginTop: 0, fontSize: '1rem' }}>Sprints for this project</h3>
        {loading && <div className={styles.empty}>Loading...</div>}
        {!loading && sprints.length === 0 && <div className={styles.empty}>No sprints yet for this project.</div>}
        {sprints.map((s) => (
          <Link key={s.id} href={`/admin/sprints/${s.id}`} className={styles.issueRow}>
            <div className={styles.issueMain}>
              <p className={styles.issueTitle}>{s.name}</p>
              <p className={styles.issueMeta}>
                {s.startDate ? new Date(s.startDate).toLocaleDateString() : 'No start date'}
                {' \u2013 '}
                {s.endDate ? new Date(s.endDate).toLocaleDateString() : 'No end date'}
                {s.goal ? ` \u00b7 ${s.goal}` : ''}
              </p>
            </div>
            <span className={styles.badge} style={STATUS_BADGE_STYLE[s.status]}>{s.status}</span>
          </Link>
        ))}
      </div>
    </AppShell>
  );
}
