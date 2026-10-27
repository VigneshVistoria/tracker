// Defect classification + developer triage, Stage 1 (2026-10-27, confirmed
// with the user). Per project, OFF by default (Project.defectTriageEnabled,
// switched in Admin -> Defect Triage Settings by Admin or Program Manager).
// When a project is on:
//   - QA classifies every new defect - Create Defect and the linked defects
//     of a rejection - with severity, type, origin, build and environment
//     (ProjectTask.severity/defectType/defectOrigin/foundInBuild/
//     foundInEnvironment). Values come from editable lists and are kept as
//     the text picked, so editing a list never changes history.
//   - The assignee triages it within DEFAULT_TRIAGE_WORKING_DAYS working
//     day(s): Accept, or Dispute with a reason and a comment. Until then the
//     defect can't be submitted for QA (triageStatus 'pending').
//   - A dispute moves the defect to 'Disputed' and to the Program Manager.
//     While Disputed the developer's clock is paused (never overdue; the
//     working days waited are added to pmWaitWorkingDays on the decision,
//     the same allowance PM review and Return to QA use). A dispute is never
//     a QA rejection.
//   - The PM decides: reject the dispute (back to the developer, accepted),
//     or agree and close the defect, reassign it to another developer (fresh
//     triage clock for them) or convert it into a Backlog task (the defect
//     is closed, a new task is created).
//   - Late triage (decided after the due date, or still waiting past it) is
//     shown on the Non-compliance report and reminds the developer once. It
//     is information only - never a KPI penalty. A dispute whose reason is
//     marked notLateTriage (default: "Wrong assignee / not my area") never
//     counts as late triage.
// Defects already open when a project is switched on have triageStatus
// null: triage does not apply to them (they count as accepted). Turning a
// project off clears 'pending' on its defects the same way; Disputed ones
// stay with the PM until decided.
//
// One defect_triages row per defect per assignee holds the clock, the
// developer's decision and the PM's decision (DefectTriage entity).

export const DISPUTED_STATUS = 'Disputed';

export type TriageStatus = 'pending' | 'accepted' | 'disputed';
export type TriageDecision = 'accepted' | 'disputed' | 'superseded';
export type PmDisputeDecision = 'rejected' | 'closed' | 'reassigned' | 'converted';
export const PM_DISPUTE_DECISIONS: PmDisputeDecision[] = ['rejected', 'closed', 'reassigned', 'converted'];

export const CLASSIFICATION_FIELDS = ['severity', 'defectType', 'defectOrigin', 'foundInBuild', 'foundInEnvironment'] as const;
export type ClassificationField = (typeof CLASSIFICATION_FIELDS)[number];
export const CLASSIFICATION_LABELS: Record<ClassificationField, string> = {
  severity: 'Severity',
  defectType: 'Defect type',
  defectOrigin: 'Origin (found in)',
  foundInBuild: 'Build',
  foundInEnvironment: 'Environment',
};
export type DefectClassification = Partial<Record<ClassificationField, string | null>>;

export interface DisputeReason {
  label: string;
  // The developer must give the ticket number this one duplicates.
  needsTicket: boolean;
  // A dispute with this reason never counts as late triage.
  notLateTriage: boolean;
}

export interface DefectTriageSettings {
  severities: string[];
  types: string[];
  origins: string[];
  environments: string[];
  disputeReasons: DisputeReason[];
  // Classification fields QA must fill in a project that is switched on.
  requiredFields: ClassificationField[];
  triageWorkingDays: number;
}

export const DEFAULT_TRIAGE_WORKING_DAYS = 1;

// The starting lists the user approved on 2026-10-27.
export const DEFAULT_DEFECT_TRIAGE_SETTINGS: DefectTriageSettings = {
  severities: ['Critical', 'Major', 'Minor', 'Trivial'],
  types: [
    'Functional',
    'UI / layout',
    'Data / calculation',
    'Validation / error handling',
    'Performance',
    'Security / permissions',
    'Integration / API',
    'Compatibility (browser, device, OS)',
    'Content / text',
    'Configuration / environment',
  ],
  origins: ['QA testing (new work)', 'Regression testing', 'UAT', 'Production', 'Client reported', 'Internal (team member)'],
  environments: ['Development', 'QA / Test', 'Staging / UAT', 'Production'],
  disputeReasons: [
    { label: 'Duplicate', needsTicket: true, notLateTriage: false },
    { label: 'Cannot reproduce', needsTicket: false, notLateTriage: false },
    { label: 'As designed / works per specification', needsTicket: false, notLateTriage: false },
    { label: 'Change request', needsTicket: false, notLateTriage: false },
    { label: 'Environment or data issue, not a code defect', needsTicket: false, notLateTriage: false },
    { label: 'Wrong assignee / not my area', needsTicket: false, notLateTriage: true },
  ],
  requiredFields: [...CLASSIFICATION_FIELDS],
  triageWorkingDays: DEFAULT_TRIAGE_WORKING_DAYS,
};

