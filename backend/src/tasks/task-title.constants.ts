// Shared between every DTO that accepts ProjectTask.title
// (CreateTaskDto/CreateDefectTaskDto/UpdateTaskDto) and
// scripts/backfill-task-titles.js, which must stay in sync with this by
// hand (it's a standalone script, not compiled from this file - see that
// script's own comment).
export const TASK_TITLE_MAX_LENGTH = 150;
