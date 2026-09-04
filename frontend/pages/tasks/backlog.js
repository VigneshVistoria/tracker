import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import AppShell from '../../components/AppShell';
import SearchSelectField from '../../components/SearchSelectField';
import styles from '../../styles/issues.module.css';
import { apiFetch } from '../../lib/api';
import { useToast } from '../../lib/toast';

const VIEW_ROLES = ['admin', 'program_manager'];

function userToOption(u) {
  return { id: u.id, name: u.fullName || u.email };
}

const EMPTY_FORM = { project: null, module: null, phase: null, description: '' };

export default function TaskBacklogPage() {
  const router = useRouter();
  const { showToast } = useToast();

  const [user, setUser] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [projects, setProjects] = useState([]);
  const [assignableUsers, setAssignableUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [modules, setModules] = useState([]);
  const [phases, setPhases] = useState([]);

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const [selectedIds, setSelectedIds] = useState([]);
  const [bulkAssignee, setBulkAssignee] = useState(null);
  const [assigning, setAssigning] = useState(false);

  const load = () => {
    setLoading(true);
    setError('');
    apiFetch('/tasks/backlog')
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
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  useEffect(() => {
    if (!form.project) {
      setModules([]);
      return;
    }
    apiFetch(`/modules?projectId=${form.project.id}`).then(setModules).catch(() => setModules([]));
  }, [form.project]);

  useEffect(() => {
    if (!form.module) {
      setPhases([]);
      return;
    }
    apiFetch(`/phases?moduleId=${form.module.id}`).then(setPhases).catch(() => setPhases([]));
  }, [form.module]);

  if (!user) return null;

  // Admin can view the Backlog (VIEW_ROLES above) but, like Executive, has
  // view-only access to Tasks - creating, editing, and assigning are
  // Program Manager only, matching TasksController's role checks.
  const canManage = user.role === 'program_manager';

  const resetForm = () => {
    setForm(EMPTY_FORM);
    setModules([]);
    setPhases([]);
    setShowForm(false);
    setEditingId(null);
  };

  const startEdit = (task) => {
    setEditingId(task.id);
    setForm({
      project: { id: task.projectId, name: task.projectName },
      module: { id: task.moduleId, name: task.moduleName },
      phase: { id: task.phaseId, name: task.phaseName },
      description: task.description,
    });
    setShowForm(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (!form.project || !form.module || !form.phase || !form.description.trim()) {
      setError('Project, Module, Phase, and Description are all required.');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        projectId: form.project.id,
        moduleId: form.module.id,
        phaseId: form.phase.id,
        description: form.description,
      };
      if (editingId) {
        await apiFetch(`/tasks/${editingId}`, { method: 'PATCH', body: JSON.stringify(payload) });
        showToast('Task updated', 'success');
      } else {
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

  const toggleSelected = (id) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const handleBulkAssign = async () => {
    if (!bulkAssignee || selectedIds.length === 0) return;
    setAssigning(true);
    setError('');
    try {
      await apiFetch('/tasks/bulk-assign', {
        method: 'PATCH',
        body: JSON.stringify({ taskIds: selectedIds, assigneeUserId: bulkAssignee.id }),
      });
      showToast(`${selectedIds.length} task(s) assigned to ${bulkAssignee.name}`, 'success');
      setSelectedIds([]);
      setBulkAssignee(null);
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setAssigning(false);
    }
  };

  return (
    <AppShell>
      <div className={styles.pageHeader}>
        <div>
          <h1 className={styles.pageTitle}>Task Backlog</h1>
          <p className={styles.pageSubtitle}>
            Tasks with no Assignee yet. Create a task with just Project/Module/Phase/Description, then assign it -
            singly or in bulk - to move it into that person&apos;s My Tasks list.
          </p>
        </div>
        {canManage && (
          <button className={`${styles.button} ${styles.buttonAccent}`} type="button" onClick={() => (showForm ? resetForm() : setShowForm(true))}>
            {showForm ? 'Cancel' : 'New Task'}
          </button>
        )}
      </div>

      {error && <div className={styles.error}>{error}</div>}

      {canManage && showForm && (
        <form onSubmit={handleSubmit} className={styles.card} style={{ marginBottom: 'var(--space-4)' }}>
          <div className={styles.fieldGrid3}>
            <SearchSelectField
              label="Project"
              id="bkProject"
              required
              value={form.project}
              onChange={(v) => setForm({ ...form, project: v, module: null, phase: null })}
              options={projects}
            />
            <SearchSelectField
              label="Module"
              id="bkModule"
              required
              value={form.module}
              onChange={(v) => setForm({ ...form, module: v, phase: null })}
              options={modules}
              disabled={!form.project}
              placeholder="Select a Project first"
            />
            <SearchSelectField
              label="Phase"
              id="bkPhase"
              required
              value={form.phase}
              onChange={(v) => setForm({ ...form, phase: v })}
              options={phases}
              disabled={!form.module}
              placeholder="Select a Module first"
            />
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="bkDescription">Task Description</label>
            <textarea
              className={styles.textarea}
              id="bkDescription"
              required
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
          </div>

          <div className={styles.actions}>
            <button className={`${styles.button} ${styles.buttonAccent}`} type="submit" disabled={saving}>
              {saving ? 'Saving...' : editingId ? 'Save Changes' : 'Create Task'}
            </button>
          </div>
        </form>
      )}

      {canManage && !loading && selectedIds.length > 0 && (
        <div className={styles.card} style={{ marginBottom: 'var(--space-4)', display: 'flex', gap: 'var(--space-3)', alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div style={{ minWidth: 240 }}>
            <SearchSelectField
              label={`Assign ${selectedIds.length} selected task(s) to`}
              id="bkBulkAssignee"
              value={bulkAssignee}
              onChange={setBulkAssignee}
              options={assignableUsers}
            />
          </div>
          <button
            className={`${styles.button} ${styles.buttonAccent}`}
            type="button"
            disabled={!bulkAssignee || assigning}
            onClick={handleBulkAssign}
          >
            {assigning ? 'Assigning...' : 'Assign'}
          </button>
          <button className={styles.buttonSecondary} type="button" onClick={() => setSelectedIds([])}>
            Clear selection
          </button>
        </div>
      )}

      {loading && <div className={styles.empty}>Loading...</div>}

      {!loading && (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                {canManage && <th></th>}
                <th>Project</th>
                <th>Module</th>
                <th>Phase</th>
                <th>Description</th>
                {canManage && <th></th>}
              </tr>
            </thead>
            <tbody>
              {tasks.length === 0 && (
                <tr>
                  <td colSpan={canManage ? 6 : 4} className={styles.empty}>The Task Backlog is empty.</td>
                </tr>
              )}
              {tasks.map((task) => (
                <tr key={task.id}>
                  {canManage && (
                    <td>
                      <input
                        type="checkbox"
                        checked={selectedIds.includes(task.id)}
                        onChange={() => toggleSelected(task.id)}
                      />
                    </td>
                  )}
                  <td>{task.projectName}</td>
                  <td>{task.moduleName}</td>
                  <td>{task.phaseName}</td>
                  <td style={{ maxWidth: 320 }}>{task.description}</td>
                  {canManage && (
                    <td>
                      <button className={styles.buttonSecondary} type="button" onClick={() => startEdit(task)}>
                        Edit
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
