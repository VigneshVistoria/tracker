import { useState } from 'react';
import { FlaskConical, RotateCcw, X } from 'lucide-react';
import Button from '../ui/Button';
import styles from '../../styles/timelineOverview.module.css';
import pageStyles from '../../styles/projectTimeline.module.css';
import { formatDate } from '../../lib/formatDate';
import { TIMELINE_STATUSES } from '../../lib/projectTimeline';
import { daysBetween, formatSlip } from '../../lib/projectTimelineSummary';

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

// One plan-vs-what-if number. better: 'lower' (fewer is better) or 'earlier'.
function Metric({ label, plan, what, kind }) {
  let delta = null;
  if (kind === 'date' && plan && what && plan !== what) delta = daysBetween(plan, what);
  if (kind === 'count' && plan !== what) delta = what - plan;
  const tone = delta == null ? '' : delta > 0 ? styles.toneError : styles.toneSuccess;
  const show = (v) => (kind === 'date' ? (v ? formatDate(v) : '—') : v);
  return (
    <div className={styles.wiMetric}>
      <span className={styles.kpiLabel}>{label}</span>
      <span className={styles.wiValues}>
        <span className={styles.wiPlan} title="Plan">
          {show(plan)}
        </span>
        <span aria-hidden="true" className={styles.wiTo}>
          to
        </span>
        <span className={styles.wiWhat} title="What-if">
          {show(what)}
        </span>
      </span>
      <span className={`${styles.kpiSub} ${tone}`}>
        {delta == null ? 'no change' : kind === 'date' ? `${formatSlip(delta)} ${delta > 0 ? 'later' : 'earlier'}` : `${delta > 0 ? '+' : ''}${delta}`}
      </span>
    </div>
  );
}

// What-if sandbox (2026-10-17): a scratch copy of the plan to try moves on.
// The Gantt edits the copy; this panel compares it with the plan and offers
// quick moves. Nothing is saved: "Apply to plan" (PM/Admin) turns the
// differences into ordinary unsaved edits on the page.
export default function WhatIfPanel({ plan, what, changes, modules, rows, onShift, onStatus, onReset, onApply, onExit }) {
  const [module, setModule] = useState('');
  const [days, setDays] = useState(7);
  const [rowKey, setRowKey] = useState('');
  const [status, setStatus] = useState('Completed');

  return (
    <section className={styles.whatIf} aria-labelledby="tl-whatif-title">
      <div className={styles.wiHead}>
        <h2 id="tl-whatif-title" className={styles.cardTitle}>
          <FlaskConical size={18} aria-hidden="true" /> What-if mode
        </h2>
        <span className={styles.wiNote}>Try changes here. Nothing is saved, and the real plan shows as a grey outline under each bar.</span>
        <div className={styles.cardActions}>
          <Button size="sm" variant="secondary" leftIcon={RotateCcw} onClick={onReset} disabled={changes.length === 0}>
            Reset
          </Button>
          {onApply && (
            <Button size="sm" onClick={onApply} disabled={changes.length === 0}>
              Apply to plan
            </Button>
          )}
          <Button size="sm" variant="secondary" leftIcon={X} onClick={onExit}>
            Exit what-if
          </Button>
        </div>
      </div>

      <div className={styles.wiMetrics} aria-live="polite">
        <Metric label="Likely finish" plan={plan.likelyEnd} what={what.likelyEnd} kind="date" />
        <Metric label="Project end" plan={plan.projectEnd} what={what.projectEnd} kind="date" />
        <Metric label="Overdue" plan={plan.overdue} what={what.overdue} kind="count" />
        <Metric label="Dependency conflicts" plan={plan.conflicts} what={what.conflicts} kind="count" />
        <Metric label="High or critical risk" plan={plan.risky} what={what.risky} kind="count" />
      </div>

      <div className={styles.wiTools}>
        <form
          className={styles.wiTool}
          onSubmit={(e) => {
            e.preventDefault();
            if (Number(days)) onShift(module, Number(days));
          }}
        >
          <span className={styles.wiToolLabel}>Shift</span>
          <label className="sr-only" htmlFor="tl-wi-module">
            Module
          </label>
          <select id="tl-wi-module" className={pageStyles.select} value={module} onChange={(e) => setModule(e.target.value)}>
            <option value="">All modules</option>
            {modules.map((m) => (
              <option key={m.key} value={m.key}>
                {m.name}
              </option>
            ))}
          </select>
          <span className={styles.wiToolText}>unfinished phases by</span>
          <label className="sr-only" htmlFor="tl-wi-days">
            Days (negative moves earlier)
          </label>
          <input id="tl-wi-days" type="number" className={pageStyles.input} value={days} min={-365} max={365} onChange={(e) => setDays(e.target.value)} />
          <span className={styles.wiToolText}>days</span>
          <Button size="sm" variant="secondary" type="submit" disabled={!Number(days)}>
            Shift
          </Button>
        </form>
        <form
          className={styles.wiTool}
          onSubmit={(e) => {
            e.preventDefault();
            if (rowKey) onStatus(rowKey, status);
          }}
        >
          <span className={styles.wiToolLabel}>Set status</span>
          <label className="sr-only" htmlFor="tl-wi-row">
            Phase
          </label>
          <select id="tl-wi-row" className={pageStyles.select} value={rowKey} onChange={(e) => setRowKey(e.target.value)}>
            <option value="">Choose a phase…</option>
            {rows.map((r) => (
              <option key={r.key} value={r.key}>
                {r.module} – {r.phase || 'New phase'} ({r.status})
              </option>
            ))}
          </select>
          <label className="sr-only" htmlFor="tl-wi-status">
            Status
          </label>
          <select id="tl-wi-status" className={pageStyles.select} value={status} onChange={(e) => setStatus(e.target.value)}>
            {TIMELINE_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <Button size="sm" variant="secondary" type="submit" disabled={!rowKey}>
            Set
          </Button>
        </form>
      </div>

      {changes.length > 0 ? (
        <details className={pageStyles.details}>
          <summary>
            {plural(changes.length, 'phase')} changed in this what-if
          </summary>
          <ul className={styles.wiChanges}>
            {changes.map((c) => (
              <li key={c.key}>
                <strong>{c.row.module}</strong> – {c.row.phase || 'New phase'}: {c.parts.join(', ')}
              </li>
            ))}
          </ul>
        </details>
      ) : (
        <p className={styles.wiNote}>Drag bars in the chart, or use Shift / Set status above, to try a change.</p>
      )}
    </section>
  );
}
