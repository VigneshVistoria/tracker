import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import AppShell from '../../components/AppShell';
import SearchSelectField from '../../components/SearchSelectField';
import Table from '../../components/ui/Table';
import RichTextEditor from '../../components/ui/RichTextEditor';
import RichTextDisplay from '../../components/ui/RichTextDisplay';
import Badge from '../../components/ui/Badge';
import styles from '../../styles/issues.module.css';
import { apiFetch } from '../../lib/api';
import { useToast } from '../../lib/toast';
import { DEVELOPER_EQUIVALENT_ROLES } from '../../lib/status';
import { stripHtmlForPreview } from '../../lib/richText';
import { TASK_TITLE_MAX_LENGTH } from '../../lib/taskTitle';
import { TASK_PRIORITIES, priorityTone, priorityLabel } from '../../lib/taskTableShared';
import { formatDate } from '../../lib/formatDate';
import { Image, GitPullRequest, Package, FileText, Workflow, FileBarChart, Video, Paperclip, ClipboardList, Bug, Globe, RefreshCw, CheckCircle2 } from 'lucide-react';

const VIEW_ROLES = ['admin', 'executive', 'program_manager', 'qa', 'client', ...DEVELOPER_EQUIVALENT_ROLES];
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
  // Escalated to PM (TaskQaReviewsService.escalate()) - amber, distinct
  // from both QA's Feedback plum and Peer Review's teal.
  Escalated: { bg: 'var(--color-amber-tint)', fg: 'var(--color-amber-dark)' },
  Pass: { bg: 'var(--color-moss-tint)', fg: 'var(--color-moss-dark)' },
  Failed: { bg: 'var(--color-red-tint)', fg: 'var(--color-red-dark)' },
  // Closed as Junk by PM (TasksService.closeAsJunk()) - neutral slate,
  // deliberately not red/moss since it's neither a pass nor a fail.
  Junk: { bg: 'var(--color-slate-tint)', fg: 'var(--color-ink-soft)' },
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
  // Team Tasks - Assignee edit (Program Manager only). A separate,
  // unrestricted-by-role list from `developers` above (which is scoped to
  // DEVELOPER_EQUIVALENT_ROLES for defect/peer-reviewer pickers) - matches
  // /tasks/backlog's own assignableUsers, since the Assignee here can be
  // anyone, not just a Developer/Designer/DevOps.
  const [assignableUsers, setAssignableUsers] = useState([]);
  const [editingAssignee, setEditingAssignee] = useState(false);
  const [assigneeSelection, setAssigneeSelection] = useState(null);
  const [savingAssignee, setSavingAssignee] = useState(false);
  // Task Description edit (Program Manager only, same canManage gate as
  // Edit Assignee above) - allowed at any status, no stage-based lock,
  // via the general PATCH /tasks/:id (TasksService.update() already lets
  // PM through regardless of status; the audit entry it writes already
  // records the full previous task alongside the submitted payload, so
  // old vs new description is captured with no extra backend work).
  const [editingDescription, setEditingDescription] = useState(false);
  const [descriptionDraft, setDescriptionDraft] = useState('');
  const [savingDescription, setSavingDescription] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const [estimatedHours, setEstimatedHours] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [priority, setPriority] = useState('');

  const [ticketDescription, setTicketDescription] = useState('');
  const [ticketOwner, setTicketOwner] = useState(null);
  const [filingTicket, setFilingTicket] = useState(false);

  // Defects spun off this task via QA-rejection's "Create linked defect(s)"
  // option - same shape/reasoning as `tickets` above for Dependency
  // Tickets. createLinkedDefect/linkedDefectDrafts/linkedDefectArtifacts
  // only matter while the QA reject form (showRejectForm) is open; reset
  // alongside rejectComment on a successful reject. linkedDefectDrafts is
  // an open-ended batch (each entry its own Title/Description/Assignee);
  // linkedDefectArtifacts is ONE shared set of evidence applied to every
  // defect in the batch, entered once rather than per defect.
  const [linkedDefects, setLinkedDefects] = useState([]);
  const [createLinkedDefect, setCreateLinkedDefect] = useState(false);
  const [linkedDefectDrafts, setLinkedDefectDrafts] = useState([{ title: '', description: '', assignee: null }]);
  const [linkedDefectArtifacts, setLinkedDefectArtifacts] = useState([]);

  // Defect scope editing (Project/Module/Phase/Description) - only
  // Program Manager or the QA who raised the defect may edit these, own
  // card/save path separate from handleSaveFields (Estimated Hours/Due
  // Date) below, same reasoning as the Review Routing card having its own
  // dedicated endpoint/state.
  const [projects, setProjects] = useState([]);
  const [defectModules, setDefectModules] = useState([]);
  const [defectPhases, setDefectPhases] = useState([]);
  const [defectProject, setDefectProject] = useState(null);
  const [defectModule, setDefectModule] = useState(null);
  const [defectPhase, setDefectPhase] = useState(null);
  const [defectTitle, setDefectTitle] = useState('');
  const [defectDescription, setDefectDescription] = useState('');
  const [savingDefectFields, setSavingDefectFields] = useState(false);
  // Off by default - the page should open into the read-only summary
  // card, not straight into this form. Cancel/save both drop back out.
  const [editingDefectFields, setEditingDefectFields] = useState(false);

  const [qaReviews, setQaReviews] = useState([]);
  // Evidence QA attached at Create Defect time - only fetched/shown for
  // defect tickets.
  const [defectArtifacts, setDefectArtifacts] = useState([]);
  const [resolution, setResolution] = useState('');
  const [artifacts, setArtifacts] = useState([{ type: '', url: '' }]);
  const [actualHours, setActualHours] = useState('');
  const [submittingQa, setSubmittingQa] = useState(false);
  const [rejectComment, setRejectComment] = useState('');
  const [showRejectForm, setShowRejectForm] = useState(false);
  // Optional note on Approve - unlike rejectComment above, never required
  // and never gated behind a toggle, since there's no decision to
  // confirm. Shared between the QA Feedback and Peer Review panels the
  // same way rejectComment is (only one panel is ever visible at once).
  const [approveComment, setApproveComment] = useState('');
  const [escalateComment, setEscalateComment] = useState('');
  const [showEscalateForm, setShowEscalateForm] = useState(false);
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

  const loadLinkedDefects = () => {
    apiFetch(`/tasks/${id}/linked-defects`).then(setLinkedDefects).catch(() => {});
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
    apiFetch('/projects').then(setProjects).catch(() => {});
    if (MANAGE_ROLES.includes(parsed.role)) {
      apiFetch('/users/assignable').then((rows) => setAssignableUsers(rows.map(userToOption))).catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  useEffect(() => {
    if (!defectProject) {
      setDefectModules([]);
      return;
    }
    apiFetch(`/modules?projectId=${defectProject.id}`).then(setDefectModules).catch(() => setDefectModules([]));
  }, [defectProject]);

  useEffect(() => {
    if (!defectModule) {
      setDefectPhases([]);
      return;
    }
    apiFetch(`/phases?moduleId=${defectModule.id}`).then(setDefectPhases).catch(() => setDefectPhases([]));
  }, [defectModule]);

  useEffect(() => {
    if (!user || !id) return;
    setLoading(true);
    setError('');
    Promise.all([
      apiFetch(`/tasks/${id}`),
      apiFetch(`/task-dependency-tickets?parentTaskId=${id}`),
      apiFetch(`/tasks/${id}/qa-reviews`),
      apiFetch(`/tasks/${id}/linked-defects`),
    ])
      .then(([t, ticketList, reviewList, linkedDefectList]) => {
        setTask(t);
        setEstimatedHours(t.estimatedHours ?? '');
        setDueDate(t.dueDate ?? '');
        setPriority(t.priority ?? '');
        setPeerReviewEnabled(!!t.peerReviewEnabled);
        setDefectProject({ id: t.projectId, name: t.projectName });
        setDefectModule({ id: t.moduleId, name: t.moduleName });
        setDefectPhase({ id: t.phaseId, name: t.phaseName });
        setDefectTitle(t.title);
        setDefectDescription(t.description);
        setDescriptionDraft(t.description);
        setAssigneeSelection(t.assigneeUserId ? { id: t.assigneeUserId, name: t.assigneeFullName || t.assigneeEmail } : null);
        setTickets(ticketList);
        setQaReviews(reviewList);
        setLinkedDefects(linkedDefectList);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, id]);

  useEffect(() => {
    if (!task?.isDefect) return;
    apiFetch(`/tasks/${task.id}/defect-artifacts`).then(setDefectArtifacts).catch(() => setDefectArtifacts([]));
  }, [task?.id, task?.isDefect]);

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
  // Backend mirror: TasksService.canEdit()'s isDefect/createdByUserId
  // branch - only Program Manager or the QA who raised this defect may
  // edit its Project/Module/Phase/Description.
  const canEditDefectScope = task.isDefect && (canManage || task.createdByUserId === user.id);

  const latestQaReview = qaReviews[0];
  const hasPendingQaReview = latestQaReview?.status === 'pending';
  const isQa = user.role === 'qa';
  // Backend mirror: TaskQaReviewsService.approve()/reject()'s isDefect
  // check - a defect's QA panel is only actionable by whoever raised it,
  // not any QA teammate.
  const canActOnQaReview = isQa && (!task.isDefect || task.createdByUserId === user.id);
  // Backend mirror: TaskQaReviewsService.submit()/PeerReviewsService.
  // submit()'s isEscalated guard - the Assignee can't resubmit either way
  // until PM reassigns it from the Escalations queue.
  const isEscalated = task.status === 'Escalated';
  const isPeerReviewer = latestQaReview?.reviewType === 'peer' && latestQaReview?.reviewerUserId === user.id;
  // QA-only hard block (backend: TasksService.assertNoOpenDependencyTickets(),
  // called from TaskQaReviewsService.submit()) - deliberately not consulted
  // by the Peer Review submit form below, which stays reachable regardless.
  const openDependencyTickets = tickets.filter((t) => t.status === 'open');
  // Backend mirror: TasksService.LINKED_DEFECT_RESOLVED_STATUSES /
  // assertNoOpenLinkedDefects() - coexists with openDependencyTickets
  // above, either one independently blocks resubmission. 'Failed' is
  // deliberately still "open" here (see that constant's comment).
  const openLinkedDefects = linkedDefects.filter((d) => !['Pass', 'Junk'].includes(d.status));

  const qaReviewColumns = [
    { key: 'roundNumber', header: 'Round', width: 72, render: (r) => r.roundNumber },
    { key: 'reviewType', header: 'Type', width: 72, render: (r) => (r.reviewType === 'peer' ? 'Peer' : 'QA') },
    { key: 'status', header: 'Status', width: 96, render: (r) => r.status.charAt(0).toUpperCase() + r.status.slice(1) },
    { key: 'resolution', header: 'Description', render: (r) => stripHtmlForPreview(r.resolution) },
    { key: 'artifacts', header: 'Artifact', width: 100, render: (r) => <ArtifactIcons artifacts={r.artifacts} /> },
    { key: 'qaArtifacts', header: 'QA Artifact', width: 100, render: (r) => <QaArtifactIcons artifacts={r.qaArtifacts} /> },
    {
      key: 'submittedAt',
      header: 'Submitted',
      render: (r) => (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span>{r.submittedByFullName}</span>
          <span style={{ fontSize: 12, color: 'var(--ds-text-muted)' }}>{formatDate(r.submittedAt)}</span>
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
            {r.reviewedAt && formatDate(r.reviewedAt)}
          </span>
        </div>
      ),
    },
    { key: 'qaComment', header: 'Comment', render: (r) => stripHtmlForPreview(r.qaComment) || null },
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
      if (canManage && priority !== (task.priority || '')) {
        payload.priority = priority || null;
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
  const handleSaveDefectFields = async (e) => {
    e.preventDefault();
    setError('');
    if (!defectProject || !defectModule || !defectPhase || !defectTitle.trim() || !stripHtmlForPreview(defectDescription).trim()) {
      setError('Project, Module, Phase, Title, and Description are all required.');
      return;
    }
    setSavingDefectFields(true);
    try {
      const updated = await apiFetch(`/tasks/${task.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          projectId: defectProject.id,
          moduleId: defectModule.id,
          phaseId: defectPhase.id,
          title: defectTitle.trim(),
          description: defectDescription,
        }),
      });
      setTask(updated);
      setEditingDefectFields(false);
      showToast('Defect details updated', 'success');
    } catch (err) {
      setError(err.message);
    } finally {
      setSavingDefectFields(false);
    }
  };

  // Discards any unsaved edits by resetting the fields back to the task's
  // last-saved values, same values the initial load effect populated them
  // with - Cancel should never leave stale edits sitting in state for the
  // next time Edit is clicked.
  const handleCancelEditDefectFields = () => {
    setDefectProject({ id: task.projectId, name: task.projectName });
    setDefectModule({ id: task.moduleId, name: task.moduleName });
    setDefectPhase({ id: task.phaseId, name: task.phaseName });
    setDefectTitle(task.title);
    setDefectDescription(task.description);
    setEditingDefectFields(false);
  };

  // Team Tasks - PM edits the Assignee directly (PATCH /tasks/:id/reassign,
  // its own dedicated endpoint - see TasksService.reassignTeamTask() for
  // why this is deliberately separate from handleSaveFields/PATCH
  // /tasks/:id above). Clearing the field (assigneeSelection null) sends
  // the task back to the Task Backlog; picking someone new moves it into
  // their My Tasks. Either way, any Peer Review/Escalation/Dependency
  // Ticket currently in flight on this task is untouched - it keeps
  // routing to whoever it's already routed to.
  const handleSaveAssignee = async () => {
    setError('');
    setSavingAssignee(true);
    try {
      const updated = await apiFetch(`/tasks/${task.id}/reassign`, {
        method: 'PATCH',
        body: JSON.stringify({ assigneeUserId: assigneeSelection ? assigneeSelection.id : null }),
      });
      setTask(updated);
      setAssigneeSelection(updated.assigneeUserId ? { id: updated.assigneeUserId, name: updated.assigneeFullName || updated.assigneeEmail } : null);
      setEditingAssignee(false);
      showToast(updated.assigneeEmail ? `Reassigned to ${updated.assigneeFullName || updated.assigneeEmail}` : 'Assignee cleared - task returned to Task Backlog', 'success');
    } catch (err) {
      setError(err.message);
    } finally {
      setSavingAssignee(false);
    }
  };

  const handleCancelEditAssignee = () => {
    setAssigneeSelection(task.assigneeUserId ? { id: task.assigneeUserId, name: task.assigneeFullName || task.assigneeEmail } : null);
    setEditingAssignee(false);
  };

  // PM-only description edit, allowed at any status (no stage-based lock,
  // unlike Estimated Hours/Due Date) - see the editingDescription state
  // declaration above for why no dedicated backend endpoint was needed.
  const handleSaveDescription = async () => {
    setError('');
    if (!stripHtmlForPreview(descriptionDraft).trim()) {
      setError('Description is required.');
      return;
    }
    setSavingDescription(true);
    try {
      const updated = await apiFetch(`/tasks/${task.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ description: descriptionDraft }),
      });
      setTask(updated);
      setDescriptionDraft(updated.description);
      setEditingDescription(false);
      showToast('Description updated', 'success');
    } catch (err) {
      setError(err.message);
    } finally {
      setSavingDescription(false);
    }
  };

  const handleCancelEditDescription = () => {
    setDescriptionDraft(task.description);
    setEditingDescription(false);
  };

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

  const addLinkedDefectArtifactRow = () => {
    setLinkedDefectArtifacts((prev) => [...prev, { type: '', url: '' }]);
  };

  const removeLinkedDefectArtifactRow = (index) => {
    setLinkedDefectArtifacts((prev) => prev.filter((_, i) => i !== index));
  };

  const updateLinkedDefectArtifactRow = (index, field, value) => {
    setLinkedDefectArtifacts((prev) => prev.map((row, i) => (i === index ? { ...row, [field]: value } : row)));
  };

  // Same "both filled in or neither" rule as buildQaArtifactsPayload. This
  // one set of artifacts is shared across every defect in
  // linkedDefectDrafts below, not picked per defect.
  const buildLinkedDefectArtifactsPayload = () => {
    const incomplete = linkedDefectArtifacts.some((row) => (row.type && !row.url.trim()) || (!row.type && row.url.trim()));
    if (incomplete) {
      throw new Error('Each linked defect artifact needs both a Type and a URL - remove any unused rows.');
    }
    return linkedDefectArtifacts.filter((row) => row.type && row.url.trim()).map((row) => ({ type: row.type, url: row.url.trim() }));
  };

  const addLinkedDefectDraft = () => {
    setLinkedDefectDrafts((prev) => [...prev, { title: '', description: '', assignee: null }]);
  };

  const removeLinkedDefectDraft = (index) => {
    setLinkedDefectDrafts((prev) => (prev.length === 1 ? prev : prev.filter((_, i) => i !== index)));
  };

  const updateLinkedDefectDraft = (index, field, value) => {
    setLinkedDefectDrafts((prev) => prev.map((row, i) => (i === index ? { ...row, [field]: value } : row)));
  };

  const resetLinkedDefectForm = () => {
    setCreateLinkedDefect(false);
    setLinkedDefectDrafts([{ title: '', description: '', assignee: null }]);
    setLinkedDefectArtifacts([]);
  };

  const handleSubmitForQa = async (e) => {
    e.preventDefault();
    setError('');
    const incomplete = artifacts.some((row) => !row.type || !row.url.trim());
    if (!stripHtmlForPreview(resolution).trim() || incomplete || actualHours === '') {
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
    if (!stripHtmlForPreview(resolution).trim() || incomplete || actualHours === '' || !peerReviewer) {
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
        body: JSON.stringify({ comment: approveComment.trim() || undefined, artifacts: payloadArtifacts }),
      });
      showToast('Task approved', 'success');
      setApproveComment('');
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
    if (!stripHtmlForPreview(rejectComment).trim()) {
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
    let linkedDefectsPayload;
    let linkedDefectArtifactsPayload;
    if (createLinkedDefect) {
      const incompleteDraft = linkedDefectDrafts.some(
        (d) => !d.title.trim() || !stripHtmlForPreview(d.description).trim() || !d.assignee,
      );
      if (incompleteDraft) {
        setError('Every linked defect needs a Title, Description, and Assignee.');
        return;
      }
      try {
        linkedDefectArtifactsPayload = buildLinkedDefectArtifactsPayload();
      } catch (err) {
        setError(err.message);
        return;
      }
      linkedDefectsPayload = linkedDefectDrafts.map((d) => ({
        title: d.title.trim(),
        description: d.description,
        assigneeUserId: d.assignee.id,
      }));
    }
    setQaActionBusy(true);
    try {
      const result = await apiFetch(`/tasks/${task.id}/qa-reject`, {
        method: 'PATCH',
        body: JSON.stringify({
          comment: rejectComment,
          artifacts: payloadArtifacts,
          linkedDefects: linkedDefectsPayload,
          linkedDefectArtifacts: linkedDefectArtifactsPayload,
        }),
      });
      showToast(
        result.linkedDefects && result.linkedDefects.length > 0
          ? `Task rejected - ${result.linkedDefects.length} linked defect${result.linkedDefects.length > 1 ? 's' : ''} created`
          : 'Task rejected',
        'success',
      );
      setRejectComment('');
      setShowRejectForm(false);
      setQaArtifacts([]);
      resetLinkedDefectForm();
      const [refreshedTask, refreshedReviews] = await Promise.all([
        apiFetch(`/tasks/${task.id}`),
        apiFetch(`/tasks/${task.id}/qa-reviews`),
      ]);
      setTask(refreshedTask);
      setQaReviews(refreshedReviews);
      loadLinkedDefects();
    } catch (err) {
      setError(err.message);
    } finally {
      setQaActionBusy(false);
    }
  };

  // QA Feedback escalation to PM - an alternative to Approve/Reject, not
  // available on the Peer Review panel below (that path has its own,
  // separate approve/reject and no escalate option at all).
  const handleQaEscalate = async (e) => {
    e.preventDefault();
    setError('');
    if (!stripHtmlForPreview(escalateComment).trim()) {
      setError('A comment explaining the escalation is required.');
      return;
    }
    setQaActionBusy(true);
    try {
      await apiFetch(`/tasks/${task.id}/qa-escalate`, {
        method: 'PATCH',
        body: JSON.stringify({ comment: escalateComment }),
      });
      showToast('Task escalated to PM', 'success');
      setEscalateComment('');
      setShowEscalateForm(false);
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
        body: JSON.stringify({ comment: approveComment.trim() || undefined, artifacts: payloadArtifacts }),
      });
      showToast('Task approved', 'success');
      setApproveComment('');
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
    if (!stripHtmlForPreview(rejectComment).trim()) {
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
          <h1 className={styles.pageTitle}>#{task.id} - {task.title}</h1>
          <p className={styles.pageSubtitle}>{task.projectName} &middot; {task.moduleName} &middot; {task.phaseName}</p>
        </div>
        <Link href="/tasks/mine" className={styles.backLink}>&larr; Back to My Tasks</Link>
      </div>

      {error && <div className={styles.error}>{error}</div>}

      <div className={styles.card} style={{ marginBottom: 'var(--space-4)' }}>
        {task.isDefect && (
          <span className={styles.badge} style={{ background: 'var(--color-red-tint)', color: 'var(--color-red-dark)' }}>
            Defect
          </span>
        )}
        {!editingDescription && <RichTextDisplay value={task.description} />}
        {canManage && !editingDescription && (
          <div className={styles.actions} style={{ marginTop: 'var(--space-2)' }}>
            <button className={styles.buttonSecondary} type="button" onClick={() => setEditingDescription(true)}>
              Edit Description
            </button>
          </div>
        )}
        {canManage && editingDescription && (
          <div style={{ marginTop: 'var(--space-3)' }}>
            <RichTextEditor
              id="taskDescriptionEdit"
              value={descriptionDraft}
              onChange={setDescriptionDraft}
              placeholder="Describe the task..."
            />
            <div className={styles.actions} style={{ marginTop: 'var(--space-2)' }}>
              <button className={`${styles.button} ${styles.buttonAccent}`} type="button" disabled={savingDescription} onClick={handleSaveDescription}>
                {savingDescription ? 'Saving...' : 'Save Description'}
              </button>
              <button className={styles.buttonSecondary} type="button" disabled={savingDescription} onClick={handleCancelEditDescription}>
                Cancel
              </button>
            </div>
          </div>
        )}
        <p className={styles.issueMeta}>
          Assignee: {task.assigneeFullName || task.assigneeEmail || 'Unassigned'} &middot; Ageing: {task.ageingDays}d
          {task.isDefect && <> &middot; Raised by {task.createdByEmail}</>}
        </p>
        {canManage && !editingAssignee && (
          <div className={styles.actions} style={{ marginTop: 'var(--space-2)' }}>
            <button className={styles.buttonSecondary} type="button" onClick={() => setEditingAssignee(true)}>
              Edit Assignee
            </button>
          </div>
        )}
        {canManage && editingAssignee && (
          <div style={{ marginTop: 'var(--space-3)' }}>
            <SearchSelectField
              label="Assignee"
              id="taskAssignee"
              value={assigneeSelection}
              onChange={setAssigneeSelection}
              options={assignableUsers}
              placeholder="Leave blank to send back to Task Backlog"
            />
            <p className={styles.helpText}>
              Leave this blank to send the task back to the Task Backlog, unassigned. Past QA/Peer Review history stays
              attributed to whoever was assigned at the time - reassigning never rewrites it. A Peer Review, Escalation to
              PM, or Dependency Ticket already in progress keeps going to whoever it's currently routed to.
            </p>
            <div className={styles.actions}>
              <button className={`${styles.button} ${styles.buttonAccent}`} type="button" disabled={savingAssignee} onClick={handleSaveAssignee}>
                {savingAssignee ? 'Saving...' : 'Save Assignee'}
              </button>
              <button className={styles.buttonSecondary} type="button" disabled={savingAssignee} onClick={handleCancelEditAssignee}>
                Cancel
              </button>
            </div>
          </div>
        )}
        {task.isDefect && defectArtifacts.length > 0 && (
          <div style={{ marginTop: 'var(--space-2)' }}>
            <span className={styles.issueMeta}>Evidence: </span>
            <QaArtifactIcons artifacts={defectArtifacts} />
          </div>
        )}
        {canEditDefectScope && !editingDefectFields && (
          <div className={styles.actions} style={{ marginTop: 'var(--space-3)' }}>
            <button className={styles.buttonSecondary} type="button" onClick={() => setEditingDefectFields(true)}>
              Edit Defect Details
            </button>
          </div>
        )}
      </div>

      {canEditDefectScope && editingDefectFields && (
        <form onSubmit={handleSaveDefectFields} className={styles.card} style={{ marginBottom: 'var(--space-4)' }}>
          <h2 className={styles.pageSubtitle} style={{ margin: '0 0 var(--space-3)', fontWeight: 600 }}>
            Edit Defect Details
          </h2>
          <div className={styles.fieldGrid3}>
            <SearchSelectField
              label="Project"
              id="defectProject"
              required
              value={defectProject}
              onChange={(v) => { setDefectProject(v); setDefectModule(null); setDefectPhase(null); }}
              options={projects}
            />
            <SearchSelectField
              label="Module"
              id="defectModule"
              required
              value={defectModule}
              onChange={(v) => { setDefectModule(v); setDefectPhase(null); }}
              options={defectModules}
              disabled={!defectProject}
              placeholder="Select a Project first"
            />
            <SearchSelectField
              label="Phase"
              id="defectPhase"
              required
              value={defectPhase}
              onChange={setDefectPhase}
              options={defectPhases}
              disabled={!defectModule}
              placeholder="Select a Module first"
            />
          </div>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="defectTitleField">Title</label>
            <input
              className={styles.input}
              id="defectTitleField"
              required
              maxLength={TASK_TITLE_MAX_LENGTH}
              value={defectTitle}
              onChange={(e) => setDefectTitle(e.target.value)}
            />
          </div>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="defectDescription">Description</label>
            <RichTextEditor
              id="defectDescription"
              value={defectDescription}
              onChange={setDefectDescription}
              placeholder="Describe the defect..."
            />
          </div>
          <div className={styles.actions}>
            <button className={`${styles.button} ${styles.buttonAccent}`} type="submit" disabled={savingDefectFields}>
              {savingDefectFields ? 'Saving...' : 'Save Defect Details'}
            </button>
            <button className={styles.button} type="button" onClick={handleCancelEditDefectFields} disabled={savingDefectFields}>
              Cancel
            </button>
          </div>
        </form>
      )}

      <form onSubmit={handleSaveFields} className={styles.card} style={{ marginBottom: 'var(--space-4)' }}>
        <div className={styles.fieldGrid4}>
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
            <label className={styles.label} htmlFor="tdPriority">Priority</label>
            {canManage ? (
              <select
                className={styles.input}
                id="tdPriority"
                value={priority}
                onChange={(e) => setPriority(e.target.value)}
              >
                <option value="">Not Set</option>
                {TASK_PRIORITIES.map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
            ) : (
              <div>
                <Badge tone={priorityTone(task.priority)}>{priorityLabel(task.priority)}</Badge>
              </div>
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
              {formatDate(ticket.createdAt)}
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

      <div className={styles.card} style={{ marginBottom: 'var(--space-4)' }}>
        <h2 className={styles.pageSubtitle} style={{ margin: '0 0 var(--space-3)', fontWeight: 600 }}>
          Linked Defects
        </h2>
        {linkedDefects.length === 0 && (
          <div className={styles.empty}>No defects have been filed against this task.</div>
        )}
        {linkedDefects.map((defect) => (
          <div key={defect.id} style={{ padding: 'var(--space-3) 0', borderTop: '1px solid var(--color-border)' }}>
            <p style={{ margin: 0 }}>
              <Link href={`/tasks/${defect.id}`}>{defect.title}</Link> <StatusBadge status={defect.status} />
            </p>
            <p className={styles.issueMeta} style={{ margin: 'var(--space-1) 0 0' }}>
              Assignee: {defect.assigneeEmail} &middot; Filed by {defect.createdByEmail} &middot;{' '}
              {formatDate(defect.createdAt)}
            </p>
          </div>
        ))}
      </div>

      {isAssignee && isEscalated && (
        <div className={styles.card} style={{ marginBottom: 'var(--space-4)' }}>
          <h2 className={styles.pageSubtitle} style={{ margin: '0 0 var(--space-3)', fontWeight: 600 }}>
            Escalated to PM
          </h2>
          <p style={{ margin: 0 }}>
            QA escalated this task instead of approving or rejecting it. It's waiting in the PM Escalation queue -
            you can&apos;t resubmit it until PM reassigns it.
          </p>
        </div>
      )}

      {isAssignee && !hasPendingQaReview && !isEscalated && !task.peerReviewEnabled && (openDependencyTickets.length > 0 || openLinkedDefects.length > 0) && (
        <div className={styles.card} style={{ marginBottom: 'var(--space-4)' }}>
          <h2 className={styles.pageSubtitle} style={{ margin: '0 0 var(--space-3)', fontWeight: 600 }}>
            Submit for QA Testing
          </h2>
          {openDependencyTickets.length > 0 && (
            <div className={styles.error}>
              Cannot submit for QA - resolve the open dependency {openDependencyTickets.length === 1 ? 'ticket' : 'tickets'}{' '}
              {openDependencyTickets.map((t) => `#${t.id}`).join(', ')} first.
            </div>
          )}
          {openLinkedDefects.length > 0 && (
            <div className={styles.error} style={{ marginTop: openDependencyTickets.length > 0 ? 'var(--space-2)' : 0 }}>
              Cannot submit for QA - resolve the open linked {openLinkedDefects.length === 1 ? 'defect' : 'defects'}{' '}
              {openLinkedDefects.map((d) => `#${d.id}`).join(', ')} first.
            </div>
          )}
        </div>
      )}

      {isAssignee && !hasPendingQaReview && !isEscalated && !task.peerReviewEnabled && openDependencyTickets.length === 0 && openLinkedDefects.length === 0 && (
        <form onSubmit={handleSubmitForQa} className={styles.card} style={{ marginBottom: 'var(--space-4)' }}>
          <h2 className={styles.pageSubtitle} style={{ margin: '0 0 var(--space-3)', fontWeight: 600 }}>
            Submit for QA Testing
          </h2>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="tdResolution">Resolution</label>
            <RichTextEditor
              id="tdResolution"
              placeholder="Describe what was done / fixed"
              value={resolution}
              onChange={setResolution}
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

      {isAssignee && !hasPendingQaReview && !isEscalated && task.peerReviewEnabled && (
        <form onSubmit={handleSubmitForPeerReview} className={styles.card} style={{ marginBottom: 'var(--space-4)' }}>
          <h2 className={styles.pageSubtitle} style={{ margin: '0 0 var(--space-3)', fontWeight: 600 }}>
            Submit for Peer Review
          </h2>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="tdPeerResolution">Resolution</label>
            <RichTextEditor
              id="tdPeerResolution"
              placeholder="Describe what was done / fixed"
              value={resolution}
              onChange={setResolution}
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

      {canActOnQaReview && hasPendingQaReview && (
        <div className={styles.card} style={{ marginBottom: 'var(--space-4)' }}>
          <h2 className={styles.pageSubtitle} style={{ margin: '0 0 var(--space-3)', fontWeight: 600 }}>
            QA Review
          </h2>
          <p style={{ margin: 0, fontWeight: 600 }}>Resolution:</p>
          <RichTextDisplay value={latestQaReview.resolution} />
          {latestQaReview.artifacts.map((artifact) => (
            <p key={artifact.id} className={styles.issueMeta} style={{ margin: 'var(--space-1) 0 0' }}>
              Artifact: {artifact.type} &middot;{' '}
              <a href={artifact.url} target="_blank" rel="noreferrer">{artifact.url}</a>
            </p>
          ))}
          <p className={styles.issueMeta} style={{ margin: 'var(--space-1) 0 0' }}>
            Submitted by {latestQaReview.submittedByEmail} &middot;{' '}
            {formatDate(latestQaReview.submittedAt)} &middot; Round {latestQaReview.roundNumber}
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

          {!showRejectForm && !showEscalateForm && (
            <>
              <div className={styles.field} style={{ marginTop: 'var(--space-3)' }}>
                <label className={styles.label} htmlFor="tdApproveComment">Comment (optional)</label>
                <RichTextEditor
                  id="tdApproveComment"
                  placeholder="Add a note for the record (optional)"
                  value={approveComment}
                  onChange={setApproveComment}
                />
              </div>
              <div className={styles.actions}>
                <button className={`${styles.button} ${styles.buttonAccent}`} type="button" onClick={handleQaApprove} disabled={qaActionBusy}>
                  {qaActionBusy ? 'Working...' : 'Approve'}
                </button>
                <button className={styles.button} type="button" onClick={() => setShowRejectForm(true)} disabled={qaActionBusy}>
                  Reject
                </button>
                <button className={styles.button} type="button" onClick={() => setShowEscalateForm(true)} disabled={qaActionBusy}>
                  Escalate to PM
                </button>
              </div>
            </>
          )}

          {showRejectForm && (
            <form onSubmit={handleQaReject} style={{ marginTop: 'var(--space-3)' }}>
              <div className={styles.field}>
                <label className={styles.label} htmlFor="tdRejectComment">Rejection Comment</label>
                <RichTextEditor
                  id="tdRejectComment"
                  placeholder="Explain what's incorrect, unclear, or missing"
                  value={rejectComment}
                  onChange={setRejectComment}
                />
              </div>

              <label className={styles.label} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginTop: 'var(--space-3)' }}>
                <input
                  type="checkbox"
                  checked={createLinkedDefect}
                  onChange={(e) => setCreateLinkedDefect(e.target.checked)}
                />
                Create linked defect(s)
              </label>
              <p className={styles.helpText} style={{ marginTop: 0 }}>
                Optional - for issue(s) serious enough to need their own tracked ticket(s). Files one or more
                Defects against this task (via Create Defect) and blocks it from being resubmitted for QA until
                every one of them is resolved. Leave unchecked for a plain reject with just the comment above.
              </p>

              {createLinkedDefect && (
                <div style={{ padding: 'var(--space-3)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', marginBottom: 'var(--space-3)' }}>
                  <label className={styles.label}>Artifacts (optional)</label>
                  <p className={styles.helpText} style={{ marginTop: 0 }}>
                    Shared evidence attached to every defect created below - enter it once, not per defect.
                  </p>
                  {linkedDefectArtifacts.map((row, index) => (
                    <div key={index} className={styles.fieldGrid3} style={{ alignItems: 'end', marginBottom: 'var(--space-2)' }}>
                      <div className={styles.field}>
                        <label className={styles.label} htmlFor={`tdLinkedDefectArtifactType-${index}`}>Artifact Type</label>
                        <select
                          className={styles.select}
                          id={`tdLinkedDefectArtifactType-${index}`}
                          value={row.type}
                          onChange={(e) => updateLinkedDefectArtifactRow(index, 'type', e.target.value)}
                        >
                          <option value="" disabled>— Select artifact type —</option>
                          {QA_ARTIFACT_TYPES.filter(
                            (t) => t === row.type || !linkedDefectArtifacts.some((r) => r.type === t),
                          ).map((t) => <option key={t} value={t}>{t}</option>)}
                        </select>
                      </div>
                      <div className={styles.field}>
                        <label className={styles.label} htmlFor={`tdLinkedDefectArtifactUrl-${index}`}>Artifact URL</label>
                        <input
                          className={styles.input}
                          id={`tdLinkedDefectArtifactUrl-${index}`}
                          type="url"
                          placeholder="https://..."
                          value={row.url}
                          onChange={(e) => updateLinkedDefectArtifactRow(index, 'url', e.target.value)}
                        />
                      </div>
                      <div className={styles.field}>
                        <button className={styles.buttonSecondary} type="button" onClick={() => removeLinkedDefectArtifactRow(index)}>
                          Remove
                        </button>
                      </div>
                    </div>
                  ))}
                  <div className={styles.actions} style={{ marginBottom: 'var(--space-3)' }}>
                    <button className={styles.buttonSecondary} type="button" onClick={addLinkedDefectArtifactRow}>
                      + Add Artifact
                    </button>
                  </div>

                  {linkedDefectDrafts.map((draft, index) => (
                    <div
                      key={index}
                      style={{ padding: 'var(--space-3)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', marginBottom: 'var(--space-3)' }}
                    >
                      <div className={styles.actions} style={{ justifyContent: 'space-between', marginTop: 0 }}>
                        <strong>Defect {index + 1}</strong>
                        {linkedDefectDrafts.length > 1 && (
                          <button className={styles.buttonSecondary} type="button" onClick={() => removeLinkedDefectDraft(index)}>
                            Remove
                          </button>
                        )}
                      </div>
                      <div className={styles.field}>
                        <label className={styles.label} htmlFor={`tdLinkedDefectTitle-${index}`}>Defect Title</label>
                        <input
                          className={styles.input}
                          id={`tdLinkedDefectTitle-${index}`}
                          maxLength={TASK_TITLE_MAX_LENGTH}
                          value={draft.title}
                          onChange={(e) => updateLinkedDefectDraft(index, 'title', e.target.value)}
                          placeholder="Short, human-readable name for this defect"
                        />
                      </div>
                      <div className={styles.field}>
                        <label className={styles.label} htmlFor={`tdLinkedDefectDescription-${index}`}>Defect Description</label>
                        <RichTextEditor
                          id={`tdLinkedDefectDescription-${index}`}
                          value={draft.description}
                          onChange={(value) => updateLinkedDefectDraft(index, 'description', value)}
                          placeholder="Describe the defect..."
                        />
                      </div>
                      <div className={styles.fieldNarrow}>
                        <SearchSelectField
                          label="Assignee (Developer)"
                          id={`tdLinkedDefectAssignee-${index}`}
                          required
                          value={draft.assignee}
                          onChange={(value) => updateLinkedDefectDraft(index, 'assignee', value)}
                          options={developers}
                        />
                      </div>
                    </div>
                  ))}
                  <div className={styles.actions}>
                    <button className={styles.buttonSecondary} type="button" onClick={addLinkedDefectDraft}>
                      + Add another defect
                    </button>
                  </div>
                </div>
              )}

              <div className={styles.actions}>
                <button className={`${styles.button} ${styles.buttonAccent}`} type="submit" disabled={qaActionBusy}>
                  {qaActionBusy ? 'Working...' : 'Confirm Reject'}
                </button>
                <button
                  className={styles.button}
                  type="button"
                  onClick={() => {
                    setShowRejectForm(false);
                    resetLinkedDefectForm();
                  }}
                  disabled={qaActionBusy}
                >
                  Cancel
                </button>
              </div>
            </form>
          )}

          {showEscalateForm && (
            <form onSubmit={handleQaEscalate} style={{ marginTop: 'var(--space-3)' }}>
              <div className={styles.field}>
                <label className={styles.label} htmlFor="tdEscalateComment">Escalation Comment</label>
                <RichTextEditor
                  id="tdEscalateComment"
                  placeholder="Explain why this needs PM's attention instead of a straightforward pass/fail (e.g. resolution is unclear or unrelated to the task)"
                  value={escalateComment}
                  onChange={setEscalateComment}
                />
              </div>
              <div className={styles.actions}>
                <button className={`${styles.button} ${styles.buttonAccent}`} type="submit" disabled={qaActionBusy}>
                  {qaActionBusy ? 'Working...' : 'Confirm Escalation'}
                </button>
                <button className={styles.button} type="button" onClick={() => setShowEscalateForm(false)} disabled={qaActionBusy}>
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
          <p style={{ margin: 0, fontWeight: 600 }}>Resolution:</p>
          <RichTextDisplay value={latestQaReview.resolution} />
          {latestQaReview.artifacts.map((artifact) => (
            <p key={artifact.id} className={styles.issueMeta} style={{ margin: 'var(--space-1) 0 0' }}>
              Artifact: {artifact.type} &middot;{' '}
              <a href={artifact.url} target="_blank" rel="noreferrer">{artifact.url}</a>
            </p>
          ))}
          <p className={styles.issueMeta} style={{ margin: 'var(--space-1) 0 0' }}>
            Submitted by {latestQaReview.submittedByEmail} &middot;{' '}
            {formatDate(latestQaReview.submittedAt)} &middot; Round {latestQaReview.roundNumber}
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
            <>
              <div className={styles.field} style={{ marginTop: 'var(--space-3)' }}>
                <label className={styles.label} htmlFor="tdPeerApproveComment">Comment (optional)</label>
                <RichTextEditor
                  id="tdPeerApproveComment"
                  placeholder="Add a note for the record (optional)"
                  value={approveComment}
                  onChange={setApproveComment}
                />
              </div>
              <div className={styles.actions}>
                <button className={`${styles.button} ${styles.buttonAccent}`} type="button" onClick={handlePeerReviewApprove} disabled={qaActionBusy}>
                  {qaActionBusy ? 'Working...' : 'Approve'}
                </button>
                <button className={styles.button} type="button" onClick={() => setShowRejectForm(true)} disabled={qaActionBusy}>
                  Reject
                </button>
              </div>
            </>
          )}

          {showRejectForm && (
            <form onSubmit={handlePeerReviewReject} style={{ marginTop: 'var(--space-3)' }}>
              <div className={styles.field}>
                <label className={styles.label} htmlFor="tdPeerRejectComment">Rejection Comment</label>
                <RichTextEditor
                  id="tdPeerRejectComment"
                  placeholder="Explain what's incorrect, unclear, or missing"
                  value={rejectComment}
                  onChange={setRejectComment}
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
