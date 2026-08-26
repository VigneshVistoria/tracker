import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import AppShell from '../../components/AppShell';
import styles from '../../styles/issues.module.css';
import { apiFetch } from '../../lib/api';
import { getSocket } from '../../lib/socket';
import { useToast } from '../../lib/toast';

export default function ProjectsAdmin() {
  const router = useRouter();
  const { showToast } = useToast();
  const [projects, setProjects] = useState([]);
  const [form, setForm] = useState({ name: '', description: '' });
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const [isAdmin, setIsAdmin] = useState(false);

  const loadProjects = () => {
    apiFetch('/projects')
      .then(setProjects)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    const storedUser = localStorage.getItem('user');
    if (!storedUser) {
      router.replace('/');
      return;
    }
    setIsAdmin(JSON.parse(storedUser).role === 'admin');
    loadProjects();
  }, [router]);

  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;
    const onCreated = (project) => {
      showToast(`New project: "${project.name}"`, 'info');
      setProjects((prev) => (prev.some((p) => p.id === project.id) ? prev : [...prev, project]));
    };
    socket.on('project:created', onCreated);
    return () => socket.off('project:created', onCreated);
  }, [showToast]);

  const handleChange = (e) => setForm({ ...form, [e.target.name]: e.target.value });

  const handleCreate = async (e) => {
    e.preventDefault();
    setError('');
    setCreating(true);
    try {
      await apiFetch('/projects', { method: 'POST', body: JSON.stringify(form) });
      setForm({ name: '', description: '' });
      showToast('Project created', 'success');
      loadProjects();
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
          <h1 className={styles.pageTitle}>Projects</h1>
          <p className={styles.pageSubtitle}>
            {isAdmin ? 'Create projects and see all of them here.' : 'Projects you\u2019ve been assigned to.'}
          </p>
        </div>
      </div>

      {error && <div className={styles.error}>{error}</div>}

      {isAdmin && (
        <div className={styles.card}>
          <h3 style={{ marginTop: 0, marginBottom: 'var(--space-4)', fontSize: '1rem' }}>Create a project</h3>
          <form onSubmit={handleCreate}>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="name">Name</label>
              <input
                className={styles.input}
                id="name"
                name="name"
                required
                value={form.name}
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
            <button className={`${styles.button} ${styles.buttonAccent}`} type="submit" disabled={creating}>
              {creating ? 'Creating...' : 'Create Project'}
            </button>
          </form>
        </div>
      )}

      <div className={styles.card}>
        {loading && <div className={styles.empty}>Loading...</div>}
        {!loading && projects.length === 0 && (
          <div className={styles.empty}>
            {isAdmin ? 'No projects yet — create one above.' : 'No projects assigned to you yet.'}
          </div>
        )}
        {projects.map((p) => (
          <Link key={p.id} href={`/admin/projects/${p.id}`} className={styles.issueRow}>
            <div className={styles.issueMain}>
              <p className={styles.issueTitle}>{p.name}</p>
              {p.description && <p className={styles.issueMeta}>{p.description}</p>}
            </div>
          </Link>
        ))}
      </div>
    </AppShell>
  );
}
