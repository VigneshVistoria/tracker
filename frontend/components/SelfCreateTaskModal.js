import { useEffect, useState } from 'react';
import Modal from './ui/Modal';
import CreateTaskForm, { EMPTY_TASK_FORM } from './CreateTaskForm';
import styles from '../styles/issues.module.css';
import { apiFetch } from '../lib/api';
import { useToast } from '../lib/toast';
import { stripHtmlForPreview } from '../lib/richText';

// Developer/Designer/DevOps top-bar "+" popup (AppShell) - the same Create
// Task form the Program Manager uses on Task Backlog, with the Assignee
// locked to the logged-in user. Backend mirror:
// TasksService.applySelfCreateRules().
export default function SelfCreateTaskModal({ open, onClose, user }) {
  const { showToast } = useToast();
  const [form, setForm] = useState(EMPTY_TASK_FORM);
  const [projects, setProjects] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Fresh form and project list each time it opens - GET /projects is
  // already scoped to the user's own projects for these roles.
  useEffect(() => {
    if (!open) return;
    setForm(EMPTY_TASK_FORM);
    setError('');
    apiFetch('/projects').then(setProjects).catch(() => setProjects([]));
  }, [open]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (!form.project || !form.module || !form.phase || !form.title.trim() || !stripHtmlForPreview(form.description).trim()) {
      setError('Project, Module, Phase, Title, and Description are all required.');
      return;
    }
    setSaving(true);
    try {
      await apiFetch('/tasks', {
        method: 'POST',
        body: JSON.stringify({
          projectId: form.project.id,
          moduleId: form.module.id,
          phaseId: form.phase.id,
          title: form.title.trim(),
          description: form.description,
          priority: form.priority || null,
          peerReviewEnabled: form.peerReviewEnabled,
          assigneeUserId: user.id,
        }),
      });
      showToast('Task created and added to your My Tasks', 'success');
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="New Task" size="lg">
      {error && <div className={styles.error}>{error}</div>}
      <CreateTaskForm
        form={form}
        setForm={setForm}
        projects={projects}
        lockedAssignee={{ id: user.id, name: user.fullName || user.email, role: user.role }}
        saving={saving}
        onSubmit={handleSubmit}
        idPrefix="selfTask"
      />
    </Modal>
  );
}
