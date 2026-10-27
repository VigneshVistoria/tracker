import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import AppShell from '../../components/AppShell';
import SearchSelectField from '../../components/SearchSelectField';
import Table from '../../components/ui/Table';
import RichTextEditor from '../../components/ui/RichTextEditor';
import RichTextDisplay from '../../components/ui/RichTextDisplay';
import Badge from '../../components/ui/Badge';
import styles from '../../styles/issues.module.css';
import { apiFetch, apiUpload } from '../../lib/api';
import { useToast } from '../../lib/toast';
import { DEVELOPER_EQUIVALENT_ROLES } from '../../lib/status';
import { isQaReviewOverdue, isOverdueTask, effectiveDueDate } from '../../lib/developerTaskStats';
import { stripHtmlForPreview } from '../../lib/richText';
import { TASK_TITLE_MAX_LENGTH } from '../../lib/taskTitle';
import { TASK_DEPENDENCY_TICKET_TITLE_MAX_LENGTH } from '../../lib/taskDependencyTicketTitle';
import { TASK_PRIORITIES, priorityTone, priorityLabel, statusLabel, statusBadgeStyle } from '../../lib/taskTableShared';
import { formatDate, formatDateTime } from '../../lib/formatDate';
import JunkReasonModal from '../../components/JunkReasonModal';
import RevertQaDecisionModal from '../../components/RevertQaDecisionModal';
import SendBackToDeveloperModal from '../../components/SendBackToDeveloperModal';
import ReturnToQaPanel from '../../components/ReturnToQaPanel';
import ScreenshotAttach from '../../components/ScreenshotAttach';
import ScreenshotUploader from '../../components/ScreenshotUploader';
import ReasonHint from '../../components/ReasonHint';
import ChangeDependencyOwnerModal from '../../components/ChangeDependencyOwnerModal';
import { Image, GitPullRequest, Package, FileText, Workflow, FileBarChart, Video, Paperclip, ClipboardList, Bug, Globe, RefreshCw, CheckCircle2, AlertTriangle, ArrowRight } from 'lucide-react';
import { useConfirm } from '../../lib/confirm';
import LoadingState from '../../components/ui/LoadingState';
import ReviewTimeline from '../../components/ReviewTimeline';
import Breadcrumbs from '../../components/ui/Breadcrumbs';
import Avatar from '../../components/ui/Avatar';
import DefectScreenshots from '../../components/DefectScreenshots';
import { redirectToSignIn } from '../../lib/session';

const VIEW_ROLES = ['admin', 'executive', 'program_manager', 'qa', 'client', ...DEVELOPER_EQUIVALENT_ROLES];
// Admin and Executive both get full view access (VIEW_ROLES above) but
// neither can edit - matches the backend's canEdit()/MUTATE_ROLES, which
// is Program Manager only (plus the task's own Assignee, handled
// separately below via isAssignee).
const MANAGE_ROLES = ['program_manager'];
// Backend mirror: TasksService.canSeeJunk() (task page and junk history)
// and ROLES_ALLOWED_TO_MANAGE_JUNK (mark/restore - Program Manager only).
const JUNK_VIEW_ROLES = ['admin', 'executive', 'program_manager'];

// Status is fully auto-computed by task events (create, QA submit/
// approve/reject) for every value except Hold/Closed, which Program
// Manager or Admin can force from any current status via the dedicated
// panel below (TasksService.holdTask()/releaseTask()/closeTask()/
// reopenTask()) - see canManageHoldClosed. Every other value is still
// just a read-only badge (see StatusBadge below).
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
  // --ds-* tokens directly (not a new legacy --color-* alias) per
  // STYLE.md - see taskTableShared.js's LEGEND_ITEMS comment. Mirrors
  // that file's STATUS_BADGE_STYLE - keep both in sync by hand.
  Hold: { bg: 'var(--ds-color-info-tint)', fg: 'var(--ds-color-info-dark)' },
  Closed: { bg: 'var(--ds-color-gray-300)', fg: 'var(--ds-text-primary)' },
  // PM review gate (2026-10-13). Mirrors taskTableShared.js's STATUS_BADGE_STYLE.
  'Pending PM Review': { bg: 'var(--ds-color-warning-tint)', fg: 'var(--ds-color-warning-dark)' },
  'PM Feedback': { bg: 'var(--ds-color-error-tint)', fg: 'var(--ds-color-error-dark)' },
  // Return to QA (2026-10-18). Mirrors taskTableShared.js's STATUS_BADGE_STYLE.
  'Returned to QA': { bg: 'var(--ds-color-primary-100)', fg: 'var(--ds-color-primary-800)' },
};

