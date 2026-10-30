// Performance Tracking O4 - escalation reason codes (2026-10-30,
// fast-track: the open rules are settings or defaults listed for the
// Technical Director in /home/ec2-user/perf-tracking-defaults.md). Pure.
//
//  * On a project with Performance Tracking ON, QA's "Escalate to PM"
//    needs a reason from the editable list (performance_tracking_settings.
//    escalationReasons: code, label, avoidable). The round keeps the code
//    and the avoidable flag as they were then (editing the list never
//    changes history). Projects with tracking off: no reason, as before.
//  * Codes are fixed once made; labels and the avoidable flag can change;
//    a reason can be removed (past rounds keep their code).
//  * O4 (metrics/tracking-metrics.ts) = avoidable escalations of the
//    person's QA rounds per 10 of their QA rounds decided in the window
//    (lower is better); details split by reason.

export interface EscalationReason {
  code: string;
  label: string;
  avoidable: boolean;
}

export const DEFAULT_ESCALATION_REASONS: EscalationReason[] = [
  { code: 'developer_unresponsive', label: 'Developer not responding', avoidable: true },
  { code: 'missing_information', label: 'Missing information from the developer', avoidable: true },
  { code: 'repeated_failure', label: 'Same problem failed again', avoidable: true },
  { code: 'requirement_unclear', label: 'Requirement unclear or disputed', avoidable: false },
  { code: 'scope_change', label: 'Scope change needed', avoidable: false },
  { code: 'environment', label: 'Environment or access problem', avoidable: false },
  { code: 'other', label: 'Other', avoidable: false },
];

export const CODE = /^[a-z][a-z0-9_]{1,39}$/;

// A code for a new label: lower case, underscores.
export function codeFor(label: string): string {
  const base = label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 36);
  return /^[a-z]/.test(base) ? base : `r_${base}`.slice(0, 39);
}

// The list as saved: 1-20 reasons, labels 2-80 characters, distinct codes
// and labels. Returns the problem, or null.
export function reasonsProblem(reasons: EscalationReason[]): string | null {
  if (!Array.isArray(reasons) || reasons.length < 1 || reasons.length > 20) return 'Keep 1 to 20 escalation reasons.';
  for (const r of reasons) {
    if (!r || typeof r.label !== 'string' || r.label.trim().length < 2 || r.label.trim().length > 80) return 'Each escalation reason needs 2 to 80 characters.';
    if (typeof r.code !== 'string' || !CODE.test(r.code)) return `Bad reason code "${r?.code}".`;
    if (typeof r.avoidable !== 'boolean') return 'Each escalation reason must say whether it is avoidable.';
  }
  if (new Set(reasons.map((r) => r.code)).size !== reasons.length) return 'Escalation reason codes must be different.';
  if (new Set(reasons.map((r) => r.label.trim().toLowerCase())).size !== reasons.length) return 'Escalation reasons must be different.';
  return null;
}
