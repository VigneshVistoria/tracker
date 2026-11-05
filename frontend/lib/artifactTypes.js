import { groupSubmissions } from './submissions.js';

// Submission artifact types (task "Ready for Feedback" / Peer Review),
// stored as TaskArtifactType on the backend. Design work (2026-11-05): when
// the assignee is a Designer, the design types come first, in their own
// group; the build/code types stay available below. Display only - any
// assignee may pick any type, and each type is still once per submission.
export const DEV_ARTIFACT_TYPES = [
  'APK Build',
  'Build Pipeline Link',
  'Deployment Report',
  'Pull Request Link',
  'Screenshot',
  'Demo Video',
  'Technical Documentation',
];

export const DESIGN_ARTIFACT_TYPES = ['Design file', 'Prototype', 'Design spec'];

export const ALL_ARTIFACT_TYPES = [...DEV_ARTIFACT_TYPES, ...DESIGN_ARTIFACT_TYPES];

// [{ label, types }] groups for the Artifact Type menu.
export function artifactTypeGroups(assigneeRole) {
  if (assigneeRole === 'designer') {
    return [
      { label: 'Design', types: [...DESIGN_ARTIFACT_TYPES, 'Screenshot', 'Demo Video'] },
      { label: 'Other', types: DEV_ARTIFACT_TYPES.filter((t) => t !== 'Screenshot' && t !== 'Demo Video') },
    ];
  }
  return [{ label: null, types: DEV_ARTIFACT_TYPES }];
}

// Which artifact types count as "the work itself" for the latest-work
// links shown above the submit form: prototype/handover for design,
// build/PR for development.
export function primaryArtifactTypes(assigneeRole) {
  return assigneeRole === 'designer'
    ? ['Prototype', 'Design file', 'Design spec']
    : ['APK Build', 'Pull Request Link', 'Build Pipeline Link', 'Deployment Report'];
}

// "Latest work" above the submit form (2026-11-05): the newest
// submission's links of the main kind for this role (prototype / design
// file / spec for a Designer; build / PR / pipeline / deployment report
// otherwise), or all its links when none of those were attached.
// null before the first submission.
export function latestWork(reviews, assigneeRole) {
  const submissions = groupSubmissions(reviews);
  const latest = submissions[submissions.length - 1];
  if (!latest || !latest.artifacts?.length) return null;
  const primary = primaryArtifactTypes(assigneeRole);
  const main = latest.artifacts.filter((a) => primary.includes(a.type));
  return { number: latest.number, submittedAt: latest.submittedAt, artifacts: main.length ? main : latest.artifacts };
}
