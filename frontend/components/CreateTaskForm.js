import { useEffect, useState } from 'react';
import SearchSelectField from './SearchSelectField';
import RichTextEditor from './ui/RichTextEditor';
import styles from '../styles/issues.module.css';
import { apiFetch } from '../lib/api';
import { TASK_TITLE_MAX_LENGTH } from '../lib/taskTitle';
import { TASK_PRIORITIES } from '../lib/taskTableShared';

export const EMPTY_TASK_FORM = { project: null, module: null, phase: null, title: '', description: '', peerReviewEnabled: false, priority: '', assignee: null };

// The Create/Edit Task form - shared by the Program Manager's Task Backlog
// page and the Developer/Designer/DevOps top-bar "+" popup (AppShell), so
// both stay the exact same form. Owns only the Module/Phase option
// fetching (derived from the selected Project/Module); the caller owns
// the form state and submission.
//
// lockedAssignee: when set, the Assignee field is shown read-only as that
// person and the "leave blank" option/help text is dropped - used for a
// Developer/Designer/DevOps creating their own task (backend mirror:
// TasksService.applySelfCreateRules()).
export default function CreateTaskForm({
  form,
  setForm,
  projects,
  assigneeOptions = [],
  lockedAssignee = null,
  editing = false,
  saving = false,
  onSubmit,
  idPrefix = 'bk',
  className,
  style,
}) {
  const [modules, setModules] = useState([]);
  const [phases, setPhases] = useState([]);

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

  const assignee = lockedAssignee || form.assignee;

  return (
    <form onSubmit={onSubmit} className={className} style={style}>
      <div className={styles.fieldGrid3}>
        <SearchSelectField
          label="Project"
          id={`${idPrefix}Project`}
          required
          value={form.project}
          onChange={(v) => setForm({ ...form, project: v, module: null, phase: null })}
          options={projects}
        />
        <SearchSelectField
          label="Module"
          id={`${idPrefix}Module`}
          required
          value={form.module}
          onChange={(v) => setForm({ ...form, module: v, phase: null })}
          options={modules}
          disabled={!form.project}
          placeholder="Select a Project first"
        />
        <SearchSelectField
          label="Phase"
          id={`${idPrefix}Phase`}
          required
          value={form.phase}
          onChange={(v) => setForm({ ...form, phase: v })}
          options={phases}
          disabled={!form.module}
          placeholder="Select a Module first"
        />
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor={`${idPrefix}Title`}>Title</label>
        <input
          className={styles.input}
          id={`${idPrefix}Title`}
          required
          maxLength={TASK_TITLE_MAX_LENGTH}
          value={form.title}
          onChange={(e) => setForm({ ...form, title: e.target.value })}
          placeholder="Short, human-readable name for this task"
        />
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor={`${idPrefix}Description`}>Task Description</label>
        <RichTextEditor
          id={`${idPrefix}Description`}
          value={form.description}
          onChange={(html) => setForm({ ...form, description: html })}
          placeholder="Describe the task..."
        />
      </div>

      {!editing && lockedAssignee && (
        <div className={styles.field}>
          <label className={styles.label} htmlFor={`${idPrefix}Assignee`}>Assignee</label>
          <input
            className={styles.input}
            id={`${idPrefix}Assignee`}
            value={`${lockedAssignee.name} (you)`}
            readOnly
            disabled
            aria-describedby={`${idPrefix}AssigneeHelp`}
          />
          <p className={styles.helpText} id={`${idPrefix}AssigneeHelp`}>
            Tasks you create are always assigned to you.
          </p>
        </div>
      )}

      {!editing && !lockedAssignee && (
        <>
          <SearchSelectField
            label="Assignee (optional)"
            id={`${idPrefix}Assignee`}
            value={form.assignee}
            onChange={(v) => setForm({ ...form, assignee: v, peerReviewEnabled: v?.role === 'qa' ? true : form.peerReviewEnabled })}
            options={assigneeOptions}
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
            disabled={assignee?.role === 'qa'}
            onChange={(e) => setForm({ ...form, peerReviewEnabled: e.target.checked })}
          />
          Peer Review
        </label>
        <p className={styles.helpText}>
          {assignee?.role === 'qa'
            ? 'Required for a QA assignee - a Developer/Designer/DevOps reviews their work instead of QA reviewing itself.'
            : 'Skips QA - the assignee will pick another developer to review this task instead.'}
        </p>
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor={`${idPrefix}Priority`}>Priority</label>
        <select
          className={styles.input}
          id={`${idPrefix}Priority`}
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
          {saving ? 'Saving...' : editing ? 'Save Changes' : 'Create Task'}
        </button>
      </div>
    </form>
  );
}
