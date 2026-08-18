import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import AppShell from '../../components/AppShell';
import styles from '../../styles/issues.module.css';
import { apiFetch } from '../../lib/api';
import { useToast } from '../../lib/toast';
import { MODE_OPTIONS, CATEGORY_OPTIONS } from '../../lib/status';

const STATUS_LABEL = {
  invalid: 'Needs a lot more detail',
  incomplete: 'Incomplete',
  needs_more_info: 'Needs a bit more info',
  valid: 'Looks good',
};

const STATUS_BADGE_CLASS = {
  invalid: 'badgeClosed',
  incomplete: 'badgeInProgress',
  needs_more_info: 'badgeClientReview',
  valid: 'badgeOpen',
};

export default function NewIssue() {
  const router = useRouter();
  const { showToast } = useToast();
  const [form, setForm] = useState({ title: '', description: '', assigneeUserId: '', projectId: '', mode: 'Manual', showstopper: false, storyPoints: '', category: '' });
  const [users, setUsers] = useState([]);
  const [projects, setProjects] = useState([]);
  const [error, setError] = useState('');

  const [analyzing, setAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    apiFetch('/users/assignable').then(setUsers).catch(() => {});
    apiFetch('/projects').then(setProjects).catch(() => {});
  }, []);

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    setForm({ ...form, [name]: type === 'checkbox' ? checked : value });
    setAnalysis(null);
  };

  const handleAnalyze = async (e) => {
    e.preventDefault();
    setError('');
    setAnalyzing(true);

    try {
      const result = await apiFetch('/issues/analyze', {
        method: 'POST',
        body: JSON.stringify({ title: form.title, description: form.description }),
      });
      setAnalysis(result);
    } catch (err) {
      setError(err.message);
    } finally {
      setAnalyzing(false);
    }
  };

  const createIssue = async () => {
    setError('');
    setSubmitting(true);

    try {
      const issue = await apiFetch('/issues', {
        method: 'POST',
        body: JSON.stringify({
          title: form.title,
          description: form.description,
          assigneeUserId: form.assigneeUserId ? Number(form.assigneeUserId) : undefined,
          projectId: form.projectId ? Number(form.projectId) : undefined,
          mode: form.mode,
          showstopper: form.showstopper,
          storyPoints: form.storyPoints !== '' ? Number(form.storyPoints) : undefined,
          category: form.category || undefined,
        }),
      });
      showToast(`Issue #${issue.id} created`, 'success');
      router.push(`/issues/${issue.id}`);
    } catch (err) {
      setError(err.message);
      setSubmitting(false);
    }
  };

  const handleRefine = () => {
    setAnalysis(null);
    document.getElementById('description')?.focus();
  };

  return (
    <AppShell>
      <div className={styles.pageHeader}>
        <div>
          <h1 className={styles.pageTitle}>New Issue</h1>
          <p className={styles.pageSubtitle}>We'll review your description before you submit.</p>
        </div>
      </div>

      <div className={styles.card}>
        {error && <div className={styles.error}>{error}</div>}

        <form onSubmit={handleAnalyze}>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="title">Title</label>
            <input
              className={styles.input}
              id="title"
              name="title"
              required
              value={form.title}
              onChange={handleChange}
              placeholder="Short summary of the issue"
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
              placeholder="Describe the issue in detail - what happened, steps to reproduce, what you expected instead..."
            />
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="projectId">Project</label>
            <select
              className={styles.select}
              id="projectId"
              name="projectId"
              value={form.projectId}
              onChange={handleChange}
            >
              <option value="">No project</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="assigneeUserId">Assignee</label>
            <select
              className={styles.select}
              id="assigneeUserId"
              name="assigneeUserId"
              value={form.assigneeUserId}
              onChange={handleChange}
            >
              <option value="">Unassigned</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>{u.fullName || u.email}</option>
              ))}
            </select>
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="mode">Mode</label>
            <select
              className={styles.select}
              id="mode"
              name="mode"
              value={form.mode}
              onChange={handleChange}
            >
              {MODE_OPTIONS.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
            <p className={styles.helpText}>Manual = filed by a person. Auto = raised by a system/integration.</p>
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="category">Category</label>
            <select
              className={styles.select}
              id="category"
              name="category"
              value={form.category}
              onChange={handleChange}
            >
              <option value="">No category</option>
              {CATEGORY_OPTIONS.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>

          <div className={styles.field}>
            <label className={styles.checkboxRow}>
              <input
                type="checkbox"
                name="showstopper"
                checked={form.showstopper}
                onChange={handleChange}
              />
              Mark as showstopper (critical, blocking issue)
            </label>
          </div>

          {!analysis && (
            <div className={styles.actions}>
              <button className={`${styles.button} ${styles.buttonAccent}`} type="submit" disabled={analyzing}>
                {analyzing ? 'Analyzing...' : 'Review Issue'}
              </button>
              <Link href="/issues" className={styles.buttonSecondary}>
                Cancel
              </Link>
            </div>
          )}
        </form>

        {analysis && (
          <div className={styles.suggestionsPanel}>
            <div className={styles.suggestionsHeader}>
              <h3 style={{ margin: 0, fontSize: '1rem' }}>Suggestions</h3>
              <span className={`${styles.badge} ${styles[STATUS_BADGE_CLASS[analysis.status]]}`}>
                {STATUS_LABEL[analysis.status]}
              </span>
            </div>

            <p style={{ color: 'var(--color-ink-soft)', marginTop: 0 }}>{analysis.summary}</p>

            {analysis.gaps.length > 0 && (
              <>
                <p style={{ fontWeight: 600, marginBottom: 'var(--space-2)', fontSize: '0.88rem' }}>What's missing</p>
                <ul className={styles.suggestionList}>
                  {analysis.gaps.map((gap, i) => <li key={i}>{gap}</li>)}
                </ul>
              </>
            )}

            {analysis.suggestions.length > 0 && (
              <>
                <p style={{ fontWeight: 600, marginBottom: 'var(--space-2)', fontSize: '0.88rem' }}>How to improve it</p>
                <ul className={styles.suggestionList}>
                  {analysis.suggestions.map((s, i) => <li key={i}>{s}</li>)}
                </ul>
              </>
            )}

            {analysis.gaps.length === 0 && (
              <p className={styles.successBanner}>No gaps found - this looks ready to go.</p>
            )}

            <div className={styles.actions}>
              <button className={`${styles.button} ${styles.buttonAccent}`} onClick={createIssue} disabled={submitting}>
                {submitting ? 'Submitting...' : 'Proceed with Submission'}
              </button>
              <button
                className={styles.buttonSecondary}
                onClick={handleRefine}
                disabled={submitting}
                type="button"
              >
                Refine the Issue
              </button>
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}
