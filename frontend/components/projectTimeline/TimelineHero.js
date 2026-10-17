import { AlertTriangle, CalendarClock, Maximize2, Minimize2, Route, TrendingUp } from 'lucide-react';
import Badge from '../ui/Badge';
import Button from '../ui/Button';
import styles from '../../styles/timelineOverview.module.css';
import { formatDate } from '../../lib/formatDate';
import { formatSlip } from '../../lib/projectTimelineSummary';

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

// A completion ring. The number in the middle is the text; the ring is
// decoration, so it is hidden from screen readers (the label says it all).
export function ProgressRing({ pct, size = 56, stroke = 6, label }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const value = Math.max(0, Math.min(100, pct || 0));
  return (
    <span className={styles.ring} style={{ width: size, height: size }} role="img" aria-label={label || `${value}% complete`}>
      <svg width={size} height={size} aria-hidden="true">
        <circle className={styles.ringTrack} cx={size / 2} cy={size / 2} r={r} strokeWidth={stroke} />
        <circle className={styles.ringValue} cx={size / 2} cy={size / 2} r={r} strokeWidth={stroke} strokeDasharray={c} strokeDashoffset={c * (1 - value / 100)} />
      </svg>
      <span className={styles.ringLabel} style={{ fontSize: size >= 96 ? 'var(--ds-text-2xl)' : size >= 56 ? 'var(--ds-text-sm)' : 'var(--ds-text-xs)' }} aria-hidden="true">
        {value}%
      </span>
    </span>
  );
}

function Kpi({ icon: Icon, iconTone, label, value, valueTone, sub, children }) {
  return (
    <div className={styles.kpi}>
      {children ||
        (Icon && (
          <span className={`${styles.kpiIcon} ${iconTone || ''}`} aria-hidden="true">
            <Icon size={20} />
          </span>
        ))}
      <div className={styles.kpiBody}>
        <span className={styles.kpiLabel}>{label}</span>
        <span className={`${styles.kpiValue} ${valueTone || ''}`}>{value}</span>
        {sub && <span className={styles.kpiSub} title={typeof sub === 'string' ? sub : undefined}>{sub}</span>}
      </div>
    </div>
  );
}

// Page header band (2026-10-17): project name, picker + actions, the full
// screen switch and five headline numbers. Read-only - every number comes
// from the same page state the Overview and Gantt use.
export default function TimelineHero({ projectName, picker, actions, fullScreen, onToggleFullScreen, summary, forecast, slip, critical, meta, unsaved, viewOnly }) {
  const o = summary?.overall;
  const late = forecast?.slipDays > 0;
  const runningLate = summary?.runningLate?.length || 0;
  return (
    <header className={styles.hero}>
      <div className={styles.heroTop}>
        <div className={styles.heroTitleBlock}>
          <p className={styles.eyebrow}>Project Timeline</p>
          <h1 className={styles.heroTitle}>{projectName || 'Choose a project'}</h1>
          <p className={styles.heroMeta}>
            {meta}
            {viewOnly && <Badge tone="neutral">View only</Badge>}
            {unsaved && <Badge tone="warning">Includes unsaved changes</Badge>}
          </p>
        </div>
        <div className={styles.heroActions}>
          <div className={styles.heroPicker}>{picker}</div>
          {actions}
          <Button variant="secondary" leftIcon={fullScreen ? Minimize2 : Maximize2} onClick={onToggleFullScreen} aria-pressed={fullScreen}>
            {fullScreen ? 'Exit full screen' : 'Full screen'}
          </Button>
        </div>
      </div>

      {o && o.total > 0 && (
        <div className={styles.kpis} aria-live="polite">
          <Kpi label="Complete" value={`${o.completed} of ${o.total}`} sub={`${plural(o.total - o.completed, 'phase')} to go`}>
            <ProgressRing pct={o.pct} size={48} stroke={5} label={`${o.pct}% of phases completed`} />
          </Kpi>
          <Kpi
            icon={CalendarClock}
            iconTone={forecast?.likelyEnd ? (late ? styles.kpiIconError : styles.kpiIconSuccess) : ''}
            label="Likely finish"
            value={forecast?.likelyEnd ? formatDate(forecast.likelyEnd) : '—'}
            sub={forecast?.likelyEnd ? (late ? `${formatSlip(forecast.slipDays)} vs plan ${formatDate(forecast.plannedEnd)}` : `On plan (${formatDate(forecast.plannedEnd)})`) : 'Add dates to forecast'}
          />
          <Kpi
            icon={TrendingUp}
            iconTone={slip?.overall?.slip > 0 ? styles.kpiIconWarning : slip ? styles.kpiIconSuccess : ''}
            label="Slip since plan"
            value={slip ? formatSlip(slip.overall?.slip ?? 0) : '—'}
            valueTone={slip?.overall?.slip > 0 ? styles.toneError : ''}
            sub={slip ? `${plural(slip.overall?.later || 0, 'phase')} later, ${slip.overall?.earlier || 0} earlier` : 'Loading…'}
          />
          <Kpi
            icon={AlertTriangle}
            iconTone={o.overdue + o.delayed > 0 ? styles.kpiIconError : styles.kpiIconSuccess}
            label="Overdue"
            value={o.overdue}
            valueTone={o.overdue > 0 ? styles.toneError : ''}
            sub={`${o.delayed} delayed · ${runningLate} running late`}
          />
          <Kpi
            icon={Route}
            label="Critical path"
            value={critical?.chain?.length ? plural(critical.chain.length, 'phase') : '—'}
            sub={critical?.projectEnd ? `Ends ${formatDate(critical.projectEnd)}` : 'No dates yet'}
          />
        </div>
      )}
    </header>
  );
}
