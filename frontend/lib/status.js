export const STATUS_OPTIONS = ['Open', 'In Progress', 'Client Review', 'Closed'];
export const MODE_OPTIONS = ['Auto', 'Manual'];

const RAIL_CLASS = {
  Open: 'railOpen',
  'In Progress': 'railInProgress',
  'Client Review': 'railReview',
  Closed: 'railClosed',
};

const BADGE_CLASS = {
  Open: 'badgeOpen',
  'In Progress': 'badgeInProgress',
  'Client Review': 'badgeClientReview',
  Closed: 'badgeClosed',
};

export function railClassFor(status, styles) {
  return styles[RAIL_CLASS[status]] || '';
}

export function badgeClassFor(status, styles) {
  return styles[BADGE_CLASS[status]] || '';
}
