import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import AppShell from '../../components/AppShell';
import SearchSelectField from '../../components/SearchSelectField';
import styles from '../../styles/issues.module.css';
import { apiFetch } from '../../lib/api';
import { useToast } from '../../lib/toast';

const VIEW_ROLES = ['admin', 'executive', 'program_manager', 'qa', 'developer'];
const CREATE_ROLES = ['admin', 'program_manager', 'qa', 'executive'];
const MANAGE_ROLES = ['admin', 'program_manager'];

const TASK_STATUSES = [
  'To Do',
  'In Progress',
  'Ready for Feedback',
  'Feedback Pass',
  'Feedback Failed',
  'Released - No Showstoppers',
  'Released - With Showstoppers',
];

const STATUS_COLOR = {
  'To Do': { bg: 'var(--color-slate-tint)', fg: 'var(--color-ink-soft)' },
  'In Progress': { bg: 'var(--color-amber-tint)', fg: 'var(--color-amber-dark)' },
  'Ready for Feedback': { bg: 'var(--color-plum-tint)', fg: 'var(--color-plum-dark)' },
  'Feedback Pass': { bg: 'var(--color-moss-tint)', fg: 'var(--color-moss-dark)' },
  'Feedback Failed': { bg: 'var(--color-red-tint)', fg: 'var(--color-red-dark)' },
  'Released - No Showstoppers': { bg: 'var(--color-teal-tint)', fg: 'var(--color-teal-dark)' },
  'Released - With Showstoppers': { bg: 'var(--color-red-tint)', fg: 'var(--color-red-dark)' },
};

