import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import AppShell from '../../components/AppShell';
import SearchSelectField from '../../components/SearchSelectField';
import styles from '../../styles/issues.module.css';
import { apiFetch } from '../../lib/api';
import { useToast } from '../../lib/toast';

const VIEW_ROLES = ['admin', 'executive', 'program_manager'];

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

export default function ProjectPhasesPage() {
  const router = useRouter();
  const { showToast } = useToast();

  const [user, setUser] = useState(null);
  const [phases, setPhases] = useState([]);
  const [projects, setProjects] = useState([]);
  const [allModules, setAllModules] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [filterProjectId, setFilterProjectId] = useState('');
  const [filterModuleId, setFilterModuleId] = useState('');

  const [showForm, setShowForm] = useState(false);
  const [formProject, setFormProject] = useState(null);
  const [formModule, setFormModule] = useState(null);
  const [formModules, setFormModules] = useState([]);
  const [formName, setFormName] = useState('');
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState(null);

  const load = () => {
    setLoading(true);
    setError('');
    apiFetch('/phases/all')
      .then(setPhases)
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
    apiFetch('/modules/all').then(setAllModules).catch(() => {});
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  // Module options in the create form are scoped to whichever Project is
  // currently selected there.
  useEffect(() => {
    if (!formProject) {
      setFormModules([]);
      return;
    }
    apiFetch(`/modules?projectId=${formProject.id}`).then(setFormModules).catch(() => setFormModules([]));
  }, [formProject]);

  const canManage = user && user.role === 'program_manager';

  const resetForm = () => {
    setFormProject(null);
    setFormModule(null);
    setFormName('');
    setShowForm(false);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (!formModule) {
      setError('Module is required - pick one from the search results.');
      return;
    }
    setSaving(true);
    try {
      await apiFetch('/phases', {
        method: 'POST',
        body: JSON.stringify({ moduleId: formModule.id, name: formName }),
      });
      showToast('Phase created', 'success');
      resetForm();
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleToggleActive = async (phase) => {
    if (phase.isActive && !confirm(`Deactivate "${phase.name}"? It will no longer be assignable to new issues or Project Planning entries.`)) return;
    setBusyId(phase.id);
    setError('');
    try {
      await apiFetch(`/phases/${phase.id}/${phase.isActive ? 'deactivate' : 'activate'}`, { method: 'PATCH' });
      showToast(phase.isActive ? 'Phase deactivated' : 'Phase activated', 'info');
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  };

  const filterModules = filterProjectId
    ? allModules.filter((m) => String(m.projectId) === filterProjectId)
    : allModules;

  const visiblePhases = phases.filter((p) => {
    if (filterProjectId && String(p.projectId) !== filterProjectId) return false;
    if (filterModuleId && String(p.moduleId) !== filterModuleId) return false;
    return true;
  });

  return (
    <AppShell>
      <div className={styles.pageHeader}>
        <div>
          <h1 className={styles.pageTitle}>Project Phases</h1>
          <p className={styles.pageSubtitle}>
            Create Phases within a Module. % Complete is computed live from the actual Issues linked to each Phase
            - it's blank until issues are assigned.
          </p>
        </div>
        {canManage && (
          <button className={`${styles.button} ${styles.buttonAccent}`} type="button" onClick={() => (showForm ? resetForm() : setShowForm(true))}>
            {showForm ? 'Cancel' : 'New Phase'}
          </button>
        )}
      </div>

      {error && <div className={styles.error}>{error}</div>}

      {showForm && canManage && (
        <form onSubmit={handleSubmit} className={styles.card} style={{ marginBottom: 'var(--space-4)' }}>
          <p className={styles.helpText} style={{ marginTop: 0 }}>
            Phase names must be unique within a Module.
          </p>

          <SearchSelectField
            label="Project"
            id="pfProject"
            required
            value={formProject}
            onChange={(v) => {
              setFormProject(v);
              setFormModule(null);
            }}
            options={projects}
          />
          <SearchSelectField
            label="Module"
            id="pfModule"
            required
            value={formModule}
            onChange={setFormModule}
            options={formModules}
            disabled={!formProject}
            placeholder="Select a Project first"
          />

          <div className={styles.field}>
            <label className={styles.label} htmlFor="pfName">Phase</label>
            <input
              className={styles.input}
              id="pfName"
              required
              value={formName}
              onChange={(e) => setFormName(e.target.value)}
              placeholder="e.g. Discovery, Build, Launch"
            />
          </div>

          <div className={styles.actions}>
            <button className={`${styles.button} ${styles.buttonAccent}`} type="submit" disabled={saving}>
              {saving ? 'Creating...' : 'Create Phase'}
            </button>
          </div>
        </form>
      )}

      <div style={{ display: 'flex', gap: 'var(--space-3)', marginBottom: 'var(--space-4)', flexWrap: 'wrap' }}>
        <div className={styles.field} style={{ margin: 0 }}>
          <label className={styles.label}>Filter by Project</label>
          <select
            className={styles.select}
            value={filterProjectId}
            onChange={(e) => {
              setFilterProjectId(e.target.value);
              setFilterModuleId('');
            }}
          >
            <option value="">All Projects</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
        <div className={styles.field} style={{ margin: 0 }}>
          <label className={styles.label}>Filter by Module</label>
          <select className={styles.select} value={filterModuleId} onChange={(e) => setFilterModuleId(e.target.value)}>
            <option value="">All Modules</option>
            {filterModules.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
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
                <th>% Complete</th>
                <th>Status</th>
                {canManage && <th></th>}
              </tr>
            </thead>
            <tbody>
              {visiblePhases.length === 0 && (
                <tr>
                  <td colSpan={canManage ? 6 : 5} className={styles.empty}>No Phases yet.</td>
                </tr>
              )}
              {visiblePhases.map((phase) => (
                <tr key={phase.id} style={{ opacity: phase.isActive ? 1 : 0.55 }}>
                  <td>{phase.projectName}</td>
                  <td>{phase.moduleName}</td>
                  <td>{phase.name}</td>
                  <td><ProgressBar percent={phase.percentComplete} /></td>
                  <td>
                    <span
                      className={styles.badge}
                      style={phase.isActive
                        ? { background: 'var(--color-teal-tint)', color: 'var(--color-teal-dark)' }
                        : { background: 'var(--color-slate-tint)', color: 'var(--color-ink-soft)' }}
                    >
                      {phase.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  {canManage && (
                    <td>
                      <button
                        className={styles.buttonSecondary}
                        type="button"
                        disabled={busyId === phase.id}
                        onClick={() => handleToggleActive(phase)}
                      >
                        {phase.isActive ? 'Deactivate' : 'Activate'}
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
