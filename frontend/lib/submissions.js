// Review history as one card per submission (2026-11-04). Display only.
//
// A submission is what the assignee sent; review rounds are what happened
// to it. One submission can have several rounds:
//  - PM review gate: the PM's 'pm' round, then the QA round the PM's
//    "Send to QA" created (same note and artifacts, new submit time);
//  - a reverted QA decision re-opens the same submission as a fresh
//    pending round (same submit time).
// Every other new round is a new submission (a resubmission).

export function groupSubmissions(reviews = []) {
  const rounds = [...reviews].sort((a, b) => a.roundNumber - b.roundNumber);
  const groups = [];
  for (const r of rounds) {
    const g = groups[groups.length - 1];
    const last = g?.rounds[g.rounds.length - 1];
    const sameSubmission =
      last &&
      last.submittedByUserId === r.submittedByUserId &&
      (String(last.submittedAt) === String(r.submittedAt) ||
        (last.reviewType === 'pm' && last.status === 'approved') ||
        last.status === 'reverted');
    if (sameSubmission) {
      g.rounds.push(r);
    } else {
      groups.push({ number: groups.length + 1, rounds: [r] });
    }
  }
  return groups.map((g) => {
    const first = g.rounds[0];
    const latest = g.rounds[g.rounds.length - 1];
    return {
      number: g.number,
      key: first.id ?? `round-${first.roundNumber}`,
      rounds: g.rounds,
      submittedAt: first.submittedAt,
      submittedByFullName: first.submittedByFullName,
      submittedByUserId: first.submittedByUserId,
      resolution: first.resolution,
      submissionChecklist: first.submissionChecklist ?? null,
      // The artifacts are copied to every round of the submission - show them once.
      artifacts: first.artifacts || [],
      reviewType: latest.reviewType,
      outcome: roundOutcome(latest),
    };
  });
}

// { tone: success|error|warning|info|neutral, text } - always text, never colour alone.
export function roundOutcome(r) {
  if (!r) return null;
  if (r.reviewType === 'pm') {
    if (r.status === 'pending') return { tone: 'info', text: 'Waiting for PM' };
    if (r.status === 'approved') return { tone: 'neutral', text: 'Sent to QA by PM' };
    if (r.status === 'rejected') return { tone: 'error', text: 'Sent back by PM' };
  }
  switch (r.status) {
    case 'pending':
      return { tone: 'info', text: 'Awaiting review' };
    case 'approved':
      return { tone: 'success', text: 'Passed' };
    case 'rejected':
      return { tone: 'error', text: r.testFailedReason ? `Failed: ${r.testFailedReason}` : 'Failed' };
    case 'not_ready':
      return { tone: 'error', text: r.notReadyReason ? `Not ready: ${r.notReadyReason}` : 'Not ready' };
    case 'escalated':
      return { tone: 'warning', text: 'Escalated to PM' };
    case 'withdrawn':
      return { tone: 'neutral', text: 'Sent back by PM before QA review' };
    case 'reverted': {
      const decided = roundOutcome({ ...r, status: r.revertedDecision || 'pending' });
      return { tone: 'neutral', text: `${decided.text}, then reverted` };
    }
    default:
      return { tone: 'neutral', text: r.status };
  }
}

// Readable names for the submission artifact types (the stored values stay as they are).
const ARTIFACT_LABELS = {
  'APK Build': 'Build / APK',
  'Pull Request Link': 'Pull request',
  'Build Pipeline Link': 'Pipeline',
  'Deployment Report': 'Deployment report',
  'Screenshot': 'Screenshot',
  'Demo Video': 'Demo video',
  'Technical Documentation': 'Technical documentation',
  'Design file': 'Design file',
  'Prototype': 'Prototype',
  'Design spec': 'Design spec',
};

// "Pull request", or "Pull request 2" when a submission has more than one.
// renamed: { [code]: name } for submission types an Admin/PM renamed
// (renamedArtifactLabels() in lib/artifactTypes.js) - never passed for QA
// evidence, whose types are a separate list.
export function labelArtifacts(artifacts = [], renamed = {}) {
  const totals = {};
  for (const a of artifacts) totals[a.type] = (totals[a.type] || 0) + 1;
  const seen = {};
  return artifacts.map((a) => {
    seen[a.type] = (seen[a.type] || 0) + 1;
    const name = renamed[a.type] || ARTIFACT_LABELS[a.type] || a.type;
    return { ...a, label: totals[a.type] > 1 ? `${name} ${seen[a.type]}` : name };
  });
}
