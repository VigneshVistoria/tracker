// Shared across Issue, Dependency, and (later) Release/Risk records so SLA
// targets, escalation rules, and reporting can all key off one consistent
// set of values instead of each module defining its own.
export enum Priority {
  CRITICAL = 'Critical',
  HIGH = 'High',
  MEDIUM = 'Medium',
  LOW = 'Low',
}
