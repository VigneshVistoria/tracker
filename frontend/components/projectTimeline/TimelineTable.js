import { useEffect, useRef, useState } from 'react';
import { AlertCircle, AlertTriangle, ArrowDown, ArrowUp, ChevronDown, ChevronRight, Copy, Plus, Trash2 } from 'lucide-react';
import Badge from '../ui/Badge';
import Button from '../ui/Button';
import styles from '../../styles/projectTimeline.module.css';
import { formatDate, formatDateTime } from '../../lib/formatDate';
import { formatSlip } from '../../lib/projectTimelineSummary';
import { STATUS_TONE, TIMELINE_STATUSES, dateRange, groupByModule, isOverdue, nameKey, rowErrors, rowWarnings } from '../../lib/projectTimeline';

const ADD_TEAM = '__add_team__';

// Hover text for the "+12d vs plan" chip.
const slipTitle = (s) =>
  `Planned end ${formatDate(s.baselineEnd)} · end date moved ${s.endMoves} time${s.endMoves === 1 ? '' : 's'}` +
  (s.lastMove ? ` · last by ${s.lastMove.by || 'unknown'} on ${formatDateTime(s.lastMove.at)}` : '');

// One cell: shows the value in the app's format; for editors, a button
// that turns into an input/select (Enter or blur keeps the change, Escape
// cancels). Nothing is saved here - the page collects edits until "Save
// changes".
function EditableCell({ kind, value, display, label, canEdit, onCommit, options, wide }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? '');
  const ref = useRef(null);
  const cancelled = useRef(false);

  useEffect(() => {
    if (editing) {
      cancelled.current = false;
      setDraft(value ?? '');
      ref.current?.focus();
    }
  }, [editing]); // eslint-disable-line react-hooks/exhaustive-deps

  const shown = display ?? (value || '');
  // What a screen reader hears - `display` may be an element (the status badge).
  const spoken = typeof shown === 'string' ? shown : value;
  if (!canEdit) return <span>{shown || <span className={styles.placeholder}>—</span>}</span>;

  if (!editing) {
    return (
      <button type="button" className={styles.cellButton} onClick={() => setEditing(true)} aria-label={`${label}: ${spoken || 'empty'}. Edit`}>
        {shown || <span className={styles.placeholder}>Add…</span>}
      </button>
    );
  }

  const finish = (next) => {
    setEditing(false);
    if (!cancelled.current && next !== (value ?? '')) onCommit(next);
  };
  const onKeyDown = (e) => {
    if (e.key === 'Escape') {
      cancelled.current = true;
      setEditing(false);
    } else if (e.key === 'Enter' && kind !== 'select') {
      e.preventDefault();
      finish(draft);
    }
  };

  if (kind === 'select') {
    return (
      <select
        ref={ref}
        className={`${styles.select} ${styles.cellInput}`}
        value={draft}
        aria-label={label}
        onChange={(e) => {
          setDraft(e.target.value);
          finish(e.target.value);
        }}
        onBlur={() => setEditing(false)}
        onKeyDown={onKeyDown}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    );
  }
  return (
    <input
      ref={ref}
      type={kind === 'date' ? 'date' : 'text'}
      className={`${styles.input} ${wide ? styles.cellWide : styles.cellInput}`}
      value={draft}
      aria-label={label}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => finish(draft)}
      onKeyDown={onKeyDown}
    />
  );
}

