import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import AppShell from '../../../components/AppShell';
import styles from '../../../styles/issues.module.css';
import { apiFetch } from '../../../lib/api';
import { useToast } from '../../../lib/toast';
import { CATEGORY_OPTIONS } from '../../../lib/status';
import { REVIEW_STATUS } from '../../../lib/testCaseReview';

const PRIORITY_OPTIONS = ['Critical', 'High', 'Medium', 'Low'];

// Doubles as the edit form when opened with ?id=<testCaseId> (linked from
// the detail page's Edit button).
export default function NewTestCase() {
  const router = useRouter();
  const { showToast } = useToast();
  const editId = router.query.id ? Number(router.query.id) : null;
  // The test case as loaded - PATCH can't clear Project/Module/Phase/
  // Priority/Category back to empty, so once one of those is set the
  // form's empty option is disabled rather than silently ignored.
  const [original, setOriginal] = useState(null);
  const [projects, setProjects] = useState([]);
  const [modules, setModules] = useState([]);
  const [phases, setPhases] = useState([]);
  const [form, setForm] = useState({
    title: '',
    description: '',
    preconditions: '',
    steps: '',
    expectedResult: '',
    priority: '',
    category: '',
    projectId: '',
    moduleId: '',
    phaseId: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    apiFetch('/projects').then(setProjects).catch(() => {});
  }, []);

  useEffect(() => {
    if (!editId) return;
    apiFetch(`/test-cases/${editId}`)
      .then((tc) => {
        setOriginal(tc);
        setForm({
          title: tc.title || '',
          description: tc.description || '',
          preconditions: tc.preconditions || '',
          steps: tc.steps || '',
          expectedResult: tc.expectedResult || '',
          priority: tc.priority || '',
          category: tc.category || '',
          projectId: tc.projectId ? String(tc.projectId) : '',
          moduleId: tc.moduleId ? String(tc.moduleId) : '',
          phaseId: tc.phaseId ? String(tc.phaseId) : '',
        });
      })
      .catch((err) => setError(err.message));
  }, [editId]);

  // Cascading Module/Phase, same pattern as Task Backlog/Create Defect
  // (pages/tasks/new-defect.js) - Project/Module/Phase stay optional here
  // (unlike those forms), so picking a Project only narrows the Module
  // dropdown, it doesn't require going any further.
  useEffect(() => {
    if (!form.projectId) {
      setModules([]);
      return;
    }
    apiFetch(`/modules?projectId=${form.projectId}`).then(setModules).catch(() => setModules([]));
  }, [form.projectId]);

  useEffect(() => {
    if (!form.moduleId) {
      setPhases([]);
      return;
    }
    apiFetch(`/phases?moduleId=${form.moduleId}`).then(setPhases).catch(() => setPhases([]));
  }, [form.moduleId]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    // Changing Project clears whatever Module/Phase was picked under the
    // old Project (a Module belongs to exactly one Project); changing
    // Module likewise clears Phase.
    if (name === 'projectId') {
      setForm({ ...form, projectId: value, moduleId: '', phaseId: '' });
      return;
    }
    if (name === 'moduleId') {
      setForm({ ...form, moduleId: value, phaseId: '' });
      return;
    }
    setForm({ ...form, [name]: value });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      if (editId) {
        const updated = await apiFetch(`/test-cases/${editId}`, {
          method: 'PATCH',
          body: JSON.stringify({
            title: form.title,
            description: form.description,
            preconditions: form.preconditions,
            steps: form.steps,
            expectedResult: form.expectedResult,
            priority: form.priority || undefined,
            category: form.category || undefined,
            projectId: form.projectId ? Number(form.projectId) : undefined,
            moduleId: form.moduleId ? Number(form.moduleId) : undefined,
            phaseId: form.phaseId ? Number(form.phaseId) : undefined,
          }),
        });
        const sentBackToDraft =
          original?.reviewStatus === REVIEW_STATUS.READY && updated.reviewStatus === REVIEW_STATUS.DRAFT;
        showToast(sentBackToDraft ? 'Test case updated - back to Draft, submit it for PM review again' : 'Test case updated', 'success');
        router.push(`/qa/test-cases/${editId}`);
        return;
      }
      const testCase = await apiFetch('/test-cases', {
        method: 'POST',
        body: JSON.stringify({
          title: form.title,
          description: form.description || undefined,
          preconditions: form.preconditions || undefined,
          steps: form.steps,
          expectedResult: form.expectedResult,
          priority: form.priority || undefined,
          category: form.category || undefined,
          projectId: form.projectId ? Number(form.projectId) : undefined,
          moduleId: form.moduleId ? Number(form.moduleId) : undefined,
          phaseId: form.phaseId ? Number(form.phaseId) : undefined,
        }),
      });
      showToast(`Test case #${testCase.id} created`, 'success');
      router.push(`/qa/test-cases/${testCase.id}`);
    } catch (err) {
      setError(err.message);
      setSubmitting(false);
    }
  };

  return (
    <AppShell>
      <div className={styles.pageHeader}>
        <div>
          <h1 className={styles.pageTitle}>{editId ? `Edit ${original?.caseNumber || `#${editId}`}` : 'New Test Case'}</h1>
          <p className={styles.pageSubtitle}>
            {editId
              ? original?.reviewStatus === REVIEW_STATUS.READY
                ? 'This test case is approved. Changing its preconditions, steps or expected result sends it back to Draft for PM re-approval.'
                : null
              : 'New test cases start as Draft - submit them for PM review before they can be executed.'}
          </p>
        </div>
      </div>

      <div className={styles.card}>
        {error && <div className={styles.error}>{error}</div>}

        <form onSubmit={handleSubmit}>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="title">Title</label>
            <input
              className={styles.input}
              id="title"
              name="title"
              required
              value={form.title}
              onChange={handleChange}
              placeholder="What is this test case verifying?"
            />
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="description">Description</label>
            <textarea
              className={styles.textarea}
              id="description"
              name="description"
              value={form.description}
              onChange={handleChange}
            />
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="preconditions">Preconditions</label>
            <textarea
              className={styles.textarea}
              id="preconditions"
              name="preconditions"
              value={form.preconditions}
              onChange={handleChange}
              placeholder="What needs to be true before running this test?"
            />
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="steps">Steps</label>
            <textarea
              className={styles.textarea}
              id="steps"
              name="steps"
              required
              value={form.steps}
              onChange={handleChange}
              placeholder={'1. ...\n2. ...\n3. ...'}
            />
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="expectedResult">Expected Result</label>
            <textarea
              className={styles.textarea}
              id="expectedResult"
              name="expectedResult"
              required
              value={form.expectedResult}
              onChange={handleChange}
            />
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="projectId">Project</label>
            <select className={styles.select} id="projectId" name="projectId" value={form.projectId} onChange={handleChange}>
              <option value="" disabled={!!original?.projectId}>No project</option>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="moduleId">Module</label>
            <select
              className={styles.select}
              id="moduleId"
              name="moduleId"
              value={form.moduleId}
              onChange={handleChange}
              disabled={!form.projectId}
            >
              <option value="" disabled={!!original?.moduleId}>{form.projectId ? 'No module' : 'Pick a Project first'}</option>
              {modules.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="phaseId">Phase</label>
            <select
              className={styles.select}
              id="phaseId"
              name="phaseId"
              value={form.phaseId}
              onChange={handleChange}
              disabled={!form.moduleId}
            >
              <option value="" disabled={!!original?.phaseId}>{form.moduleId ? 'No phase' : 'Pick a Module first'}</option>
              {phases.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="priority">Priority</label>
            <select className={styles.select} id="priority" name="priority" value={form.priority} onChange={handleChange}>
              <option value="" disabled={!!original?.priority}>No priority</option>
              {PRIORITY_OPTIONS.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="category">Category</label>
            <select className={styles.select} id="category" name="category" value={form.category} onChange={handleChange}>
              <option value="" disabled={!!original?.category}>No category</option>
              {CATEGORY_OPTIONS.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>

          <div className={styles.actions}>
            <button className={`${styles.button} ${styles.buttonAccent}`} type="submit" disabled={submitting || (editId && !original)}>
              {editId ? (submitting ? 'Saving...' : 'Save Changes') : submitting ? 'Creating...' : 'Create Test Case'}
            </button>
            <Link href={editId ? `/qa/test-cases/${editId}` : '/qa/test-cases'} className={styles.buttonSecondary}>Cancel</Link>
          </div>
        </form>
      </div>
    </AppShell>
  );
}