export const LIST_ITEM_MAX = 100;
export const LIST_MAX_COUNT = 30;
export const BUILD_MAX = 100;
export const TRIAGE_WORKING_DAYS_MAX = 10;
export const DISPUTE_COMMENT_MIN = 10;
export const DISPUTE_TEXT_MAX = 2000;

// team_settings.defectTriageSettings as saved (possibly partial, or '{}'
// when never saved) -> the full settings, defaults filling any gap.
export function resolveDefectTriageSettings(raw: unknown): DefectTriageSettings {
  const saved = (raw && typeof raw === 'object' ? raw : {}) as Partial<DefectTriageSettings>;
  const list = (v: unknown, fallback: string[]) =>
    Array.isArray(v) && v.length > 0 && v.every((x) => typeof x === 'string') ? (v as string[]) : [...fallback];
  const d = DEFAULT_DEFECT_TRIAGE_SETTINGS;
  const reasons =
    Array.isArray(saved.disputeReasons) && saved.disputeReasons.length > 0
      ? saved.disputeReasons
          .filter((r) => r && typeof r.label === 'string')
          .map((r) => ({ label: r.label, needsTicket: !!r.needsTicket, notLateTriage: !!r.notLateTriage }))
      : d.disputeReasons.map((r) => ({ ...r }));
  const required = Array.isArray(saved.requiredFields)
    ? CLASSIFICATION_FIELDS.filter((f) => (saved.requiredFields as string[]).includes(f))
    : [...d.requiredFields];
  const days = Number.isInteger(saved.triageWorkingDays) && saved.triageWorkingDays! >= 1 ? saved.triageWorkingDays! : d.triageWorkingDays;
  return {
    severities: list(saved.severities, d.severities),
    types: list(saved.types, d.types),
    origins: list(saved.origins, d.origins),
    environments: list(saved.environments, d.environments),
    disputeReasons: reasons.length > 0 ? reasons : d.disputeReasons.map((r) => ({ ...r })),
    requiredFields: required,
    triageWorkingDays: days,
  };
}

// Which list a picked classification value must come from (build is free
// text).
export function optionsFor(settings: DefectTriageSettings, field: ClassificationField): string[] | null {
  switch (field) {
    case 'severity':
      return settings.severities;
    case 'defectType':
      return settings.types;
    case 'defectOrigin':
      return settings.origins;
    case 'foundInEnvironment':
      return settings.environments;
    default:
      return null;
  }
}

// Audit actions, kept with the feature.
export const DEFECT_TRIAGE_AUDIT = {
  ACCEPTED: 'defect_triage_accepted',
  DISPUTED: 'defect_triage_disputed',
  DISPUTE_DECIDED: 'defect_dispute_decided',
  CLASSIFICATION_UPDATED: 'defect_classification_updated',
  SETTINGS_UPDATED: 'defect_triage_settings_updated',
  PROJECT_SWITCHED: 'project_defect_triage_switched',
} as const;

export interface DefectDisputedEvent {
  tenantId: number;
  taskId: number;
  title: string;
  reason: string;
  qaUserId: number | null;
  actorUserId: number;
  actorEmail: string;
}

export interface DefectDisputeDecidedEvent {
  tenantId: number;
  taskId: number;
  title: string;
  decision: PmDisputeDecision;
  comment: string | null;
  developerUserId: number;
  qaUserId: number | null;
  convertedTaskId: number | null;
  actorUserId: number;
  actorEmail: string;
}

export interface DefectTriageOverdueEvent {
  tenantId: number;
  taskId: number;
  title: string;
  assigneeUserId: number;
  dueDate: string;
}
