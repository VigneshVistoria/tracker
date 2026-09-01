import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import AppShell from '../../components/AppShell';
import styles from '../../styles/issues.module.css';
import { apiFetch } from '../../lib/api';
import { useToast } from '../../lib/toast';
import { MODE_OPTIONS, canCreateTickets } from '../../lib/status';

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
  const [categories, setCategories] = useState([]);
  const [error, setError] = useState('');
  const [user, setUser] = useState(null);

  const [analyzing, setAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const [keyword, setKeyword] = useState('');
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState('');

  useEffect(() => {
    const storedUser = localStorage.getItem('user');
    const role = storedUser ? JSON.parse(storedUser).role : null;
    if (storedUser) setUser(JSON.parse(storedUser));
    // Clients get a stripped-down form (title/description only) - skip
    // fetching internal staff/project lists for them entirely, both
    // because they're unused and because the assignable-users list
    // exposes internal staff emails a client shouldn't see.
    if (role !== 'client') {
      apiFetch('/users/assignable').then(setUsers).catch(() => {});
      apiFetch('/projects').then(setProjects).catch(() => {});
      apiFetch('/issue-categories').then((list) => setCategories(list.filter((c) => c.isActive))).catch(() => {});
    }
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

  const handleGenerate = async (e) => {
    e.preventDefault();
    setGenerateError('');
    setGenerating(true);
    try {
      const result = await apiFetch('/issues/ai/generate-user-story', {
        method: 'POST',
        body: JSON.stringify({ keyword }),
      });
      const criteria = result.acceptanceCriteria.map((c) => `- [ ] ${c}`).join('\n');
      const included = result.scopeIncluded.map((s) => `- ${s}`).join('\n');
      const excluded = result.scopeExcluded.map((s) => `- ${s}`).join('\n');
      setForm({
        ...form,
        title: result.suggestedTitle,
        description:
          `### User Story\n${result.userStory}\n\n` +
          `### Acceptance Criteria\n${criteria}\n\n` +
          `### Scope\nIncluded:\n${included}\n\nExcluded:\n${excluded}`,
      });
      setAnalysis(null);
    } catch (err) {
      // Never blocks ticket creation - the title/description fields
      // stay plain, editable inputs regardless, so manual entry always
      // still works.
      setGenerateError(err.message || 'Could not generate - fill in the fields manually instead.');
    } finally {
      setGenerating(false);
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

  // Defense-in-depth for direct navigation (the "New Issue" entry points
  // are already hidden/disabled for this role on the Dashboard and Issues
  // list) - don't let a Developer fill out the whole form just to get a
  // 403 on submit.
  if (user && !canCreateTickets(user.role)) {
    return (
      <AppShell>
        <div className={styles.pageHeader}>
          <div>
            <h1 className={styles.pageTitle}>New Issue</h1>
          </div>
        </div>
        <div className={styles.card}>
          <div className={styles.error} style={{ marginBottom: 0 }}>
            You don't have permission to create tickets. Only Admins, Program Managers, QA, and
            Executives can. Ask one of them to file this on your behalf.
          </div>
        </div>
        <div className={styles.actions}>
          <Link href="/issues" className={styles.buttonSecondary}>&larr; Back to issues</Link>
        </div>
      </AppShell>
    );
  }

  const isClient = user?.role === 'client';
  const isProgramManager = user?.role === 'program_manager';

  return (
    <AppShell>
      <div className={styles.pageHeader}>
        <div>
          <h1 className={styles.pageTitle}>{isClient ? 'New Support Request' : 'New Issue'}</h1>
          <p className={styles.pageSubtitle}>
            {isClient
              ? "Tell us what you're seeing - we'll review it before you submit."
              : "We'll review your description before you submit."}
          </p>
        </div>
      </div>

      <div className={styles.card}>
        {error && <div className={styles.error}>{error}</div>}

        {isProgramManager && (
          <div className={styles.field} style={{ background: 'var(--color-slate-tint, #eef0f2)', padding: 'var(--space-4)', borderRadius: 'var(--radius-md)' }}>
            <label className={styles.label} htmlFor="keyword">AI Assist &mdash; generate from a keyword</label>
            <p className={styles.helpText} style={{ marginTop: 0 }}>
              Type a short phrase (e.g. "create login page") and generate a draft User Story, Acceptance Criteria, and
              Scope. Review and edit before submitting - nothing here is final.
            </p>
            <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
              <input
                className={styles.input}
                id="keyword"
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                placeholder="e.g. create login page"
              />
              <button
                className={styles.buttonSecondary}
                type="button"
                onClick={handleGenerate}
                disabled={generating || keyword.trim().length < 3}
              >
                {generating ? 'Generating...' : 'Auto-Generate'}
              </button>
            </div>
            {generateError && <p className={styles.error} style={{ marginTop: 'var(--space-2)' }}>{generateError}</p>}
          </div>
        )}

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

          {!isClient && (
            <>
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
                  {categories.map((c) => <option key={c.id} value={c.name}>{c.name}</option>)}
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
            </>
          )}

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
