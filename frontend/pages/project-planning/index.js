import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import AppShell from '../../components/AppShell';
import SearchSelectField from '../../components/SearchSelectField';
import styles from '../../styles/issues.module.css';
import { apiFetch } from '../../lib/api';
import { useToast } from '../../lib/toast';

const VIEW_ROLES = ['admin', 'executive', 'program_manager'];
const STATUS_OPTIONS = ['ToDo', 'In Progress', 'Completed', 'Delayed'];

const EMPTY_FORM = {
  id: null,
  project: null,
  module: null,
  phase: null,
  team: null,
  startDate: '',
  targetDate: '',
  status: 'ToDo',
};

const STATUS_BADGE_STYLE = {
  ToDo: { background: 'var(--color-slate-tint)', color: 'var(--color-ink-soft)' },
  'In Progress': { background: 'var(--color-amber-tint)', color: 'var(--color-amber-dark)' },
  Completed: { background: 'var(--color-teal-tint)', color: 'var(--color-teal-dark)' },
  Delayed: { background: 'var(--color-red-tint)', color: 'var(--color-red-dark)' },
};

function ProgressBar({ percent }) {
  if (percent === null || percent === undefined) {
    return <span className={styles.issueMeta}>—</span>;
  }
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
      <div style={{ width: 80, height: 8, borderRadius: 4, background: 'var(--color-slate-tint)', overflow: 'hidden' }}>
        <div style={{ width: `${percent}%`, height: '100%', background: 'var(--color-teal)' }} />
      </div>
      <span style={{ fontSize: '0.85rem', color: 'var(--color-ink-soft)' }}>{percent}%</span>
    </div>
  );
}