// The plan grouped by Module (collapsible), every column editable inline
// for PM/Admin; Executive gets the same table read-only. Flags: red
// Overdue chip (To Do + end date passed), amber warnings, overlap note.
// canReorder is false while the table is filtered - moving a row past
// rows you can't see would be confusing. revealKey (from the Summary's
// "Go to row") opens that row's module, scrolls to it and focuses it.
export default function TimelineTable({ rows, teams, today, canEdit, canReorder = true, overlaps, dirtyKeys, revealKey, onRevealed, emptyText, slipByKey, onChange, onAddRow, onDuplicate, onDelete, onMove, onAddTeam }) {
  const [collapsed, setCollapsed] = useState(() => new Set());
  const [flashKey, setFlashKey] = useState(null);

  useEffect(() => {
    if (!revealKey) return;
    const row = rows.find((r) => r.key === revealKey);
    if (!row) return;
    const groupKey = nameKey(row.module) || '';
    setCollapsed((prev) => {
      if (!prev.has(groupKey)) return prev;
      const next = new Set(prev);
      next.delete(groupKey);
      return next;
    });
    // After the module opens: scroll, focus the row, highlight it briefly.
    const t = setTimeout(() => {
      const el = document.getElementById(`timeline-row-${revealKey}`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.focus({ preventScroll: true });
      }
      setFlashKey(revealKey);
      onRevealed?.();
    }, 50);
    return () => clearTimeout(t);
  }, [revealKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const groups = groupByModule(rows);
  const teamName = new Map(teams.map((t) => [t.id, t.name]));
  const teamOptions = [
    { value: '', label: 'No team' },
    ...teams.filter((t) => t.isActive).map((t) => ({ value: String(t.id), label: t.name })),
    { value: ADD_TEAM, label: '+ Add a team…' },
  ];
  const statusOptions = TIMELINE_STATUSES.map((s) => ({ value: s, label: s }));

  const toggle = (key) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  if (rows.length === 0) {
    return <p className={styles.muted}>{emptyText || `This project has no plan yet.${canEdit ? ' Import a file, or add a module.' : ''}`}</p>;
  }

  return groups.map((group) => {
    const done = group.rows.filter((r) => r.status === 'Completed').length;
    const pct = Math.round((done / group.rows.length) * 100);
    const isOpen = !collapsed.has(group.key);
    const bodyId = `timeline-group-${group.key.replace(/[^a-z0-9]+/g, '-')}`;
    return (
      <section key={group.key} className={styles.group} aria-label={`Module ${group.name}`}>
        <div className={styles.groupHeader}>
          <button type="button" className={styles.groupToggle} aria-expanded={isOpen} aria-controls={bodyId} onClick={() => toggle(group.key)}>
            {isOpen ? <ChevronDown size={16} aria-hidden="true" /> : <ChevronRight size={16} aria-hidden="true" />}
            {group.name}
          </button>
          <span className={styles.progress}>
            <span
              className={styles.progressTrack}
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={group.rows.length}
              aria-valuenow={done}
              aria-label={`${group.name}: ${done} of ${group.rows.length} phases completed`}
            >
              <span className={styles.progressFill} style={{ width: `${pct}%` }} />
            </span>
            {done} of {group.rows.length} completed
          </span>
          {canEdit && (
            <Button size="sm" variant="ghost" leftIcon={Plus} onClick={() => onAddRow(group.name)}>
              Add phase
            </Button>
          )}
        </div>
        {isOpen && (
          <div className={styles.tableWrap} id={bodyId}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col">Module</th>
                  <th scope="col">Phase</th>
                  <th scope="col">Team</th>
                  <th scope="col">Status</th>
                  <th scope="col">Start Date</th>
                  <th scope="col">End Date</th>
                  {canEdit && <th scope="col">Actions</th>}
                </tr>
              </thead>
              <tbody>
                {group.rows.map((r, i) => {
                  const errors = rowErrors(r);
                  // The red Overdue chip already says "To Do, end date passed".
                  const overdue = isOverdue(r, today);
                  const warnings = rowWarnings(r, today).filter((w) => !(overdue && w.startsWith('Still To Do')));
                  const overlapping = overlaps.get(r.key) || [];
                  const label = (field) => `${field} for ${r.module || 'new row'} – ${r.phase || 'new phase'}`;
                  const set = (patch) => onChange(r.key, patch);
                  return (
                    <tr
                      key={r.key}
                      id={`timeline-row-${r.key}`}
                      tabIndex={-1}
                      className={`${dirtyKeys.has(r.key) ? styles.rowDirty : ''} ${flashKey === r.key ? styles.rowFlash : ''}`}
                    >
                      <td>
                        <EditableCell kind="text" wide value={r.module} label={label('Module')} canEdit={canEdit} onCommit={(v) => set({ module: v })} />
                      </td>
                      <td>
                        <EditableCell kind="text" wide value={r.phase} label={label('Phase')} canEdit={canEdit} onCommit={(v) => set({ phase: v })} />
                        <div className={styles.flags}>
                          {overdue && <span className={styles.chipOverdue}>Overdue</span>}
                          {slipByKey?.get(r.key)?.slip ? (
                            <span className={styles.chipSlip} title={slipTitle(slipByKey.get(r.key))}>
                              {formatSlip(slipByKey.get(r.key).slip)} vs plan
                            </span>
                          ) : null}
                          {errors.map((e) => (
                            <span key={e} className={styles.flagError}>
                              <AlertCircle size={12} aria-hidden="true" /> {e}
                            </span>
                          ))}
                          {warnings.map((w) => (
                            <span key={w} className={styles.flagWarning}>
                              <AlertTriangle size={12} aria-hidden="true" /> {w}
                            </span>
                          ))}
                          {overlapping.length > 0 && (
                            <span className={styles.flagWarning}>
                              <AlertTriangle size={12} aria-hidden="true" /> Overlaps{' '}
                              {overlapping.map((o) => `${o.phase} (${dateRange(o.startDate, o.endDate)})`).join(', ')}
                            </span>
                          )}
                        </div>
                      </td>
                      <td>
                        <EditableCell
                          kind="select"
                          value={r.teamId != null ? String(r.teamId) : ''}
                          display={r.teamId != null ? teamName.get(r.teamId) : ''}
                          options={teamOptions}
                          label={label('Team')}
                          canEdit={canEdit}
                          onCommit={(v) => (v === ADD_TEAM ? onAddTeam(r.key) : set({ teamId: v ? Number(v) : null }))}
                        />
                      </td>
                      <td>
                        {canEdit ? (
                          <EditableCell
                            kind="select"
                            value={r.status}
                            display={<Badge tone={STATUS_TONE[r.status]}>{r.status}</Badge>}
                            options={statusOptions}
                            label={label('Status')}
                            canEdit
                            onCommit={(v) => set({ status: v })}
                          />
                        ) : (
                          <Badge tone={STATUS_TONE[r.status]}>{r.status}</Badge>
                        )}
                      </td>
                      <td className={styles.nowrap}>
                        <EditableCell kind="date" value={r.startDate || ''} display={r.startDate ? formatDate(r.startDate) : ''} label={label('Start date')} canEdit={canEdit} onCommit={(v) => set({ startDate: v || null })} />
                      </td>
                      <td className={styles.nowrap}>
                        <EditableCell kind="date" value={r.endDate || ''} display={r.endDate ? formatDate(r.endDate) : ''} label={label('End date')} canEdit={canEdit} onCommit={(v) => set({ endDate: v || null })} />
                      </td>
                      {canEdit && (
                        <td>
                          <div className={styles.rowActions}>
                            <button type="button" className={styles.iconButton} aria-label={`Move ${r.phase || 'row'} up`} title={canReorder ? 'Move up' : 'Clear filters to reorder'} disabled={!canReorder || i === 0} onClick={() => onMove(r.key, -1)}>
                              <ArrowUp size={16} aria-hidden="true" />
                            </button>
                            <button
                              type="button"
                              className={styles.iconButton}
                              aria-label={`Move ${r.phase || 'row'} down`}
                              title={canReorder ? 'Move down' : 'Clear filters to reorder'}
                              disabled={!canReorder || i === group.rows.length - 1}
                              onClick={() => onMove(r.key, 1)}
                            >
                              <ArrowDown size={16} aria-hidden="true" />
                            </button>
                            <button type="button" className={styles.iconButton} aria-label={`Duplicate ${r.phase || 'row'}`} title="Duplicate" onClick={() => onDuplicate(r.key)}>
                              <Copy size={16} aria-hidden="true" />
                            </button>
                            <button type="button" className={styles.iconButton} aria-label={`Delete ${r.phase || 'row'}`} title="Delete" onClick={() => onDelete(r.key)}>
                              <Trash2 size={16} aria-hidden="true" />
                            </button>
                          </div>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    );
  });
}
