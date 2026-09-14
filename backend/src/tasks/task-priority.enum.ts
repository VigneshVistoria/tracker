// Task-level priority - deliberately separate from the shared
// common/priority.enum.ts Priority enum (Critical/High/Medium/Low, used by
// Issue/Dependency/SLA config): this is a different, narrower vocabulary
// (Immediate/High/Medium, no Low) scoped to ProjectTask only, set solely by
// Program Manager (see TasksService.update()'s PRIORITY_MUTATE_ROLES
// check). Nullable on the entity - unset ("Not Set") is a valid, common
// state, never auto-assigned.
export enum TaskPriority {
  IMMEDIATE = 'Immediate',
  HIGH = 'High',
  MEDIUM = 'Medium',
}