export default function ProjectPlanningPage() {
  const router = useRouter();
  const { showToast } = useToast();

  const [user, setUser] = useState(null);
  const [entries, setEntries] = useState([]);
  const [projects, setProjects] = useState([]);
  const [modules, setModules] = useState([]);
  const [phases, setPhases] = useState([]);
  const [teams, setTeams] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [filterProjectId, setFilterProjectId] = useState('');
  const [filterStatus, setFilterStatus] = useState('');

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState(null);

  const load = () => {
    setLoading(true);
    setError('');
    apiFetch('/project-planning')
      .then(setEntries)
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

  // Module options are scoped to whichever Project is currently selected.
  useEffect(() => {
    if (!form.project) {
      setModules([]);
      return;
    }
    apiFetch(`/modules?projectId=${form.project.id}`).then(setModules).catch(() => setModules([]));
  }, [form.project]);

  // Team options are scoped to whichever Project is currently selected -
  // a Team belongs to exactly one Project (backend/src/project-teams).
  useEffect(() => {
    if (!form.project) {
      setTeams([]);
      return;
    }
    apiFetch(`/project-teams?projectId=${form.project.id}`).then(setTeams).catch(() => setTeams([]));
  }, [form.project]);

  // Phase options are scoped to whichever Module is currently selected -
  // a Phase always belongs to exactly one Module.
  useEffect(() => {
    if (!form.module) {
      setPhases([]);
      return;
    }
    apiFetch(`/phases?moduleId=${form.module.id}`).then(setPhases).catch(() => setPhases([]));
  }, [form.module]);

  const canManage = user && user.role === 'program_manager';

  const resetForm = () => {
    setForm(EMPTY_FORM);
    setShowForm(false);
  };

  const startEdit = (entry) => {
    setForm({
      id: entry.id,
      project: { id: entry.projectId, name: entry.projectName },
      module: entry.moduleId ? { id: entry.moduleId, name: entry.moduleName } : null,
      phase: entry.phaseId ? { id: entry.phaseId, name: entry.phaseName } : null,
      team: entry.teamId ? { id: entry.teamId, name: entry.teamName } : null,
      startDate: entry.startDate,
      targetDate: entry.targetDate,
      status: entry.status,
    });
    setShowForm(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (!form.project) {
      setError('Project is required - pick one from the search results.');
      return;
    }
    if (form.targetDate < form.startDate) {
      setError('Target Date must be on or after Start Date.');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        projectId: form.project.id,
        moduleId: form.module ? form.module.id : null,
        moduleName: form.module ? form.module.name : null,
        phaseId: form.phase ? form.phase.id : null,
        phaseName: form.phase ? form.phase.name : null,
        teamId: form.team ? form.team.id : null,
        teamName: form.team ? form.team.name : null,
        startDate: form.startDate,
        targetDate: form.targetDate,
      };
      if (form.id) {
        await apiFetch(`/project-planning/${form.id}`, { method: 'PATCH', body: JSON.stringify(payload) });
        showToast('Project Planning entry updated', 'success');
      } else {
        await apiFetch('/project-planning', { method: 'POST', body: JSON.stringify({ ...payload, status: form.status }) });
        showToast('Project Planning entry created', 'success');
      }
      resetForm();
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleStatusChange = async (id, status) => {
    setBusyId(id);
    setError('');
    try {
      await apiFetch(`/project-planning/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) });
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  };

  const handleToggleActive = async (entry) => {
    if (entry.isActive && !confirm(`Deactivate this Project Planning entry for "${entry.projectName}"?`)) return;
    setBusyId(entry.id);
    setError('');
    try {
      await apiFetch(`/project-planning/${entry.id}/${entry.isActive ? 'deactivate' : 'activate'}`, { method: 'PATCH' });
      showToast(entry.isActive ? 'Entry deactivated' : 'Entry activated', 'info');
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  };

  const visibleEntries = entries.filter((entry) => {
    if (filterProjectId && String(entry.projectId) !== filterProjectId) return false;
    if (filterStatus && entry.status !== filterStatus) return false;
    return true;
  });

  return (
    <AppShell>
      <div className={styles.pageHeader}>
        <div>
          <h1 className={styles.pageTitle}>Project Planning</h1>
          <p className={styles.pageSubtitle}>
            Plan work against a Project's Module/Phase/Team and timeline. % Complete is computed live from the
            actual Issues in scope - it's never typed in.
          </p>
        </div>
        {canManage && (
          <button className={`${styles.button} ${styles.buttonAccent}`} type="button" onClick={() => (showForm ? resetForm() : setShowForm(true))}>
            {showForm ? 'Cancel' : 'New Entry'}
          </button>
        )}
      </div>

      {error && <div className={styles.error}>{error}</div>}

      {showForm && canManage && (
        <form onSubmit={handleSubmit} className={styles.card} style={{ marginBottom: 'var(--space-4)' }}>
          <p className={styles.helpText} style={{ marginTop: 0 }}>
            {form.id ? `Editing entry #${form.id}` : 'Project is required; Module/Phase/Team are optional.'}
          </p>

          <SearchSelectField
            label="Project"
            id="ppProject"
            required
            value={form.project}
            onChange={(v) => setForm({ ...form, project: v, module: null, phase: null, team: null })}
            options={projects}
          />
          <SearchSelectField
            label="Module"
            id="ppModule"
            value={form.module}
            onChange={(v) => setForm({ ...form, module: v, phase: null })}
            options={modules}
            disabled={!form.project}
            placeholder="Select a Project first"
          />
          <SearchSelectField
            label="Phase"
            id="ppPhase"
            value={form.phase}
            onChange={(v) => setForm({ ...form, phase: v })}
            options={phases}
            disabled={!form.module}
            placeholder="Select a Module first"
          />
          <SearchSelectField
            label="Team"
            id="ppTeam"
            value={form.team}
            onChange={(v) => setForm({ ...form, team: v })}
            options={teams}
            disabled={!form.project}
            placeholder="Select a Project first"
          />

          <div style={{ display: 'flex', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
            <div className={styles.field} style={{ flex: '1 1 160px' }}>
              <label className={styles.label} htmlFor="ppStart">Start Date</label>
              <input
                className={styles.input}
                id="ppStart"
                type="date"
                required
                value={form.startDate}
                onChange={(e) => setForm({ ...form, startDate: e.target.value })}
              />
            </div>
            <div className={styles.field} style={{ flex: '1 1 160px' }}>
              <label className={styles.label} htmlFor="ppTarget">Target Date</label>
              <input
                className={styles.input}
                id="ppTarget"
                type="date"
                required
                min={form.startDate || undefined}
                value={form.targetDate}
                onChange={(e) => setForm({ ...form, targetDate: e.target.value })}
              />
            </div>
            {!form.id && (
              <div className={styles.field} style={{ flex: '1 1 160px' }}>
                <label className={styles.label} htmlFor="ppStatus">Status</label>
                <select
                  className={styles.select}
                  id="ppStatus"
                  value={form.status}
                  onChange={(e) => setForm({ ...form, status: e.target.value })}
                >
                  {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
            )}
          </div>

          <div className={styles.actions}>
            <button className={`${styles.button} ${styles.buttonAccent}`} type="submit" disabled={saving}>
              {saving ? 'Saving...' : form.id ? 'Save Changes' : 'Create Entry'}
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
        <div className={styles.field} style={{ margin: 0 }}>
          <label className={styles.label}>Filter by Status</label>
          <select className={styles.select} value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
            <option value="">All Statuses</option>
            {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
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
                <th>Module</th>
                <th>Phase</th>
                <th>Team</th>
                <th>Start Date</th>
                <th>Target Date</th>
                <th>Status</th>
                <th>% Complete</th>
                {canManage && <th></th>}
              </tr>
            </thead>
            <tbody>
              {visibleEntries.length === 0 && (
                <tr>
                  <td colSpan={canManage ? 9 : 8} className={styles.empty}>No Project Planning entries yet.</td>
                </tr>
              )}
              {visibleEntries.map((entry) => (
                <tr key={entry.id} style={{ opacity: entry.isActive ? 1 : 0.55 }}>
                  <td>{entry.projectName}</td>
                  <td>{entry.moduleName || '—'}</td>
                  <td>{entry.phaseName || '—'}</td>
                  <td>{entry.teamName || '—'}</td>
                  <td>{entry.startDate}</td>
                  <td>{entry.targetDate}</td>
                  <td>
                    {canManage ? (
                      <select
                        className={styles.select}
                        value={entry.status}
                        disabled={busyId === entry.id || !entry.isActive}
                        onChange={(e) => handleStatusChange(entry.id, e.target.value)}
                      >
                        {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
                      </select>
                    ) : (
                      <span className={styles.badge} style={STATUS_BADGE_STYLE[entry.status]}>{entry.status}</span>
                    )}
                  </td>
                  <td><ProgressBar percent={entry.percentComplete} /></td>
                  {canManage && (
                    <td style={{ display: 'flex', gap: 'var(--space-2)' }}>
                      <button className={styles.buttonSecondary} type="button" onClick={() => startEdit(entry)}>Edit</button>
                      <button
                        className={styles.buttonSecondary}
                        type="button"
                        disabled={busyId === entry.id}
                        onClick={() => handleToggleActive(entry)}
                      >
                        {entry.isActive ? 'Deactivate' : 'Activate'}
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
