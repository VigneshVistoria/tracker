import { bandScore, combineRows, scorePerson, SnapshotRowLike } from '../src/performance-tracking/scorecard/scoring';
import { feedConfig, keyMatches } from '../src/performance-tracking/scorecard/scorecard-feed.controller';

// Performance Tracking B3 (2026-10-30): bands, combining projects,
// Baseline / Not enough data, overrides, competency averages - and the
// feed's key rules.
const bands = { percentBands: [95, 85, 70, 50], breachBands: [0, 1, 2, 3] };
const row = (metric: string, extra: Partial<SnapshotRowLike> = {}): SnapshotRowLike => ({
  projectId: 1,
  userId: 10,
  metric,
  phase: 'scoring',
  value: null,
  numerator: null,
  denominator: null,
  sample: 0,
  details: {},
  ...extra,
});

describe('Performance Tracking B3 scoring', () => {
  it('percent bands: 5/4/3/2 at or above, else 1', () => {
    expect(bandScore('D1', 100, bands)).toBe(5);
    expect(bandScore('D1', 95, bands)).toBe(5);
    expect(bandScore('D1', 94.9, bands)).toBe(4);
    expect(bandScore('D1', 70, bands)).toBe(3);
    expect(bandScore('D1', 50, bands)).toBe(2);
    expect(bandScore('D1', 49, bands)).toBe(1);
  });

  it('a lower-is-better percent (Q3 reopen rate) scores 100 minus the value', () => {
    expect(bandScore('Q3', 0, bands)).toBe(5);
    expect(bandScore('Q3', 10, bands)).toBe(4);
    expect(bandScore('Q3', 60, bands)).toBe(1);
  });

  it('breach bands for counts, working days and rates: 5/4/3/2 at or below, else 1', () => {
    expect(bandScore('D4', 0, bands)).toBe(5);
    expect(bandScore('D4', 1, bands)).toBe(4);
    expect(bandScore('C2', 3, bands)).toBe(2);
    expect(bandScore('C2', 4, bands)).toBe(1);
    expect(bandScore('O1', 1.5, bands)).toBe(3);
  });

  it('combines projects: percents by numerator/denominator, counts by sum, days by weighted average', () => {
    expect(combineRows('D1', [row('D1', { numerator: 9, denominator: 10, sample: 10 }), row('D1', { projectId: 2, numerator: 1, denominator: 10, sample: 10 })])).toMatchObject({
      value: 50,
      sample: 20,
    });
    expect(combineRows('D4', [row('D4', { value: 2, sample: 4 }), row('D4', { projectId: 2, value: 3, sample: 6 })])).toMatchObject({ value: 5, sample: 10 });
    expect(combineRows('O1', [row('O1', { value: 1, sample: 3 }), row('O1', { projectId: 2, value: 3, sample: 1 })])).toMatchObject({ value: 1.5, sample: 4 });
    expect(combineRows('O3', [row('O3', { numerator: 2, denominator: 10, details: { perTasks: 10 } }), row('O3', { projectId: 2, numerator: 1, denominator: 10, details: { perTasks: 10 } })])).toMatchObject({
      value: 1.5,
    });
    // Q4 (rate): 1 escaped defect per 4 tasks released, per 10.
    expect(combineRows('Q4', [row('Q4', { numerator: 1, denominator: 2, details: { perTasks: 10 } }), row('Q4', { projectId: 2, numerator: 0, denominator: 2, details: { perTasks: 10 } })])).toMatchObject({
      value: 2.5,
    });
  });

  it('Q5 technical review: rounded 1-5 score, one review is enough, combined by weighted average', () => {
    expect(bandScore('Q5', 3.5, bands)).toBe(4);
    expect(bandScore('Q5', 3.4, bands)).toBe(3);
    expect(combineRows('Q5', [row('Q5', { value: 4, sample: 1 }), row('Q5', { projectId: 2, value: 2, sample: 3 })])).toMatchObject({ value: 2.5, sample: 4 });
    const card = scorePerson(10, [row('Q5', { value: 4.2, sample: 1 })], { bands, minSample: 5, overrides: [] });
    expect(card.metrics.find((m) => m.metric === 'Q5')).toMatchObject({ state: 'scored', score: 4 });
  });

  it('P1/P2 need their own minimum of releases (default 3), not the shared one', () => {
    const p1 = (sample: number, opts: any = {}) =>
      scorePerson(10, [row('P1', { numerator: sample, denominator: sample, sample })], { bands, minSample: 5, overrides: [], ...opts }).metrics.find((m) => m.metric === 'P1');
    expect(p1(2, { releaseMinSample: 3 })).toMatchObject({ state: 'not_enough_data', score: null });
    expect(p1(3, { releaseMinSample: 3 })).toMatchObject({ state: 'scored', score: 5 });
    expect(p1(3, { releaseMinSample: 4 })).toMatchObject({ state: 'not_enough_data' });
    expect(p1(2)).toMatchObject({ state: 'not_enough_data' });
  });

  it('P3 needs securityMinSample verified fixes; P4 breaches are scored from one finding on the breach bands', () => {
    const card = (rows: SnapshotRowLike[], opts: any = {}) => scorePerson(10, rows, { bands, minSample: 5, overrides: [], ...opts });
    expect(card([row('P3', { numerator: 2, denominator: 2, sample: 2 })]).metrics.find((m) => m.metric === 'P3')).toMatchObject({ state: 'not_enough_data' });
    expect(card([row('P3', { numerator: 2, denominator: 2, sample: 2 })], { securityMinSample: 2 }).metrics.find((m) => m.metric === 'P3')).toMatchObject({ state: 'scored', score: 5 });
    expect(card([row('P4', { value: 1, numerator: 1, denominator: 1, sample: 1 })]).metrics.find((m) => m.metric === 'P4')).toMatchObject({ state: 'scored', score: 4 });
    expect(card([row('P4', { value: 1, sample: 1 })]).competencies.find((c) => c.key === 'P')).toMatchObject({ label: 'Process', score: 4 });
  });

  it('C3 is person-level: the same row in two projects is taken once; one week is enough', () => {
    expect(combineRows('C3', [row('C3', { numerator: 3, denominator: 4, sample: 4 }), row('C3', { projectId: 2, numerator: 3, denominator: 4, sample: 4 })])).toMatchObject({ value: 75, sample: 4 });
    const card = scorePerson(10, [row('C3', { numerator: 1, denominator: 1, sample: 1 })], { bands, minSample: 5, overrides: [] });
    expect(card.metrics.find((m) => m.metric === 'C3')).toMatchObject({ state: 'scored', score: 5 });
  });

  it('Baseline: no scores at all, not even with an override', () => {
    const card = scorePerson(10, [row('D1', { phase: 'baseline', numerator: 10, denominator: 10, sample: 10, value: 100 })], {
      bands,
      minSample: 5,
      overrides: [{ id: 1, metric: 'D1', overrideScore: 2, originalScore: 5, reason: 'x', createdByUserId: 1, createdAt: new Date(), effectiveFrom: '2026-11-01' }],
    });
    expect(card.state).toBe('baseline');
    expect(card.overall).toBeNull();
    expect(card.metrics.every((m) => m.state === 'baseline' && m.score === null && m.value === null)).toBe(true);
  });

  it('below the minimum sample: Not enough data, no score; O5 shown but not scored', () => {
    const card = scorePerson(10, [row('D1', { numerator: 2, denominator: 4, sample: 4, value: 50 }), row('O5', { value: 3, sample: 3 })], { bands, minSample: 5, overrides: [] });
    expect(card.metrics.find((m) => m.metric === 'D1')).toMatchObject({ state: 'not_enough_data', score: null, value: 50 });
    expect(card.metrics.find((m) => m.metric === 'O5')).toMatchObject({ state: 'not_scored', score: null, value: 3 });
    expect(card.state).toBe('not_enough_data');
  });

  it('competency = average of its scores, overall = average of competencies; an override replaces one score and keeps the computed one', () => {
    const rows = [
      row('D1', { numerator: 10, denominator: 10, sample: 10 }), // 100% -> 5
      row('D2', { numerator: 6, denominator: 10, sample: 10 }), // 60% -> 2
      row('Q1', { numerator: 8, denominator: 10, sample: 10 }), // 80% -> 3
    ];
    const plain = scorePerson(10, rows, { bands, minSample: 5, overrides: [] });
    expect(plain.competencies.find((c) => c.key === 'D')!.score).toBe(3.5);
    expect(plain.competencies.find((c) => c.key === 'Q')!.score).toBe(3);
    expect(plain.overall).toBe(3.3);
    const overridden = scorePerson(10, rows, {
      bands,
      minSample: 5,
      overrides: [{ id: 7, metric: 'D2', overrideScore: 4, originalScore: 2, reason: 'Client froze the project for a week', createdByUserId: 1, createdAt: new Date(), effectiveFrom: '2026-11-01' }],
    });
    const d2 = overridden.metrics.find((m) => m.metric === 'D2')!;
    expect(d2).toMatchObject({ score: 4, computedScore: 2 });
    expect(d2.override!.reason).toBe('Client froze the project for a week');
    expect(overridden.competencies.find((c) => c.key === 'D')!.score).toBe(4.5);
  });

  it('the feed is off unless a long key and a tenant are set; the key must match exactly', () => {
    expect(feedConfig({})).toBeNull();
    expect(feedConfig({ PERFORMANCE_FEED_KEY: 'short', PERFORMANCE_FEED_TENANT_ID: '1' })).toBeNull();
    expect(feedConfig({ PERFORMANCE_FEED_KEY: 'k'.repeat(40) })).toBeNull();
    expect(feedConfig({ PERFORMANCE_FEED_KEY: 'k'.repeat(40), PERFORMANCE_FEED_TENANT_ID: '1' })).toEqual({ key: 'k'.repeat(40), tenantId: 1 });
    expect(keyMatches('k'.repeat(40), 'k'.repeat(40))).toBe(true);
    expect(keyMatches('k'.repeat(39), 'k'.repeat(40))).toBe(false);
    expect(keyMatches(undefined, 'k'.repeat(40))).toBe(false);
  });
});
