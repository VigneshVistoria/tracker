// Developer submission checklist, defect triage Stage 2 (2026-10-27,
// confirmed with the user). Per project, OFF by default
// (Project.submissionChecklistEnabled, Admin -> Submission Checklist
// Settings, Admin or Program Manager). When a project is on, Submit for QA
// (TaskQaReviewsService.submit() - also the submission that goes to the PM
// first under the PM review gate) is refused until the checklist is
// complete, with a message naming exactly what is missing:
//   - Root cause (defect fixes only): picked from an editable list; a cause
//     marked needsNote ("Other (explain)") also needs a note.
//   - What changed: the existing Resolution, plus a link - at least one
//     artifact of a "link" type (Pull Request Link / Build Pipeline Link).
//   - How to test: steps (required) and test data (optional by default).
//   - Evidence of self-test: at least one artifact of an "evidence" type
//     (Screenshot / Demo Video) or screenshots pasted on the form, which the
//     page uploads to the round right after (QaReviewAttachmentsService lets
//     the submitter attach to their own pending round).
//   - Areas possibly affected: text, or "None expected".
//   - Build + environment (environment from the Stage 1 list) and a tick
//     confirming the self-test was on them.
// Which items are required is set per kind (defect / task). Peer Review
// submissions are not affected. The checklist is stored on the round
// (TaskQaReview.submissionChecklist) with its labels, so editing the lists
// never changes history.

export type ChecklistItem = 'rootCause' | 'changeLink' | 'testSteps' | 'testData' | 'evidence' | 'affectedAreas' | 'buildConfirmation';
export const CHECKLIST_ITEMS: ChecklistItem[] = ['rootCause', 'changeLink', 'testSteps', 'testData', 'evidence', 'affectedAreas', 'buildConfirmation'];
export const CHECKLIST_LABELS: Record<ChecklistItem, string> = {
  rootCause: 'Root cause',
  changeLink: 'What changed - link',
  testSteps: 'How to test - steps',
  testData: 'How to test - test data',
  evidence: 'Evidence of self-test',
  affectedAreas: 'Areas possibly affected',
  buildConfirmation: 'Build and environment confirmation',
};

export interface RootCause {
  label: string;
  needsNote: boolean;
}

export interface SubmissionChecklistSettings {
  rootCauses: RootCause[];
  // Artifact types (TaskArtifactType values) that count as the change link
  // and as self-test evidence.
  linkArtifactTypes: string[];
  evidenceArtifactTypes: string[];
  required: { defect: ChecklistItem[]; task: ChecklistItem[] };
  // Minimum characters for the free-text items, so "." doesn't pass.
  minTextLength: number;
}

export const DEFAULT_SUBMISSION_CHECKLIST_SETTINGS: SubmissionChecklistSettings = {
  rootCauses: [
    { label: 'Coding error / logic mistake', needsNote: false },
    { label: 'Missed requirement', needsNote: false },
    { label: 'Requirement unclear or changed', needsNote: false },
    { label: 'Missing validation / edge case not handled', needsNote: false },
    { label: 'Regression from another change', needsNote: false },
    { label: 'Data issue', needsNote: false },
    { label: 'Configuration / environment', needsNote: false },
    { label: 'Third-party or integration issue', needsNote: false },
    { label: 'Design / UI specification gap', needsNote: false },
    { label: 'Merge / deployment error', needsNote: false },
    { label: 'Other (explain)', needsNote: true },
  ],
  linkArtifactTypes: ['Pull Request Link', 'Build Pipeline Link'],
  evidenceArtifactTypes: ['Screenshot', 'Demo Video'],
  required: {
    defect: ['rootCause', 'changeLink', 'testSteps', 'evidence', 'affectedAreas', 'buildConfirmation'],
    task: ['changeLink', 'testSteps', 'evidence', 'affectedAreas', 'buildConfirmation'],
  },
  minTextLength: 10,
};

export const CHECKLIST_TEXT_MAX = 4000;
export const CHECKLIST_SHORT_MAX = 100;
export const MIN_TEXT_LENGTH_MAX = 200;
export const MAX_SELF_TEST_SCREENSHOTS = 5;

// team_settings.submissionChecklistSettings as saved (possibly partial, or
// '{}' when never saved) -> the full settings, defaults filling any gap.
export function resolveSubmissionChecklistSettings(raw: unknown): SubmissionChecklistSettings {
  const saved = (raw && typeof raw === 'object' ? raw : {}) as Partial<SubmissionChecklistSettings>;
  const d = DEFAULT_SUBMISSION_CHECKLIST_SETTINGS;
  const strings = (v: unknown, fallback: string[]) =>
    Array.isArray(v) && v.length > 0 && v.every((x) => typeof x === 'string') ? (v as string[]) : [...fallback];
  const items = (v: unknown, fallback: ChecklistItem[]) =>
    Array.isArray(v) ? CHECKLIST_ITEMS.filter((i) => (v as string[]).includes(i)) : [...fallback];
  const causes =
    Array.isArray(saved.rootCauses) && saved.rootCauses.length > 0
      ? saved.rootCauses.filter((c) => c && typeof c.label === 'string').map((c) => ({ label: c.label, needsNote: !!c.needsNote }))
      : d.rootCauses.map((c) => ({ ...c }));
  const min = Number.isInteger(saved.minTextLength) && saved.minTextLength! >= 1 ? saved.minTextLength! : d.minTextLength;
  return {
    rootCauses: causes.length > 0 ? causes : d.rootCauses.map((c) => ({ ...c })),
    linkArtifactTypes: strings(saved.linkArtifactTypes, d.linkArtifactTypes),
    evidenceArtifactTypes: strings(saved.evidenceArtifactTypes, d.evidenceArtifactTypes),
    required: {
      defect: items(saved.required?.defect, d.required.defect),
      // Root cause is for defect fixes only.
      task: items(saved.required?.task, d.required.task).filter((i) => i !== 'rootCause'),
    },
    minTextLength: min,
  };
}

