// New workflow statuses (replacing the old Open/In Progress/Client
// Review/Closed model). Reuses the same underlying CSS classes/colors so
// no stylesheet changes were needed - just remapped labels.
export const STATUS_OPTIONS = ['Backlog', 'In Progress', 'In Review', 'QA Testing', 'QA Failed', 'Ready for Production'];
export const MODE_OPTIONS = ['Auto', 'Manual'];
export const CATEGORY_OPTIONS = ['New Feature', 'Enhancement', 'Bug', 'Critical', 'Showstopper', 'Defect'];

// Mirrors IssuesService.ROLES_ALLOWED_TO_CREATE_TICKETS on the backend -
// kept here so the frontend can hide/disable the "New Issue" entry point
// for Developers instead of letting them fill out the whole form and get
// a 403 on submit.
export const CAN_CREATE_TICKET_ROLES = ['admin', 'program_manager', 'qa', 'executive', 'client'];
export function canCreateTickets(role) {
  return CAN_CREATE_TICKET_ROLES.includes(role);
}

export const ROLE_LABELS = {
  admin: 'Admin',
  program_manager: 'Program Manager',
  developer: 'Developer',
  qa: 'QA',
  executive: 'Executive',
  client: 'Client',
};
export function roleLabel(role) {
  return ROLE_LABELS[role] || role;
}

// Which forward moves a regular (non-admin) user can make directly via
// the status dropdown. Moving into "In Review", "QA Testing", or
// "Ready for Production" requires the dedicated Submit for Review /
// Program Manager / QA actions instead - kept here so the frontend can
// grey those options out rather than let someone pick them and get a
// confusing rejection from the API. QA Failed -> In Progress is a plain
// self-service move though (the assignee picking the ticket back up), same
// as Backlog <-> In Progress.
export const SELF_SERVICE_TRANSITIONS = {
  Backlog: ['Backlog', 'In Progress'],
  'In Progress': ['Backlog', 'In Progress'],
  'In Review': ['In Review'],
  'QA Testing': ['QA Testing'],
  'QA Failed': ['QA Failed', 'In Progress'],
  'Ready for Production': ['Ready for Production'],
};

const RAIL_CLASS = {
  Backlog: 'railOpen',
  'In Progress': 'railInProgress',
  'In Review': 'railReview',
  'QA Testing': 'railQa',
  'QA Failed': 'railQaFailed',
  'Ready for Production': 'railClosed',
};

const BADGE_CLASS = {
  Backlog: 'badgeOpen',
  'In Progress': 'badgeInProgress',
  'In Review': 'badgeClientReview',
  'QA Testing': 'badgeQa',
  'QA Failed': 'badgeQaFailed',
  'Ready for Production': 'badgeClosed',
};

// Shared by the issue detail page's status dropdown/action buttons and
// the Kanban board's drag-and-drop: given an issue, the column it's being
// moved to, and the current user, decides whether the move is allowed
// and which endpoint performs it. Mirrors IssuesService's backend rules
// exactly (ALLOWED_SELF_SERVICE_TRANSITIONS plus the dedicated
// submit-for-review/approve/reject/qa-approve/qa-reject actions) so the
// UI never offers a move the API would reject - Admin can reach any
// column via 'patch' for pairs with no dedicated action (matching the
// backend's unconditional Admin bypass), everyone else is limited to
// exactly what a real button on the detail page already allows them.
export function getIssueMoveAction(issue, targetStatus, currentUser) {
  const role = currentUser?.role;
  if (!role || role === 'executive' || role === 'client') {
    return { allowed: false };
  }
  if (targetStatus === issue.status) {
    return { allowed: false };
  }

  const isAdmin = role === 'admin';
  const isAssignee = currentUser.id === issue.assigneeUserId;
  const isProgramManager = role === 'program_manager';
  const isQa = role === 'qa';

  const selfService = SELF_SERVICE_TRANSITIONS[issue.status] || [];
  if (selfService.includes(targetStatus)) {
    return { allowed: true, action: 'patch' };
  }
  if (issue.status === 'In Progress' && targetStatus === 'In Review') {
    return { allowed: isAdmin || isAssignee, action: 'submit-for-review' };
  }
  if (issue.status === 'In Review' && targetStatus === 'QA Testing') {
    return { allowed: isAdmin || isProgramManager, action: 'approve' };
  }
  if (issue.status === 'In Review' && targetStatus === 'In Progress') {
    return { allowed: isAdmin || isProgramManager, action: 'reject' };
  }
  if (issue.status === 'QA Testing' && targetStatus === 'Ready for Production') {
    return { allowed: isAdmin || isQa, action: 'qa-approve' };
  }
  if (issue.status === 'QA Testing' && targetStatus === 'QA Failed') {
    return { allowed: isAdmin || isQa, action: 'qa-reject' };
  }
  // Any other column pair has no dedicated action - only Admin can reach
  // it, via a plain status PATCH (same bypass the backend grants Admin).
  return { allowed: isAdmin, action: 'patch' };
}

export function railClassFor(status, styles) {
  return styles[RAIL_CLASS[status]] || '';
}

export function badgeClassFor(status, styles) {
  return styles[BADGE_CLASS[status]] || '';
}
