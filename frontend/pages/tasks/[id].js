import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import AppShell from '../../components/AppShell';
import SearchSelectField from '../../components/SearchSelectField';
import Table from '../../components/ui/Table';
import styles from '../../styles/issues.module.css';
import { apiFetch } from '../../lib/api';
import { useToast } from '../../lib/toast';
import { Image, GitPullRequest, Package, FileText, Workflow, FileBarChart, Video, Paperclip, ClipboardList, Bug, Globe, RefreshCw, CheckCircle2 } from 'lucide-react';

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
  // Distinct color from QA's Feedback/Re-Feedback plum, so Peer Review is
  // visually distinguishable at a glance.
  'Peer Review': { bg: 'var(--color-teal-tint)', fg: 'var(--color-teal-dark)' },
  'Re-Peer-Review': { bg: 'var(--color-teal-tint)', fg: 'var(--color-teal-dark)' },
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

// Artifact Type is a fixed enum today (see TaskArtifactType on the
// backend), but this map still falls back to a generic icon for any
// value it doesn't recognize, so a future enum addition can't break the
// history table before its icon is added here.
const ARTIFACT_ICONS = {
  'Screenshot': Image,
  'Pull Request Link': GitPullRequest,
  'APK Build': Package,
  'Technical Documentation': FileText,
  'Build Pipeline Link': Workflow,
  'Deployment Report': FileBarChart,
  'Demo Video': Video,
};

function ArtifactIcons({ artifacts }) {
  return (
    <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
      {artifacts.map((artifact) => {
        const Icon = ARTIFACT_ICONS[artifact.type] || Paperclip;
        return (
          <a
            key={artifact.id}
            href={artifact.url}
            target="_blank"
            rel="noreferrer"
            title={artifact.type}
            aria-label={artifact.type}
            style={{ display: 'inline-flex', color: 'inherit' }}
          >
            <Icon size={16} aria-hidden="true" />
          </a>
        );
      })}
    </div>
  );
}

