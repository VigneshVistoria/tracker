import styles from '../styles/issues.module.css';
import ScreenshotAttach from './ScreenshotAttach';

// Developer submission checklist, defect triage Stage 2 (2026-10-27) -
// mirrors backend/src/tasks/submission-checklist.ts (evaluateChecklist). The
// form shows what's missing before Submit; the backend checks the same
// rules again. `options` is GET /submission-checklist/options.
export const CHECKLIST_LABELS = {
  rootCause: 'Root cause',
  changeLink: 'What changed - link',
  testSteps: 'How to test - steps',
  testData: 'How to test - test data',
  evidence: 'Evidence of self-test',
  affectedAreas: 'Areas possibly affected',
  buildConfirmation: 'Build and environment confirmation',
};

export const EMPTY_CHECKLIST = {
  rootCause: '',
  rootCauseNote: '',
  testSteps: '',
  testData: '',
  affectedAreas: '',
  noAreasAffected: false,
  build: '',
  environment: '',
  confirmedBuild: false,
};

// Pre-fills a resubmission from the previous round's checklist (the
// confirmation tick is always given again).
export function checklistFromRound(stored) {
  if (!stored) return { ...EMPTY_CHECKLIST };
  const next = { ...EMPTY_CHECKLIST };
  for (const k of Object.keys(EMPTY_CHECKLIST)) {
    if (k === 'confirmedBuild') continue;
    if (stored[k] !== null && stored[k] !== undefined) next[k] = stored[k];
  }
  return next;
}

const text = (v) => (typeof v === 'string' ? v.trim() : '');

// Labels of what is missing, same wording as the backend.
export function missingChecklist(value, { options, isDefect, artifactTypes, screenshotCount }) {
  if (!options) return [];
  const v = value || EMPTY_CHECKLIST;
  const required = new Set(options.required[isDefect ? 'defect' : 'task']);
  const min = options.minTextLength;
  const missing = [];
  if (isDefect) {
    const cause = options.rootCauses.find((c) => c.label === v.rootCause);
    if (cause?.needsNote && text(v.rootCauseNote).length < min) missing.push(`Root cause note (at least ${min} characters)`);
    if (!cause && required.has('rootCause')) missing.push(CHECKLIST_LABELS.rootCause);
  }
  if (required.has('changeLink') && !artifactTypes.some((t) => options.linkArtifactTypes.includes(t))) {
    missing.push(`${CHECKLIST_LABELS.changeLink} (add a ${options.linkArtifactTypes.join(' or ')} artifact)`);
  }
  if (required.has('testSteps') && text(v.testSteps).length < min) missing.push(`${CHECKLIST_LABELS.testSteps} (at least ${min} characters)`);
  if (required.has('testData') && text(v.testData).length < min) missing.push(`${CHECKLIST_LABELS.testData} (at least ${min} characters)`);
  if (required.has('evidence') && !artifactTypes.some((t) => options.evidenceArtifactTypes.includes(t)) && screenshotCount === 0) {
    missing.push(`${CHECKLIST_LABELS.evidence} (add a ${options.evidenceArtifactTypes.join(' or ')} artifact, or paste a screenshot)`);
  }
  if (required.has('affectedAreas') && !v.noAreasAffected && text(v.affectedAreas).length < min) {
    missing.push(`${CHECKLIST_LABELS.affectedAreas} (at least ${min} characters, or tick "None expected")`);
  }
  if (required.has('buildConfirmation') && (!text(v.build) || !v.environment || !v.confirmedBuild)) {
    missing.push(`${CHECKLIST_LABELS.buildConfirmation} (build, environment and the confirmation tick)`);
  }
  return missing;
}

// What the API takes (QaSubmitTaskDto.checklist).
export function checklistPayload(value, { isDefect, screenshotCount }) {
  const v = value || EMPTY_CHECKLIST;
  return {
    ...(isDefect && v.rootCause ? { rootCause: v.rootCause, rootCauseNote: text(v.rootCauseNote) } : {}),
    testSteps: text(v.testSteps),
    testData: text(v.testData),
    affectedAreas: v.noAreasAffected ? '' : text(v.affectedAreas),
    noAreasAffected: !!v.noAreasAffected,
    build: text(v.build),
    environment: v.environment,
    confirmedBuild: !!v.confirmedBuild,
    selfTestScreenshots: screenshotCount,
  };
}

