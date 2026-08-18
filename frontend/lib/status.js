// New workflow statuses (replacing the old Open/In Progress/Client
// Review/Closed model). Reuses the same underlying CSS classes/colors so
// no stylesheet changes were needed - just remapped labels.
export const STATUS_OPTIONS = ['Backlog', 'In Progress', 'In Review', 'Completed'];
export const MODE_OPTIONS = ['Auto', 'Manual'];
export const CATEGORY_OPTIONS = ['New Feature', 'Enhancement', 'Bug', 'Critical', 'Showstopper', 'Defect'];

// Which forward moves a regular (non-admin) user can make directly via
// the status dropdown. Moving into "In Review" or "Completed" requires
// the dedicated Submit for Review / Approve actions instead - kept here
// so the frontend can grey those options out rather than let someone
// pick them and get a confusing rejection from the API.
export const SELF_SERVICE_TRANSITIONS = {
  Backlog: ['Backlog', 'In Progress'],
  'In Progress': ['Backlog', 'In Progress'],
  'In Review': ['In Review'],
  Completed: ['Completed'],
};

const RAIL_CLASS = {
  Backlog: 'railOpen',
  'In Progress': 'railInProgress',
  'In Review': 'railReview',
  Completed: 'railClosed',
};

const BADGE_CLASS = {
  Backlog: 'badgeOpen',
  'In Progress': 'badgeInProgress',
  'In Review': 'badgeClientReview',
  Completed: 'badgeClosed',
};

export function railClassFor(status, styles) {
  return styles[RAIL_CLASS[status]] || '';
}

export function badgeClassFor(status, styles) {
  return styles[BADGE_CLASS[status]] || '';
}
