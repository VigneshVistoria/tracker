import { useEffect, useState } from 'react';
import { groupSubmissions } from './submissions.js';
import { apiFetch } from './api';

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

// Stage 4 (2026-11-06): the menus come from Admin -> Submission Checklist
// Settings -> Artifact types (GET /submission-checklist/artifact-menu). The
// lists above stay as the fallback while it loads or if it fails, and are
// exactly what a role with no rules gets from the server too.
// One request shared by every component on the page; refreshed at most
// every 30 seconds, so an Admin's change shows up on the next page visit.
let menuCache = null;
let menuFetchedAt = 0;
let menuInflight = null;
const MENU_MAX_AGE_MS = 30000;

function loadArtifactMenu() {
  if (menuCache && Date.now() - menuFetchedAt < MENU_MAX_AGE_MS) return Promise.resolve(menuCache);
  if (!menuInflight) {
    menuInflight = apiFetch('/submission-checklist/artifact-menu')
      .then((m) => {
        menuCache = m;
        menuFetchedAt = Date.now();
        return m;
      })
      .finally(() => {
        menuInflight = null;
      });
  }
  return menuInflight;
}

export function useArtifactMenu() {
  const [menu, setMenu] = useState(menuCache);
  useEffect(() => {
    let live = true;
    loadArtifactMenu()
      .then((m) => {
        if (live) setMenu(m);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);
  return menu;
}

// The name people see for a stored artifact type (the code).
export function artifactLabel(menu, code) {
  return menu?.types?.find((t) => t.code === code)?.label ?? code;
}

// { [code]: label } for the types an Admin/PM renamed - only these replace
// the built-in short names on the submission cards.
export function renamedArtifactLabels(menu) {
  const out = {};
  for (const t of menu?.types || []) if (t.label !== t.code) out[t.code] = t.label;
  return out;
}

// [{ label, types: [{ code, label, required }] }] groups for the Artifact
// Type menu of the assignee's role.
export function artifactMenuGroups(assigneeRole, menu) {
  const fromServer = menu?.menus?.[assigneeRole] || menu?.menus?.developer;
  if (fromServer) return fromServer.groups;
  return artifactTypeGroups(assigneeRole).map((g) => ({ label: g.label, types: g.types.map((t) => ({ code: t, label: t, required: false })) }));
}

// Required types for the role, by name ([] when none).
export function requiredArtifactLabels(assigneeRole, menu) {
  return artifactMenuGroups(assigneeRole, menu).flatMap((g) => g.types.filter((t) => t.required).map((t) => t.label));
}

// [{ label, types }] groups for the Artifact Type menu - the built-in
// fallback (before Stage 4 this was the only source).
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
