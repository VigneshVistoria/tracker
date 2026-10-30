// Requests to a named person on a task - C1 response time (Performance
// Tracking B4, 2026-10-30). Pure - no Nest/TypeORM imports. Only while the
// task's project has tracking ON.
//
//  * "request": anyone who can see the task asks a named internal person
//    something (never themselves, never a client). The person is told
//    in-app and answers on the task page; the asker is told.
//  * "dependency": a dependency ticket counts as a request to its owner
//    (setting requestSources). The owner answers it on the task page, or
//    resolving the ticket counts as the answer - whichever is first.
//  * C1 = share answered within responseTargetWorkingHours (default 4) of
//    the person's own working hours; unanswered ones count once they are
//    past the target. Median working hours is shown next to it.
export const REQUEST_TEXT_MIN = 10;
export const RESPONSE_TEXT_MIN = 5;
export const REQUEST_TEXT_MAX = 2000;
export const REQUEST_CLOSED_STATUSES = ['Junk'];

export const TASK_REQUEST_AUDIT = {
  CREATED: 'task_request_created',
  ANSWERED: 'task_request_answered',
  DEPENDENCY_ANSWERED: 'task_dependency_ticket_answered',
} as const;

export interface TaskRequestEvent {
  tenantId: number;
  taskId: number;
  title: string;
  requestId: number;
  kind: 'created' | 'answered';
  // Who gets the notification.
  recipientUserId: number;
  text: string;
  actorUserId: number;
  actorEmail: string;
}
