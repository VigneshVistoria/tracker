import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import AppShell from '../../components/AppShell';
import LoadingState from '../../components/ui/LoadingState';
import Modal from '../../components/ui/Modal';
import Button from '../../components/ui/Button';
import Badge from '../../components/ui/Badge';
import ReasonHint from '../../components/ReasonHint';
import styles from '../../styles/issues.module.css';
import { apiDownload, apiFetch } from '../../lib/api';
import { redirectToSignIn } from '../../lib/session';
import { useToast } from '../../lib/toast';
import { formatDate, formatDateTime } from '../../lib/formatDate';

// Mirrors backend/src/performance-tracking/scorecard/scorecard.service.ts.
const REASON_MIN = 10;
const REASON_MAX = 2000;
const STATE_TEXT = { baseline: 'Baseline – no scores yet', not_enough_data: 'Not enough data', not_scored: 'Shown, not scored' };

function valueText(m) {
  if (m.value === null || m.value === undefined) return '-';
  if (m.unit === 'percent') return `${m.value}%`;
  if (m.unit === 'days') return `${m.value} working days`;
  if (m.unit === 'rate') return `${m.value} per 10 ${m.metric === 'Q4' ? 'tasks released' : m.metric === 'O4' ? 'QA rounds' : 'tasks due'}`;
  if (m.unit === 'score') return `${m.value} of 5`;
  return String(m.value);
}

function ScoreCell({ m }) {
  if (m.state !== 'scored') return <span className={styles.issueMeta}>{STATE_TEXT[m.state]}</span>;
  return (
    <span>
      <strong>{m.score}</strong> / 5
      {m.override && (
        <>
          {' '}
          <Badge tone="info">Overridden</Badge>{' '}
          <span className={styles.issueMeta}>(computed {m.computedScore ?? 'none'})</span>
        </>
      )}
    </span>
  );
}

function overallText(card) {
  if (card.state === 'baseline') return STATE_TEXT.baseline;
  if (card.overall === null) return STATE_TEXT.not_enough_data;
  return `${card.overall} / 5`;
}

