import { useState } from 'react';
import { X } from 'lucide-react';
import Button from '../ui/Button';
import styles from '../../styles/projectTimeline.module.css';
import { TIMELINE_STATUSES } from '../../lib/projectTimeline';

const NO_TEAM = 'none';
const MAX_SHIFT = 3650;

// Bulk edit for the ticked rows (Stage 3, 2026-10-16): set the team, set
// the status, or move both dates by N calendar days. Like an inline edit,
// nothing is saved until "Save changes".
export default function BulkBar({ count, teams, onSetTeam, onSetStatus, onShift, onClear }) {
  const [team, setTeam] = useState('');
  const [status, setStatus] = useState('');
  const [days, setDays] = useState('');
  const shiftBy = Number(days);
  const shiftValid = days.trim() !== '' && Number.isInteger(shiftBy) && shiftBy !== 0 && Math.abs(shiftBy) <= MAX_SHIFT;

  return (
    <div className={styles.bulkBar} role="region" aria-label="Change the selected phases">
      <strong className={styles.bulkCount} aria-live="polite">
        {count} selected
      </strong>
      <div className={styles.bulkControl}>
        <label className={styles.label} htmlFor="tl-bulk-team">
          Team
        </label>
        <div className={styles.bulkInline}>
          <select id="tl-bulk-team" className={styles.select} value={team} onChange={(e) => setTeam(e.target.value)}>
            <option value="">Choose…</option>
            <option value={NO_TEAM}>No team</option>
            {teams
              .filter((t) => t.isActive)
              .map((t) => (
                <option key={t.id} value={String(t.id)}>
                  {t.name}
                </option>
              ))}
          </select>
          <Button size="sm" variant="secondary" disabled={!team} onClick={() => onSetTeam(team === NO_TEAM ? null : Number(team))}>
            Set team
          </Button>
        </div>
      </div>
      <div className={styles.bulkControl}>
        <label className={styles.label} htmlFor="tl-bulk-status">
          Status
        </label>
        <div className={styles.bulkInline}>
          <select id="tl-bulk-status" className={styles.select} value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">Choose…</option>
            {TIMELINE_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <Button size="sm" variant="secondary" disabled={!status} onClick={() => onSetStatus(status)}>
            Set status
          </Button>
        </div>
      </div>
      <div className={styles.bulkControl}>
        <label className={styles.label} htmlFor="tl-bulk-shift">
          Shift dates (days, − for earlier)
        </label>
        <div className={styles.bulkInline}>
          <input
            id="tl-bulk-shift"
            type="number"
            step={1}
            min={-MAX_SHIFT}
            max={MAX_SHIFT}
            className={`${styles.input} ${styles.bulkDays}`}
            value={days}
            onChange={(e) => setDays(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && shiftValid && onShift(shiftBy)}
            aria-describedby="tl-bulk-shift-hint"
          />
          <Button size="sm" variant="secondary" disabled={!shiftValid} onClick={() => onShift(shiftBy)}>
            Shift
          </Button>
        </div>
        <span id="tl-bulk-shift-hint" className={styles.bulkHint}>
          Start and end move together, in calendar days.
        </span>
      </div>
      <Button size="sm" variant="ghost" leftIcon={X} onClick={onClear}>
        Clear selection
      </Button>
    </div>
  );
}
