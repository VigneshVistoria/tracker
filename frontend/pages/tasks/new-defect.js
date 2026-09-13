import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import AppShell from '../../components/AppShell';
import SearchSelectField from '../../components/SearchSelectField';
import RichTextEditor from '../../components/ui/RichTextEditor';
import styles from '../../styles/issues.module.css';
import { apiFetch } from '../../lib/api';
import { useToast } from '../../lib/toast';
import { stripHtmlForPreview } from '../../lib/richText';
import { TASK_TITLE_MAX_LENGTH } from '../../lib/taskTitle';

const VIEW_ROLES = ['qa'];

function userToOption(u) {
  return { id: u.id, name: u.fullName || u.email };
}

const EMPTY_FORM = { project: null, module: null, phase: null, title: '', description: '', assignee: null };

// Same list as QA_ARTIFACT_TYPES on the task detail page (pages/tasks/[id].js)
// - this is the same "QA's own evidence" concept, just captured at
// ticket-creation time instead of at Approve/Reject.
const ARTIFACT_TYPES = [
  'Test Case / Test Plan',
  'Test Execution Report',
  'Bug Report',
  'Screenshot',
  'Screen Recording / Video',
  'Log File',
  'Staging / Test Environment URL',
  'Regression Test Results',
  'Automated Test Run',
  'Sign-off / Acceptance Report',
];

