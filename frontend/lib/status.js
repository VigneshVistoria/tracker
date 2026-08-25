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
export const CAN_CREATE_TICKET_ROLES = ['admin', 'program_manager', 'qa', 'executive'];
export function canCreateTickets(role) {
  return CAN_CREATE_TICKET_ROLES.includes(role);
}

export const ROLE_LABELS = {
  admin: 'Admin',
  program_manager: 'Program Manager',
  developer: 'Developer',
  qa: 'QA',
  executive: 'Executive',
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

export function railClassFor(status, styles) {
  return styles[RAIL_CLASS[status]] || '';
}

export function badgeClassFor(status, styles) {
  return styles[BADGE_CLASS[status]] || '';
}