// What the developer sends with Submit for QA (QaSubmitTaskDto.checklist).
export interface SubmissionChecklistInput {
  rootCause?: string;
  rootCauseNote?: string;
  testSteps?: string;
  testData?: string;
  affectedAreas?: string;
  noAreasAffected?: boolean;
  build?: string;
  environment?: string;
  confirmedBuild?: boolean;
  selfTestScreenshots?: number;
}

// What is stored on the round.
export interface StoredSubmissionChecklist {
  kind: 'defect' | 'task';
  rootCause: string | null;
  rootCauseNote: string | null;
  testSteps: string | null;
  testData: string | null;
  affectedAreas: string | null;
  noAreasAffected: boolean;
  build: string | null;
  environment: string | null;
  confirmedBuild: boolean;
  linkArtifactTypes: string[];
  evidenceArtifactTypes: string[];
  selfTestScreenshots: number;
}

const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

// Checks the checklist against the settings and the submission's artifacts.
// Returns what to store, or the labels of what is missing / wrong.
export function evaluateChecklist(
  input: SubmissionChecklistInput | undefined,
  ctx: { isDefect: boolean; artifactTypes: string[]; settings: SubmissionChecklistSettings; environments: string[] },
): { missing: string[]; stored: StoredSubmissionChecklist } {
  const s = ctx.settings;
  const kind = ctx.isDefect ? 'defect' : 'task';
  const required = new Set(s.required[kind]);
  const i = input || {};
  const missing: string[] = [];
  const long = (v: string) => v.length >= s.minTextLength;

  let rootCause: string | null = null;
  let rootCauseNote: string | null = null;
  if (ctx.isDefect) {
    const cause = s.rootCauses.find((c) => c.label.toLowerCase() === text(i.rootCause).toLowerCase());
    const note = text(i.rootCauseNote);
    if (cause) {
      rootCause = cause.label;
      rootCauseNote = note || null;
      if (cause.needsNote && !long(note)) missing.push(`Root cause note (at least ${s.minTextLength} characters)`);
    } else if (text(i.rootCause)) {
      missing.push('Root cause (pick one from the list - it may have changed, reload the page)');
    } else if (required.has('rootCause')) {
      missing.push(CHECKLIST_LABELS.rootCause);
    }
  }

  const linkTypes = ctx.artifactTypes.filter((t) => s.linkArtifactTypes.includes(t));
  if (required.has('changeLink') && linkTypes.length === 0) {
    missing.push(`${CHECKLIST_LABELS.changeLink} (add a ${s.linkArtifactTypes.join(' or ')} artifact)`);
  }

  const testSteps = text(i.testSteps);
  if (required.has('testSteps') && !long(testSteps)) missing.push(`${CHECKLIST_LABELS.testSteps} (at least ${s.minTextLength} characters)`);
  const testData = text(i.testData);
  if (required.has('testData') && !long(testData)) missing.push(`${CHECKLIST_LABELS.testData} (at least ${s.minTextLength} characters)`);

  const evidenceTypes = ctx.artifactTypes.filter((t) => s.evidenceArtifactTypes.includes(t));
  const shots = Number.isInteger(i.selfTestScreenshots) ? Math.min(Math.max(i.selfTestScreenshots!, 0), MAX_SELF_TEST_SCREENSHOTS) : 0;
  if (required.has('evidence') && evidenceTypes.length === 0 && shots === 0) {
    missing.push(`${CHECKLIST_LABELS.evidence} (add a ${s.evidenceArtifactTypes.join(' or ')} artifact, or paste a screenshot)`);
  }

  const noAreas = !!i.noAreasAffected;
  const areas = noAreas ? '' : text(i.affectedAreas);
  if (required.has('affectedAreas') && !noAreas && !long(areas)) {
    missing.push(`${CHECKLIST_LABELS.affectedAreas} (at least ${s.minTextLength} characters, or tick "None expected")`);
  }

  const build = text(i.build);
  const envInput = text(i.environment);
  const environment = ctx.environments.find((e) => e.toLowerCase() === envInput.toLowerCase()) || null;
  if (envInput && !environment) missing.push('Environment (pick one from the list - it may have changed, reload the page)');
  if (required.has('buildConfirmation') && (!build || !environment || !i.confirmedBuild)) {
    missing.push(`${CHECKLIST_LABELS.buildConfirmation} (build, environment and the confirmation tick)`);
  }

  return {
    missing,
    stored: {
      kind,
      rootCause,
      rootCauseNote,
      testSteps: testSteps || null,
      testData: testData || null,
      affectedAreas: areas || null,
      noAreasAffected: noAreas,
      build: build || null,
      environment,
      confirmedBuild: !!i.confirmedBuild,
      linkArtifactTypes: linkTypes,
      evidenceArtifactTypes: evidenceTypes,
      selfTestScreenshots: shots,
    },
  };
}

export const SUBMISSION_CHECKLIST_AUDIT = {
  SETTINGS_UPDATED: 'submission_checklist_settings_updated',
  PROJECT_SWITCHED: 'project_submission_checklist_switched',
} as const;