// The checklist block inside the Submit for QA form.
export function SubmissionChecklistFields({ value, onChange, options, isDefect, screenshots, onScreenshotsChange, disabled }) {
  const v = value || EMPTY_CHECKLIST;
  const required = new Set(options.required[isDefect ? 'defect' : 'task']);
  const set = (k, next) => onChange({ ...v, [k]: next });
  const opt = (k) => (required.has(k) ? '' : ' (optional)');
  const cause = options.rootCauses.find((c) => c.label === v.rootCause);

  return (
    <fieldset style={{ border: 0, padding: 0, margin: '0 0 var(--space-3)', minWidth: 0 }}>
      <legend className={styles.cardTitle} style={{ padding: 0, fontSize: 'var(--ds-text-md)' }}>
        Submission checklist
      </legend>
      <p className={styles.helpText} style={{ marginTop: 0 }}>
        Required in this project before QA. &quot;What changed&quot; is the Resolution above plus a {options.linkArtifactTypes.join(' or ')}{' '}
        artifact below.
      </p>

      {isDefect && (
        <div className={styles.fieldGrid3}>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="ckRootCause">
              Root cause{opt('rootCause')}
            </label>
            <select id="ckRootCause" className={styles.select} value={v.rootCause} onChange={(e) => set('rootCause', e.target.value)} disabled={disabled}>
              <option value="">— Select —</option>
              {options.rootCauses.map((c) => (
                <option key={c.label} value={c.label}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>
          {cause?.needsNote && (
            <div className={styles.field} style={{ gridColumn: 'span 2' }}>
              <label className={styles.label} htmlFor="ckRootCauseNote">
                Explain the root cause
              </label>
              <input id="ckRootCauseNote" className={styles.input} value={v.rootCauseNote} onChange={(e) => set('rootCauseNote', e.target.value)} disabled={disabled} />
            </div>
          )}
        </div>
      )}

      <div className={styles.field}>
        <label className={styles.label} htmlFor="ckTestSteps">
          How to test - steps{opt('testSteps')}
        </label>
        <textarea
          id="ckTestSteps"
          className={styles.textarea}
          rows={4}
          value={v.testSteps}
          onChange={(e) => set('testSteps', e.target.value)}
          placeholder={'1. Open ...\n2. Enter ...\n3. Expect ...'}
          disabled={disabled}
        />
      </div>
      <div className={styles.field}>
        <label className={styles.label} htmlFor="ckTestData">
          How to test - test data{opt('testData')}
        </label>
        <textarea
          id="ckTestData"
          className={styles.textarea}
          rows={2}
          value={v.testData}
          onChange={(e) => set('testData', e.target.value)}
          placeholder="Accounts, records or files QA should use"
          disabled={disabled}
        />
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor="ckAffected">
          Areas possibly affected{opt('affectedAreas')}
        </label>
        <textarea
          id="ckAffected"
          className={styles.textarea}
          rows={2}
          value={v.noAreasAffected ? '' : v.affectedAreas}
          onChange={(e) => set('affectedAreas', e.target.value)}
          placeholder="Other screens, reports or integrations this change could touch"
          disabled={disabled || v.noAreasAffected}
        />
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-1)', marginTop: 'var(--space-1)' }}>
          <input type="checkbox" checked={!!v.noAreasAffected} onChange={(e) => set('noAreasAffected', e.target.checked)} disabled={disabled} />
          None expected
        </label>
      </div>

      <div className={styles.fieldGrid3}>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="ckBuild">
            Build tested{opt('buildConfirmation')}
          </label>
          <input id="ckBuild" className={styles.input} maxLength={100} value={v.build} onChange={(e) => set('build', e.target.value)} placeholder="e.g. 2.4.1-rc3" disabled={disabled} />
        </div>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="ckEnvironment">
            Environment
          </label>
          <select id="ckEnvironment" className={styles.select} value={v.environment} onChange={(e) => set('environment', e.target.value)} disabled={disabled}>
            <option value="">— Select —</option>
            {options.environments.map((e) => (
              <option key={e} value={e}>
                {e}
              </option>
            ))}
          </select>
        </div>
      </div>
      <label style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-2)', marginBottom: 'var(--space-3)' }}>
        <input type="checkbox" checked={!!v.confirmedBuild} onChange={(e) => set('confirmedBuild', e.target.checked)} disabled={disabled} />
        <span>I tested this change myself on the build and environment above.</span>
      </label>

      <div className={styles.field}>
        <span className={styles.label}>Evidence of self-test{opt('evidence')}</span>
        <p className={styles.helpText} style={{ marginTop: 0 }}>
          Add a {options.evidenceArtifactTypes.join(' or ')} artifact below, or paste / capture screenshots here.
        </p>
        <ScreenshotAttach screenshots={screenshots} onChange={onScreenshotsChange} disabled={disabled} itemNoun="submission" hint="They're attached to this submission when you submit." />
      </div>
    </fieldset>
  );
}

// Read-only view of a stored checklist - on the review history and above
// QA's / the PM's decision.
export function SubmissionChecklistSummary({ checklist }) {
  if (!checklist) return null;
  const rows = [
    checklist.kind === 'defect' && ['Root cause', `${checklist.rootCause || '—'}${checklist.rootCauseNote ? ` - ${checklist.rootCauseNote}` : ''}`],
    ['What changed - link', checklist.linkArtifactTypes?.length ? checklist.linkArtifactTypes.join(', ') : '—'],
    ['How to test - steps', checklist.testSteps || '—'],
    checklist.testData && ['Test data', checklist.testData],
    [
      'Evidence of self-test',
      [
        ...(checklist.evidenceArtifactTypes || []),
        ...(checklist.selfTestScreenshots ? [`${checklist.selfTestScreenshots} screenshot${checklist.selfTestScreenshots === 1 ? '' : 's'}`] : []),
      ].join(', ') || '—',
    ],
    ['Areas possibly affected', checklist.noAreasAffected ? 'None expected' : checklist.affectedAreas || '—'],
    [
      'Tested on',
      `${checklist.build || '—'} · ${checklist.environment || '—'}${checklist.confirmedBuild ? ' (confirmed by the developer)' : ' (not confirmed)'}`,
    ],
  ].filter(Boolean);
  return (
    <dl style={{ display: 'grid', gridTemplateColumns: 'minmax(140px, max-content) 1fr', gap: 'var(--ds-space-1) var(--ds-space-3)', margin: 'var(--ds-space-2) 0' }}>
      {rows.map(([k, val]) => (
        <div key={k} style={{ display: 'contents' }}>
          <dt className={styles.issueMeta}>{k}</dt>
          <dd style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{val}</dd>
        </div>
      ))}
    </dl>
  );
}
