// Performance Tracking B3 (2026-10-30, fast-track plan approved by the
// user) - turning the nightly rows (../metrics/) into 1-5 scores. Pure -
// no Nest/TypeORM imports.
//
//  * A person's rows from every tracked project are combined: percent
//    metrics by adding numerators and denominators, counts by adding, O1/O2
//    (working days) as a sample-weighted average, O3 as total chases per
//    chasesPerTasks tasks due, Q4 as total escaped defects per
//    escapedPerTasks tasks released. Only rows from projects past their Baseline
//    count; if a person has none yet, the card says "Baseline - no scores
//    yet" and shows no score at all.
//  * Below the minimum sample (shared setting, default 5) a metric says
//    "Not enough data" and has no score.
//  * Bands (settings): percent metrics 5/4/3/2 at or above each of
//    percentBands (default 95/85/70/50), else 1 - for "lower is better"
//    percents (Q3 reopen rate) on 100 minus the value. Counts, working days
//    and rates where lower is better: 5/4/3/2 at or below each of
//    breachBands (default 0/1/2/3), else 1.
//  * O5 (self-initiated improvements) is shown as a count and not scored:
//    no band makes sense for "more is better" with no ceiling (default,
//    for the Technical Director to review).
//  * Competency score = the average of its scored metrics; overall = the
//    average of the competency scores. One decimal.
//  * A Technical Director override replaces one metric's score (reason
//    required, audited); the computed score is kept and shown next to it.
import { METRIC_INFO, TrackingMetric, TRACKING_METRICS } from '../metrics/tracking-metrics';

export const COMPETENCIES: Record<string, { label: string; metrics: TrackingMetric[] }> = {
  D: { label: 'Delivery', metrics: ['D1', 'D2', 'D3', 'D4'] },
  Q: { label: 'Quality', metrics: ['Q1', 'Q2', 'Q3', 'Q4'] },
  C: { label: 'Collaboration', metrics: ['C1', 'C2', 'C5'] },
  O: { label: 'Ownership', metrics: ['O1', 'O2', 'O3', 'O5'] },
  L: { label: 'Client focus', metrics: ['L1', 'L2'] },
};

export const UNSCORED_METRICS: TrackingMetric[] = ['O5'];

export type MetricState = 'scored' | 'baseline' | 'not_enough_data' | 'not_scored';

export interface SnapshotRowLike {
  projectId: number;
  userId: number;
  metric: string;
  phase: 'baseline' | 'scoring';
  value: number | null;
  numerator: number | null;
  denominator: number | null;
  sample: number;
  details: Record<string, any>;
}

export interface Bands {
  percentBands: number[];
  breachBands: number[];
}

export interface ActiveOverride {
  id: number;
  metric: string;
  overrideScore: number;
  originalScore: number | null;
  reason: string;
  createdByUserId: number;
  createdAt: Date;
  effectiveFrom: string;
}

export interface MetricScore {
  metric: TrackingMetric;
  label: string;
  unit: string;
  higherIsBetter: boolean;
  state: MetricState;
  value: number | null;
  sample: number;
  numerator: number | null;
  denominator: number | null;
  computedScore: number | null;
  score: number | null;
  override: ActiveOverride | null;
  projects: number[];
}

export interface PersonScorecard {
  userId: number;
  // 'baseline' = no project of theirs is past its Baseline yet.
  state: 'baseline' | 'scored' | 'not_enough_data';
  overall: number | null;
  competencies: Array<{ key: string; label: string; score: number | null }>;
  metrics: MetricScore[];
}

const r1 = (n: number) => Math.round(n * 10) / 10;
const r2 = (n: number) => Math.round(n * 100) / 100;

export function bandScore(metric: TrackingMetric, value: number, bands: Bands): number {
  const info = METRIC_INFO[metric];
  if (info.unit === 'percent') {
    const v = info.higherIsBetter ? value : 100 - value;
    const i = bands.percentBands.findIndex((b) => v >= b);
    return i === -1 ? 1 : 5 - i;
  }
  const i = bands.breachBands.findIndex((b) => value <= b);
  return i === -1 ? 1 : 5 - i;
}

