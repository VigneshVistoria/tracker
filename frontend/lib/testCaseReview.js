// PM review gate on test cases - mirrors TestCaseReviewStatus in
// backend/src/test-cases/test-case.entity.ts. Shared by the Test Cases
// list and detail pages.
export const REVIEW_STATUS = {
  DRAFT: 'Draft',
  PENDING: 'Pending Review',
  READY: 'Ready for Execution',
  REJECTED: 'Rejected',
};

export const REVIEW_STATUS_OPTIONS = [REVIEW_STATUS.DRAFT, REVIEW_STATUS.PENDING, REVIEW_STATUS.READY, REVIEW_STATUS.REJECTED];

// Statuses QA can send to the PM from.
export const SUBMITTABLE_REVIEW_STATUSES = [REVIEW_STATUS.DRAFT, REVIEW_STATUS.REJECTED];

export const REVIEW_BADGE_STYLE = {
  [REVIEW_STATUS.DRAFT]: { background: 'var(--ds-bg-surface-sunken)', color: 'var(--ds-text-secondary)' },
  [REVIEW_STATUS.PENDING]: { background: 'var(--ds-color-warning-tint)', color: 'var(--ds-color-warning-dark)' },
  [REVIEW_STATUS.READY]: { background: 'var(--ds-color-success-tint)', color: 'var(--ds-color-success-dark)' },
  [REVIEW_STATUS.REJECTED]: { background: 'var(--ds-color-error-tint)', color: 'var(--ds-color-error-dark)' },
};
