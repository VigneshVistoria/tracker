import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import AppShell from '../../components/AppShell';
import SearchSelectField from '../../components/SearchSelectField';
import styles from '../../styles/issues.module.css';
import { apiFetch } from '../../lib/api';
import { useToast } from '../../lib/toast';

const VIEW_ROLES = ['admin', 'executive', 'program_manager'];
const STATUS_OPTIONS = ['Active', 'Inactive'];

export default function ProjectTeamsPage() {
  const router = useRouter();
  const { showToast } = useToast();

  const [user, setUser] = useState(null);
  const [teams, setTeams] = useState([]);
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [filterProjectId, setFilterProjectId] = useState('');

  const [showForm, setShowForm] = useState(false);
  const [formProject, setFormProject] = useState(null);
  const [formName, setFormName] = useState('');
  const [formStatus, setFormStatus] = useState('Active');
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState(null);

  const load = () => {
    setLoading(true);
    setError('');
    apiFetch('/project-teams/all')
      .then(setTeams)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    const storedUser = localStorage.getItem('user');
    if (!storedUser) {
      router.replace('/');
      return;
    }
    const parsed = JSON.parse(storedUser);
    if (!VIEW_ROLES.includes(parsed.role)) {
      router.replace('/dashboard');
      return;
    }
    setUser(parsed);
    apiFetch('/projects').then(setProjects).catch(() => {});
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  const canManage = user && user.role === 'program_manager';

  const resetForm = () => {
    setFormProject(null);
    setFormName('');
    setFormStatus('Active');
    setShowForm(false);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (!formProject) {
      setError('Project is required - pick one from the search results.');
      return;
    }
    setSaving(true);
    try {
      await apiFetch('/project-teams', {
        method: 'POST',
        body: JSON.stringify({ projectId: formProject.id, name: formName, status: formStatus }),
      });
      showToast('Team created', 'success');
      resetForm();
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleToggleActive = async (team) => {
    const isActive = team.status === 'Active';
    if (isActive && !confirm(`Deactivate "${team.name}"? It will no longer be assignable to new Project Planning entries or Tasks - existing ones keep it.`)) return;
    setBusyId(team.id);
    setError('');
    try {
      await apiFetch(`/project-teams/${team.id}/${isActive ? 'deactivate' : 'activate'}`, { method: 'PATCH' });
      showToast(isActive ? 'Team deactivated' : 'Team activated', 'info');
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  };

  const visibleTeams = teams.filter((team) => {
    if (filterProjectId && String(team.projectId) !== filterProjectId) return false;
    return true;
  });

  return (
    <AppShell>
      <div className={styles.pageHeader}>
        <div>
          <h1 className={styles.pageTitle}>Project Teams</h1>
          <p className={styles.pageSubtitle}>
            Create Teams within a Project. Deactivating a Team hides it from new selections without breaking
            existing Project Planning entries or Tasks that already reference it.
          </p>
        </div>
        {canManage && (
          <button className={`${styles.button} ${styles.buttonAccent}`} type="button" onClick={() => (showForm ? resetForm() : setShowForm(true))}>
            {showForm ? 'Cancel' : 'New Team'}
          </button>
        )}
      </div>

      {error && <div className={styles.error}>{error}</div>}

      {showForm && canManage && (
        <form onSubmit={handleSubmit} className={styles.card} style={{ marginBottom: 'var(--space-4)' }}>
          <p className={styles.helpText} style={{ marginTop: 0 }}>
            Team names must be unique within a Project.
          </p>

          <SearchSelectField
            label="Project Name"
            id="ptProject"
            required
            value={formProject}
            onChange={setFormProject}
            options={projects}
          />

          <div className={styles.field}>
            <label className={styles.label} htmlFor="ptName">Team</label>
            <input
              className={styles.input}
              id="ptName"
              required
              value={formName}
              onChange={(e) => setFormName(e.target.value)}
              placeholder="e.g. Backend, QA, Frontend"
            />
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="ptStatus">Status</label>
            <select className={styles.select} id="ptStatus" value={formStatus} onChange={(e) => setFormStatus(e.target.value)}>
              {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>

          <div className={styles.actions}>
            <button className={`${styles.button} ${styles.buttonAccent}`} type="submit" disabled={saving}>
              {saving ? 'Creating...' : 'Create Team'}
            </button>
          </div>
        </form>
      )}

      <div style={{ display: 'flex', gap: 'var(--space-3)', marginBottom: 'var(--space-4)', flexWrap: 'wrap' }}>
        <div className={styles.field} style={{ margin: 0 }}>
          <label className={styles.label}>Filter by Project</label>
          <select className={styles.select} value={filterProjectId} onChange={(e) => setFilterProjectId(e.target.value)}>
            <option value="">All Projects</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
      </div>

      {loading && <div className={styles.empty}>Loading...</div>}

      {!loading && (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Project</th>
                <th>Team</th>
                <th>Status</th>
                {canManage && <th></th>}
              </tr>
            </thead>
            <tbody>
              {visibleTeams.length === 0 && (
                <tr>
                  <td colSpan={canManage ? 4 : 3} className={styles.empty}>No Teams yet.</td>
                </tr>
              )}
              {visibleTeams.map((team) => (
                <tr key={team.id} style={{ opacity: team.status === 'Active' ? 1 : 0.55 }}>
                  <td>{team.projectName}</td>
                  <td>{team.name}</td>
                  <td>
                    <span
                      className={styles.badge}
                      style={team.status === 'Active'
                        ? { background: 'var(--color-teal-tint)', color: 'var(--color-teal-dark)' }
                        : { background: 'var(--color-slate-tint)', color: 'var(--color-ink-soft)' }}
                    >
                      {team.status}
                    </span>
                  </td>
                  {canManage && (
                    <td>
                      <button
                        className={styles.buttonSecondary}
                        type="button"
                        disabled={busyId === team.id}
                        onClick={() => handleToggleActive(team)}
                      >
                        {team.status === 'Active' ? 'Deactivate' : 'Activate'}
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </AppShell>
  );
}