// QA's own evidence-of-testing artifact types, attached at Approve/Reject
// time - a separate list from ARTIFACT_TYPES (the Assignee's
// submission-time artifacts). Mirrors QaArtifactType on the backend
// (task-qa-review-qa-artifact.entity.ts).
const QA_ARTIFACT_TYPES = [
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

const QA_ARTIFACT_ICONS = {
  'Test Case / Test Plan': ClipboardList,
  'Test Execution Report': FileBarChart,
  'Bug Report': Bug,
  'Screenshot': Image,
  'Screen Recording / Video': Video,
  'Log File': FileText,
  'Staging / Test Environment URL': Globe,
  'Regression Test Results': RefreshCw,
  'Automated Test Run': Workflow,
  'Sign-off / Acceptance Report': CheckCircle2,
};

function QaArtifactIcons({ artifacts }) {
  if (!artifacts || artifacts.length === 0) return null;
  return (
    <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
      {artifacts.map((artifact) => {
        const Icon = QA_ARTIFACT_ICONS[artifact.type] || Paperclip;
        return (
          <a
            key={artifact.id}
            href={artifact.url}
            target="_blank"
            rel="noreferrer"
            title={artifact.type}
            aria-label={artifact.type}
            style={{ display: 'inline-flex', color: 'inherit' }}
          >
            <Icon size={16} aria-hidden="true" />
          </a>
        );
      })}
    </div>
  );
}

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
  const [artifacts, setArtifacts] = useState([{ type: '', url: '' }]);
  const [actualHours, setActualHours] = useState('');
  const [submittingQa, setSubmittingQa] = useState(false);
  const [rejectComment, setRejectComment] = useState('');
  const [showRejectForm, setShowRejectForm] = useState(false);
  const [qaActionBusy, setQaActionBusy] = useState(false);
  // QA's own evidence artifacts - optional, shared between Approve and
  // Reject since only one of those actions is taken per round.
  const [qaArtifacts, setQaArtifacts] = useState([]);
  // Peer Review reviewer picker - only used when task.peerReviewEnabled.
  const [peerReviewer, setPeerReviewer] = useState(null);
  // Review Routing card - the Peer Review checkbox on an already-assigned
  // task, saved through its own dedicated endpoint (see handleSavePeerReviewFlag).
  const [peerReviewEnabled, setPeerReviewEnabled] = useState(false);
  const [savingPeerReviewFlag, setSavingPeerReviewFlag] = useState(false);

  const loadTickets = () => {
    apiFetch(`/task-dependency-tickets?parentTaskId=${id}`).then(setTickets).catch(() => {});
  };

  const handleResolveTicket = async (ticketId) => {
    setError('');
    try {
      await apiFetch(`/task-dependency-tickets/${ticketId}/resolve`, { method: 'PATCH' });
      showToast('Dependency ticket resolved', 'success');
      loadTickets();
    } catch (err) {
      setError(err.message);
    }
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
        setPeerReviewEnabled(!!t.peerReviewEnabled);
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
  // Narrow exception to Admin's usual view-only access to tasks - Admin
  // may set/edit only the Peer Review checkbox (via its own dedicated
  // endpoint below), nothing else on this page.
  const canManagePeerReviewFlag = canManage || user.role === 'admin';

  const latestQaReview = qaReviews[0];
  const hasPendingQaReview = latestQaReview?.status === 'pending';
  const isQa = user.role === 'qa';
  const isPeerReviewer = latestQaReview?.reviewType === 'peer' && latestQaReview?.reviewerUserId === user.id;

  const qaReviewColumns = [
    { key: 'roundNumber', header: 'Round', width: 72, render: (r) => r.roundNumber },
    { key: 'reviewType', header: 'Type', width: 72, render: (r) => (r.reviewType === 'peer' ? 'Peer' : 'QA') },
    { key: 'status', header: 'Status', width: 96, render: (r) => r.status.charAt(0).toUpperCase() + r.status.slice(1) },
    { key: 'resolution', header: 'Description', render: (r) => r.resolution },
    { key: 'artifacts', header: 'Artifact', width: 100, render: (r) => <ArtifactIcons artifacts={r.artifacts} /> },
    { key: 'qaArtifacts', header: 'QA Artifact', width: 100, render: (r) => <QaArtifactIcons artifacts={r.qaArtifacts} /> },
    {
      key: 'submittedAt',
      header: 'Submitted',
      render: (r) => (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span>{r.submittedByFullName}</span>
          <span style={{ fontSize: 12, color: 'var(--ds-text-muted)' }}>{new Date(r.submittedAt).toLocaleDateString()}</span>
        </div>
      ),
    },
    {
      key: 'reviewedAt',
      header: 'Reviewed',
      render: (r) => r.status === 'pending' ? null : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span>{r.reviewedByFullName}</span>
          <span style={{ fontSize: 12, color: 'var(--ds-text-muted)' }}>
            {r.reviewedAt && new Date(r.reviewedAt).toLocaleDateString()}
          </span>
        </div>
      ),
    },
    { key: 'qaComment', header: 'Comment', render: (r) => r.qaComment || null },
  ];

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

  // Peer Review checkbox on an already-assigned task - its own dedicated
  // endpoint, separate from handleSaveFields/PATCH /tasks/:id above, so
  // that form's Program-Manager-or-Assignee gating is never touched by
  // this feature. Always allowed regardless of the task's current status
  // - it only affects the next time the task is submitted for review.
  const handleSavePeerReviewFlag = async () => {
    setError('');
    setSavingPeerReviewFlag(true);
    try {
      const updated = await apiFetch(`/tasks/${task.id}/peer-review-flag`, {
        method: 'PATCH',
        body: JSON.stringify({ peerReviewEnabled }),
      });
      setTask(updated);
      showToast('Review routing updated', 'success');
    } catch (err) {
      setError(err.message);
    } finally {
      setSavingPeerReviewFlag(false);
    }
  };

  const addArtifactRow = () => {
    setArtifacts((prev) => [...prev, { type: '', url: '' }]);
  };

  const removeArtifactRow = (index) => {
    setArtifacts((prev) => (prev.length === 1 ? prev : prev.filter((_, i) => i !== index)));
  };

  const updateArtifactRow = (index, field, value) => {
    setArtifacts((prev) => prev.map((row, i) => (i === index ? { ...row, [field]: value } : row)));
  };

  const addQaArtifactRow = () => {
    setQaArtifacts((prev) => [...prev, { type: '', url: '' }]);
  };

  const removeQaArtifactRow = (index) => {
    setQaArtifacts((prev) => prev.filter((_, i) => i !== index));
  };

  const updateQaArtifactRow = (index, field, value) => {
    setQaArtifacts((prev) => prev.map((row, i) => (i === index ? { ...row, [field]: value } : row)));
  };

  // Optional - only rows with both a Type and a URL are sent. A row with
  // just one of the two filled in is treated as a mistake rather than
  // silently dropped, since that's more likely a forgotten field than an
  // intentionally abandoned row.
  const buildQaArtifactsPayload = () => {
    const incomplete = qaArtifacts.some((row) => (row.type && !row.url.trim()) || (!row.type && row.url.trim()));
    if (incomplete) {
      throw new Error('Each QA artifact needs both a Type and a URL - remove any unused rows.');
    }
    return qaArtifacts.filter((row) => row.type && row.url.trim()).map((row) => ({ type: row.type, url: row.url.trim() }));
  };

  const handleSubmitForQa = async (e) => {
    e.preventDefault();
    setError('');
    const incomplete = artifacts.some((row) => !row.type || !row.url.trim());
    if (!resolution.trim() || incomplete || actualHours === '') {
      setError('Resolution, a Type and URL for every artifact, and Actual Hours are all required to submit for QA testing.');
      return;
    }
    setSubmittingQa(true);
    try {
      await apiFetch(`/tasks/${task.id}/qa-submit`, {
        method: 'POST',
        body: JSON.stringify({
          resolution,
          actualHours: Number(actualHours),
          artifacts: artifacts.map((row) => ({ type: row.type, url: row.url.trim() })),
        }),
      });
      showToast('Submitted for QA testing', 'success');
      setResolution('');
      setArtifacts([{ type: '', url: '' }]);
      setActualHours('');
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

  // Peer Review's equivalent of handleSubmitForQa above - only reachable
  // when task.peerReviewEnabled, hits the Peer Review module's own
  // endpoint instead of /qa-submit. handleSubmitForQa itself is untouched.
  const handleSubmitForPeerReview = async (e) => {
    e.preventDefault();
    setError('');
    const incomplete = artifacts.some((row) => !row.type || !row.url.trim());
    if (!resolution.trim() || incomplete || actualHours === '' || !peerReviewer) {
      setError('Resolution, a Type and URL for every artifact, Actual Hours, and a Peer Reviewer are all required to submit for Peer Review.');
      return;
    }
    setSubmittingQa(true);
    try {
      await apiFetch(`/tasks/${task.id}/peer-review-submit`, {
        method: 'POST',
        body: JSON.stringify({
          resolution,
          actualHours: Number(actualHours),
          artifacts: artifacts.map((row) => ({ type: row.type, url: row.url.trim() })),
          reviewerUserId: peerReviewer.id,
        }),
      });
      showToast('Submitted for Peer Review', 'success');
      setResolution('');
      setArtifacts([{ type: '', url: '' }]);
      setActualHours('');
      setPeerReviewer(null);
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
    let payloadArtifacts;
    try {
      payloadArtifacts = buildQaArtifactsPayload();
    } catch (err) {
      setError(err.message);
      return;
    }
    setQaActionBusy(true);
    try {
      await apiFetch(`/tasks/${task.id}/qa-approve`, {
        method: 'PATCH',
        body: JSON.stringify({ artifacts: payloadArtifacts }),
      });
      showToast('Task approved', 'success');
      setQaArtifacts([]);
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
    let payloadArtifacts;
    try {
      payloadArtifacts = buildQaArtifactsPayload();
    } catch (err) {
      setError(err.message);
      return;
    }
    setQaActionBusy(true);
    try {
      await apiFetch(`/tasks/${task.id}/qa-reject`, {
        method: 'PATCH',
        body: JSON.stringify({ comment: rejectComment, artifacts: payloadArtifacts }),
      });
      showToast('Task rejected', 'success');
      setRejectComment('');
      setShowRejectForm(false);
      setQaArtifacts([]);
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

  // Peer Review's equivalent of handleQaApprove/handleQaReject above -
  // same shape, hits the Peer Review module's own endpoints. The existing
  // QA handlers are untouched.
  const handlePeerReviewApprove = async () => {
    setError('');
    let payloadArtifacts;
    try {
      payloadArtifacts = buildQaArtifactsPayload();
    } catch (err) {
      setError(err.message);
      return;
    }
    setQaActionBusy(true);
    try {
      await apiFetch(`/tasks/${task.id}/peer-review-approve`, {
        method: 'PATCH',
        body: JSON.stringify({ artifacts: payloadArtifacts }),
      });
      showToast('Task approved', 'success');
      setQaArtifacts([]);
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

  const handlePeerReviewReject = async (e) => {
    e.preventDefault();
    setError('');
    if (!rejectComment.trim()) {
      setError('A comment explaining the rejection is required.');
      return;
    }
    let payloadArtifacts;
    try {
      payloadArtifacts = buildQaArtifactsPayload();
    } catch (err) {
      setError(err.message);
      return;
    }
    setQaActionBusy(true);
    try {
      await apiFetch(`/tasks/${task.id}/peer-review-reject`, {
        method: 'PATCH',
        body: JSON.stringify({ comment: rejectComment, artifacts: payloadArtifacts }),
      });
      showToast('Task rejected', 'success');
      setRejectComment('');
      setShowRejectForm(false);
      setQaArtifacts([]);
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
        <div className={styles.fieldGrid3}>
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
              <p className={styles.helpText}>
                {latestQaReview.reviewType === 'peer'
                  ? 'A Peer Review round is pending - status is controlled by the reviewer\'s Approve/Reject.'
                  : 'A QA review round is pending - status is controlled by QA Approve/Reject.'}
              </p>
            )}
          </div>
        </div>

        {canEditFields && (
          <div className={styles.actions}>
            <button className={`${styles.button} ${styles.buttonAccent}`} type="submit" disabled={saving}>
              {saving ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        )}
      </form>

      {canManagePeerReviewFlag && (
        <div className={styles.card} style={{ marginBottom: 'var(--space-4)' }}>
          <h2 className={styles.pageSubtitle} style={{ margin: '0 0 var(--space-3)', fontWeight: 600 }}>
            Review Routing
          </h2>
          <label className={styles.label} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
            <input
              type="checkbox"
              checked={peerReviewEnabled}
              onChange={(e) => setPeerReviewEnabled(e.target.checked)}
            />
            Peer Review
          </label>
          <p className={styles.helpText}>
            Skips QA - the assignee will pick another developer to review this task instead. Only affects the next
            time this task is submitted for review - it won&apos;t change a round that&apos;s already in progress.
          </p>
          <div className={styles.actions}>
            <button
              className={`${styles.button} ${styles.buttonAccent}`}
              type="button"
              disabled={savingPeerReviewFlag || peerReviewEnabled === !!task.peerReviewEnabled}
              onClick={handleSavePeerReviewFlag}
            >
              {savingPeerReviewFlag ? 'Saving...' : 'Save'}
            </button>
          </div>
        </div>
      )}

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
          <div className={styles.fieldNarrow}>
            <SearchSelectField
              label="Dependency Owner (Developer)"
              id="tdTicketOwner"
              required
              value={ticketOwner}
              onChange={setTicketOwner}
              options={developers}
            />
          </div>
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
            <p style={{ margin: 0 }}>
              {ticket.description}{' '}
              <span className={styles.badge} style={ticket.status === 'resolved' ? { background: 'var(--color-teal-tint)', color: 'var(--color-teal-dark)' } : { background: 'var(--color-red-tint)', color: 'var(--color-red-dark)' }}>
                {ticket.status === 'resolved' ? 'Resolved' : 'Open'}
              </span>
            </p>
            <p className={styles.issueMeta} style={{ margin: 'var(--space-1) 0 0' }}>
              Owner: {ticket.ownerEmail} &middot; Filed by {ticket.createdByEmail} &middot;{' '}
              {new Date(ticket.createdAt).toLocaleDateString()}
            </p>
            {ticket.status !== 'resolved' && (ticket.ownerEmail === user.email || canManage) && (
              <button
                className={styles.buttonSecondary}
                type="button"
                style={{ marginTop: 'var(--space-2)' }}
                onClick={() => handleResolveTicket(ticket.id)}
              >
                Mark Resolved
              </button>
            )}
          </div>
        ))}
      </div>

      {isAssignee && !hasPendingQaReview && !task.peerReviewEnabled && (
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
          <label className={styles.label}>Artifacts</label>
          {artifacts.map((row, index) => (
            <div key={index} className={styles.fieldGrid3} style={{ alignItems: 'end', marginBottom: 'var(--space-2)' }}>
              <div className={styles.field}>
                <label className={styles.label} htmlFor={`tdArtifactType-${index}`}>Artifact Type</label>
                <select
                  className={styles.select}
                  id={`tdArtifactType-${index}`}
                  required
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
                <label className={styles.label} htmlFor={`tdArtifactUrl-${index}`}>Artifact URL</label>
                <input
                  className={styles.input}
                  id={`tdArtifactUrl-${index}`}
                  type="url"
                  required
                  placeholder="https://..."
                  value={row.url}
                  onChange={(e) => updateArtifactRow(index, 'url', e.target.value)}
                />
              </div>
              <div className={styles.field}>
                <button
                  className={styles.buttonSecondary}
                  type="button"
                  onClick={() => removeArtifactRow(index)}
                  disabled={artifacts.length === 1}
                >
                  Remove
                </button>
              </div>
            </div>
          ))}
          <div className={styles.actions} style={{ marginBottom: 'var(--space-3)' }}>
            <button className={styles.buttonSecondary} type="button" onClick={addArtifactRow}>
              + Add Another Artifact
            </button>
          </div>
          <div className={styles.field} style={{ maxWidth: '260px' }}>
            <label className={styles.label} htmlFor="tdActualHours">Actual Hours Spent</label>
            <input
              className={styles.input}
              id="tdActualHours"
              type="number"
              min="0"
              step="0.5"
              required
              placeholder="Total hours spent on this task so far"
              value={actualHours}
              onChange={(e) => setActualHours(e.target.value)}
            />
          </div>
          <div className={styles.actions}>
            <button className={`${styles.button} ${styles.buttonAccent}`} type="submit" disabled={submittingQa}>
              {submittingQa ? 'Submitting...' : 'Mark Ready for Feedback'}
            </button>
          </div>
        </form>
      )}

      {isAssignee && !hasPendingQaReview && task.peerReviewEnabled && (
        <form onSubmit={handleSubmitForPeerReview} className={styles.card} style={{ marginBottom: 'var(--space-4)' }}>
          <h2 className={styles.pageSubtitle} style={{ margin: '0 0 var(--space-3)', fontWeight: 600 }}>
            Submit for Peer Review
          </h2>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="tdPeerResolution">Resolution</label>
            <textarea
              className={styles.textarea}
              id="tdPeerResolution"
              required
              placeholder="Describe what was done / fixed"
              value={resolution}
              onChange={(e) => setResolution(e.target.value)}
            />
          </div>
          <label className={styles.label}>Artifacts</label>
          {artifacts.map((row, index) => (
            <div key={index} className={styles.fieldGrid3} style={{ alignItems: 'end', marginBottom: 'var(--space-2)' }}>
              <div className={styles.field}>
                <label className={styles.label} htmlFor={`tdPeerArtifactType-${index}`}>Artifact Type</label>
                <select
                  className={styles.select}
                  id={`tdPeerArtifactType-${index}`}
                  required
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
                <label className={styles.label} htmlFor={`tdPeerArtifactUrl-${index}`}>Artifact URL</label>
                <input
                  className={styles.input}
                  id={`tdPeerArtifactUrl-${index}`}
                  type="url"
                  required
                  placeholder="https://..."
                  value={row.url}
                  onChange={(e) => updateArtifactRow(index, 'url', e.target.value)}
                />
              </div>
              <div className={styles.field}>
                <button
                  className={styles.buttonSecondary}
                  type="button"
                  onClick={() => removeArtifactRow(index)}
                  disabled={artifacts.length === 1}
                >
                  Remove
                </button>
              </div>
            </div>
          ))}
          <div className={styles.actions} style={{ marginBottom: 'var(--space-3)' }}>
            <button className={styles.buttonSecondary} type="button" onClick={addArtifactRow}>
              + Add Another Artifact
            </button>
          </div>
          <div className={styles.fieldGrid3}>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="tdActualHoursPeer">Actual Hours Spent</label>
              <input
                className={styles.input}
                id="tdActualHoursPeer"
                type="number"
                min="0"
                step="0.5"
                required
                placeholder="Total hours spent on this task so far"
                value={actualHours}
                onChange={(e) => setActualHours(e.target.value)}
              />
            </div>
            <SearchSelectField
              label="Peer Reviewer"
              id="tdPeerReviewer"
              required
              value={peerReviewer}
              onChange={setPeerReviewer}
              options={developers.filter((d) => d.id !== user.id)}
            />
          </div>
          <div className={styles.actions}>
            <button className={`${styles.button} ${styles.buttonAccent}`} type="submit" disabled={submittingQa}>
              {submittingQa ? 'Submitting...' : 'Submit for Peer Review'}
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
          {latestQaReview.artifacts.map((artifact) => (
            <p key={artifact.id} className={styles.issueMeta} style={{ margin: 'var(--space-1) 0 0' }}>
              Artifact: {artifact.type} &middot;{' '}
              <a href={artifact.url} target="_blank" rel="noreferrer">{artifact.url}</a>
            </p>
          ))}
          <p className={styles.issueMeta} style={{ margin: 'var(--space-1) 0 0' }}>
            Submitted by {latestQaReview.submittedByEmail} &middot;{' '}
            {new Date(latestQaReview.submittedAt).toLocaleDateString()} &middot; Round {latestQaReview.roundNumber}
          </p>

          <div style={{ marginTop: 'var(--space-3)' }}>
            <label className={styles.label}>QA Artifacts (optional)</label>
            {qaArtifacts.map((row, index) => (
              <div key={index} className={styles.fieldGrid3} style={{ alignItems: 'end', marginBottom: 'var(--space-2)' }}>
                <div className={styles.field}>
                  <label className={styles.label} htmlFor={`tdQaArtifactType-${index}`}>Artifact Type</label>
                  <select
                    className={styles.select}
                    id={`tdQaArtifactType-${index}`}
                    value={row.type}
                    onChange={(e) => updateQaArtifactRow(index, 'type', e.target.value)}
                  >
                    <option value="" disabled>— Select artifact type —</option>
                    {QA_ARTIFACT_TYPES.filter(
                      (t) => t === row.type || !qaArtifacts.some((r) => r.type === t),
                    ).map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <div className={styles.field}>
                  <label className={styles.label} htmlFor={`tdQaArtifactUrl-${index}`}>Artifact URL</label>
                  <input
                    className={styles.input}
                    id={`tdQaArtifactUrl-${index}`}
                    type="url"
                    placeholder="https://..."
                    value={row.url}
                    onChange={(e) => updateQaArtifactRow(index, 'url', e.target.value)}
                  />
                </div>
                <div className={styles.field}>
                  <button className={styles.buttonSecondary} type="button" onClick={() => removeQaArtifactRow(index)}>
                    Remove
                  </button>
                </div>
              </div>
            ))}
            <div className={styles.actions}>
              <button className={styles.buttonSecondary} type="button" onClick={addQaArtifactRow}>
                + Add Artifact
              </button>
            </div>
          </div>

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

      {isPeerReviewer && hasPendingQaReview && (
        <div className={styles.card} style={{ marginBottom: 'var(--space-4)' }}>
          <h2 className={styles.pageSubtitle} style={{ margin: '0 0 var(--space-3)', fontWeight: 600 }}>
            Peer Review
          </h2>
          <p style={{ margin: 0 }}><strong>Resolution:</strong> {latestQaReview.resolution}</p>
          {latestQaReview.artifacts.map((artifact) => (
            <p key={artifact.id} className={styles.issueMeta} style={{ margin: 'var(--space-1) 0 0' }}>
              Artifact: {artifact.type} &middot;{' '}
              <a href={artifact.url} target="_blank" rel="noreferrer">{artifact.url}</a>
            </p>
          ))}
          <p className={styles.issueMeta} style={{ margin: 'var(--space-1) 0 0' }}>
            Submitted by {latestQaReview.submittedByEmail} &middot;{' '}
            {new Date(latestQaReview.submittedAt).toLocaleDateString()} &middot; Round {latestQaReview.roundNumber}
          </p>

          <div style={{ marginTop: 'var(--space-3)' }}>
            <label className={styles.label}>Reviewer Artifacts (optional)</label>
            {qaArtifacts.map((row, index) => (
              <div key={index} className={styles.fieldGrid3} style={{ alignItems: 'end', marginBottom: 'var(--space-2)' }}>
                <div className={styles.field}>
                  <label className={styles.label} htmlFor={`tdPeerQaArtifactType-${index}`}>Artifact Type</label>
                  <select
                    className={styles.select}
                    id={`tdPeerQaArtifactType-${index}`}
                    value={row.type}
                    onChange={(e) => updateQaArtifactRow(index, 'type', e.target.value)}
                  >
                    <option value="" disabled>— Select artifact type —</option>
                    {QA_ARTIFACT_TYPES.filter(
                      (t) => t === row.type || !qaArtifacts.some((r) => r.type === t),
                    ).map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <div className={styles.field}>
                  <label className={styles.label} htmlFor={`tdPeerQaArtifactUrl-${index}`}>Artifact URL</label>
                  <input
                    className={styles.input}
                    id={`tdPeerQaArtifactUrl-${index}`}
                    type="url"
                    placeholder="https://..."
                    value={row.url}
                    onChange={(e) => updateQaArtifactRow(index, 'url', e.target.value)}
                  />
                </div>
                <div className={styles.field}>
                  <button className={styles.buttonSecondary} type="button" onClick={() => removeQaArtifactRow(index)}>
                    Remove
                  </button>
                </div>
              </div>
            ))}
            <div className={styles.actions}>
              <button className={styles.buttonSecondary} type="button" onClick={addQaArtifactRow}>
                + Add Artifact
              </button>
            </div>
          </div>

          {!showRejectForm && (
            <div className={styles.actions} style={{ marginTop: 'var(--space-3)' }}>
              <button className={`${styles.button} ${styles.buttonAccent}`} type="button" onClick={handlePeerReviewApprove} disabled={qaActionBusy}>
                {qaActionBusy ? 'Working...' : 'Approve'}
              </button>
              <button className={styles.button} type="button" onClick={() => setShowRejectForm(true)} disabled={qaActionBusy}>
                Reject
              </button>
            </div>
          )}

          {showRejectForm && (
            <form onSubmit={handlePeerReviewReject} style={{ marginTop: 'var(--space-3)' }}>
              <div className={styles.field}>
                <label className={styles.label} htmlFor="tdPeerRejectComment">Rejection Comment</label>
                <textarea
                  className={styles.textarea}
                  id="tdPeerRejectComment"
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
          Review History
        </h2>
        <Table
          columns={qaReviewColumns}
          rows={[...qaReviews].sort((a, b) => a.roundNumber - b.roundNumber)}
          rowClassName={(review) => (review.status === 'rejected' ? styles.rowRejected : '')}
          emptyState="No QA review rounds yet."
          bodyVerticalAlign="top"
        />
      </div>
    </AppShell>
  );
}
