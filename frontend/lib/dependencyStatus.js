export const STATUS_OPTIONS = ['Open', 'Under Review', 'Assigned', 'In Progress', 'Resolved', 'Closed', 'Blocked', 'Escalated'];
export const BLOCKED_STATUSES = ['Blocked', 'Escalated'];
export const RESOLVED_STATUSES = ['Resolved', 'Closed'];
export const PRIORITY_OPTIONS = ['Critical', 'High', 'Medium', 'Low'];
export const IMPACT_OPTIONS = ['Critical', 'High', 'Medium', 'Low'];

export function formatDate(value) {
  if (!value) return '—';
  return new Date(value).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export function formatDateTime(value) {
  if (!value) return '—';
  return new Date(value).toLocaleString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

// Collapses the entity's 8 workflow statuses down to the 3 buckets an
// inbox actually needs to scan at a glance - the precise status is still
// shown as the badge text, this just drives the color.
export function statusBucketStyle(status) {
  if (BLOCKED_STATUSES.includes(status)) {
    return { background: 'var(--color-red-tint)', color: 'var(--color-red-dark)', border: 'var(--color-red)' };
  }
  if (RESOLVED_STATUSES.includes(status)) {
    return { background: 'var(--color-teal-tint)', color: 'var(--color-teal-dark)', border: 'var(--color-teal)' };
  }
  return { background: 'var(--color-moss-tint)', color: 'var(--color-moss-dark)', border: 'var(--color-moss)' };
}

// Overdue -> red, due within 2 days -> amber, otherwise neutral - so the
// due-date chip carries its own urgency signal without needing the row's
// status to also be "Blocked".
export function dueMeta(requiredByDate) {
  if (!requiredByDate) return null;
  const due = new Date(requiredByDate);
  const today = new Date(new Date().toDateString());
  const diffDays = Math.round((due - today) / 86400000);
  if (diffDays < 0) {
    return { label: `Overdue · ${formatDate(requiredByDate)}`, style: { background: 'var(--color-red-tint)', color: 'var(--color-red-dark)' } };
  }
  if (diffDays <= 2) {
    return { label: `Due ${formatDate(requiredByDate)}`, style: { background: 'var(--color-moss-tint)', color: 'var(--color-moss-dark)' } };
  }
  return { label: `Due ${formatDate(requiredByDate)}`, style: { background: 'var(--color-slate-tint)', color: 'var(--color-ink-soft)' } };
}

// Same ownership rule as DependenciesService.canEdit on the backend - kept
// in sync so the UI can hide controls that would just 403, without being
// the actual authorization boundary (the server still enforces this).
export function canEditDependency(dependency, currentUser) {
  if (!currentUser) return false;
  if (currentUser.role === 'admin' || currentUser.role === 'program_manager') return true;
  return dependency.ownerUserId === currentUser.id || dependency.createdByUserId === currentUser.id;
}
