// Shared between Create/UpdateTaskDependencyTicketDto and
// scripts/backfill-task-dependency-ticket-titles.js, which must stay in
// sync with this by hand (standalone script, not compiled from this file -
// same convention as tasks/task-title.constants.ts). Shorter than
// TASK_TITLE_MAX_LENGTH (150) on purpose - a dependency title is meant to
// be a one-line scannable label (confirmed with the user 2026-10).
export const TASK_DEPENDENCY_TICKET_TITLE_MAX_LENGTH = 100;