// One metric for one person, from their rows in the scoring phase.
export function combineRows(metric: TrackingMetric, rows: SnapshotRowLike[]): { value: number | null; sample: number; numerator: number | null; denominator: number | null } {
  if (rows.length === 0) return { value: null, sample: 0, numerator: null, denominator: null };
  const sum = (k: 'numerator' | 'denominator' | 'sample' | 'value') => rows.reduce((s, r) => s + Number(r[k] ?? 0), 0);
  const sample = sum('sample');
  const info = METRIC_INFO[metric];
  if (info.unit === 'percent') {
    const n = sum('numerator');
    const d = sum('denominator');
    return { value: d > 0 ? r2((n / d) * 100) : null, sample, numerator: n, denominator: d };
  }
  // Rates (O3 chases, Q4 escaped defects): total per `perTasks` tasks.
  if (info.unit === 'rate') {
    const n = sum('numerator');
    const d = sum('denominator');
    const per = Number(rows[0].details?.perTasks ?? 10);
    return { value: d > 0 ? r2((n / d) * per) : null, sample, numerator: n, denominator: d };
  }
  if (info.unit === 'days') {
    const valued = rows.filter((r) => r.value !== null && r.sample > 0);
    const w = valued.reduce((s, r) => s + r.sample, 0);
    return { value: w > 0 ? r2(valued.reduce((s, r) => s + Number(r.value) * r.sample, 0) / w) : null, sample, numerator: null, denominator: null };
  }
  // Counts.
  return { value: sum('value'), sample, numerator: sum('numerator'), denominator: null };
}

export function scorePerson(
  userId: number,
  rows: SnapshotRowLike[],
  options: { bands: Bands; minSample: number; overrides: ActiveOverride[] },
): PersonScorecard {
  const mine = rows.filter((r) => r.userId === userId);
  const scoring = mine.filter((r) => r.phase === 'scoring');
  const inBaseline = mine.length > 0 && scoring.length === 0;
  const metrics: MetricScore[] = TRACKING_METRICS.map((metric) => {
    const info = METRIC_INFO[metric];
    const list = scoring.filter((r) => r.metric === metric);
    const combined = combineRows(metric, list);
    const override = options.overrides.find((o) => o.metric === metric) ?? null;
    let state: MetricState;
    let computed: number | null = null;
    if (inBaseline) state = 'baseline';
    else if (UNSCORED_METRICS.includes(metric)) state = 'not_scored';
    else if (combined.value === null || combined.sample < options.minSample) state = 'not_enough_data';
    else {
      state = 'scored';
      computed = bandScore(metric, combined.value, options.bands);
    }
    // An override applies only where a score is shown at all (never in
    // Baseline, never on an unscored metric).
    const applies = override && !inBaseline && !UNSCORED_METRICS.includes(metric);
    return {
      metric,
      label: info.label,
      unit: info.unit,
      higherIsBetter: info.higherIsBetter,
      state: applies && state === 'not_enough_data' ? 'scored' : state,
      value: inBaseline ? null : combined.value,
      sample: combined.sample,
      numerator: inBaseline ? null : combined.numerator,
      denominator: inBaseline ? null : combined.denominator,
      computedScore: computed,
      score: applies ? override!.overrideScore : computed,
      override: applies ? override : null,
      projects: [...new Set(list.map((r) => r.projectId))],
    };
  });
  const competencies = Object.entries(COMPETENCIES).map(([key, c]) => {
    const scores = metrics.filter((m) => c.metrics.includes(m.metric) && m.score !== null).map((m) => m.score!);
    return { key, label: c.label, score: scores.length ? r1(scores.reduce((s, x) => s + x, 0) / scores.length) : null };
  });
  const scored = competencies.filter((c) => c.score !== null).map((c) => c.score!);
  return {
    userId,
    state: inBaseline ? 'baseline' : scored.length ? 'scored' : 'not_enough_data',
    overall: scored.length ? r1(scored.reduce((s, x) => s + x, 0) / scored.length) : null,
    competencies,
    metrics,
  };
}