// Performance Tracking scorecard (B3, 2026-10-30). PM, Executive and Admin
// see everyone; a developer, designer or DevOps only their own - the
// backend enforces this (ScorecardService), the page only follows it.
export default function ScorecardPage() {
  const router = useRouter();
  const { showToast } = useToast();
  const [list, setList] = useState(null);
  const [person, setPerson] = useState(null);
  const [error, setError] = useState('');
  const [dialog, setDialog] = useState(null);
  const [busy, setBusy] = useState(false);
  const selected = router.query.user ? Number(router.query.user) : null;

  const loadList = useCallback(
    () =>
      apiFetch('/performance-tracking/scorecard')
        .then((l) => {
          setList(l);
          // A developer goes straight to their own card.
          if (!l.seesEveryone && l.cards[0] && !selected) router.replace({ query: { user: l.cards[0].userId } }, undefined, { shallow: true });
        })
        .catch((err) => setError(err.message)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selected],
  );
  const loadPerson = useCallback((id) => {
    setPerson(null);
    return apiFetch(`/performance-tracking/scorecard/people/${id}`)
      .then(setPerson)
      .catch((err) => setError(err.message));
  }, []);

  useEffect(() => {
    if (!router.isReady) return;
    if (!localStorage.getItem('user')) {
      redirectToSignIn(router);
      return;
    }
    loadList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router.isReady]);
  useEffect(() => {
    if (selected) loadPerson(selected);
    else setPerson(null);
  }, [selected, loadPerson]);

  const exportExcel = async () => {
    setBusy(true);
    try {
      await apiDownload('/performance-tracking/scorecard/export', `performance-scorecard-${list.snapshotDate || 'empty'}.xlsx`);
      showToast('Scorecard exported - the export has been recorded', 'success');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const afterOverride = async (updated, message) => {
    setDialog(null);
    setPerson(updated);
    showToast(message, 'success');
    loadList();
  };

  return (
    <AppShell>
      <div className={styles.pageHeader}>
        <div>
          <h1 className={styles.pageTitle}>Performance Scorecard</h1>
          <p className={styles.pageSubtitle}>
            {list?.snapshotDate ? `Scores as of ${formatDate(list.snapshotDate)}` : 'No nightly results yet.'} Personal performance data -
            confidential.
            {list?.nonComplianceDisplay === 'side_by_side' && list?.seesEveryone && (
              <>
                {' '}
                The <Link href="/reports/non-compliance">Non-Compliance Report</Link> stays available next to it.
              </>
            )}
          </p>
        </div>
        {list?.canExport && (
          <Button variant="secondary" onClick={exportExcel} loading={busy} disabled={!list.snapshotDate}>
            Export to Excel
          </Button>
        )}
      </div>

      {error && <div className={styles.error} role="alert">{error}</div>}
      {!list && !error && <LoadingState />}

      {list && list.projects.length === 0 && (
        <div className={styles.card}>
          <p className={styles.helpText} style={{ margin: 0 }}>Performance Tracking is not switched on for any project yet.</p>
        </div>
      )}

      {list && list.seesEveryone && !selected && list.projects.length > 0 && (
        <div className={styles.card}>
          <p className={styles.helpText} style={{ marginTop: 0 }}>
            Projects:{' '}
            {list.projects.map((p) => `${p.name} (${p.phase === 'baseline' ? `Baseline until ${formatDate(p.baselineEndsAt)}` : 'Scoring'})`).join(', ')}. Below {list.minSample}{' '}
            items a measure shows &quot;Not enough data&quot;
            {list.release && ` (P1, P2: releases in the last ${list.release.windowDays} days, at least ${list.release.minSample})`}
            {list.security && ` (P3: verified security fixes in the last ${list.security.windowDays} days, at least ${list.security.minSample}; P4 from one finding due)`}.
          </p>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Person</th>
                  <th>Overall</th>
                  {list.competencies.map((c) => (
                    <th key={c.key}>{c.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {list.cards.length === 0 && (
                  <tr>
                    <td colSpan={2 + list.competencies.length} className={styles.empty}>No results yet - the first nightly run fills this in.</td>
                  </tr>
                )}
                {list.cards.map((c) => (
                  <tr key={c.userId}>
                    <td>
                      <Link href={{ query: { user: c.userId } }} shallow>
                        {c.name}
                      </Link>
                    </td>
                    <td>{overallText(c)}</td>
                    {c.competencies.map((x) => (
                      <td key={x.key}>{c.state === 'baseline' ? '-' : x.score === null ? 'Not enough data' : x.score}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {selected && !person && !error && <LoadingState />}
      {selected && person && (
        <PersonCard person={person} showBack={list?.seesEveryone} onOverride={(m) => setDialog({ type: 'set', metric: m })} onRemove={(m) => setDialog({ type: 'remove', metric: m })} />
      )}

      {dialog && person && (
        <OverrideDialog dialog={dialog} person={person} onClose={() => setDialog(null)} onDone={afterOverride} />
      )}
    </AppShell>
  );
}

function PersonCard({ person, showBack, onOverride, onRemove }) {
  const card = person.card;
  const detailsFor = (metric) => person.details.filter((d) => d.metric === metric);
  const projectName = (id) => person.projects.find((p) => p.id === id)?.name || `Project #${id}`;
  return (
    <>
      {showBack && (
        <p style={{ marginTop: 0 }}>
          <Link href={{ query: {} }} shallow>
            ← Everyone
          </Link>
        </p>
      )}
      <div className={styles.card} style={{ marginBottom: 'var(--space-4)' }}>
        <h2 className={styles.cardTitle}>{person.user.name}</h2>
        {!card ? (
          <p className={styles.helpText} style={{ margin: 0 }}>No results yet for {person.snapshotDate ? formatDate(person.snapshotDate) : 'any night'}.</p>
        ) : (
          <>
            <p style={{ margin: 0 }}>
              Overall: <strong>{overallText(card)}</strong>
            </p>
            {card.state !== 'baseline' && (
              <ul style={{ margin: 'var(--ds-space-2) 0 0', paddingLeft: 'var(--ds-space-5)' }}>
                {card.competencies.map((c) => (
                  <li key={c.key}>
                    {c.label}: {c.score === null ? 'Not enough data' : `${c.score} / 5`}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>

      {card && (
        <div className={styles.card} style={{ marginBottom: 'var(--space-4)' }}>
          <h2 className={styles.cardTitle}>Measures</h2>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Measure</th>
                  <th>Value</th>
                  <th>Items</th>
                  <th>Score</th>
                  {person.canOverride && <th></th>}
                </tr>
              </thead>
              <tbody>
                {card.metrics.map((m) => (
                  <tr key={m.metric}>
                    <td>
                      {m.metric} {m.label}
                      {m.metric === 'Q5' && (
                        <>
                          {' '}
                          <Link href="/performance-tracking/tech-reviews">reviews</Link>
                        </>
                      )}
                      {detailsFor(m.metric).length > 1 && (
                        <div className={styles.issueMeta}>
                          {detailsFor(m.metric)
                            .map((d) => `${projectName(d.projectId)}: ${d.value ?? '-'} (${d.sample})`)
                            .join(' · ')}
                        </div>
                      )}
                      {m.override && (
                        <div className={styles.issueMeta}>
                          Override: &quot;{m.override.reason}&quot; ({formatDateTime(m.override.createdAt)})
                        </div>
                      )}
                    </td>
                    <td>{valueText(m)}</td>
                    <td>{m.sample}</td>
                    <td>
                      <ScoreCell m={m} />
                    </td>
                    {person.canOverride && (
                      <td>
                        {card.state !== 'baseline' && m.state !== 'not_scored' && (
                          <Button variant="secondary" onClick={() => (m.override ? onRemove(m) : onOverride(m))} aria-label={`${m.override ? 'Remove the override on' : 'Override'} ${m.label}`}>
                            {m.override ? 'Remove override' : 'Override'}
                          </Button>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {person.overrideHistory.length > 0 && (
        <div className={styles.card}>
          <details>
            <summary className={styles.issueMeta}>Override history ({person.overrideHistory.length})</summary>
            <ul style={{ margin: 'var(--ds-space-2) 0 0', paddingLeft: 'var(--ds-space-5)' }}>
              {person.overrideHistory.map((o) => (
                <li key={o.id} className={styles.issueMeta}>
                  {formatDateTime(o.createdAt)} - {o.metric} set to {o.overrideScore} (computed {o.originalScore ?? 'none'}) by {o.createdByName}: &quot;{o.reason}&quot;
                  {o.removedAt ? ` - removed ${formatDateTime(o.removedAt)} by ${o.removedByName || 'someone'}: "${o.removeReason}"` : ' - active'}
                </li>
              ))}
            </ul>
          </details>
        </div>
      )}
    </>
  );
}

function OverrideDialog({ dialog, person, onClose, onDone }) {
  const isRemove = dialog.type === 'remove';
  const m = dialog.metric;
  const [score, setScore] = useState(String(m.computedScore ?? 3));
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [attempted, setAttempted] = useState(false);
  const reasonRef = useRef(null);
  const trimmed = reason.trim();
  const valid = trimmed.length >= REASON_MIN && trimmed.length <= REASON_MAX;

  const confirm = async () => {
    if (busy) return;
    if (!valid) {
      setAttempted(true);
      reasonRef.current?.focus();
      return;
    }
    setBusy(true);
    setError('');
    try {
      const updated = isRemove
        ? await apiFetch(`/performance-tracking/scorecard/overrides/${m.override.id}/remove`, { method: 'PATCH', body: JSON.stringify({ reason: trimmed }) })
        : await apiFetch('/performance-tracking/scorecard/overrides', {
            method: 'POST',
            body: JSON.stringify({ userId: person.user.id, metric: m.metric, score: Number(score), reason: trimmed }),
          });
      await onDone(updated, isRemove ? 'Override removed - recorded' : 'Score overridden - recorded with your reason');
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={busy ? () => {} : onClose}
      title={isRemove ? `Remove the override on ${m.label}` : `Override ${m.label} for ${person.user.name}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={confirm} aria-disabled={!valid} loading={busy}>
            {isRemove ? 'Remove override' : 'Save override'}
          </Button>
        </>
      }
    >
      <p className={styles.issueMeta} style={{ marginTop: 0 }}>
        {isRemove
          ? `The computed score (${m.computedScore ?? 'none'}) comes back. The override stays in the history.`
          : `Computed score: ${m.computedScore ?? 'none'}. It is kept and shown next to yours. The person sees your score and your reason.`}
      </p>
      {!isRemove && (
        <div className={styles.field} style={{ maxWidth: 200 }}>
          <label className={styles.label} htmlFor="overrideScore">New score</label>
          <select id="overrideScore" className={styles.input} value={score} onChange={(e) => setScore(e.target.value)}>
            {[5, 4, 3, 2, 1].map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
        </div>
      )}
      <label className={styles.label} htmlFor="overrideReason">Reason (required)</label>
      <textarea
        id="overrideReason"
        ref={reasonRef}
        className={styles.textarea}
        rows={3}
        maxLength={REASON_MAX}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        aria-required="true"
        aria-invalid={(reason.length > 0 || attempted) && !valid}
        aria-describedby="overrideReasonHint"
        placeholder="e.g. Late only because the client moved the release date"
      />
      <ReasonHint id="overrideReasonHint" length={trimmed.length} min={REASON_MIN} max={REASON_MAX} attempted={attempted} />
      {error && (
        <div className={styles.error} role="alert" style={{ marginTop: 'var(--ds-space-3)', marginBottom: 0 }}>
          {error}
        </div>
      )}
    </Modal>
  );
}
