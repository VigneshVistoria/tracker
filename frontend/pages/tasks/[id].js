import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import AppShell from '../../components/AppShell';
import SearchSelectField from '../../components/SearchSelectField';
import styles from '../../styles/issues.module.css';
import { apiFetch } from '../../lib/api';
import { useToast } from '../../lib/toast';

const VIEW_ROLES = ['admin', 'executive', 'program_manager', 'qa', 'developer'];
// Admin and Executive both get full view access (VIEW_ROLES above) but
// neither can edit - matches the backend's canEdit()/MUTATE_ROLES, which
// is Program Manager only (plus the task's own Assignee, handled
// separately below via isAssignee).
const MANAGE_ROLES = ['program_manager'];

// Status is fully auto-computed by task events (create, QA submit/
// approve/reject) - there is no manual status selection anywhere in this
// flow, just a read-only badge (see StatusBadge below).
const STATUS_COLOR = {
  Development: { bg: 'var(--color-slate-tint)', fg: 'var(--color-ink-soft)' },
  Feedback: { bg: 'var(--color-plum-tint)', fg: 'var(--color-plum-dark)' },
  'Re-Feedback': { bg: 'var(--color-plum-tint)', fg: 'var(--color-plum-dark)' },
  Pass: { bg: 'var(--color-moss-tint)', fg: 'var(--color-moss-dark)' },
  Failed: { bg: 'var(--color-red-tint)', fg: 'var(--color-red-dark)' },
};

function StatusBadge({ status }) {
  const color = STATUS_COLOR[status] || { bg: 'var(--color-slate-tint)', fg: 'var(--color-ink-soft)' };
  return (
    <span className={styles.badge} style={{ background: color.bg, color: color.fg }}>
      {status}
    </span>
  );
}

const ARTIFACT_TYPES = [
  'APK Build',
  'Build Pipeline Link',
  'Deployment Report',
  'Pull Request Link',
  'Screenshot',
  'Demo Video',
  'Technical Documentation',
];

function userToOption(u) {
  return { id: u.id, name: u.fullName || u.email };
}

