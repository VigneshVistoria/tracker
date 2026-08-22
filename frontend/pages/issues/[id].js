import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import AppShell from '../../components/AppShell';
import styles from '../../styles/issues.module.css';
import { apiFetch } from '../../lib/api';
import { getSocket } from '../../lib/socket';
import { useToast } from '../../lib/toast';
import { badgeClassFor, STATUS_OPTIONS, SELF_SERVICE_TRANSITIONS, MODE_OPTIONS, CATEGORY_OPTIONS } from '../../lib/status';

function formatDateTime(value) {
  if (!value) return null;
  return new Date(value).toLocaleString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

export default function IssueDetail() {
  const router = useRouter();
  const { id } = router.query;
  const { showToast } = useToast();

  const [issue, setIssue] = useState(null);
  const [currentUser, setCurrentUser] = useState(null);
  const [users, setUsers] = useState([]);
  const [projects, setProjects] = useState([]);
  const [form, setForm] = useState({
    title: '',
    description: '',
    status: 'Backlog',
    assigneeUserId: '',
    projectId: '',
    mode: 'Manual',
    showstopper: false,
    storyPoints: '',
    category: '',
  });
  const [parentIssue, setParentIssue] = useState(null);
  const [showDependencyForm, setShowDependencyForm] = useState(false);
  const [dependencyForm, setDependencyForm] = useState({ title: '', description: '', assigneeUserId: '', storyPoints: '' });
  const [creatingDependency, setCreatingDependency] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [workflowBusy, setWorkflowBusy] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [showRejectBox, setShowRejectBox] = useState(false);

  const load = () => {
    if (!id) return;
    Promise.all([
      apiFetch(`/issues/${id}`),
      apiFetch('/users/assignable'),
      apiFetch('/projects'),
      apiFetch('/users/me'),
    ])
      .then(([data, allUsers, allProjects, me]) => {
        setIssue(data);
        setUsers(allUsers);
        setProjects(allProjects);
        setCurrentUser(me);
        setForm({
          title: data.title,
          description: data.description || '',
          status: data.status,
          assigneeUserId: data.assigneeUserId || '',
          projectId: data.projectId || '',
          mode: data.mode || 'Manual',
          showstopper: Boolean(data.showstopper),
          storyPoints: data.storyPoints ?? '',
          category: data.category || '',
        });
        if (data.parentIssueId) {
          apiFetch(`/issues/${data.parentIssueId}`)
            .then(setParentIssue)
            .catch(() => setParentIssue(null)); // may not have access to the parent - fine, just skip the link
        } else {
          setParentIssue(null);
        }
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // If someone else updates this same issue elsewhere, reflect it live.
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;
    const onUpdated = (updated) => {
      if (String(updated.id) === String(id)) {
        setIssue(updated);
        showToast('This issue was just updated', 'info');
      }
    };
    socket.on('issue:updated', onUpdated);
    return () => socket.off('issue:updated', onUpdated);
  }, [id, showToast]);

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    setForm({ ...form, [name]: type === 'checkbox' ? checked : value });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSaving(true);

    try {
      const updated = await apiFetch(`/issues/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          title: form.title,
          description: form.description,
          status: form.status,
          assigneeUserId: form.assigneeUserId ? Number(form.assigneeUserId) : null,
          projectId: form.projectId ? Number(form.projectId) : null,
          mode: form.mode,
          showstopper: form.showstopper,
          storyPoints: form.storyPoints !== '' ? Number(form.storyPoints) : null,
          category: form.category || null,
        }),
      });
      setIssue(updated);
      showToast('Changes saved', 'success');
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleSubmitForReview = async () => {
    setError('');
    setWorkflowBusy(true);
    try {
      const updated = await apiFetch(`/issues/${id}/submit-for-review`, { method: 'POST' });
      setIssue(updated);
      setForm({ ...form, status: updated.status });
      showToast('Submitted for review', 'success');
    } catch (err) {
      setError(err.message);
    } finally {
      setWorkflowBusy(false);
    }
  };

  const handleApprove = async () => {
    setError('');
    setWorkflowBusy(true);
    try {
      const updated = await apiFetch(`/issues/${id}/approve`, { method: 'POST' });
      setIssue(updated);
      setForm({ ...form, status: updated.status });
      showToast('Issue approved and marked Completed', 'success');
    } catch (err) {
      setError(err.message);
    } finally {
      setWorkflowBusy(false);
    }
  };

  const handleReject = async () => {
    setError('');
    setWorkflowBusy(true);
    try {
      const updated = await apiFetch(`/issues/${id}/reject`, {
        method: 'POST',
        body: JSON.stringify({ reason: rejectReason || undefined }),
      });
      setIssue(updated);
      setForm({ ...form, status: updated.status });
      setRejectReason('');
      setShowRejectBox(false);
      showToast('Sent back for more work', 'info');
    } catch (err) {
      setError(err.message);
    } finally {
      setWorkflowBusy(false);
    }
  };

  const handleCreateDependency = async (e) => {
    e.preventDefault();
    setError('');
    setCreatingDependency(true);
    try {
      const dep = await apiFetch(`/issues/${id}/dependencies`, {
        method: 'POST',
        body: JSON.stringify({
          title: dependencyForm.title,
          description: dependencyForm.description || undefined,
          assigneeUserId: Number(dependencyForm.assigneeUserId),
          storyPoints: dependencyForm.storyPoints !== '' ? Number(dependencyForm.storyPoints) : undefined,
        }),
      });
      showToast(`Dependency #${dep.id} created`, 'success');
      router.push(`/issues/${dep.id}`);
    } catch (err) {
      setError(err.message);
    } finally {
      setCreatingDependency(false);
    }
  };

  if (loading) {
    return <AppShell><div className={styles.empty}>Loading...</div></AppShell>;
  }

  if (!issue) {
    return (
      <AppShell>
        <div className={styles.error}>{error || 'Issue not found.'}</div>
        <Link href="/issues" className={styles.backLink}>&larr; Back to issues</Link>
      </AppShell>
    );
  }

  const isAdmin = currentUser?.role === 'admin';
  const isExecutive = currentUser?.role === 'executive';
  const isAssignee = currentUser && issue.assigneeUserId === currentUser.id;
  const isProgramManager = currentUser?.role === 'program_manager';
  const canSubmitForReview = issue.status === 'In Progress' && (isAdmin || isAssignee);
  const canReview = issue.status === 'In Review' && (isAdmin || isProgramManager);

  const statusOptionsForForm = isAdmin
    ? STATUS_OPTIONS
    : (SELF_SERVICE_TRANSITIONS[issue.status] || [issue.status]);

  return (
    <AppShell>
      <div className={styles.pageHeader}>
        <div>
          <h1 className={styles.pageTitle}>
            <span className={styles.issueId}>#{issue.id}</span>
            {issue.title}
          </h1>
          <p className={styles.pageSubtitle}>Opened by {issue.createdByEmail}</p>
        </div>
        <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
          {issue.category && (
            <span className={styles.badge} style={{ background: 'var(--color-slate-tint, #eef0f2)', color: 'var(--color-ink-soft)' }}>
              {issue.category}
            </span>
          )}
          {issue.showstopper && (
            <span className={styles.badge} style={{ background: 'var(--color-red-tint)', color: 'var(--color-red-dark)' }}>
              Showstopper
            </span>
          )}
          <span className={`${styles.badge} ${badgeClassFor(issue.status, styles)}`}>
            {issue.status}
          </span>
        </div>
      </div>

      {error && <div className={styles.error}>{error}</div>}

      {parentIssue && (
        <div className={styles.card} style={{ background: 'var(--color-paper)' }}>
          <p className={styles.issueMeta} style={{ margin: 0 }}>
            This is a dependency ticket, spun off from{' '}
            <Link href={`/issues/${parentIssue.id}`}>#{parentIssue.id} {parentIssue.title}</Link>
          </p>
        </div>
      )}

      <div className={styles.card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ marginTop: 0, fontSize: '1rem' }}>Dependencies ({(issue.dependencies || []).length})</h3>
          {currentUser?.role !== 'executive' && (
            <button className={styles.buttonSecondary} type="button" onClick={() => setShowDependencyForm((v) => !v)}>
              {showDependencyForm ? 'Cancel' : 'Create Dependency'}
            </button>
          )}
        </div>

        {(issue.dependencies || []).length === 0 && !showDependencyForm && (
          <p className={styles.helpText}>No dependency tickets spun off from this one yet.</p>
        )}

        {(issue.dependencies || []).map((dep) => (
          <Link key={dep.id} href={`/issues/${dep.id}`} className={styles.issueRow}>
            <div className={styles.issueMain}>
              <p className={styles.issueTitle}>#{dep.id} {dep.title}</p>
              <p className={styles.issueMeta}>{dep.assigneeEmail || 'Unassigned'}</p>
            </div>
            <span className={`${styles.badge} ${badgeClassFor(dep.status, styles)}`}>{dep.status}</span>
          </Link>
        ))}

        {showDependencyForm && (
          <form onSubmit={handleCreateDependency} style={{ marginTop: 'var(--space-4)' }}>
            <p className={styles.helpText} style={{ marginTop: 0 }}>
              Creates a new ticket linked back to this one, assigned to whoever owns the dependency.
            </p>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="depTitle">Title</label>
              <input
                className={styles.input}
                id="depTitle"
                required
                value={dependencyForm.title}
                onChange={(e) => setDependencyForm({ ...dependencyForm, title: e.target.value })}
                placeholder="What does this dependency need to cover?"
              />
            </div>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="depDescription">Description</label>
              <textarea
                className={styles.textarea}
                id="depDescription"
                value={dependencyForm.description}
                onChange={(e) => setDependencyForm({ ...dependencyForm, description: e.target.value })}
              />
            </div>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="depAssignee">Dependency owner</label>
              <select
                className={styles.select}
                id="depAssignee"
                required
                value={dependencyForm.assigneeUserId}
                onChange={(e) => setDependencyForm({ ...dependencyForm, assigneeUserId: e.target.value })}
              >
                <option value="">Select an owner</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>{u.fullName || u.email}</option>
                ))}
              </select>
            </div>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="depStoryPoints">Story Points</label>
              <input
                className={styles.input}
                id="depStoryPoints"
                type="number"
                min="0"
                value={dependencyForm.storyPoints}
                onChange={(e) => setDependencyForm({ ...dependencyForm, storyPoints: e.target.value })}
              />
            </div>
            <div className={styles.actions}>
              <button className={`${styles.button} ${styles.buttonAccent}`} type="submit" disabled={creatingDependency}>
                {creatingDependency ? 'Creating...' : 'Create Dependency'}
              </button>
            </div>
          </form>
        )}
      </div>

      {issue.lastRejectionReason && issue.status === 'In Progress' && (
        <div className={styles.card} style={{ borderLeft: '3px solid var(--color-red)', background: 'var(--color-red-tint)' }}>
          <p style={{ margin: 0, fontWeight: 600 }}>Sent back for more work</p>
          <p style={{ margin: 'var(--space-2) 0 0' }}>{issue.lastRejectionReason}</p>
        </div>
      )}

      {(canSubmitForReview || canReview) && (
        <div className={styles.card}>
          <h3 style={{ marginTop: 0, fontSize: '1rem' }}>Workflow</h3>
          {canSubmitForReview && (
            <div className={styles.actions}>
              <p className={styles.helpText} style={{ marginTop: 0, marginBottom: 'var(--space-3)', width: '100%' }}>
                Done with this? Submit it for the Program Manager's review.
              </p>
              <button
                className={`${styles.button} ${styles.buttonAccent}`}
                type="button"
                onClick={handleSubmitForReview}
                disabled={workflowBusy}
              >
                {workflowBusy ? 'Submitting...' : 'Submit for Review'}
              </button>
            </div>
          )}
          {canReview && (
            <div>
              <p className={styles.helpText} style={{ marginTop: 0 }}>
                Submitted {formatDateTime(issue.submittedForReviewAt)}. Approve to mark Completed, or send it back with a note.
              </p>
              <div className={styles.actions}>
                <button
                  className={`${styles.button} ${styles.buttonAccent}`}
                  type="button"
                  onClick={handleApprove}
                  disabled={workflowBusy}
                >
                  {workflowBusy ? 'Working...' : 'Approve'}
                </button>
                <button
                  className={styles.buttonSecondary}
                  type="button"
                  onClick={() => setShowRejectBox((v) => !v)}
                  disabled={workflowBusy}
                >
                  Send Back
                </button>
              </div>
              {showRejectBox && (
                <div className={styles.field} style={{ marginTop: 'var(--space-3)' }}>
                  <label className={styles.label} htmlFor="rejectReason">What needs fixing? (optional)</label>
                  <textarea
                    className={styles.textarea}
                    id="rejectReason"
                    value={rejectReason}
                    onChange={(e) => setRejectReason(e.target.value)}
                    placeholder="e.g. Please add a test case before resubmitting"
                  />
                  <div className={styles.actions} style={{ marginTop: 'var(--space-2)' }}>
                    <button className={`${styles.button} ${styles.buttonAccent}`} type="button" onClick={handleReject} disabled={workflowBusy}>
                      {workflowBusy ? 'Sending...' : 'Confirm Send Back'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <div className={styles.card}>
        <form onSubmit={handleSubmit}>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="title">Title</label>
            <input
              className={styles.input}
              id="title"
              name="title"
              value={form.title}
              onChange={handleChange}
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
            <label className={styles.label} htmlFor="status">Status</label>
            <select
              className={styles.select}
              id="status"
              name="status"
              value={form.status}
              onChange={handleChange}
            >
              {statusOptionsForForm.map((option) => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>
            {!isAdmin && (issue.status === 'In Review' || issue.status === 'Completed') && (
              <p className={styles.helpText}>
                This status can only change via the workflow actions above{issue.status === 'Completed' ? ' (or an admin).' : '.'}
              </p>
            )}
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
            <label className={styles.label} htmlFor="storyPoints">Story Points</label>
            <input
              className={styles.input}
              id="storyPoints"
              name="storyPoints"
              type="number"
              min="0"
              value={form.storyPoints}
              onChange={handleChange}
              placeholder="e.g. 3"
            />
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
              Showstopper (critical, blocking issue)
            </label>
          </div>

          {issue.closedOn && (
            <p className={styles.helpText}>
              Completed on {formatDateTime(issue.closedOn)}
              {issue.reviewedByEmail ? ` \u2013 approved by ${issue.reviewedByEmail}` : ''}
            </p>
          )}

          <div className={styles.actions}>
            {!isExecutive && (
              <button className={`${styles.button} ${styles.buttonAccent}`} type="submit" disabled={saving}>
                {saving ? 'Saving...' : 'Save changes'}
              </button>
            )}
            <Link href="/issues" className={styles.buttonSecondary}>
              Back to list
            </Link>
          </div>
        </form>
      </div>
    </AppShell>
  );
}
