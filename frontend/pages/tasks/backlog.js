import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import AppShell from '../../components/AppShell';
import SearchSelectField from '../../components/SearchSelectField';
import RichTextEditor from '../../components/ui/RichTextEditor';
import Badge from '../../components/ui/Badge';
import styles from '../../styles/issues.module.css';
import { apiFetch } from '../../lib/api';
import { useToast } from '../../lib/toast';
import { stripHtmlForPreview } from '../../lib/richText';
import { TASK_TITLE_MAX_LENGTH } from '../../lib/taskTitle';
import { TASK_PRIORITIES, priorityTone, priorityLabel } from '../../lib/taskTableShared';
import { DEVELOPER_EQUIVALENT_ROLES } from '../../lib/status';

const VIEW_ROLES = ['admin', 'program_manager'];

// Roles that actually do task work and so can be picked in the Create
// Task form's optional Assignee field - deliberately narrower than the
// bulk-assign dropdown below (which reuses the same /users/assignable
// list unfiltered, matching its pre-existing behavior). QA and Client
// are both confirmed use cases: QA can be assigned work items (writing
// test cases, environment setup) separate from their reviewer role in QA
// Feedback, and Client can be assigned action items they need to
// complete themselves (e.g. "provide documents").
const CREATE_TASK_ASSIGNEE_ROLES = [...DEVELOPER_EQUIVALENT_ROLES, 'qa', 'client'];

function userToOption(u) {
  return { id: u.id, name: u.fullName || u.email, role: u.role };
}

const EMPTY_FORM = { project: null, module: null, phase: null, title: '', description: '', peerReviewEnabled: false, priority: '', assignee: null };

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
  // The Peer Review flag changes through its own dedicated endpoint
  // (PATCH /tasks/:id/peer-review-flag), not the general PATCH /tasks/:id
  // call this form otherwise uses - this tracks the value the task had
  // when editing started, so handleSubmit only calls that endpoint when
  // the checkbox actually changed.
  const [editingOriginalPeerReview, setEditingOriginalPeerReview] = useState(false);

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

  const createAssigneeOptions = assignableUsers.filter((u) => CREATE_TASK_ASSIGNEE_ROLES.includes(u.role));

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
      title: task.title,
      description: task.description,
      peerReviewEnabled: !!task.peerReviewEnabled,
      priority: task.priority || '',
      assignee: null,
    });
    setEditingOriginalPeerReview(!!task.peerReviewEnabled);
    setShowForm(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (!form.project || !form.module || !form.phase || !form.title.trim() || !stripHtmlForPreview(form.description).trim()) {
      setError('Project, Module, Phase, Title, and Description are all required.');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        projectId: form.project.id,
        moduleId: form.module.id,
        phaseId: form.phase.id,
        title: form.title.trim(),
        description: form.description,
        priority: form.priority || null,
      };
      if (editingId) {
        await apiFetch(`/tasks/${editingId}`, { method: 'PATCH', body: JSON.stringify(payload) });
        // Peer Review flag changes through its own dedicated endpoint, not
        // the general PATCH above - only called when it actually changed.
        if (form.peerReviewEnabled !== editingOriginalPeerReview) {
          await apiFetch(`/tasks/${editingId}/peer-review-flag`, {
            method: 'PATCH',
            body: JSON.stringify({ peerReviewEnabled: form.peerReviewEnabled }),
          });
        }
        showToast('Task updated', 'success');
      } else {
        await apiFetch('/tasks', {
          method: 'POST',
          body: JSON.stringify({
            ...payload,
            peerReviewEnabled: form.peerReviewEnabled,
            assigneeUserId: form.assignee ? form.assignee.id : undefined,
          }),
        });
        showToast(form.assignee ? `Task created and assigned to ${form.assignee.name}` : 'Task created', 'success');
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
        <div className={styles.actions}>
          <Link href="/tasks/backlog-bulk" className={styles.buttonSecondary}>
            Bulk Import/Export
          </Link>
          {canManage && (
            <button className={`${styles.button} ${styles.buttonAccent}`} type="button" onClick={() => (showForm ? resetForm() : setShowForm(true))}>
              {showForm ? 'Cancel' : 'New Task'}
            </button>
          )}
        </div>
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
            <label className={styles.label} htmlFor="bkTitle">Title</label>
            <input
              className={styles.input}
              id="bkTitle"
              required
              maxLength={TASK_TITLE_MAX_LENGTH}
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder="Short, human-readable name for this task"
            />
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="bkDescription">Task Description</label>
            <RichTextEditor
              id="bkDescription"
              value={form.description}
              onChange={(html) => setForm({ ...form, description: html })}
              placeholder="Describe the task..."
            />
          </div>

          {!editingId && (
            <>
              <SearchSelectField
                label="Assignee (optional)"
                id="bkAssignee"
                value={form.assignee}
                onChange={(v) => setForm({ ...form, assignee: v, peerReviewEnabled: v?.role === 'qa' ? true : form.peerReviewEnabled })}
                options={createAssigneeOptions}
              />
              <p className={styles.helpText}>
                Leave blank to create it unassigned in the Task Backlog, same as today. Pick someone to skip the
                separate assign step and put it straight into their My Tasks list.
              </p>
            </>
          )}

          <div className={styles.field}>
            <label className={styles.label} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
              <input
                type="checkbox"
                checked={form.peerReviewEnabled}
                disabled={form.assignee?.role === 'qa'}
                onChange={(e) => setForm({ ...form, peerReviewEnabled: e.target.checked })}
              />
              Peer Review
            </label>
            <p className={styles.helpText}>
              {form.assignee?.role === 'qa'
                ? 'Required for a QA assignee - a Developer/Designer/DevOps reviews their work instead of QA reviewing itself.'
                : 'Skips QA - the assignee will pick another developer to review this task instead.'}
            </p>
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="bkPriority">Priority</label>
            <select
              className={styles.input}
              id="bkPriority"
              value={form.priority}
              onChange={(e) => setForm({ ...form, priority: e.target.value })}
            >
              <option value="">Not Set</option>
              {TASK_PRIORITIES.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
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
                <th className={styles.colCompact}>Project</th>
                <th className={styles.colCompact}>Module</th>
                <th className={styles.colCompact}>Phase</th>
                <th>Title</th>
                <th className={styles.colCompact}>Priority</th>
                {canManage && <th></th>}
              </tr>
            </thead>
            <tbody>
              {tasks.length === 0 && (
                <tr>
                  <td colSpan={canManage ? 7 : 5} className={styles.empty}>The Task Backlog is empty.</td>
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
                  <td className={styles.colCompact} title={task.projectName}>{task.projectName}</td>
                  <td className={styles.colCompact} title={task.moduleName}>{task.moduleName}</td>
                  <td className={styles.colCompact} title={task.phaseName}>{task.phaseName}</td>
                  <td className={styles.tableDescCell} title={task.title}>{task.title}</td>
                  <td className={styles.colCompact}>
                    <Badge tone={priorityTone(task.priority)}>{priorityLabel(task.priority)}</Badge>
                  </td>
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