export default function TaskDetailPage() {
  const router = useRouter();
  const { id } = router.query;
  const { showToast } = useToast();

  const [user, setUser] = useState(null);
  const [task, setTask] = useState(null);
  const [tickets, setTickets] = useState([]);
  const [developers, setDevelopers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const [estimatedHours, setEstimatedHours] = useState('');
  const [dueDate, setDueDate] = useState('');

  const [ticketDescription, setTicketDescription] = useState('');
  const [ticketOwner, setTicketOwner] = useState(null);
  const [filingTicket, setFilingTicket] = useState(false);

  const [qaReviews, setQaReviews] = useState([]);
  const [resolution, setResolution] = useState('');
  const [artifactType, setArtifactType] = useState('');
  const [artifactUrl, setArtifactUrl] = useState('');
  const [submittingQa, setSubmittingQa] = useState(false);
  const [rejectComment, setRejectComment] = useState('');
  const [showRejectForm, setShowRejectForm] = useState(false);
  const [qaActionBusy, setQaActionBusy] = useState(false);

  const loadTickets = () => {
    apiFetch(`/task-dependency-tickets?parentTaskId=${id}`).then(setTickets).catch(() => {});
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
    apiFetch('/users/assignable?role=developer').then((rows) => setDevelopers(rows.map(userToOption))).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  useEffect(() => {
    if (!user || !id) return;
    setLoading(true);
    setError('');
    Promise.all([
      apiFetch(`/tasks/${id}`),
      apiFetch(`/task-dependency-tickets?parentTaskId=${id}`),
      apiFetch(`/tasks/${id}/qa-reviews`),
    ])
      .then(([t, ticketList, reviewList]) => {
        setTask(t);
        setEstimatedHours(t.estimatedHours ?? '');
        setDueDate(t.dueDate ?? '');
        setTickets(ticketList);
        setQaReviews(reviewList);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, id]);

  if (!user || loading) {
    return (
      <AppShell>
        <div className={styles.empty}>Loading...</div>
      </AppShell>
    );
  }

  if (error || !task) {
    return (
      <AppShell>
        <div className={styles.error}>{error || 'Task not found.'}</div>
      </AppShell>
    );
  }

  const canManage = MANAGE_ROLES.includes(user.role);
  const isAssignee = task.assigneeUserId === user.id;
  const canEditFields = canManage || isAssignee;
  const estimatedHoursLocked = task.estimatedHours != null && !canManage;
  // Due Date: one-time entry for the Assignee, same lock pattern as
  // E.Hrs - Program Manager can always re-edit it, no lock applies to PM.
  const dueDateLocked = task.dueDate != null && !canManage;

  const latestQaReview = qaReviews[0];
  const hasPendingQaReview = latestQaReview?.status === 'pending';
  const isQa = user.role === 'qa';

  const handleSaveFields = async (e) => {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      const payload = {};
      if (!estimatedHoursLocked && estimatedHours !== '' && Number(estimatedHours) !== task.estimatedHours) {
        payload.estimatedHours = Number(estimatedHours);
      }
      if (!dueDateLocked && dueDate && dueDate !== task.dueDate) {
        payload.dueDate = dueDate;
      }
      const updated = await apiFetch(`/tasks/${task.id}`, { method: 'PATCH', body: JSON.stringify(payload) });
      setTask(updated);
      showToast('Task updated', 'success');
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleSubmitForQa = async (e) => {
    e.preventDefault();
    setError('');
    if (!resolution.trim() || !artifactType || !artifactUrl.trim()) {
      setError('Resolution, Artifact Type, and Artifact URL are all required to submit for QA testing.');
      return;
    }
    setSubmittingQa(true);
    try {
      await apiFetch(`/tasks/${task.id}/qa-submit`, {
        method: 'POST',
        body: JSON.stringify({ resolution, artifactType, artifactUrl }),
      });
      showToast('Submitted for QA testing', 'success');
      setResolution('');
      setArtifactType('');
      setArtifactUrl('');
      const [refreshedTask, refreshedReviews] = await Promise.all([
        apiFetch(`/tasks/${task.id}`),
        apiFetch(`/tasks/${task.id}/qa-reviews`),
      ]);
      setTask(refreshedTask);
      setQaReviews(refreshedReviews);
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmittingQa(false);
    }
  };

  const handleQaApprove = async () => {
    setError('');
    setQaActionBusy(true);
    try {
      await apiFetch(`/tasks/${task.id}/qa-approve`, { method: 'PATCH' });
      showToast('Task approved', 'success');
      const [refreshedTask, refreshedReviews] = await Promise.all([
        apiFetch(`/tasks/${task.id}`),
        apiFetch(`/tasks/${task.id}/qa-reviews`),
      ]);
      setTask(refreshedTask);
      setQaReviews(refreshedReviews);
    } catch (err) {
      setError(err.message);
    } finally {
      setQaActionBusy(false);
    }
  };

  const handleQaReject = async (e) => {
    e.preventDefault();
    setError('');
    if (!rejectComment.trim()) {
      setError('A comment explaining the rejection is required.');
      return;
    }
    setQaActionBusy(true);
    try {
      await apiFetch(`/tasks/${task.id}/qa-reject`, {
        method: 'PATCH',
        body: JSON.stringify({ comment: rejectComment }),
      });
      showToast('Task rejected', 'success');
      setRejectComment('');
      setShowRejectForm(false);
      const [refreshedTask, refreshedReviews] = await Promise.all([
        apiFetch(`/tasks/${task.id}`),
        apiFetch(`/tasks/${task.id}/qa-reviews`),
      ]);
      setTask(refreshedTask);
      setQaReviews(refreshedReviews);
    } catch (err) {
      setError(err.message);
    } finally {
      setQaActionBusy(false);
    }
  };

  const handleFileTicket = async (e) => {
    e.preventDefault();
    setError('');
    if (!ticketDescription.trim() || !ticketOwner) {
      setError('Dependency Description and Dependency Owner are both required.');
      return;
    }
    setFilingTicket(true);
    try {
      await apiFetch('/task-dependency-tickets', {
        method: 'POST',
        body: JSON.stringify({
          parentTaskId: task.id,
          description: ticketDescription,
          ownerUserId: ticketOwner.id,
        }),
      });
      showToast('Dependency Ticket created', 'success');
      setTicketDescription('');
      setTicketOwner(null);
      loadTickets();
    } catch (err) {
      setError(err.message);
    } finally {
      setFilingTicket(false);
    }
  };

  return (
    <AppShell>
      <div className={styles.pageHeader}>
        <div>
          <h1 className={styles.pageTitle}>Task #{task.id}</h1>
          <p className={styles.pageSubtitle}>{task.projectName} &middot; {task.moduleName} &middot; {task.phaseName}</p>
        </div>
        <Link href="/tasks/mine" className={styles.backLink}>&larr; Back to My Tasks</Link>
      </div>

      {error && <div className={styles.error}>{error}</div>}

      <div className={styles.card} style={{ marginBottom: 'var(--space-4)' }}>
        <p style={{ marginTop: 0 }}>{task.description}</p>
        <p className={styles.issueMeta}>
          Assignee: {task.assigneeEmail || 'Unassigned'} &middot; Ageing: {task.ageingDays}d
        </p>
      </div>

      <form onSubmit={handleSaveFields} className={styles.card} style={{ marginBottom: 'var(--space-4)' }}>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="tdEHrs">Estimated Hours</label>
          <input
            className={styles.input}
            id="tdEHrs"
            type="number"
            min="0"
            step="0.5"
            disabled={!canEditFields || estimatedHoursLocked}
            value={estimatedHours}
            onChange={(e) => setEstimatedHours(e.target.value)}
          />
          {estimatedHoursLocked && (
            <p className={styles.helpText}>Locked after first entry - only Admin or Program Manager can change it now.</p>
          )}
        </div>

        <div className={styles.field}>
          <label className={styles.label} htmlFor="tdDueDate">Due Date</label>
          <input
            className={styles.input}
            id="tdDueDate"
            type="date"
            disabled={!canEditFields || dueDateLocked}
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
          />
          {dueDateLocked && (
            <p className={styles.helpText}>Locked after first entry - only Program Manager can change it now.</p>
          )}
        </div>

        <div className={styles.field}>
          <label className={styles.label}>Status</label>
          <div>
            <StatusBadge status={task.status} />
          </div>
          {hasPendingQaReview && (
            <p className={styles.helpText}>A QA review round is pending - status is controlled by QA Approve/Reject.</p>
          )}
        </div>

        {canEditFields && (
          <div className={styles.actions}>
            <button className={`${styles.button} ${styles.buttonAccent}`} type="submit" disabled={saving}>
              {saving ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        )}
      </form>

      {isAssignee && (
        <form onSubmit={handleFileTicket} className={styles.card} style={{ marginBottom: 'var(--space-4)' }}>
          <h2 className={styles.pageSubtitle} style={{ margin: '0 0 var(--space-3)', fontWeight: 600 }}>
            Create Dependency Ticket
          </h2>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="tdTicketDesc">Dependency Description</label>
            <textarea
              className={styles.textarea}
              id="tdTicketDesc"
              required
              value={ticketDescription}
              onChange={(e) => setTicketDescription(e.target.value)}
            />
          </div>
          <SearchSelectField
            label="Dependency Owner (Developer)"
            id="tdTicketOwner"
            required
            value={ticketOwner}
            onChange={setTicketOwner}
            options={developers}
          />
          <div className={styles.actions}>
            <button className={`${styles.button} ${styles.buttonAccent}`} type="submit" disabled={filingTicket}>
              {filingTicket ? 'Filing...' : 'File Dependency Ticket'}
            </button>
          </div>
        </form>
      )}

      <div className={styles.card} style={{ marginBottom: 'var(--space-4)' }}>
        <h2 className={styles.pageSubtitle} style={{ margin: '0 0 var(--space-3)', fontWeight: 600 }}>
          Dependency Tickets
        </h2>
        {tickets.length === 0 && <div className={styles.empty}>No dependency tickets filed for this task.</div>}
        {tickets.map((ticket) => (
          <div key={ticket.id} style={{ padding: 'var(--space-3) 0', borderTop: '1px solid var(--color-border)' }}>
            <p style={{ margin: 0 }}>{ticket.description}</p>
            <p className={styles.issueMeta} style={{ margin: 'var(--space-1) 0 0' }}>
              Owner: {ticket.ownerEmail} &middot; Filed by {ticket.createdByEmail} &middot;{' '}
              {new Date(ticket.createdAt).toLocaleDateString()}
            </p>
          </div>
        ))}
      </div>

      {isAssignee && !hasPendingQaReview && (
        <form onSubmit={handleSubmitForQa} className={styles.card} style={{ marginBottom: 'var(--space-4)' }}>
          <h2 className={styles.pageSubtitle} style={{ margin: '0 0 var(--space-3)', fontWeight: 600 }}>
            Submit for QA Testing
          </h2>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="tdResolution">Resolution</label>
            <textarea
              className={styles.textarea}
              id="tdResolution"
              required
              placeholder="Describe what was done / fixed"
              value={resolution}
              onChange={(e) => setResolution(e.target.value)}
            />
          </div>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="tdArtifactType">Artifact Type</label>
            <select
              className={styles.select}
              id="tdArtifactType"
              required
              value={artifactType}
              onChange={(e) => setArtifactType(e.target.value)}
            >
              <option value="" disabled>— Select artifact type —</option>
              {ARTIFACT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="tdArtifactUrl">Artifact URL</label>
            <input
              className={styles.input}
              id="tdArtifactUrl"
              type="url"
              required
              placeholder="https://..."
              value={artifactUrl}
              onChange={(e) => setArtifactUrl(e.target.value)}
            />
          </div>
          <div className={styles.actions}>
            <button className={`${styles.button} ${styles.buttonAccent}`} type="submit" disabled={submittingQa}>
              {submittingQa ? 'Submitting...' : 'Mark Ready for Feedback'}
            </button>
          </div>
        </form>
      )}

      {isQa && hasPendingQaReview && (
        <div className={styles.card} style={{ marginBottom: 'var(--space-4)' }}>
          <h2 className={styles.pageSubtitle} style={{ margin: '0 0 var(--space-3)', fontWeight: 600 }}>
            QA Review
          </h2>
          <p style={{ margin: 0 }}><strong>Resolution:</strong> {latestQaReview.resolution}</p>
          <p className={styles.issueMeta} style={{ margin: 'var(--space-1) 0 0' }}>
            Artifact: {latestQaReview.artifactType} &middot;{' '}
            <a href={latestQaReview.artifactUrl} target="_blank" rel="noreferrer">{latestQaReview.artifactUrl}</a>
          </p>
          <p className={styles.issueMeta} style={{ margin: 'var(--space-1) 0 0' }}>
            Submitted by {latestQaReview.submittedByEmail} &middot;{' '}
            {new Date(latestQaReview.submittedAt).toLocaleDateString()} &middot; Round {latestQaReview.roundNumber}
          </p>

          {!showRejectForm && (
            <div className={styles.actions} style={{ marginTop: 'var(--space-3)' }}>
              <button className={`${styles.button} ${styles.buttonAccent}`} type="button" onClick={handleQaApprove} disabled={qaActionBusy}>
                {qaActionBusy ? 'Working...' : 'Approve'}
              </button>
              <button className={styles.button} type="button" onClick={() => setShowRejectForm(true)} disabled={qaActionBusy}>
                Reject
              </button>
            </div>
          )}

          {showRejectForm && (
            <form onSubmit={handleQaReject} style={{ marginTop: 'var(--space-3)' }}>
              <div className={styles.field}>
                <label className={styles.label} htmlFor="tdRejectComment">Rejection Comment</label>
                <textarea
                  className={styles.textarea}
                  id="tdRejectComment"
                  required
                  placeholder="Explain what's incorrect, unclear, or missing"
                  value={rejectComment}
                  onChange={(e) => setRejectComment(e.target.value)}
                />
              </div>
              <div className={styles.actions}>
                <button className={`${styles.button} ${styles.buttonAccent}`} type="submit" disabled={qaActionBusy}>
                  {qaActionBusy ? 'Working...' : 'Confirm Reject'}
                </button>
                <button className={styles.button} type="button" onClick={() => setShowRejectForm(false)} disabled={qaActionBusy}>
                  Cancel
                </button>
              </div>
            </form>
          )}
        </div>
      )}

      <div className={styles.card}>
        <h2 className={styles.pageSubtitle} style={{ margin: '0 0 var(--space-3)', fontWeight: 600 }}>
          QA Review History
        </h2>
        {qaReviews.length === 0 && <div className={styles.empty}>No QA review rounds yet.</div>}
        {qaReviews.map((review) => (
          <div key={review.id} style={{ padding: 'var(--space-3) 0', borderTop: '1px solid var(--color-border)' }}>
            <p style={{ margin: 0 }}>
              <strong>Round {review.roundNumber}</strong> &middot; {review.status}
            </p>
            <p style={{ margin: 'var(--space-1) 0 0' }}>{review.resolution}</p>
            <p className={styles.issueMeta} style={{ margin: 'var(--space-1) 0 0' }}>
              Artifact: {review.artifactType} &middot;{' '}
              <a href={review.artifactUrl} target="_blank" rel="noreferrer">{review.artifactUrl}</a>
            </p>
            <p className={styles.issueMeta} style={{ margin: 'var(--space-1) 0 0' }}>
              Submitted by {review.submittedByEmail} &middot; {new Date(review.submittedAt).toLocaleDateString()}
            </p>
            {review.status !== 'pending' && (
              <p className={styles.issueMeta} style={{ margin: 'var(--space-1) 0 0' }}>
                Reviewed by {review.reviewedByEmail} &middot;{' '}
                {review.reviewedAt && new Date(review.reviewedAt).toLocaleDateString()}
                {review.qaComment && <> &middot; Comment: {review.qaComment}</>}
              </p>
            )}
          </div>
        ))}
      </div>
    </AppShell>
  );
}