function StatusBadge({ status }) {
  const color = STATUS_COLOR[status] || { bg: 'var(--color-slate-tint)', fg: 'var(--color-ink-soft)' };
  return (
    <span className={styles.badge} style={{ background: color.bg, color: color.fg }}>
      {statusLabel(status)}
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

// One line of the "Dependency history" list, after the actor's name.
function dependencyHistoryText(h) {
  const ticket = `"${h.ticketTitle || `#${h.ticketId}`}"`;
  switch (h.action) {
    case 'task_dependency_ticket_created':
      return `raised ${ticket}${h.ownerName ? ` for ${h.ownerName}` : ''}`;
    case 'task_dependency_ticket_title_updated':
      return `renamed "${h.previousTitle}" to "${h.title}"`;
    case 'task_dependency_ticket_owner_changed':
      return `changed the owner of ${ticket} from ${h.previousOwnerName} to ${h.ownerName}`;
    case 'task_dependency_ticket_resolved':
      return `resolved ${ticket}`;
    default:
      return `updated ${ticket}`;
  }
}

function userToOption(u) {
  return { id: u.id, name: u.fullName || u.email };
}

// Soft duplicate-title nudge for the batch-reject "Create linked
// defect(s)" panel - deliberately approximate (word-overlap, not an
// external search/fuzzy-match library) since this is a heads-up for QA to
// glance at, not a hard block: worded-differently duplicates will still
// slip through, and unrelated defects that happen to share common words
// can still trigger it. Titles under 2 distinct words are skipped
// entirely - too short to compare meaningfully without just matching on
// one common word.
function titleWords(title) {
  return new Set((title || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean));
}

function titlesLookSimilar(a, b) {
  const wordsA = titleWords(a);
  const wordsB = titleWords(b);
  const smaller = Math.min(wordsA.size, wordsB.size);
  if (smaller < 2) return false;
  const overlap = [...wordsA].filter((w) => wordsB.has(w)).length;
  return overlap / smaller >= 0.7;
}

// Recently-used artifact URLs for the batch-reject "Create linked
// defect(s)" panel - QA frequently points several defects (or several
// separate rejections in a day) at the same staging link/build/test
// report, so this saves retyping/copy-paste. Deliberately localStorage,
// not the per-task sessionStorage draft above - this is a cross-task,
// cross-session convenience list, not in-progress work. A plain
// <datalist> (native browser autocomplete) rather than a custom dropdown,
// to keep this a small addition rather than a new UI component.
const ARTIFACT_URL_HISTORY_KEY = 'qaArtifactUrlHistory';
const ARTIFACT_URL_HISTORY_LIMIT = 8;
const ARTIFACT_URL_HISTORY_DATALIST_ID = 'qaArtifactUrlHistoryOptions';

function loadArtifactUrlHistory() {
  try {
    const saved = JSON.parse(localStorage.getItem(ARTIFACT_URL_HISTORY_KEY) || '[]');
    return Array.isArray(saved) ? saved : [];
  } catch {
    return [];
  }
}

function recordArtifactUrlHistory(urls) {
  const existing = loadArtifactUrlHistory();
  const merged = [...urls, ...existing].filter((url, index, all) => url && all.indexOf(url) === index);
  localStorage.setItem(ARTIFACT_URL_HISTORY_KEY, JSON.stringify(merged.slice(0, ARTIFACT_URL_HISTORY_LIMIT)));
  return merged.slice(0, ARTIFACT_URL_HISTORY_LIMIT);
}

export default function TaskDetailPage() {
  const confirmAction = useConfirm();
  const router = useRouter();
  const { id } = router.query;
  const { showToast } = useToast();

  const [user, setUser] = useState(null);
  const [task, setTask] = useState(null);
  const [activeTab, setActiveTab] = useState('overview');
  const [tickets, setTickets] = useState([]);
  // "Change owner" dialog (PM/Admin) - the ticket being moved, or null.
  const [ownerChangeTicket, setOwnerChangeTicket] = useState(null);
  // Audited changes to this task's dependency tickets, oldest first.
  const [dependencyHistory, setDependencyHistory] = useState([]);
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
  // Task Description edit (Program Manager, or the task's Developer/
  // Designer/DevOps Assignee - see canEditDescription) - allowed at any status, no stage-based lock,
  // via the general PATCH /tasks/:id (TasksService.update() already lets
  // PM through regardless of status; the audit entry it writes already
  // records the full previous task alongside the submitted payload, so
  // old vs new description is captured with no extra backend work).
  const [editingDescription, setEditingDescription] = useState(false);
  const [descriptionDraft, setDescriptionDraft] = useState('');
  const [savingDescription, setSavingDescription] = useState(false);
  // Task Title edit - same PM-only, any-status rules as Description above.
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const [savingTitle, setSavingTitle] = useState(false);
  // Module/Phase edit - same PM-only, any-status rules as Title above.
  // Project stays fixed (only the defect form can move a task across
  // projects), so Module options are this task's project's active
  // Modules and Phase options follow the chosen Module.
  const [editingModulePhase, setEditingModulePhase] = useState(false);
  const [moduleDraftId, setModuleDraftId] = useState('');
  const [phaseDraftId, setPhaseDraftId] = useState('');
  const [moduleOptions, setModuleOptions] = useState([]);
  const [phaseOptions, setPhaseOptions] = useState([]);
  const [savingModulePhase, setSavingModulePhase] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const [estimatedHours, setEstimatedHours] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [priority, setPriority] = useState('');

  // QA Review Due Date - separate field/endpoint from Estimated Hours/Due
  // Date above (PATCH /tasks/:id/qa-review-due-date, not UpdateTaskDto),
  // auto-set on QA/Peer Review submission, manually adjustable by QA/PM/
  // Admin only.
  const [qaReviewDueDateDraft, setQaReviewDueDateDraft] = useState('');
  const [savingQaReviewDueDate, setSavingQaReviewDueDate] = useState(false);

  const [ticketTitle, setTicketTitle] = useState('');
  const [ticketDescription, setTicketDescription] = useState('');
  // Inline "Edit Title" on an existing dependency ticket - one at a time,
  // keyed by ticket id (see TaskDependencyTicketsService.updateTitle()).
  const [editingTicketId, setEditingTicketId] = useState(null);
  const [ticketTitleDraft, setTicketTitleDraft] = useState('');
  const [savingTicketTitle, setSavingTicketTitle] = useState(false);
  // Team Tasks' dependency cards link here as /tasks/:id#dependency-:ticketId
  // (a ticket has no page of its own) - once the tickets have rendered,
  // scroll to and highlight that ticket. Done by hand rather than relying
  // on the browser's own hash scroll, which fires before the async ticket
  // list exists. Only once per page load, so later re-fetches (resolve,
  // edit title) don't keep jumping the page back.
  const [highlightedTicketId, setHighlightedTicketId] = useState(null);
  const ticketHashHandled = useRef(false);
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
  // Existing defects QA/PM linked as blocking this task (TaskBlockingDefect),
  // and - on a defect's own page - the tasks it blocks. Separate from
  // linkedDefects above (spun off a QA rejection), but both feed the same
  // submit gate.
  const [blockingDefects, setBlockingDefects] = useState([]);
  const [blockedTasks, setBlockedTasks] = useState([]);
  const [blockingCandidates, setBlockingCandidates] = useState([]);
  const [blockingSelection, setBlockingSelection] = useState(null);
  const [savingBlockingLink, setSavingBlockingLink] = useState(false);
  const [createLinkedDefect, setCreateLinkedDefect] = useState(false);
  const [linkedDefectDrafts, setLinkedDefectDrafts] = useState([{ title: '', description: '', assignee: null }]);
  const [linkedDefectArtifacts, setLinkedDefectArtifacts] = useState([]);
  // Loaded once on mount (not per-task) - see loadArtifactUrlHistory/
  // recordArtifactUrlHistory above.
  const [artifactUrlHistory, setArtifactUrlHistory] = useState([]);

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
  // Bumped when Return to QA changes a defect's screenshots, to reload them.
  const [screenshotsVersion, setScreenshotsVersion] = useState(0);
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
  // PM review gate (2026-10-13).
  const [pmToQaComment, setPmToQaComment] = useState('');
  const [pmSendBackComment, setPmSendBackComment] = useState('');
  // Confirm clicked with no feedback - shows the hint under the box.
  const [pmSendBackAttempted, setPmSendBackAttempted] = useState(false);
  const [showPmSendBack, setShowPmSendBack] = useState(false);
  const [pmBusy, setPmBusy] = useState(false);
  // QA's own evidence artifacts - optional, shared between Approve and
  // Reject since only one of those actions is taken per round.
  const [qaArtifacts, setQaArtifacts] = useState([]);
  // Screenshots for the QA decision (approve/reject/escalate) - uploaded
  // to the decided round right after the decision (2026-10-18).
  const [qaShots, setQaShots] = useState([]);
  // One screenshot list per linked-defect row (same order as
  // linkedDefectDrafts) - kept out of the text draft, images can't go there.
  const [linkedDefectShots, setLinkedDefectShots] = useState([]);
  // Screenshots already attached to decisions, shown in Review history.
  const [decisionShots, setDecisionShots] = useState([]);
  // Uploads that failed after a decision went through - kept for Retry.
  const [failedShotUploads, setFailedShotUploads] = useState([]);
  // Peer Review reviewer picker - only used when task.peerReviewEnabled.
  const [peerReviewer, setPeerReviewer] = useState(null);
  // Review Routing card - the Peer Review checkbox on an already-assigned
  // task, saved through its own dedicated endpoint (see handleSavePeerReviewFlag).
  const [peerReviewEnabled, setPeerReviewEnabled] = useState(false);
  const [savingPeerReviewFlag, setSavingPeerReviewFlag] = useState(false);
  // Hold/Close/Release panel - see handleHold/handleRelease/handleClose.
  const [savingHoldClosed, setSavingHoldClosed] = useState(false);
  const [junkModalOpen, setJunkModalOpen] = useState(false);
  const [revertModalOpen, setRevertModalOpen] = useState(false);
  const [sendBackModalOpen, setSendBackModalOpen] = useState(false);
  const [junkHistory, setJunkHistory] = useState([]);
  const [restoringJunk, setRestoringJunk] = useState(false);

  const loadTickets = () => {
    apiFetch(`/task-dependency-tickets?parentTaskId=${id}`).then(setTickets).catch(() => {});
    loadDependencyHistory();
  };

  const loadDependencyHistory = () => {
    apiFetch(`/task-dependency-tickets/history?parentTaskId=${id}`).then(setDependencyHistory).catch(() => setDependencyHistory([]));
  };

  const loadLinkedDefects = () => {
    apiFetch(`/tasks/${id}/linked-defects`).then(setLinkedDefects).catch(() => {});
  };

  const loadBlockingLinks = () => {
    apiFetch(`/tasks/${id}/blocking-defects`).then(setBlockingDefects).catch(() => {});
    apiFetch(`/tasks/${id}/blocked-tasks`).then(setBlockedTasks).catch(() => {});
  };

  // On a regular task, pick a Defect to link; on a defect, pick a Task it
  // blocks. Either way the link is stored task -> defect.
  const handleLinkBlocking = async () => {
    if (!blockingSelection) return;
    setSavingBlockingLink(true);
    const taskId = task.isDefect ? blockingSelection.id : task.id;
    const defectId = task.isDefect ? task.id : blockingSelection.id;
    try {
      await apiFetch(`/tasks/${taskId}/blocking-defects`, { method: 'POST', body: JSON.stringify({ defectId }) });
      showToast(task.isDefect ? `Now blocks Task #${taskId}` : `Blocked by Defect #${defectId}`, 'success');
      setBlockingSelection(null);
      loadBlockingLinks();
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setSavingBlockingLink(false);
    }
  };

  const handleUnlinkBlocking = async (taskId, defectId) => {
    try {
      await apiFetch(`/tasks/${taskId}/blocking-defects/${defectId}`, { method: 'DELETE' });
      showToast(`Unlinked Defect #${defectId} from Task #${taskId}`, 'success');
      loadBlockingLinks();
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  useEffect(() => {
    if (ticketHashHandled.current || tickets.length === 0) return;
    const match = window.location.hash.match(/^#dependency-(\d+)$/);
    if (!match) return;
    const ticketId = Number(match[1]);
    const el = document.getElementById(`dependency-${ticketId}`);
    if (!el) return;
    ticketHashHandled.current = true;
    setHighlightedTicketId(ticketId);
    el.scrollIntoView({ block: 'center' });
    el.focus({ preventScroll: true });
  }, [tickets, loading]);

  const handleSaveTicketTitle = async (ticketId) => {
    if (!ticketTitleDraft.trim()) {
      showToast('Dependency Title is required.', 'error');
      return;
    }
    setSavingTicketTitle(true);
    try {
      await apiFetch(`/task-dependency-tickets/${ticketId}/title`, {
        method: 'PATCH',
        body: JSON.stringify({ title: ticketTitleDraft.trim() }),
      });
      showToast('Dependency title updated', 'success');
      setEditingTicketId(null);
      loadTickets();
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setSavingTicketTitle(false);
    }
  };

  // Errors are thrown back to ChangeDependencyOwnerModal, which shows them
  // in place and stays open.
  const handleChangeTicketOwner = async (ownerUserId) => {
    const updated = await apiFetch(`/task-dependency-tickets/${ownerChangeTicket.id}/owner`, {
      method: 'PATCH',
      body: JSON.stringify({ ownerUserId }),
    });
    setOwnerChangeTicket(null);
    showToast(`Dependency owner changed to ${updated.ownerName || updated.ownerEmail}`, 'success');
    loadTickets();
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
      redirectToSignIn(router);
      return;
    }
    const parsed = JSON.parse(storedUser);
    if (!VIEW_ROLES.includes(parsed.role)) {
      router.replace('/dashboard');
      return;
    }
    setUser(parsed);
    setArtifactUrlHistory(loadArtifactUrlHistory());
    apiFetch('/users/assignable?role=developer').then((rows) => setDevelopers(rows.map((u) => ({ ...userToOption(u), role: u.role })))).catch(() => {});
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
    if (!editingModulePhase || !task) return;
    apiFetch(`/modules?projectId=${task.projectId}`).then(setModuleOptions).catch(() => setModuleOptions([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingModulePhase, task?.projectId]);

  useEffect(() => {
    if (!editingModulePhase || !moduleDraftId) {
      setPhaseOptions([]);
      return;
    }
    apiFetch(`/phases?moduleId=${moduleDraftId}`).then(setPhaseOptions).catch(() => setPhaseOptions([]));
  }, [editingModulePhase, moduleDraftId]);

  useEffect(() => {
    if (!user || !id || !JUNK_VIEW_ROLES.includes(user.role)) return;
    apiFetch(`/tasks/${id}/junk-history`).then(setJunkHistory).catch(() => setJunkHistory([]));
  }, [user, id, task?.status]);

  useEffect(() => {
    if (!user || !id) return;
    setLoading(true);
    setError('');
    Promise.all([
      apiFetch(`/tasks/${id}`),
      apiFetch(`/task-dependency-tickets?parentTaskId=${id}`),
      apiFetch(`/tasks/${id}/qa-reviews`),
      apiFetch(`/tasks/${id}/linked-defects`),
      apiFetch(`/tasks/${id}/blocking-defects`),
      apiFetch(`/tasks/${id}/blocked-tasks`),
    ])
      .then(([t, ticketList, reviewList, linkedDefectList, blockingDefectList, blockedTaskList]) => {
        setTask(t);
        setEstimatedHours(t.estimatedHours ?? '');
        setDueDate(t.dueDate ?? '');
        setQaReviewDueDateDraft(t.qaReviewDueDate ?? '');
        setPriority(t.priority ?? '');
        setPeerReviewEnabled(!!t.peerReviewEnabled);
        setDefectProject({ id: t.projectId, name: t.projectName });
        setDefectModule({ id: t.moduleId, name: t.moduleName });
        setDefectPhase({ id: t.phaseId, name: t.phaseName });
        setDefectTitle(t.title);
        setDefectDescription(t.description);
        setDescriptionDraft(t.description);
        setTitleDraft(t.title);
        setAssigneeSelection(t.assigneeUserId ? { id: t.assigneeUserId, name: t.assigneeFullName || t.assigneeEmail } : null);
        setTickets(ticketList);
        loadDependencyHistory();
        setQaReviews(reviewList);
        setLinkedDefects(linkedDefectList);
        setBlockingDefects(blockingDefectList);
        setBlockedTasks(blockedTaskList);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, id]);

  useEffect(() => {
    if (!task?.isDefect) return;
    apiFetch(`/tasks/${task.id}/defect-artifacts`).then(setDefectArtifacts).catch(() => setDefectArtifacts([]));
  }, [task?.id, task?.isDefect]);

  // Screenshots attached to QA decisions, for Review history.
  useEffect(() => {
    if (!task?.id) return;
    apiFetch(`/tasks/${task.id}/qa-review-attachments`).then(setDecisionShots).catch(() => setDecisionShots([]));
  }, [task?.id]);

  // Backend mirror: ROLES_ALLOWED_TO_LINK_BLOCKING_DEFECTS (TasksService).
  const canLinkBlocking = !!user && ['qa', 'program_manager'].includes(user.role);
  useEffect(() => {
    if (!task || !canLinkBlocking) return;
    apiFetch(`/tasks/blocking-link-candidates?kind=${task.isDefect ? 'tasks' : 'defects'}`)
      .then((rows) => setBlockingCandidates(rows.map((r) => ({ id: r.id, name: `#${r.id} - ${r.title} (${statusLabel(r.status)})` }))))
      .catch(() => setBlockingCandidates([]));
  }, [task?.id, task?.isDefect, canLinkBlocking]);

  // QA-rejection draft (comment + linked-defect batch) - mirrored into
  // sessionStorage, not just component state, so an accidental reload or
  // back-navigation mid-batch doesn't silently lose it before Confirm
  // Reject has actually run. Deliberately sessionStorage, not
  // localStorage - nothing here is a real record until submitted, so it
  // only needs to survive normal in-tab use, not a browser restart.
  // Scoped per task id so switching to review a different task's
  // rejection never shows another task's stale draft. qaArtifacts (QA's
  // own evidence, shared with Approve/Escalate) is deliberately excluded.
  const rejectDraftKey = id ? `qaRejectDraft:${id}` : null;
  const [rejectDraftHydrated, setRejectDraftHydrated] = useState(false);

  useEffect(() => {
    setRejectDraftHydrated(false);
    if (!rejectDraftKey) return;
    const saved = sessionStorage.getItem(rejectDraftKey);
    if (saved) {
      try {
        const draft = JSON.parse(saved);
        setRejectComment(draft.rejectComment || '');
        setCreateLinkedDefect(!!draft.createLinkedDefect);
        setLinkedDefectDrafts(
          Array.isArray(draft.linkedDefectDrafts) && draft.linkedDefectDrafts.length > 0
            ? draft.linkedDefectDrafts
            : [{ title: '', description: '', assignee: null }],
        );
        setLinkedDefectArtifacts(Array.isArray(draft.linkedDefectArtifacts) ? draft.linkedDefectArtifacts : []);
        setShowRejectForm(true);
      } catch {
        sessionStorage.removeItem(rejectDraftKey);
      }
    }
    setRejectDraftHydrated(true);
  }, [rejectDraftKey]);

  useEffect(() => {
    if (!rejectDraftKey || !rejectDraftHydrated) return;
    const isEmpty =
      !stripHtmlForPreview(rejectComment).trim() &&
      !createLinkedDefect &&
      linkedDefectArtifacts.length === 0 &&
      linkedDefectDrafts.length === 1 &&
      !linkedDefectDrafts[0].title.trim() &&
      !stripHtmlForPreview(linkedDefectDrafts[0].description).trim() &&
      !linkedDefectDrafts[0].assignee;
    if (isEmpty) {
      sessionStorage.removeItem(rejectDraftKey);
      return;
    }
    sessionStorage.setItem(
      rejectDraftKey,
      JSON.stringify({ rejectComment, createLinkedDefect, linkedDefectDrafts, linkedDefectArtifacts }),
    );
  }, [rejectDraftKey, rejectDraftHydrated, rejectComment, createLinkedDefect, linkedDefectDrafts, linkedDefectArtifacts]);

  if (!user || loading) {
    return (
      <AppShell>
        <LoadingState />
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

  // A Junk ticket is frozen for everyone (the backend refuses every
  // change) - only the Junk card's Restore is offered.
  const isJunk = task.status === 'Junk';
  // The backend refuses link/unlink on a Junk ticket (assertNotJunk).
  const canChangeBlockingLinks = canLinkBlocking && !isJunk;
  const isProgramManager = MANAGE_ROLES.includes(user.role);
  const canManage = isProgramManager && !isJunk;
  // Backend mirror: TaskDependencyTicketsService.changeOwner().
  const canChangeDependencyOwner = (user.role === 'program_manager' || user.role === 'admin') && !isJunk;
  const isAssignee = task.assigneeUserId === user.id;
  const canEditFields = (canManage || isAssignee) && !isJunk;
  const estimatedHoursLocked = task.estimatedHours != null && !canManage;
  // Due Date: one-time entry for the Assignee, same lock pattern as
  // E.Hrs - Program Manager can always re-edit it, no lock applies to PM.
  const dueDateLocked = task.dueDate != null && !canManage;
  // Narrow exception to Admin's usual view-only access to tasks - Admin
  // may set/edit only the Peer Review checkbox (via its own dedicated
  // endpoint below), nothing else on this page.
  // Backend mirror: TasksService.assertPeerReviewAllowed() - not offered on
  // a defect, unless it's already on (so it can still be switched off).
  const canManagePeerReviewFlag = (canManage || user.role === 'admin') && !isJunk && (!task.isDefect || !!task.peerReviewEnabled);
  // Backend mirror: ROLES_ALLOWED_TO_SET_HOLD_CLOSED (TasksController) -
  // Program Manager or Admin only, same narrow exception shape as
  // canManagePeerReviewFlag above.
  const canManageHoldClosed = (canManage || user.role === 'admin') && !isJunk;
  // Backend mirror: TaskQaReviewsService.revertDecision() + the controller's
  // ROLES_ALLOWED_TO_REVERT_QA_DECISION - PM/Admin, latest round only, a
  // QA approve/reject, and the task still exactly where it left it.
  const latestRound = qaReviews[0];
  const canRevertQaDecision =
    ['program_manager', 'admin'].includes(user.role) &&
    !isJunk &&
    latestRound?.reviewType === 'qa' &&
    ((latestRound.status === 'rejected' && task.status === 'Failed') || (latestRound.status === 'approved' && task.status === 'Pass'));
  // Backend mirror: ROLES_ALLOWED_TO_SET_QA_REVIEW_DUE_DATE
  // (TasksController) - QA, Program Manager, or Admin only.
  const canEditQaReviewDueDate = (user.role === 'qa' || canManage || user.role === 'admin') && !isJunk;
  // Backend mirror: TasksService.canEdit()'s isDefect/createdByUserId
  // branch - only Program Manager or the QA who raised this defect may
  // edit its Project/Module/Phase/Description.
  // Description: PM, or a Developer/Designer/DevOps assigned to the task
  // (mirrors the isDeveloperAssignee exception in TasksService.update()).
  const canEditDescription = !isJunk && (canManage || (isAssignee && DEVELOPER_EQUIVALENT_ROLES.includes(user.role)));
  const canEditDefectScope = !isJunk && task.isDefect && (canManage || task.createdByUserId === user.id);

  const latestQaReview = qaReviews[0];
  const hasPendingQaReview = latestQaReview?.status === 'pending';
  const isQa = user.role === 'qa';
  // Backend mirror: TasksService.assertReviewDecidable() - a pending round
  // on a Held or Closed task waits until the PM releases/reopens it.
  const isReviewPaused = task.status === 'Hold' || task.status === 'Closed';
  // Backend mirror: TasksService.assertSubmittable() - only a task still
  // being worked on can be submitted for QA or Peer Review.
  // Backend mirror: TasksService.assertNotAlreadyApproved() - once the
  // latest decided round (QA or Peer Review) is approved, the task can't
  // be resubmitted whatever its status; a re-check needs a PM/QA reopen.
  // PM review rounds are a gate before QA, never the task's verdict.
  const latestDecidedReview = qaReviews.find((r) => r.status !== 'pending' && r.reviewType !== 'pm');
  const isAlreadyApproved = latestDecidedReview?.status === 'approved';
  const canSubmitForReview =
    !isAlreadyApproved &&
    !['Hold', 'Closed', 'Pass', 'Junk', 'Released - No Showstoppers', 'Released - With Showstoppers', 'Returned to QA'].includes(task.status);
  // Backend mirror: TaskQaReviewsService.submit()/PeerReviewsService.
  // submit() - a defect always goes to QA, whatever its Peer Review flag.
  const usesPeerReview = !!task.peerReviewEnabled && !task.isDefect;
  // Backend mirror: TaskQaReviewsService.approve()/reject()'s isDefect
  // check - a defect's QA panel is only actionable by whoever raised it,
  // not any QA teammate - and findPendingRound(), which refuses a pending
  // Peer Review round (that belongs to its picked reviewer, never QA).
  const canActOnQaReview =
    isQa && latestQaReview?.reviewType === 'qa' && !isReviewPaused && (!task.isDefect || task.createdByUserId === user.id);
  // PM review gate (2026-10-13). Backend mirror: PmReviewsController's
  // PM_REVIEW_ROLES + PmReviewsService.loadDecidable() - PM/Admin, a
  // pending 'pm' round, the task waiting for it, not Hold/Closed.
  const isPmRound = latestQaReview?.reviewType === 'pm';
  const canActOnPmReview =
    ['program_manager', 'admin'].includes(user.role) && isPmRound && hasPendingQaReview && task.status === 'Pending PM Review' && !isReviewPaused;
  // The PM's latest send-back, shown to the developer while the task is
  // in PM Feedback - from the PM review gate (a rejected 'pm' round) or
  // pulled back from QA before QA decided it (a 'withdrawn' round).
  const latestPmSendBack =
    task.status === 'PM Feedback' ? qaReviews.find((r) => (r.reviewType === 'pm' && r.status === 'rejected') || r.status === 'withdrawn') : null;
  const pmSendBackFromQa = latestPmSendBack?.status === 'withdrawn';
  // Backend mirror: TaskQaReviewsService.sendBackFromQa() + the controller's
  // ROLES_ALLOWED_TO_SEND_BACK_FROM_QA - PM/Admin, a task (not a defect)
  // waiting for QA with a pending QA round. Picking another developer is
  // Program Manager only.
  const canSendBackFromQa =
    ['program_manager', 'admin'].includes(user.role) &&
    !isJunk &&
    !task.isDefect &&
    ['Feedback', 'Re-Feedback'].includes(task.status) &&
    latestQaReview?.status === 'pending' &&
    latestQaReview?.reviewType === 'qa';
  // Backend mirror: TaskQaReviewsService.submit()/PeerReviewsService.
  // submit()'s isEscalated guard - the Assignee can't resubmit either way
  // until PM reassigns it from the Escalations queue.
  const isEscalated = task.status === 'Escalated';
  const isPeerReviewer = latestQaReview?.reviewType === 'peer' && latestQaReview?.reviewerUserId === user.id;
  const canActOnPeerReview = isPeerReviewer && !isReviewPaused;
  // "What needs me on this task" - mirrors the exact conditions of the
  // action cards below, so the banner can never point at a form that
  // isn't rendered for this user.
  const pendingAction = (() => {
    if (canActOnPmReview) {
      return { tone: 'info', icon: ClipboardList, title: 'Waiting for PM review', detail: 'Send it to QA, or back to the developer with feedback.', cta: 'Review now', target: 'pm-review' };
    }
    if (isAssignee && latestPmSendBack) {
      return {
        tone: 'error',
        icon: AlertTriangle,
        title: 'PM feedback',
        detail: pmSendBackFromQa
          ? 'The Program Manager took this back from QA before review - see their reason below, refine it, and submit again.'
          : 'The Program Manager sent this back - see their feedback below, refine it, and submit again.',
        cta: 'See feedback',
        target: 'task-pm-feedback',
      };
    }
    if (isAssignee && hasPendingQaReview && isPmRound) {
      return { tone: 'neutral', icon: CheckCircle2, title: 'With the Program Manager', detail: 'A PM reviews it before QA - you\'ll see the outcome here.' };
    }
    if (canActOnQaReview && hasPendingQaReview) {
      return { tone: 'info', icon: ClipboardList, title: 'Waiting for your QA review', detail: 'Approve, reject or escalate this round.', cta: 'Review now', target: 'task-action-qa-review' };
    }
    if (canActOnPeerReview && hasPendingQaReview) {
      return { tone: 'info', icon: ClipboardList, title: 'Waiting for your peer review', detail: 'Approve or send this round back.', cta: 'Review now', target: 'task-action-peer-review' };
    }
    if (isPeerReviewer && hasPendingQaReview && isReviewPaused) {
      return { tone: 'neutral', icon: CheckCircle2, title: 'Peer review paused', detail: `This task is ${task.status === 'Hold' ? 'on Hold' : 'Closed'} - you can review it once a Program Manager ${task.status === 'Hold' ? 'releases' : 'reopens'} it.` };
    }
    if (isAssignee && isEscalated) {
      return { tone: 'warning', icon: AlertTriangle, title: 'With the Program Manager', detail: 'This task was sent for a PM decision - nothing to do until it comes back.' };
    }
    if (isAssignee && !hasPendingQaReview && task.status === 'Failed') {
      return { tone: 'error', icon: AlertTriangle, title: 'Sent back by review', detail: 'Check the latest comments in Review history, fix, and resubmit.', cta: 'Go to resubmit', target: 'task-action-submit' };
    }
    if (isAssignee && hasPendingQaReview) {
      return { tone: 'neutral', icon: CheckCircle2, title: 'Submitted for review', detail: 'Waiting on the reviewer - you\'ll see the outcome here.' };
    }
    return null;
  })();
  // Hard block on QA submission (backend: TasksService.
  // assertNoOpenDependencyTickets(), called from TaskQaReviewsService.
  // submit()) - deliberately not consulted by the Peer Review submit form
  // below, which stays reachable regardless, but it does block the Peer
  // Reviewer's Approve (PeerReviewsService.approve()).
  const openDependencyTickets = tickets.filter((t) => t.status === 'open');
  // Backend mirror: TasksService.LINKED_DEFECT_RESOLVED_STATUSES /
  // assertNoOpenLinkedDefects() - coexists with openDependencyTickets
  // above, either one independently blocks resubmission. 'Failed' is
  // deliberately still "open" here (see that constant's comment). Covers
  // both spun-off (linkedDefects) and manually linked (blockingDefects)
  // defects, de-duplicated by id.
  const LINKED_DEFECT_RESOLVED_STATUSES = ['Pass', 'Junk', 'Closed'];
  const openLinkedDefects = [...linkedDefects.filter((d) => d.isDefect !== false), ...blockingDefects]
    .filter((d, i, all) => all.findIndex((x) => x.id === d.id) === i)
    .filter((d) => !LINKED_DEFECT_RESOLVED_STATUSES.includes(d.status))
    .sort((a, b) => a.id - b.id);
  const blockingCandidateOptions = blockingCandidates.filter((c) =>
    task.isDefect ? !blockedTasks.some((t) => t.id === c.id) : !openLinkedDefects.some((d) => d.id === c.id) && !blockingDefects.some((d) => d.id === c.id),
  );

  const qaReviewColumns = [
    { key: 'roundNumber', header: 'Round', width: 72, render: (r) => r.roundNumber },
    { key: 'reviewType', header: 'Type', width: 72, render: (r) => (r.reviewType === 'peer' ? 'Peer' : r.reviewType === 'pm' ? 'PM' : 'QA') },
    {
      key: 'status',
      header: 'Status',
      width: 96,
      render: (r) =>
        r.status === 'reverted' && r.revertedDecision
          ? `${r.revertedDecision === 'approved' ? 'Approved' : 'Rejected'}, reverted`
          : r.status === 'withdrawn'
            ? 'Sent back by PM before QA review'
            : r.reviewType === 'pm' && r.status !== 'pending'
            ? r.status === 'approved' ? 'Sent to QA' : 'Sent back'
            : statusLabel(r.status.charAt(0).toUpperCase() + r.status.slice(1)),
    },
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
    {
      key: 'qaComment',
      header: 'Comment',
      render: (r) => (
        <>
          {stripHtmlForPreview(r.qaComment) || null}
          {r.status === 'reverted' && (
            <div style={{ fontSize: 12, color: 'var(--ds-text-muted)', marginTop: 2 }}>
              Reverted by {r.revertedByFullName || 'Unknown'}
              {r.revertedAt ? ` · ${formatDate(r.revertedAt)}` : ''}
              {r.revertReason ? `: ${r.revertReason}` : ''}
            </div>
          )}
        </>
      ),
    },
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

  // Description edit (PM or developer Assignee), allowed at any status (no stage-based lock,
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

  const handleSaveTitle = async () => {
    setError('');
    if (!titleDraft.trim()) {
      setError('Title is required.');
      return;
    }
    setSavingTitle(true);
    try {
      const updated = await apiFetch(`/tasks/${task.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ title: titleDraft.trim() }),
      });
      setTask(updated);
      setTitleDraft(updated.title);
      setEditingTitle(false);
      showToast('Title updated', 'success');
    } catch (err) {
      setError(err.message);
    } finally {
      setSavingTitle(false);
    }
  };

  const handleCancelEditTitle = () => {
    setTitleDraft(task.title);
    setEditingTitle(false);
  };

  const handleStartEditModulePhase = () => {
    setModuleDraftId(String(task.moduleId));
    setPhaseDraftId(String(task.phaseId));
    setEditingModulePhase(true);
  };

  const handleSaveModulePhase = async () => {
    setError('');
    if (!moduleDraftId || !phaseDraftId) {
      setError('Module and Phase are required.');
      return;
    }
    setSavingModulePhase(true);
    try {
      const updated = await apiFetch(`/tasks/${task.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ moduleId: Number(moduleDraftId), phaseId: Number(phaseDraftId) }),
      });
      setTask(updated);
      setEditingModulePhase(false);
      showToast('Module and Phase updated', 'success');
    } catch (err) {
      setError(err.message);
    } finally {
      setSavingModulePhase(false);
    }
  };

  const handleCancelEditModulePhase = () => {
    setEditingModulePhase(false);
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

  // No reason/comment required (confirmed with the user) - a plain PATCH,
  // same shape as handleSavePeerReviewFlag above, just with a confirm dialog
  // guard since these are bigger, less-reversible actions than a checkbox.
  const handleHold = async () => {
    setError('');
    setSavingHoldClosed(true);
    try {
      const updated = await apiFetch(`/tasks/${task.id}/hold`, { method: 'PATCH' });
      setTask(updated);
      showToast('Task put on Hold', 'success');
    } catch (err) {
      setError(err.message);
    } finally {
      setSavingHoldClosed(false);
    }
  };

  const handleRelease = async () => {
    setError('');
    setSavingHoldClosed(true);
    try {
      const updated = await apiFetch(`/tasks/${task.id}/release`, { method: 'PATCH' });
      setTask(updated);
      showToast('Task released from Hold', 'success');
    } catch (err) {
      setError(err.message);
    } finally {
      setSavingHoldClosed(false);
    }
  };

  const handleClose = async () => {
    if (!await confirmAction({ title: 'Close task?', message: 'Close this task? This ends it regardless of resolution state. It can be reopened later.', confirmLabel: 'Close task', danger: true })) return;
    setError('');
    setSavingHoldClosed(true);
    try {
      const updated = await apiFetch(`/tasks/${task.id}/close`, { method: 'PATCH' });
      setTask(updated);
      showToast('Task Closed', 'success');
    } catch (err) {
      setError(err.message);
    } finally {
      setSavingHoldClosed(false);
    }
  };

  const submitJunk = async (reason) => {
    const updated = await apiFetch(`/tasks/${task.id}/junk`, { method: 'PATCH', body: JSON.stringify({ reason }) });
    setJunkModalOpen(false);
    setTask((prev) => ({ ...prev, ...updated }));
    showToast(`Task #${task.id} marked as Junk`, 'success');
  };

  const submitRevertQaDecision = async (reason) => {
    const what = latestRound?.status === 'approved' ? 'approval' : 'rejection';
    const result = await apiFetch(`/tasks/${task.id}/qa-revert`, { method: 'PATCH', body: JSON.stringify({ reason }) });
    setRevertModalOpen(false);
    const [refreshedTask, refreshedReviews] = await Promise.all([apiFetch(`/tasks/${task.id}`), apiFetch(`/tasks/${task.id}/qa-reviews`)]);
    setTask(refreshedTask);
    setQaReviews(refreshedReviews);
    const junked = result.junkedDefectIds || [];
    showToast(
      `QA ${what} reverted - back to ${statusLabel(refreshedTask.status)}${junked.length ? `; ${junked.map((d) => `#${d}`).join(', ')} moved to Junk` : ''}`,
      'success',
    );
  };

  const submitSendBackFromQa = async (reason, assigneeUserId) => {
    await apiFetch(`/tasks/${task.id}/qa-send-back`, { method: 'PATCH', body: JSON.stringify({ reason, assigneeUserId }) });
    setSendBackModalOpen(false);
    const [refreshedTask, refreshedReviews] = await Promise.all([apiFetch(`/tasks/${task.id}`), apiFetch(`/tasks/${task.id}/qa-reviews`)]);
    setTask(refreshedTask);
    setQaReviews(refreshedReviews);
    showToast(
      `Task #${task.id} sent back to ${refreshedTask.assigneeFullName || refreshedTask.assigneeEmail || 'the developer'} - out of the QA queue`,
      'success',
    );
  };

  // Return to QA (ReturnToQaPanel): reload what it may have changed.
  const refreshAfterReturnToQa = async (message) => {
    const refreshedTask = await apiFetch(`/tasks/${task.id}`);
    setTask(refreshedTask);
    if (refreshedTask.isDefect) {
      apiFetch(`/tasks/${task.id}/defect-artifacts`).then(setDefectArtifacts).catch(() => {});
      setScreenshotsVersion((v) => v + 1);
    }
    if (message) showToast(message, 'success');
  };

  const handleRestoreJunk = async () => {
    if (!await confirmAction({
      title: 'Restore from Junk?',
      message: `Task #${task.id} goes back to ${statusLabel(task.statusBeforeJunk || 'Escalated')} and counts again from now on. Its history is kept.`,
      confirmLabel: 'Restore',
    })) return;
    setError('');
    setRestoringJunk(true);
    try {
      const updated = await apiFetch(`/tasks/${task.id}/restore-junk`, { method: 'PATCH' });
      setTask((prev) => ({ ...prev, ...updated }));
      showToast(`Task restored as ${statusLabel(updated.status)}`, 'success');
    } catch (err) {
      setError(err.message);
    } finally {
      setRestoringJunk(false);
    }
  };

  const handleReopen = async () => {
    if (!await confirmAction({ title: 'Reopen task?', message: 'Reopen this task? It returns to the status it had before it was closed.', confirmLabel: 'Reopen' })) return;
    setError('');
    setSavingHoldClosed(true);
    try {
      const updated = await apiFetch(`/tasks/${task.id}/reopen`, { method: 'PATCH' });
      setTask(updated);
      showToast(`Task reopened as ${statusLabel(updated.status)}`, 'success');
    } catch (err) {
      setError(err.message);
    } finally {
      setSavingHoldClosed(false);
    }
  };

  const handleSaveQaReviewDueDate = async () => {
    setError('');
    setSavingQaReviewDueDate(true);
    try {
      const updated = await apiFetch(`/tasks/${task.id}/qa-review-due-date`, {
        method: 'PATCH',
        body: JSON.stringify({ qaReviewDueDate: qaReviewDueDateDraft }),
      });
      setTask(updated);
      showToast('QA Review Due Date updated', 'success');
    } catch (err) {
      setError(err.message);
    } finally {
      setSavingQaReviewDueDate(false);
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
    if (linkedDefectDrafts.length === 1) return;
    setLinkedDefectDrafts((prev) => prev.filter((_, i) => i !== index));
    setLinkedDefectShots((prev) => prev.filter((_, i) => i !== index));
  };

  const setLinkedDefectShotsAt = (index, shots) => {
    setLinkedDefectShots((prev) => {
      const next = [...prev];
      while (next.length <= index) next.push([]);
      next[index] = shots;
      return next;
    });
  };

  // Clones title/description/assignee into a new row right after the
  // source one - for variations of the same underlying issue (e.g. same
  // bug on a different screen) where retyping the whole thing per defect
  // would be pure repetition.
  const duplicateLinkedDefectDraft = (index) => {
    setLinkedDefectDrafts((prev) => [
      ...prev.slice(0, index + 1),
      { ...prev[index] },
      ...prev.slice(index + 1),
    ]);
    // The copy starts without screenshots.
    setLinkedDefectShots((prev) => {
      const next = [...prev];
      while (next.length <= index) next.push([]);
      next.splice(index + 1, 0, []);
      return next;
    });
  };

  // Checks a batch row's title against this task's existing open defects
  // (openLinkedDefects, already loaded for the "cannot submit for QA"
  // gate above) and against every other row already in this same batch -
  // the two places a QA-rejection session could accidentally spin up a
  // redundant ticket for the same underlying issue.
  const findPossibleDuplicateDefectWarning = (index) => {
    const title = linkedDefectDrafts[index].title.trim();
    if (!title) return null;

    const existingMatch = openLinkedDefects.find((d) => titlesLookSimilar(title, d.title));
    if (existingMatch) {
      return `Possible duplicate of existing open defect #${existingMatch.id} ("${existingMatch.title}")`;
    }

    const batchMatchIndex = linkedDefectDrafts.findIndex(
      (other, i) => i !== index && other.title.trim() && titlesLookSimilar(title, other.title),
    );
    if (batchMatchIndex !== -1) {
      return `Possible duplicate of Defect ${batchMatchIndex + 1} in this same batch`;
    }

    return null;
  };

  const updateLinkedDefectDraft = (index, field, value) => {
    setLinkedDefectDrafts((prev) => prev.map((row, i) => (i === index ? { ...row, [field]: value } : row)));
  };

  const resetLinkedDefectForm = () => {
    setCreateLinkedDefect(false);
    setLinkedDefectDrafts([{ title: '', description: '', assignee: null }]);
    setLinkedDefectArtifacts([]);
    setLinkedDefectShots([]);
  };

  const loadDecisionShots = () =>
    apiFetch(`/tasks/${task.id}/qa-review-attachments`).then(setDecisionShots).catch(() => setDecisionShots([]));

  // Uploads screenshots that belong to something just created (a decided
  // round, a linked defect). The decision itself already went through, so
  // a failure never undoes it: the screenshots are kept for Retry.
  const uploadShotsAfterDecision = async (jobs) => {
    const failed = [];
    for (const job of jobs) {
      if (!job.shots.length) continue;
      try {
        const form = new FormData();
        for (const shot of job.shots) form.append('files', shot.blob, shot.name);
        // eslint-disable-next-line no-await-in-loop
        await apiUpload(job.path, form);
      } catch (err) {
        failed.push({ ...job, error: err.message });
      }
    }
    if (failed.length) setFailedShotUploads((prev) => [...prev, ...failed]);
    return failed.length;
  };

  const retryFailedShotUploads = async () => {
    const jobs = failedShotUploads;
    setFailedShotUploads([]);
    const failed = await uploadShotsAfterDecision(jobs);
    loadDecisionShots();
    setScreenshotsVersion((v) => v + 1);
    if (!failed) showToast('Screenshots attached', 'success');
  };

  const refreshAfterPmDecision = async () => {
    const [refreshedTask, refreshedReviews] = await Promise.all([apiFetch(`/tasks/${task.id}`), apiFetch(`/tasks/${task.id}/qa-reviews`)]);
    setTask(refreshedTask);
    setQaReviews(refreshedReviews);
  };

  const handlePmSendToQa = async () => {
    setError('');
    setPmBusy(true);
    try {
      const comment = stripHtmlForPreview(pmToQaComment).trim() ? pmToQaComment : undefined;
      await apiFetch(`/pm-review/tasks/${task.id}/send-to-qa`, { method: 'PATCH', body: JSON.stringify(comment ? { comment } : {}) });
      setPmToQaComment('');
      await refreshAfterPmDecision();
      showToast(`Task #${task.id} sent to QA`, 'success');
    } catch (err) {
      setError(err.message);
    } finally {
      setPmBusy(false);
    }
  };

  const handlePmSendBack = async (e) => {
    e.preventDefault();
    setError('');
    if (!stripHtmlForPreview(pmSendBackComment).trim()) {
      setPmSendBackAttempted(true);
      return;
    }
    setPmBusy(true);
    try {
      await apiFetch(`/pm-review/tasks/${task.id}/send-back`, { method: 'PATCH', body: JSON.stringify({ comment: pmSendBackComment }) });
      setPmSendBackComment('');
      setShowPmSendBack(false);
      await refreshAfterPmDecision();
      showToast(`Task #${task.id} sent back to the developer`, 'success');
    } catch (err) {
      setError(err.message);
    } finally {
      setPmBusy(false);
    }
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
      const submitted = await apiFetch(`/tasks/${task.id}/qa-submit`, {
        method: 'POST',
        body: JSON.stringify({
          resolution,
          actualHours: Number(actualHours),
          artifacts: artifacts.map((row) => ({ type: row.type, url: row.url.trim() })),
        }),
      });
      showToast(submitted?.reviewType === 'pm' ? 'Submitted - a Program Manager reviews it before QA' : 'Submitted for QA testing', 'success');
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
      const decided = await apiFetch(`/tasks/${task.id}/qa-approve`, {
        method: 'PATCH',
        body: JSON.stringify({ comment: approveComment.trim() || undefined, artifacts: payloadArtifacts }),
      });
      const failedShots = await uploadShotsAfterDecision([
        { path: `/tasks/${task.id}/qa-reviews/${decided.id}/attachments`, shots: qaShots, label: 'your approval' },
      ]);
      showToast(failedShots ? 'Task approved - some screenshots were not attached, see Retry above' : 'Task approved', 'success');
      setApproveComment('');
      setQaArtifacts([]);
      setQaShots([]);
      loadDecisionShots();
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
      const created = result.linkedDefects || [];
      const failedShots = await uploadShotsAfterDecision([
        { path: `/tasks/${task.id}/qa-reviews/${result.id}/attachments`, shots: qaShots, label: 'your rejection' },
        // Linked defects come back in the order they were sent.
        ...created.map((d, i) => ({ path: `/tasks/${d.id}/attachments`, shots: linkedDefectShots[i] || [], label: `defect #${d.id}` })),
      ]);
      showToast(
        `${created.length > 0 ? `Task rejected - ${created.length} linked defect${created.length > 1 ? 's' : ''} created` : 'Task rejected'}${
          failedShots ? ' - some screenshots were not attached, see Retry above' : ''
        }`,
        'success',
      );
      setQaShots([]);
      loadDecisionShots();
      if (linkedDefectArtifactsPayload && linkedDefectArtifactsPayload.length > 0) {
        setArtifactUrlHistory(recordArtifactUrlHistory(linkedDefectArtifactsPayload.map((a) => a.url)));
      }
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
      setError('A comment explaining why PM intervention is needed is required.');
      return;
    }
    setQaActionBusy(true);
    try {
      const decided = await apiFetch(`/tasks/${task.id}/qa-escalate`, {
        method: 'PATCH',
        body: JSON.stringify({ comment: escalateComment }),
      });
      const failedShots = await uploadShotsAfterDecision([
        { path: `/tasks/${task.id}/qa-reviews/${decided.id}/attachments`, shots: qaShots, label: 'your intervention request' },
      ]);
      showToast(failedShots ? 'Task sent to PM - some screenshots were not attached, see Retry above' : 'Task sent to PM for intervention', 'success');
      setQaShots([]);
      loadDecisionShots();
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
    if (!ticketTitle.trim() || !ticketDescription.trim() || !ticketOwner) {
      setError('Dependency Title, Description, and Owner are all required.');
      return;
    }
    setFilingTicket(true);
    try {
      await apiFetch('/task-dependency-tickets', {
        method: 'POST',
        body: JSON.stringify({
          parentTaskId: task.id,
          title: ticketTitle.trim(),
          description: ticketDescription,
          ownerUserId: ticketOwner.id,
        }),
      });
      showToast('Dependency Ticket created', 'success');
      setTicketTitle('');
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
      <Breadcrumbs items={[{ label: 'My Tasks', href: '/tasks/mine' }, { label: `#${task.id}` }]} />
      <div className={styles.pageHeader}>
        <div>
          {!editingTitle && <h1 className={styles.pageTitle}>#{task.id} - {task.title}</h1>}
          {!editingTitle && (
            <div className={styles.metaRow}>
              <span className={styles.statusChip} style={statusBadgeStyle(task.status)}>
                {statusLabel(task.status)}
              </span>
              {task.priority && <Badge tone={priorityTone(task.priority)}>{priorityLabel(task.priority)} priority</Badge>}
              {task.isDefect && <Badge tone="error">Defect</Badge>}
              <span className={`${styles.metaItem} ${isOverdueTask(task) ? styles.metaOverdue : ''}`}>
                {task.dueDate ? `${isOverdueTask(task) ? 'Overdue · due' : 'Due'} ${formatDate(effectiveDueDate(task))}` : 'No due date'}
                {/* PM review gate: the working days spent waiting for a PM extend it. */}
                {task.dueDate && task.pmWaitWorkingDays > 0 && ` (${formatDate(task.dueDate)} + ${task.pmWaitWorkingDays} working ${task.pmWaitWorkingDays === 1 ? 'day' : 'days'} with PM)`}
              </span>
              <span className={`${styles.metaItem} ${styles.metaPerson}`}>
                {(task.assigneeFullName || task.assigneeEmail) && <Avatar name={task.assigneeFullName || task.assigneeEmail} size="xs" />}
                {task.assigneeFullName || task.assigneeEmail || 'Unassigned'}
              </span>
            </div>
          )}
          {canManage && !editingTitle && (
            <div className={styles.actions} style={{ marginBottom: 'var(--space-2)' }}>
              <button className={styles.buttonSecondary} type="button" onClick={() => setEditingTitle(true)}>
                Edit Title
              </button>
            </div>
          )}
          {canManage && editingTitle && (
            <div className={styles.field}>
              <label className={styles.label} htmlFor="taskTitleEdit">Title</label>
              <input
                className={styles.input}
                id="taskTitleEdit"
                required
                maxLength={TASK_TITLE_MAX_LENGTH}
                value={titleDraft}
                onChange={(e) => setTitleDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSaveTitle();
                  if (e.key === 'Escape') handleCancelEditTitle();
                }}
                autoFocus
              />
              <div className={styles.actions} style={{ marginTop: 'var(--space-2)' }}>
                <button className={`${styles.button} ${styles.buttonAccent}`} type="button" disabled={savingTitle} onClick={handleSaveTitle}>
                  {savingTitle ? 'Saving...' : 'Save Title'}
                </button>
                <button className={styles.buttonSecondary} type="button" disabled={savingTitle} onClick={handleCancelEditTitle}>
                  Cancel
                </button>
              </div>
            </div>
          )}
          {!editingModulePhase && (
            <p className={styles.pageSubtitle}>{task.projectName} &middot; {task.moduleName} &middot; {task.phaseName}</p>
          )}
          {canManage && !editingModulePhase && (
            <div className={styles.actions} style={{ marginBottom: 'var(--space-2)' }}>
              <button className={styles.buttonSecondary} type="button" onClick={handleStartEditModulePhase}>
                Edit Module / Phase
              </button>
            </div>
          )}
          {canManage && editingModulePhase && (
            <div>
              <p className={styles.pageSubtitle}>{task.projectName}</p>
              <div className={styles.fieldGrid3}>
                <div className={styles.field}>
                  <label className={styles.label} htmlFor="taskModuleEdit">Module</label>
                  <select
                    className={styles.input}
                    id="taskModuleEdit"
                    required
                    value={moduleDraftId}
                    onChange={(e) => { setModuleDraftId(e.target.value); setPhaseDraftId(''); }}
                    autoFocus
                  >
                    {/* Keeps the current value selectable even if it has since been deactivated (inactive ones aren't in moduleOptions). */}
                    {!moduleOptions.some((m) => String(m.id) === String(task.moduleId)) && (
                      <option value={String(task.moduleId)}>{task.moduleName}</option>
                    )}
                    {moduleOptions.map((m) => (
                      <option key={m.id} value={String(m.id)}>{m.name}</option>
                    ))}
                  </select>
                </div>
                <div className={styles.field}>
                  <label className={styles.label} htmlFor="taskPhaseEdit">Phase</label>
                  <select
                    className={styles.input}
                    id="taskPhaseEdit"
                    required
                    value={phaseDraftId}
                    onChange={(e) => setPhaseDraftId(e.target.value)}
                  >
                    <option value="" disabled>Select a Phase</option>
                    {moduleDraftId === String(task.moduleId) && !phaseOptions.some((p) => String(p.id) === String(task.phaseId)) && (
                      <option value={String(task.phaseId)}>{task.phaseName}</option>
                    )}
                    {phaseOptions.map((p) => (
                      <option key={p.id} value={String(p.id)}>{p.name}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className={styles.actions} style={{ marginBottom: 'var(--space-2)' }}>
                <button
                  className={`${styles.button} ${styles.buttonAccent}`}
                  type="button"
                  disabled={savingModulePhase || !moduleDraftId || !phaseDraftId}
                  onClick={handleSaveModulePhase}
                >
                  {savingModulePhase ? 'Saving...' : 'Save'}
                </button>
                <button className={styles.buttonSecondary} type="button" disabled={savingModulePhase} onClick={handleCancelEditModulePhase}>
                  Cancel
                </button>
              </div>
            </div>
          )}
          {(openLinkedDefects.length > 0 || (task.isDefect && blockedTasks.length > 0)) && (
            <ul className={styles.blockingBadges} aria-label="Blocking links">
              {openLinkedDefects.map((d) => (
                <li key={`by-${d.id}`}>
                  <Link href={`/tasks/${d.id}`}>
                    <Badge tone="error" dot>Blocked by Defect #{d.id}</Badge>
                  </Link>
                </li>
              ))}
              {task.isDefect && blockedTasks.map((t) => (
                <li key={`blocks-${t.id}`}>
                  <Link href={`/tasks/${t.id}`}>
                    <Badge tone="warning" dot>Blocks Task #{t.id}</Badge>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {error && <div className={styles.error}>{error}</div>}

      {pendingAction && (
        <div className={`${styles.actionBanner} ${styles[`actionBanner_${pendingAction.tone}`]}`} role="status">
          <pendingAction.icon size={20} aria-hidden="true" className={styles.actionBannerIcon} />
          <div className={styles.actionBannerText}>
            <strong>{pendingAction.title}</strong>
            <span>{pendingAction.detail}</span>
          </div>
          {pendingAction.target && (
            <button
              type="button"
              className={`${styles.button} ${styles.buttonAccent}`}
              onClick={() => {
                setActiveTab('overview');
                requestAnimationFrame(() => {
                  const el = document.getElementById(pendingAction.target);
                  el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                  el?.focus({ preventScroll: true });
                });
              }}
            >
              {pendingAction.cta}
            </button>
          )}
        </div>
      )}

      {latestPmSendBack && (
        <div id="task-pm-feedback" tabIndex={-1} className={styles.card} style={{ marginBottom: 'var(--space-4)', borderLeft: '4px solid var(--ds-color-error)' }}>
          <h2 className={styles.cardTitle}>
            PM feedback
          </h2>
          <p className={styles.issueMeta} style={{ marginTop: 0 }}>
            From {latestPmSendBack.reviewedByFullName || 'the Program Manager'}
            {latestPmSendBack.reviewedAt ? ` · ${formatDate(latestPmSendBack.reviewedAt)}` : ''}
          </p>
          <RichTextDisplay value={latestPmSendBack.qaComment} />
          {isAssignee && (
            <p className={styles.helpText} style={{ marginBottom: 0 }}>
              {pmSendBackFromQa
                ? `Taken back from QA before review. Refine the task, then submit it again below - it goes ${task.pmReviewGateOn ? 'to the Program Manager first, then QA' : 'back to QA'}. This is not a QA rejection.`
                : 'Refine the task, then submit it again below - it goes back to the Program Manager. This is not a QA rejection.'}
            </p>
          )}
        </div>
      )}

      <div className={styles.tabs} role="tablist" aria-label="Task sections">
        {[
          { key: 'overview', label: 'Overview' },
          { key: 'history', label: 'Review history', count: qaReviews.length },
        ].map((tab) => (
          <button
            key={tab.key}
            type="button"
            role="tab"
            id={`task-tab-${tab.key}`}
            aria-selected={activeTab === tab.key}
            aria-controls={`task-panel-${tab.key}`}
            tabIndex={activeTab === tab.key ? 0 : -1}
            className={`${styles.tab} ${activeTab === tab.key ? styles.tabActive : ''}`}
            onClick={() => setActiveTab(tab.key)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
                e.preventDefault();
                const next = activeTab === 'overview' ? 'history' : 'overview';
                setActiveTab(next);
                document.getElementById(`task-tab-${next}`)?.focus();
              }
            }}
          >
            {tab.label}
            {tab.count > 0 && <span className={styles.tabCount}>{tab.count}</span>}
          </button>
        ))}
      </div>

      {/* Panels stay mounted (hidden, not unmounted) so switching tabs never
          loses a half-written review comment or form draft. */}
      <div role="tabpanel" id="task-panel-overview" aria-labelledby="task-tab-overview" hidden={activeTab !== 'overview'}>

      <div className={styles.card} style={{ marginBottom: 'var(--space-4)' }}>
        {task.isDefect && (
          <span className={styles.badge} style={{ background: 'var(--color-red-tint)', color: 'var(--color-red-dark)' }}>
            Defect
          </span>
        )}
        {!editingDescription && <RichTextDisplay value={task.description} />}
        {canEditDescription && !editingDescription && (
          <div className={styles.actions} style={{ marginTop: 'var(--space-2)' }}>
            <button className={styles.buttonSecondary} type="button" onClick={() => setEditingDescription(true)}>
              Edit Description
            </button>
          </div>
        )}
        {canEditDescription && editingDescription && (
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
              attributed to whoever was assigned at the time - reassigning never rewrites it. A Peer Review, PM
              Intervention, or Dependency Ticket already in progress keeps going to whoever it's currently routed to.
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
        {task.isDefect && <DefectScreenshots key={screenshotsVersion} taskId={task.id} />}
        {task.isDefect && !isJunk && user.role === 'qa' && task.createdByUserId === user.id && task.status !== 'Returned to QA' && (
          <ScreenshotUploader collapsed uploadPath={`/tasks/${task.id}/attachments`} onUploaded={() => setScreenshotsVersion((v) => v + 1)} />
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
          <h2 className={styles.cardTitle}>
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
                  : latestQaReview.reviewType === 'pm'
                    ? 'Waiting for PM review - a Program Manager sends it to QA or back to the developer.'
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
          <h2 className={styles.cardTitle}>
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

      {(isJunk || isProgramManager || junkHistory.length > 0) && JUNK_VIEW_ROLES.includes(user.role) && (
        <div className={styles.card} style={{ marginBottom: 'var(--space-4)' }} id="task-junk">
          <h2 className={styles.cardTitle}>Junk</h2>
          {isJunk ? (
            <>
              <dl style={{ margin: '0 0 var(--ds-space-3)', display: 'grid', gridTemplateColumns: 'max-content 1fr', gap: 'var(--ds-space-1) var(--ds-space-4)' }}>
                <dt className={styles.issueMeta}>Marked by</dt>
                <dd style={{ margin: 0 }}>{task.junkedByEmail || 'Unknown'}</dd>
                <dt className={styles.issueMeta}>When</dt>
                <dd style={{ margin: 0 }}>{task.junkedAt ? formatDateTime(task.junkedAt) : 'Unknown'}</dd>
                <dt className={styles.issueMeta}>Reason</dt>
                <dd style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{task.junkReason || '—'}</dd>
                <dt className={styles.issueMeta}>Previous status</dt>
                <dd style={{ margin: 0 }}>{statusLabel(task.statusBeforeJunk || 'Escalated')}</dd>
              </dl>
              {isProgramManager ? (
                <div className={styles.actions}>
                  <button
                    className={`${styles.button} ${styles.buttonAccent}`}
                    type="button"
                    disabled={restoringJunk}
                    onClick={handleRestoreJunk}
                  >
                    {restoringJunk ? 'Restoring...' : 'Restore'}
                  </button>
                </div>
              ) : (
                <p className={styles.helpText}>Hidden from Developers and QA. Only a Program Manager can restore it.</p>
              )}
            </>
          ) : isProgramManager ? (
            <>
              <p className={styles.helpText}>
                Created by mistake? Junk hides this ticket from Developers and QA and leaves it out of every count and report.
                Nothing is deleted - you can restore it from the Junk list.
              </p>
              <div className={styles.actions}>
                <button className={styles.buttonSecondary} type="button" onClick={() => setJunkModalOpen(true)}>
                  Mark as Junk
                </button>
              </div>
            </>
          ) : null}
          {junkHistory.length > 0 && (
            <>
              <h3 className={styles.issueMeta} style={{ margin: 'var(--ds-space-4) 0 var(--ds-space-2)' }}>History</h3>
              <ul style={{ margin: 0, paddingLeft: 'var(--ds-space-5)', lineHeight: 'var(--ds-leading-normal)' }}>
                {junkHistory.map((h) => (
                  <li key={h.id}>
                    {formatDateTime(h.createdAt)} - {h.action === 'task_restored_from_junk' ? 'Restored' : 'Marked as Junk'} by {h.userEmail || 'Unknown'}
                    {h.details?.previousStatus && h.details?.newStatus
                      ? (
                        <>
                          {' ('}{statusLabel(h.details.previousStatus)}{' '}
                          {/* Icon, not a → character - the app font has no arrow glyph. */}
                          <ArrowRight size={13} aria-hidden="true" style={{ verticalAlign: 'middle' }} />
                          <span className="sr-only">to</span>{' '}{statusLabel(h.details.newStatus)})
                        </>
                      )
                      : ''}
                    {h.action !== 'task_restored_from_junk' && h.details?.reason ? `: ${h.details.reason}` : ''}
                  </li>
                ))}
              </ul>
            </>
          )}
          <JunkReasonModal
            open={junkModalOpen}
            tasks={[{ id: task.id, title: task.title, status: task.status }]}
            onClose={() => setJunkModalOpen(false)}
            submit={submitJunk}
          />
        </div>
      )}

      {!isJunk && <ReturnToQaPanel task={task} user={user} onChanged={refreshAfterReturnToQa} />}

      {(canRevertQaDecision || canSendBackFromQa) && (
        <div className={styles.card} style={{ marginBottom: 'var(--space-4)' }} id="task-pm-actions">
          <h2 className={styles.cardTitle}>
            PM actions
          </h2>
          {canSendBackFromQa && (
            <>
              <p className={styles.helpText}>
                Waiting for QA (round {latestQaReview.roundNumber}). Not ready for QA - for example the description is unclear? Send it back
                to the developer with a reason. It leaves the QA queue and does not count as a QA rejection.
              </p>
              <div className={styles.actions}>
                <button className={styles.buttonSecondary} type="button" onClick={() => setSendBackModalOpen(true)}>
                  Send back to developer
                </button>
              </div>
              <SendBackToDeveloperModal
                open={sendBackModalOpen}
                taskId={task.id}
                currentDeveloper={task.assigneeUserId ? { id: task.assigneeUserId, name: task.assigneeFullName || task.assigneeEmail } : null}
                developers={developers}
                canPickOther={user.role === 'program_manager'}
                onClose={() => setSendBackModalOpen(false)}
                submit={submitSendBackFromQa}
              />
            </>
          )}
          {canRevertQaDecision && (
            <>
              <p className={styles.helpText}>
                {latestRound.reviewedByFullName || 'QA'} {latestRound.status === 'approved' ? 'approved' : 'rejected'} round {latestRound.roundNumber}
                {latestRound.reviewedAt ? ` on ${formatDate(latestRound.reviewedAt)}` : ''}. Made by mistake? Revert it and the task goes back to
                waiting for QA with the same submission.
              </p>
              <div className={styles.actions}>
                <button className={styles.buttonSecondary} type="button" onClick={() => setRevertModalOpen(true)}>
                  Revert QA decision
                </button>
              </div>
              <RevertQaDecisionModal
                open={revertModalOpen}
                taskId={task.id}
                decision={latestRound.status}
                decidedBy={latestRound.reviewedByFullName}
                onClose={() => setRevertModalOpen(false)}
                submit={submitRevertQaDecision}
              />
            </>
          )}
        </div>
      )}

      {canManageHoldClosed && (
        <div className={styles.card} style={{ marginBottom: 'var(--space-4)' }}>
          <h2 className={styles.cardTitle}>
            Hold / Close
          </h2>
          {task.status === 'Closed' ? (
            <>
              <p className={styles.helpText}>
                This task is Closed. Reopening returns it to the status it had before it was closed.
              </p>
              <div className={styles.actions}>
                <button
                  className={`${styles.button} ${styles.buttonAccent}`}
                  type="button"
                  disabled={savingHoldClosed}
                  onClick={handleReopen}
                >
                  {savingHoldClosed ? 'Saving...' : 'Reopen'}
                </button>
              </div>
            </>
          ) : task.status === 'Hold' ? (
            <>
              <p className={styles.helpText}>
                On Hold{task.priorStatus ? ` - was "${task.priorStatus}" before being paused` : ''}. Releasing
                resumes it at that status.
              </p>
              <div className={styles.actions}>
                <button
                  className={`${styles.button} ${styles.buttonAccent}`}
                  type="button"
                  disabled={savingHoldClosed}
                  onClick={handleRelease}
                >
                  {savingHoldClosed ? 'Saving...' : 'Release from Hold'}
                </button>
                <button
                  className={styles.buttonSecondary}
                  type="button"
                  disabled={savingHoldClosed}
                  onClick={handleClose}
                >
                  Close
                </button>
              </div>
            </>
          ) : (
            <>
              <p className={styles.helpText}>
                Pause or force-end this task from its current status ({statusLabel(task.status)}) - no reason or comment
                required. Either can be undone later - releasing or reopening returns it to this same status.
              </p>
              <div className={styles.actions}>
                <button
                  className={styles.buttonSecondary}
                  type="button"
                  disabled={savingHoldClosed}
                  onClick={handleHold}
                >
                  {savingHoldClosed ? 'Saving...' : 'Put on Hold'}
                </button>
                <button
                  className={styles.buttonSecondary}
                  type="button"
                  disabled={savingHoldClosed}
                  onClick={handleClose}
                >
                  Close
                </button>
              </div>
            </>
          )}
        </div>
      )}

      <div className={styles.card} style={{ marginBottom: 'var(--space-4)' }}>
        <h2 className={styles.cardTitle}>
          QA Review Due Date
        </h2>
        <p style={{ margin: 0 }} className={isQaReviewOverdue(task) ? styles.dueDateOverdue : undefined}>
          {task.qaReviewDueDate ? formatDate(task.qaReviewDueDate) : 'Not yet submitted for QA or Peer Review.'}
        </p>
        <p className={styles.helpText}>
          Auto-set to 5 business days from whenever this task is submitted for QA or Peer Review, and reset fresh on
          every resubmission - separate from the task's own Due Date above.
        </p>
        {canEditQaReviewDueDate && (
          <>
            <div className={styles.fieldNarrow}>
              <label className={styles.label} htmlFor="tdQaReviewDueDate">Adjust QA Review Due Date</label>
              <input
                className={styles.input}
                id="tdQaReviewDueDate"
                type="date"
                value={qaReviewDueDateDraft}
                onChange={(e) => setQaReviewDueDateDraft(e.target.value)}
              />
            </div>
            <div className={styles.actions}>
              <button
                className={`${styles.button} ${styles.buttonAccent}`}
                type="button"
                disabled={savingQaReviewDueDate || !qaReviewDueDateDraft || qaReviewDueDateDraft === (task.qaReviewDueDate || '')}
                onClick={handleSaveQaReviewDueDate}
              >
                {savingQaReviewDueDate ? 'Saving...' : 'Save'}
              </button>
            </div>
          </>
        )}
      </div>

      {isAssignee && (
        <form onSubmit={handleFileTicket} className={styles.card} style={{ marginBottom: 'var(--space-4)' }}>
          <h2 className={styles.cardTitle}>
            Create Dependency Ticket
          </h2>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="tdTicketTitle">Dependency Title</label>
            <input
              className={styles.input}
              id="tdTicketTitle"
              required
              maxLength={TASK_DEPENDENCY_TICKET_TITLE_MAX_LENGTH}
              value={ticketTitle}
              onChange={(e) => setTicketTitle(e.target.value)}
              aria-describedby="tdTicketTitleHint"
            />
            <p id="tdTicketTitleHint" className={styles.issueMeta} style={{ margin: 'var(--space-1) 0 0' }}>
              A short one-line summary, shown wherever this dependency is listed.
            </p>
          </div>
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
        <h2 className={styles.cardTitle}>
          Dependency Tickets
        </h2>
        {tickets.length === 0 && <div className={styles.empty}>No dependency tickets filed for this task.</div>}
        {tickets.map((ticket) => (
          <div
            key={ticket.id}
            id={`dependency-${ticket.id}`}
            tabIndex={-1}
            className={highlightedTicketId === ticket.id ? styles.ticketHighlight : undefined}
            style={{
              padding: highlightedTicketId === ticket.id ? 'var(--space-3)' : 'var(--space-3) 0',
              borderTop: '1px solid var(--color-border)',
            }}
          >
            {editingTicketId === ticket.id ? (
              <div className={styles.field} style={{ marginBottom: 'var(--space-2)' }}>
                <label className={styles.label} htmlFor={`tdTicketTitleEdit-${ticket.id}`}>Dependency Title</label>
                <input
                  className={styles.input}
                  id={`tdTicketTitleEdit-${ticket.id}`}
                  required
                  maxLength={TASK_DEPENDENCY_TICKET_TITLE_MAX_LENGTH}
                  value={ticketTitleDraft}
                  onChange={(e) => setTicketTitleDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleSaveTicketTitle(ticket.id);
                    if (e.key === 'Escape') setEditingTicketId(null);
                  }}
                  autoFocus
                />
                <div className={styles.actions} style={{ marginTop: 'var(--space-2)' }}>
                  <button className={`${styles.button} ${styles.buttonAccent}`} type="button" disabled={savingTicketTitle} onClick={() => handleSaveTicketTitle(ticket.id)}>
                    {savingTicketTitle ? 'Saving...' : 'Save Title'}
                  </button>
                  <button className={styles.buttonSecondary} type="button" disabled={savingTicketTitle} onClick={() => setEditingTicketId(null)}>
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <p style={{ margin: 0, fontWeight: 600 }}>
                {ticket.title}{' '}
                <span className={styles.badge} style={ticket.status === 'resolved' ? { background: 'var(--color-teal-tint)', color: 'var(--color-teal-dark)' } : { background: 'var(--color-red-tint)', color: 'var(--color-red-dark)' }}>
                  {ticket.status === 'resolved' ? 'Resolved' : 'Open'}
                </span>
              </p>
            )}
            <p style={{ margin: 'var(--space-1) 0 0', whiteSpace: 'pre-wrap' }}>{ticket.description}</p>
            <p className={styles.issueMeta} style={{ margin: 'var(--space-1) 0 0' }}>
              Owner: {ticket.ownerName || ticket.ownerEmail} &middot; Filed by {ticket.createdByName || ticket.createdByEmail} &middot;{' '}
              {formatDate(ticket.createdAt)}
            </p>
            {editingTicketId !== ticket.id && (ticket.createdByUserId === user.id || canManage || user.role === 'admin') && (
              <button
                className={styles.buttonSecondary}
                type="button"
                style={{ marginTop: 'var(--space-2)', marginRight: 'var(--space-2)' }}
                onClick={() => {
                  setEditingTicketId(ticket.id);
                  setTicketTitleDraft(ticket.title);
                }}
              >
                Edit Title
              </button>
            )}
            {editingTicketId !== ticket.id && canChangeDependencyOwner && ticket.status === 'open' && (
              <button
                className={styles.buttonSecondary}
                type="button"
                style={{ marginTop: 'var(--space-2)', marginRight: 'var(--space-2)' }}
                onClick={() => setOwnerChangeTicket(ticket)}
                aria-label={`Change owner of ${ticket.title}`}
              >
                Change owner
              </button>
            )}
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
        {dependencyHistory.length > 0 && (
          <div style={{ borderTop: '1px solid var(--color-border)', paddingTop: 'var(--space-3)' }}>
            <h3 className={styles.issueMeta} style={{ margin: '0 0 var(--ds-space-2)' }}>Dependency history</h3>
            <ul style={{ margin: 0, paddingLeft: 'var(--ds-space-5)' }}>
              {dependencyHistory.map((h) => (
                <li key={h.id} className={styles.issueMeta} style={{ marginBottom: 'var(--ds-space-1)' }}>
                  {formatDateTime(h.createdAt)} &middot; {h.actorName} {dependencyHistoryText(h)}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
      <ChangeDependencyOwnerModal
        open={!!ownerChangeTicket}
        ticket={ownerChangeTicket}
        people={developers}
        onClose={() => setOwnerChangeTicket(null)}
        submit={handleChangeTicketOwner}
      />

      <div className={styles.card} style={{ marginBottom: 'var(--space-4)' }}>
        <h2 className={styles.cardTitle}>
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

      <div className={styles.card} style={{ marginBottom: 'var(--space-4)' }}>
        <h2 className={styles.cardTitle}>
          {task.isDefect ? 'Blocked Tasks' : 'Blocking Defects'}
        </h2>
        <p className={styles.helpText} style={{ marginTop: 0 }}>
          {task.isDefect
            ? 'Tasks this defect blocks. While it is unresolved (not Pass, Junk, or Closed), they cannot be submitted for QA.'
            : 'Existing defects linked as blocking this task. While any is unresolved (not Pass, Junk, or Closed), this task cannot be submitted for QA.'}
        </p>
        {task.isDefect && blockedTasks.length === 0 && <div className={styles.empty}>This defect is not blocking any task.</div>}
        {!task.isDefect && blockingDefects.length === 0 && <div className={styles.empty}>No defects linked as blocking.</div>}
        {task.isDefect && blockedTasks.map((t) => (
          <div key={t.id} style={{ padding: 'var(--space-3) 0', borderTop: '1px solid var(--color-border)' }}>
            <p style={{ margin: 0 }}>
              <Link href={`/tasks/${t.id}`}>#{t.id} - {t.title}</Link> <StatusBadge status={t.status} />
            </p>
            <p className={styles.issueMeta} style={{ margin: 'var(--space-1) 0 0' }}>
              {t.linkType === 'spun-off' ? 'Raised from this task\'s QA rejection' : 'Linked as blocking'}
            </p>
            {canChangeBlockingLinks && t.linkType === 'manual' && (
              <button
                className={styles.buttonSecondary}
                type="button"
                style={{ marginTop: 'var(--space-2)' }}
                aria-label={`Unlink Task #${t.id}`}
                onClick={() => handleUnlinkBlocking(t.id, task.id)}
              >
                Unlink
              </button>
            )}
          </div>
        ))}
        {!task.isDefect && blockingDefects.map((d) => (
          <div key={d.id} style={{ padding: 'var(--space-3) 0', borderTop: '1px solid var(--color-border)' }}>
            <p style={{ margin: 0 }}>
              <Link href={`/tasks/${d.id}`}>#{d.id} - {d.title}</Link> <StatusBadge status={d.status} />
            </p>
            <p className={styles.issueMeta} style={{ margin: 'var(--space-1) 0 0' }}>
              Assignee: {d.assigneeEmail} &middot; Linked by {d.linkedByEmail} &middot; {formatDate(d.linkedAt)}
            </p>
            {canChangeBlockingLinks && (
              <button
                className={styles.buttonSecondary}
                type="button"
                style={{ marginTop: 'var(--space-2)' }}
                aria-label={`Unlink Defect #${d.id}`}
                onClick={() => handleUnlinkBlocking(task.id, d.id)}
              >
                Unlink
              </button>
            )}
          </div>
        ))}
        {canChangeBlockingLinks && (
          <div style={{ marginTop: 'var(--space-3)' }}>
            <SearchSelectField
              label={task.isDefect ? 'Link Blocked Task' : 'Link Blocking Defect'}
              id="blockingLinkSelect"
              value={blockingSelection}
              onChange={setBlockingSelection}
              options={blockingCandidateOptions}
            />
            <div className={styles.actions}>
              <button
                className={`${styles.button} ${styles.buttonAccent}`}
                type="button"
                disabled={!blockingSelection || savingBlockingLink}
                onClick={handleLinkBlocking}
              >
                {savingBlockingLink ? 'Linking...' : 'Link'}
              </button>
            </div>
          </div>
        )}
      </div>

      {isAssignee && !hasPendingQaReview && isAlreadyApproved && !isJunk && (
        <div className={styles.card} style={{ marginBottom: 'var(--space-4)' }}>
          <p style={{ margin: 0 }}>
            Approved {latestDecidedReview.reviewType === 'peer' ? 'in Peer Review' : 'by QA'}
            {latestDecidedReview.reviewedByFullName ? ` by ${latestDecidedReview.reviewedByFullName}` : ''}
            {latestDecidedReview.reviewedAt ? ` on ${formatDate(latestDecidedReview.reviewedAt)}` : ''}. Need a re-check? Ask a
            Program Manager or QA to reopen it.
          </p>
        </div>
      )}

      {isAssignee && isEscalated && (
        <div className={styles.card} style={{ marginBottom: 'var(--space-4)' }}>
          <h2 className={styles.cardTitle}>
            Sent to PM for Intervention
          </h2>
          <p style={{ margin: 0 }}>
            QA sent this task to PM for intervention instead of approving or rejecting it. It's waiting in the PM Interventions queue -
            you can&apos;t resubmit it until PM reassigns it.
          </p>
        </div>
      )}

      {isAssignee && !hasPendingQaReview && !isEscalated && canSubmitForReview && !usesPeerReview && (openDependencyTickets.length > 0 || openLinkedDefects.length > 0) && (
        <div id="task-action-submit" tabIndex={-1} className={styles.card} style={{ marginBottom: 'var(--space-4)' }}>
          <h2 className={styles.cardTitle}>
            {task.pmReviewGateOn ? 'Submit for review (PM first, then QA)' : 'Submit for QA Testing'}
          </h2>
          {openDependencyTickets.length > 0 && (
            <div className={styles.error}>
              Cannot submit for QA - resolve the open dependency {openDependencyTickets.length === 1 ? 'ticket' : 'tickets'}{' '}
              {openDependencyTickets.map((t) => `#${t.id}`).join(', ')} first.
            </div>
          )}
          {openLinkedDefects.length > 0 && (
            <div className={styles.error} style={{ marginTop: openDependencyTickets.length > 0 ? 'var(--space-2)' : 0 }}>
              Cannot submit for QA - blocked by unresolved {openLinkedDefects.length === 1 ? 'Defect' : 'Defects'}{' '}
              {openLinkedDefects.map((d) => `#${d.id}`).join(', ')}. Resolve it first.
            </div>
          )}
        </div>
      )}

      {isAssignee && !hasPendingQaReview && !isEscalated && canSubmitForReview && !usesPeerReview && openDependencyTickets.length === 0 && openLinkedDefects.length === 0 && (
        <form id="task-action-submit" tabIndex={-1} onSubmit={handleSubmitForQa} className={styles.card} style={{ marginBottom: 'var(--space-4)' }}>
          <h2 className={styles.cardTitle}>
            {task.pmReviewGateOn ? 'Submit for review (PM first, then QA)' : 'Submit for QA Testing'}
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

      {isAssignee && !hasPendingQaReview && !isEscalated && canSubmitForReview && usesPeerReview && (
        <form id="task-action-submit" tabIndex={-1} onSubmit={handleSubmitForPeerReview} className={styles.card} style={{ marginBottom: 'var(--space-4)' }}>
          <h2 className={styles.cardTitle}>
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

      {canActOnPmReview && (
        <div id="pm-review" tabIndex={-1} className={styles.card} style={{ marginBottom: 'var(--space-4)' }}>
          <h2 className={styles.cardTitle}>
            PM review
          </h2>
          <p className={styles.helpText} style={{ marginTop: 0 }}>
            Check the description above and the resolution and evidence below, then send it to QA or back to the developer. Time
            waiting here never counts against the developer.
          </p>
          <p style={{ margin: 0, fontWeight: 600 }}>Resolution:</p>
          <RichTextDisplay value={latestQaReview.resolution} />
          {latestQaReview.artifacts.map((artifact) => (
            <p key={artifact.id} className={styles.issueMeta} style={{ margin: 'var(--space-1) 0 0' }}>
              Evidence: {artifact.type} &middot;{' '}
              <a href={artifact.url} target="_blank" rel="noreferrer">{artifact.url}</a>
            </p>
          ))}
          <p className={styles.issueMeta} style={{ margin: 'var(--space-1) 0 0' }}>
            Submitted by {latestQaReview.submittedByFullName || latestQaReview.submittedByEmail} &middot; {formatDate(latestQaReview.submittedAt)}
            {' '}&middot; PM round {qaReviews.filter((r) => r.reviewType === 'pm').length}
          </p>

          {!showPmSendBack ? (
            <>
              <div className={styles.field} style={{ marginTop: 'var(--space-3)' }}>
                <label className={styles.label} htmlFor="tdPmToQaComment">Note for QA (optional)</label>
                <RichTextEditor id="tdPmToQaComment" placeholder="Anything QA should know" value={pmToQaComment} onChange={setPmToQaComment} />
              </div>
              <div className={styles.actions}>
                <button className={`${styles.button} ${styles.buttonAccent}`} type="button" onClick={handlePmSendToQa} disabled={pmBusy}>
                  {pmBusy ? 'Working...' : 'Send to QA'}
                </button>
                <button className={styles.button} type="button" onClick={() => setShowPmSendBack(true)} disabled={pmBusy}>
                  Send back to developer
                </button>
              </div>
            </>
          ) : (
            <form onSubmit={handlePmSendBack} style={{ marginTop: 'var(--space-3)' }}>
              <div className={styles.field}>
                <label className={styles.label} htmlFor="tdPmSendBackComment">Feedback for the developer (required)</label>
                <RichTextEditor
                  id="tdPmSendBackComment"
                  placeholder="What should the developer refine before this goes to QA?"
                  value={pmSendBackComment}
                  onChange={setPmSendBackComment}
                />
                <ReasonHint
                  id="tdPmSendBackHint"
                  length={stripHtmlForPreview(pmSendBackComment).trim().length}
                  min={1}
                  attempted={pmSendBackAttempted}
                  emptyMessage="Write feedback for the developer before sending it back."
                />
              </div>
              <div className={styles.actions}>
                <button className={`${styles.button} ${styles.buttonAccent}`} type="submit" disabled={pmBusy}>
                  {pmBusy ? 'Working...' : 'Confirm send back'}
                </button>
                <button
                  className={styles.button}
                  type="button"
                  onClick={() => {
                    setShowPmSendBack(false);
                    setPmSendBackAttempted(false);
                  }}
                  disabled={pmBusy}
                >
                  Cancel
                </button>
              </div>
            </form>
          )}
        </div>
      )}

      {failedShotUploads.length > 0 && (
        <div className={styles.card} role="alert" style={{ marginBottom: 'var(--space-4)', borderLeft: '4px solid var(--ds-color-error)' }}>
          <h2 className={styles.cardTitle}>Some screenshots were not attached</h2>
          <p className={styles.helpText} style={{ marginTop: 0 }}>
            Your decision was saved. These screenshots are still here - try again, or discard them.
          </p>
          <ul style={{ margin: '0 0 var(--space-3)', paddingLeft: 'var(--space-5)' }}>
            {failedShotUploads.map((job) => (
              <li key={job.path}>
                {job.shots.length} screenshot{job.shots.length === 1 ? '' : 's'} for {job.label}: {job.error}
              </li>
            ))}
          </ul>
          <div className={styles.actions}>
            <button className={`${styles.button} ${styles.buttonAccent}`} type="button" onClick={retryFailedShotUploads}>
              Retry upload
            </button>
            <button className={styles.buttonSecondary} type="button" onClick={() => setFailedShotUploads([])}>
              Discard
            </button>
          </div>
        </div>
      )}

      {canActOnQaReview && hasPendingQaReview && (
        <div id="task-action-qa-review" tabIndex={-1} className={styles.card} style={{ marginBottom: 'var(--space-4)' }} data-screenshot-scope>
          <h2 className={styles.cardTitle}>
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
            <ScreenshotAttach
              screenshots={qaShots}
              onChange={setQaShots}
              disabled={qaActionBusy}
              itemNoun="decision"
              hint="They're attached to your Approve, Reject or Intervention."
            >
              <button className={styles.buttonSecondary} type="button" onClick={addQaArtifactRow}>
                + Add Artifact
              </button>
            </ScreenshotAttach>
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
                  Send to PM for Intervention
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
                  {artifactUrlHistory.length > 0 && (
                    <datalist id={ARTIFACT_URL_HISTORY_DATALIST_ID}>
                      {artifactUrlHistory.map((url) => <option key={url} value={url} />)}
                    </datalist>
                  )}
                  <label className={styles.label}>Artifacts (optional)</label>
                  <p className={styles.helpText} style={{ marginTop: 0 }}>
                    Shared evidence attached to every defect created below - enter it once, not per defect. Start
                    typing in the URL field to see recently-used links.
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
                          list={artifactUrlHistory.length > 0 ? ARTIFACT_URL_HISTORY_DATALIST_ID : undefined}
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
                      data-screenshot-scope
                      style={{ padding: 'var(--space-3)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', marginBottom: 'var(--space-3)' }}
                    >
                      <div className={styles.actions} style={{ justifyContent: 'space-between', marginTop: 0 }}>
                        <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                          <strong>Defect {index + 1}</strong>
                          {rejectDraftHydrated &&
                            (draft.title.trim() || stripHtmlForPreview(draft.description).trim() || draft.assignee) && (
                              <span
                                style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)', color: 'var(--color-teal-dark)', fontSize: 12 }}
                              >
                                <CheckCircle2 size={14} /> Saved
                              </span>
                            )}
                        </span>
                        <span style={{ display: 'flex', gap: 'var(--space-2)' }}>
                          <button className={styles.buttonSecondary} type="button" onClick={() => duplicateLinkedDefectDraft(index)}>
                            Duplicate
                          </button>
                          {linkedDefectDrafts.length > 1 && (
                            <button className={styles.buttonSecondary} type="button" onClick={() => removeLinkedDefectDraft(index)}>
                              Remove
                            </button>
                          )}
                        </span>
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
                        {findPossibleDuplicateDefectWarning(index) && (
                          <p
                            style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)', color: 'var(--color-amber-dark)', fontSize: 12, margin: 'var(--space-1) 0 0' }}
                          >
                            <AlertTriangle size={14} /> {findPossibleDuplicateDefectWarning(index)} - check before creating.
                          </p>
                        )}
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
                      <div className={styles.field}>
                        <span className={styles.label}>Screenshots for defect {index + 1} (optional)</span>
                        <ScreenshotAttach
                          screenshots={linkedDefectShots[index] || []}
                          onChange={(shots) => setLinkedDefectShotsAt(index, shots)}
                          disabled={qaActionBusy}
                          hint="They're attached to this defect when you confirm the rejection."
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
                <label className={styles.label} htmlFor="tdEscalateComment">Intervention Comment</label>
                <RichTextEditor
                  id="tdEscalateComment"
                  placeholder="Explain why this needs PM's attention instead of a straightforward pass/fail (e.g. resolution is unclear or unrelated to the task)"
                  value={escalateComment}
                  onChange={setEscalateComment}
                />
              </div>
              <div className={styles.actions}>
                <button className={`${styles.button} ${styles.buttonAccent}`} type="submit" disabled={qaActionBusy}>
                  {qaActionBusy ? 'Working...' : 'Confirm Intervention'}
                </button>
                <button className={styles.button} type="button" onClick={() => setShowEscalateForm(false)} disabled={qaActionBusy}>
                  Cancel
                </button>
              </div>
            </form>
          )}
        </div>
      )}

      {canActOnPeerReview && hasPendingQaReview && (
        <div id="task-action-peer-review" tabIndex={-1} className={styles.card} style={{ marginBottom: 'var(--space-4)' }}>
          <h2 className={styles.cardTitle}>
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
              {/* Backend mirror: PeerReviewsService.approve()'s open
                  dependency / linked defect check - Reject stays open. */}
              {openDependencyTickets.length > 0 && (
                <div className={styles.error} role="alert" style={{ marginTop: 'var(--space-2)' }}>
                  Cannot approve this Peer Review - resolve the open dependency {openDependencyTickets.length === 1 ? 'ticket' : 'tickets'}{' '}
                  {openDependencyTickets.map((t) => `#${t.id}`).join(', ')} first.
                </div>
              )}
              {openLinkedDefects.length > 0 && (
                <div className={styles.error} role="alert" style={{ marginTop: 'var(--space-2)' }}>
                  Cannot approve this Peer Review - blocked by unresolved {openLinkedDefects.length === 1 ? 'Defect' : 'Defects'}{' '}
                  {openLinkedDefects.map((d) => `#${d.id}`).join(', ')}. Resolve it first.
                </div>
              )}
              <div className={styles.actions}>
                <button
                  className={`${styles.button} ${styles.buttonAccent}`}
                  type="button"
                  onClick={handlePeerReviewApprove}
                  disabled={qaActionBusy || openDependencyTickets.length > 0 || openLinkedDefects.length > 0}
                >
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

      </div>

      <div role="tabpanel" id="task-panel-history" aria-labelledby="task-tab-history" hidden={activeTab !== 'history'}>
      <div className={styles.card}>
        <h2 className={styles.cardTitle}>
          Timeline
        </h2>
        <ReviewTimeline reviews={qaReviews} decisionScreenshots={decisionShots} />
        <h2 className={styles.cardTitle}>
          All rounds
        </h2>
        <Table
          columns={qaReviewColumns}
          rows={[...qaReviews].sort((a, b) => a.roundNumber - b.roundNumber)}
          rowClassName={(review) => (review.status === 'rejected' ? styles.rowRejected : '')}
          emptyState="No QA review rounds yet."
          bodyVerticalAlign="top"
        />
      </div>
      </div>
    </AppShell>
  );
}
