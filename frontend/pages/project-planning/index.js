import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import AppShell from '../../components/AppShell';
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

// Text input + filtered dropdown over an already-fetched options array -
// no typeahead component exists anywhere else in this codebase to reuse,
// so this is new but deliberately small. Selecting is required: typing
// something that doesn't match a real option just leaves the field
// unset, so entries can't fragment into free-text variants (Project in
// particular must always resolve to a real one - enforced again on the
// backend regardless of what the UI allows).
function SearchSelectField({ label, id, value, onChange, options, disabled, placeholder, required }) {
  const [query, setQuery] = useState(value ? value.name : '');
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setQuery(value ? value.name : '');
  }, [value]);

  const filtered = query
    ? options.filter((o) => o.name.toLowerCase().includes(query.toLowerCase()))
    : options;

  return (
    <div className={styles.field} style={{ position: 'relative' }}>
      <label className={styles.label} htmlFor={id}>{label}</label>
      <input
        className={styles.input}
        id={id}
        disabled={disabled}
        required={required}
        placeholder={disabled ? placeholder : 'Type to search...'}
        autoComplete="off"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          if (value) onChange(null);
        }}
        onFocus={() => setOpen(true)}
        // onMouseDown (not onClick) on the options below fires before this
        // blur, otherwise the dropdown would close before a click registers.
        onBlur={() => setTimeout(() => setOpen(false), 150)}
      />
      {open && !disabled && filtered.length > 0 && (
        <div
          style={{
            position: 'absolute', zIndex: 20, top: '100%', left: 0, right: 0, marginTop: 4,
            background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 8,
            maxHeight: 220, overflowY: 'auto', boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
          }}
        >
          {filtered.map((o) => (
            <div
              key={o.id}
              onMouseDown={() => {
                onChange(o);
                setQuery(o.name);
                setOpen(false);
              }}
              style={{ padding: 'var(--space-2) var(--space-3)', cursor: 'pointer' }}
            >
              {o.name}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

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
    apiFetch('/teams').then((list) => setTeams(list.filter((t) => t.isActive))).catch(() => {});
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  // Module/Phase options are scoped to whichever Project is currently
  // selected in the form - refetched whenever that changes, same as the
  // Issue edit page's module dropdown.
  useEffect(() => {
    if (!form.project) {
      setModules([]);
      setPhases([]);
      return;
    }
    apiFetch(`/modules?projectId=${form.project.id}`).then(setModules).catch(() => setModules([]));
    apiFetch(`/sprints?projectId=${form.project.id}`).then(setPhases).catch(() => setPhases([]));
  }, [form.project]);

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
      phase: entry.sprintId ? { id: entry.sprintId, name: entry.sprintName } : null,
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
        sprintId: form.phase ? form.phase.id : null,
        sprintName: form.phase ? form.phase.name : null,
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
            onChange={(v) => setForm({ ...form, project: v, module: null, phase: null })}
            options={projects}
          />
          <SearchSelectField
            label="Module"
            id="ppModule"
            value={form.module}
            onChange={(v) => setForm({ ...form, module: v })}
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
            disabled={!form.project}
            placeholder="Select a Project first"
          />
          <SearchSelectField
            label="Team"
            id="ppTeam"
            value={form.team}
            onChange={(v) => setForm({ ...form, team: v })}
            options={teams}
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
                  <td>{entry.sprintName || '—'}</td>
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