function StatusBadge({ status }) {
  if (!status) return <span className={styles.issueMeta}>—</span>;
  const color = STATUS_COLOR[status] || { bg: 'var(--color-slate-tint)', fg: 'var(--color-ink-soft)' };
  return (
    <span className={styles.badge} style={{ background: color.bg, color: color.fg }}>
      {status}
    </span>
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

function userToOption(u) {
  return { id: u.id, name: u.fullName || u.email };
}

const EMPTY_FORM = {
  project: null,
  module: null,
  phase: null,
  sprint: null,
  description: '',
  assignee: null,
  estimatedHours: '',
  dueDate: '',
  dependency: false,
  dependencyDescription: '',
  dependencyOwner: null,
  feedbackLink: '',
  status: '',
};

export default function TasksPage() {
  const router = useRouter();
  const { showToast } = useToast();

  const [user, setUser] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [projects, setProjects] = useState([]);
  const [assignableUsers, setAssignableUsers] = useState([]);
  const [developers, setDevelopers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [modules, setModules] = useState([]);
  const [phases, setPhases] = useState([]);
  const [sprints, setSprints] = useState([]);

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [statusBusyId, setStatusBusyId] = useState(null);

  const load = () => {
    setLoading(true);
    setError('');
    apiFetch('/tasks')
      .then(setTasks)
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
    apiFetch('/users/assignable').then((rows) => setAssignableUsers(rows.map(userToOption))).catch(() => {});
    apiFetch('/users/assignable?role=developer').then((rows) => setDevelopers(rows.map(userToOption))).catch(() => {});
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  // Cascading Project -> Module -> Phase, and Sprint (project-scoped only).
  useEffect(() => {
    if (!form.project) {
      setModules([]);
      return;
    }
    apiFetch(`/modules?projectId=${form.project.id}`).then(setModules).catch(() => setModules([]));
    apiFetch(`/sprints?projectId=${form.project.id}`).then(setSprints).catch(() => setSprints([]));
  }, [form.project]);

  useEffect(() => {
    if (!form.module) {
      setPhases([]);
      return;
    }
    apiFetch(`/phases?moduleId=${form.module.id}`).then(setPhases).catch(() => setPhases([]));
  }, [form.module]);

  if (!user) return null;

  const canCreate = CREATE_ROLES.includes(user.role);
  const canManage = MANAGE_ROLES.includes(user.role);

  const canEditTask = (task) => canManage || task.assigneeUserId === user.id;

  const resetForm = () => {
    setForm(EMPTY_FORM);
    setModules([]);
    setPhases([]);
    setSprints([]);
    setShowForm(false);
    setEditingId(null);
  };

  const startEdit = (task) => {
    setEditingId(task.id);
    setForm({
      project: { id: task.projectId, name: task.projectName },
      module: { id: task.moduleId, name: task.moduleName },
      phase: { id: task.phaseId, name: task.phaseName },
      sprint: { id: task.sprintId, name: task.sprintName },
      description: task.description,
      assignee: { id: task.assigneeUserId, name: task.assigneeEmail },
      estimatedHours: task.estimatedHours ?? '',
      dueDate: task.dueDate ?? '',
      dependency: task.dependency,
      dependencyDescription: task.dependencyDescription || '',
      dependencyOwner: task.dependencyOwnerUserId
        ? { id: task.dependencyOwnerUserId, name: task.dependencyOwnerEmail }
        : null,
      feedbackLink: task.feedbackLink || '',
      status: task.status || '',
    });
    setShowForm(true);
  };

  const buildPayload = () => ({
    projectId: form.project?.id,
    moduleId: form.module?.id,
    phaseId: form.phase?.id,
    sprintId: form.sprint?.id,
    description: form.description,
    assigneeUserId: form.assignee?.id,
    estimatedHours: form.estimatedHours === '' ? undefined : Number(form.estimatedHours),
    dueDate: form.dueDate || undefined,
    dependency: form.dependency,
    dependencyDescription: form.dependency ? form.dependencyDescription : undefined,
    dependencyOwnerUserId: form.dependency ? form.dependencyOwner?.id : undefined,
    feedbackLink: form.feedbackLink || undefined,
  });

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (!form.project || !form.module || !form.phase || !form.sprint) {
      setError('Project, Module, Phase, and Sprint are all required.');
      return;
    }
    if (!form.assignee) {
      setError('Assignee is required.');
      return;
    }
    setSaving(true);
    try {
      if (editingId) {
        await apiFetch(`/tasks/${editingId}`, { method: 'PATCH', body: JSON.stringify(buildPayload()) });
        showToast('Task updated', 'success');
      } else {
        const payload = { ...buildPayload() };
        if (form.status) payload.status = form.status;
        await apiFetch('/tasks', { method: 'POST', body: JSON.stringify(payload) });
        showToast('Task created', 'success');
      }
      resetForm();
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleStatusChange = async (task, status) => {
    setStatusBusyId(task.id);
    setError('');
    try {
      await apiFetch(`/tasks/${task.id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) });
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setStatusBusyId(null);
    }
  };

  const estimatedHoursLocked =
    editingId != null &&
    tasks.find((t) => t.id === editingId)?.estimatedHours != null &&
    !canManage;

  return (
    <AppShell>
      <div className={styles.pageHeader}>
        <div>
          <h1 className={styles.pageTitle}>Tasks</h1>
          <p className={styles.pageSubtitle}>
            Granular work items scoped to a Project, Module, Phase, and Sprint. % Complete is derived from the
            admin-configured status mapping (see Task Status Config). Status can't be set until Estimated Hours and
            Due Date are both filled in.
          </p>
        </div>
        {canCreate && (
          <button className={`${styles.button} ${styles.buttonAccent}`} type="button" onClick={() => (showForm ? resetForm() : setShowForm(true))}>
            {showForm ? 'Cancel' : 'New Task'}
          </button>
        )}
      </div>

      {error && <div className={styles.error}>{error}</div>}

      {showForm && (canCreate || editingId) && (
        <form onSubmit={handleSubmit} className={styles.card} style={{ marginBottom: 'var(--space-4)' }}>
          <SearchSelectField
            label="Project"
            id="tkProject"
            required
            value={form.project}
            onChange={(v) => setForm({ ...form, project: v, module: null, phase: null, sprint: null })}
            options={projects}
          />
          <SearchSelectField
            label="Module"
            id="tkModule"
            required
            value={form.module}
            onChange={(v) => setForm({ ...form, module: v, phase: null })}
            options={modules}
            disabled={!form.project}
            placeholder="Select a Project first"
          />
          <SearchSelectField
            label="Phase"
            id="tkPhase"
            required
            value={form.phase}
            onChange={(v) => setForm({ ...form, phase: v })}
            options={phases}
            disabled={!form.module}
            placeholder="Select a Module first"
          />
          <SearchSelectField
            label="Sprint"
            id="tkSprint"
            required
            value={form.sprint}
            onChange={(v) => setForm({ ...form, sprint: v })}
            options={sprints}
            disabled={!form.project}
            placeholder="Select a Project first"
          />

          <div className={styles.field}>
            <label className={styles.label} htmlFor="tkDescription">Description</label>
            <textarea
              className={styles.textarea}
              id="tkDescription"
              required
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
          </div>

          <SearchSelectField
            label="Assignee"
            id="tkAssignee"
            required
            value={form.assignee}
            onChange={(v) => setForm({ ...form, assignee: v })}
            options={assignableUsers}
          />

          <div className={styles.field}>
            <label className={styles.label} htmlFor="tkEHrs">Estimated Hours</label>
            <input
              className={styles.input}
              id="tkEHrs"
              type="number"
              min="0"
              step="0.5"
              disabled={estimatedHoursLocked}
              value={form.estimatedHours}
              onChange={(e) => setForm({ ...form, estimatedHours: e.target.value })}
            />
            {estimatedHoursLocked && (
              <p className={styles.helpText}>Locked after first entry - only Admin or Program Manager can change it now.</p>
            )}
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="tkDueDate">Due Date</label>
            <input
              className={styles.input}
              id="tkDueDate"
              type="date"
              value={form.dueDate}
              onChange={(e) => setForm({ ...form, dueDate: e.target.value })}
            />
          </div>

          <div className={styles.field}>
            <label className={styles.checkboxRow}>
              <input
                type="checkbox"
                checked={form.dependency}
                onChange={(e) => setForm({ ...form, dependency: e.target.checked })}
              />
              This task has a dependency
            </label>
          </div>

          {form.dependency && (
            <>
              <div className={styles.field}>
                <label className={styles.label} htmlFor="tkDepDesc">Dependency Description</label>
                <textarea
                  className={styles.textarea}
                  id="tkDepDesc"
                  required
                  value={form.dependencyDescription}
                  onChange={(e) => setForm({ ...form, dependencyDescription: e.target.value })}
                />
              </div>
              <SearchSelectField
                label="Dependency Owner (Developer)"
                id="tkDepOwner"
                required
                value={form.dependencyOwner}
                onChange={(v) => setForm({ ...form, dependencyOwner: v })}
                options={developers}
              />
            </>
          )}

          <div className={styles.field}>
            <label className={styles.label} htmlFor="tkFeedbackLink">Feedback Link</label>
            <input
              className={styles.input}
              id="tkFeedbackLink"
              type="url"
              value={form.feedbackLink}
              onChange={(e) => setForm({ ...form, feedbackLink: e.target.value })}
            />
          </div>

          {!editingId && (
            <div className={styles.field}>
              <label className={styles.label} htmlFor="tkStatus">Status (optional at creation)</label>
              <select
                className={styles.select}
                id="tkStatus"
                value={form.status}
                disabled={!form.estimatedHours || !form.dueDate}
                onChange={(e) => setForm({ ...form, status: e.target.value })}
              >
                <option value="">— Not set —</option>
                {TASK_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
              {(!form.estimatedHours || !form.dueDate) && (
                <p className={styles.helpText}>Set Estimated Hours and Due Date to enable Status.</p>
              )}
            </div>
          )}

          <div className={styles.actions}>
            <button className={`${styles.button} ${styles.buttonAccent}`} type="submit" disabled={saving}>
              {saving ? 'Saving...' : editingId ? 'Save Changes' : 'Create Task'}
            </button>
          </div>
        </form>
      )}

      {loading && <div className={styles.empty}>Loading...</div>}

      {!loading && (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Project</th>
                <th>Module</th>
                <th>Phase</th>
                <th>Sprint</th>
                <th>Description</th>
                <th>Assignee</th>
                <th>E.Hrs</th>
                <th>Due Date</th>
                <th>Dependency</th>
                <th>Status</th>
                <th>% Complete</th>
                <th>Ageing</th>
                <th>Feedback</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {tasks.length === 0 && (
                <tr>
                  <td colSpan={14} className={styles.empty}>No Tasks yet.</td>
                </tr>
              )}
              {tasks.map((task) => (
                <tr key={task.id}>
                  <td>{task.projectName}</td>
                  <td>{task.moduleName}</td>
                  <td>{task.phaseName}</td>
                  <td>{task.sprintName}</td>
                  <td style={{ maxWidth: 240 }}>{task.description}</td>
                  <td>{task.assigneeEmail}</td>
                  <td>{task.estimatedHours ?? '—'}</td>
                  <td>{task.dueDate || '—'}</td>
                  <td>{task.dependency ? task.dependencyOwnerEmail || 'Yes' : 'No'}</td>
                  <td>
                    {canEditTask(task) && task.estimatedHours != null && task.dueDate ? (
                      <select
                        className={styles.select}
                        value={task.status || ''}
                        disabled={statusBusyId === task.id}
                        onChange={(e) => handleStatusChange(task, e.target.value)}
                      >
                        <option value="" disabled>— Set status —</option>
                        {TASK_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                      </select>
                    ) : (
                      <StatusBadge status={task.status} />
                    )}
                  </td>
                  <td><ProgressBar percent={task.percentComplete} /></td>
                  <td>{task.ageingDays}d</td>
                  <td>
                    {task.feedbackLink ? (
                      <a href={task.feedbackLink} target="_blank" rel="noreferrer">Link</a>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td>
                    {canEditTask(task) && (
                      <button className={styles.buttonSecondary} type="button" onClick={() => startEdit(task)}>
                        Edit
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </AppShell>
  );
}