// Create Defect - QA only, always category "Defect", assigned straight to
// a Developer, no Task Backlog step and never linked to another ticket.
// Project/Module/Phase stay required, same as every other task (needed
// for scoping/KPI/dashboards) - this form reuses the exact same
// cascading Project->Module->Phase pickers as Task Backlog's own create
// form (pages/tasks/backlog.js).
export default function NewDefectPage() {
  const router = useRouter();
  const { showToast } = useToast();

  const [user, setUser] = useState(null);
  const [projects, setProjects] = useState([]);
  const [developers, setDevelopers] = useState([]);
  const [modules, setModules] = useState([]);
  const [phases, setPhases] = useState([]);
  const [form, setForm] = useState(EMPTY_FORM);
  // Optional evidence (screenshot, bug report, etc.) attached at filing
  // time - empty by default, unlike the developer's later mandatory
  // submission artifacts.
  const [artifacts, setArtifacts] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

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
    apiFetch('/users/assignable?role=developer').then((rows) => setDevelopers(rows.map(userToOption))).catch(() => {});
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

  const addArtifactRow = () => {
    setArtifacts((prev) => [...prev, { type: '', url: '' }]);
  };

  const removeArtifactRow = (index) => {
    setArtifacts((prev) => prev.filter((_, i) => i !== index));
  };

  const updateArtifactRow = (index, field, value) => {
    setArtifacts((prev) => prev.map((row, i) => (i === index ? { ...row, [field]: value } : row)));
  };

  // Optional - only rows with both a Type and a URL are sent. A row with
  // just one of the two filled in is treated as a mistake rather than
  // silently dropped, same as the developer's own artifact rows on the
  // task detail page.
  const buildArtifactsPayload = () => {
    const incomplete = artifacts.some((row) => (row.type && !row.url.trim()) || (!row.type && row.url.trim()));
    if (incomplete) {
      throw new Error('Each artifact needs both a Type and a URL - remove any unused rows.');
    }
    return artifacts.filter((row) => row.type && row.url.trim()).map((row) => ({ type: row.type, url: row.url.trim() }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (!form.project || !form.module || !form.phase || !form.title.trim() || !stripHtmlForPreview(form.description).trim() || !form.assignee) {
      setError('Project, Module, Phase, Description, and Assignee are all required.');
      return;
    }
    let payloadArtifacts;
    try {
      payloadArtifacts = buildArtifactsPayload();
    } catch (err) {
      setError(err.message);
      return;
    }
    setSaving(true);
    try {
      const created = await apiFetch('/tasks/defects', {
        method: 'POST',
        body: JSON.stringify({
          projectId: form.project.id,
          moduleId: form.module.id,
          phaseId: form.phase.id,
          title: form.title.trim(),
          description: form.description,
          assigneeUserId: form.assignee.id,
          artifacts: payloadArtifacts,
        }),
      });
      showToast('Defect created', 'success');
      router.push(`/tasks/${created.id}`);
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  };

  return (
    <AppShell>
      <div className={styles.pageHeader}>
        <div>
          <h1 className={styles.pageTitle}>Create Defect</h1>
          <p className={styles.pageSubtitle}>
            A standalone defect ticket, assigned straight to a Developer - no Task Backlog step, no link to any
            other ticket. Feedback on this defect will route back to you specifically once it&apos;s submitted.
          </p>
        </div>
      </div>

      {error && <div className={styles.error}>{error}</div>}

      <form onSubmit={handleSubmit} className={styles.card}>
        <div className={styles.fieldGrid3}>
          <SearchSelectField
            label="Project"
            id="ndProject"
            required
            value={form.project}
            onChange={(v) => setForm({ ...form, project: v, module: null, phase: null })}
            options={projects}
          />
          <SearchSelectField
            label="Module"
            id="ndModule"
            required
            value={form.module}
            onChange={(v) => setForm({ ...form, module: v, phase: null })}
            options={modules}
            disabled={!form.project}
            placeholder="Select a Project first"
          />
          <SearchSelectField
            label="Phase"
            id="ndPhase"
            required
            value={form.phase}
            onChange={(v) => setForm({ ...form, phase: v })}
            options={phases}
            disabled={!form.module}
            placeholder="Select a Module first"
          />
        </div>

        <div className={styles.field}>
          <label className={styles.label} htmlFor="ndTitle">Title</label>
          <input
            className={styles.input}
            id="ndTitle"
            required
            maxLength={TASK_TITLE_MAX_LENGTH}
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            placeholder="Short, human-readable name for this defect"
          />
        </div>

        <div className={styles.field}>
          <label className={styles.label} htmlFor="ndDescription">Defect Description</label>
          <RichTextEditor
            id="ndDescription"
            value={form.description}
            onChange={(html) => setForm({ ...form, description: html })}
            placeholder="Describe the defect..."
          />
        </div>

        <div className={styles.fieldNarrow}>
          <SearchSelectField
            label="Assignee (Developer)"
            id="ndAssignee"
            required
            value={form.assignee}
            onChange={(v) => setForm({ ...form, assignee: v })}
            options={developers}
          />
        </div>

        <label className={styles.label}>Artifacts (optional)</label>
        <p className={styles.helpText} style={{ marginTop: 0 }}>
          Attach evidence of the defect - a screenshot, bug report, screen recording, etc.
        </p>
        {artifacts.map((row, index) => (
          <div key={index} className={styles.fieldGrid3} style={{ alignItems: 'end', marginBottom: 'var(--space-2)' }}>
            <div className={styles.field}>
              <label className={styles.label} htmlFor={`ndArtifactType-${index}`}>Artifact Type</label>
              <select
                className={styles.select}
                id={`ndArtifactType-${index}`}
                value={row.type}
                onChange={(e) => updateArtifactRow(index, 'type', e.target.value)}
              >
                <option value="" disabled>— Select artifact type —</option>
                {ARTIFACT_TYPES.filter(
                  (t) => t === row.type || !artifacts.some((r) => r.type === t),
                ).map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div className={styles.field}>
              <label className={styles.label} htmlFor={`ndArtifactUrl-${index}`}>Artifact URL</label>
              <input
                className={styles.input}
                id={`ndArtifactUrl-${index}`}
                type="url"
                placeholder="https://..."
                value={row.url}
                onChange={(e) => updateArtifactRow(index, 'url', e.target.value)}
              />
            </div>
            <div className={styles.field}>
              <button className={styles.buttonSecondary} type="button" onClick={() => removeArtifactRow(index)}>
                Remove
              </button>
            </div>
          </div>
        ))}
        <div className={styles.actions} style={{ marginBottom: 'var(--space-3)' }}>
          <button className={styles.buttonSecondary} type="button" onClick={addArtifactRow}>
            + Add Artifact
          </button>
        </div>

        <div className={styles.actions}>
          <button className={`${styles.button} ${styles.buttonAccent}`} type="submit" disabled={saving}>
            {saving ? 'Creating...' : 'Create Defect'}
          </button>
        </div>
      </form>
    </AppShell>
  );
}
