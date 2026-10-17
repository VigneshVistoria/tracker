import { useMemo, useState } from 'react';
import { Trash2 } from 'lucide-react';
import Modal from '../ui/Modal';
import Button from '../ui/Button';
import { apiFetch } from '../../lib/api';
import { formatDate } from '../../lib/formatDate';
import { groupByModule } from '../../lib/projectTimeline';
import { earliestStart, wouldCreateCycle } from '../../lib/projectTimelineDeps';
import { useToast } from '../../lib/toast';
import styles from '../../styles/projectTimeline.module.css';

// Project Timeline Stage B - one phase's links: what it starts after
// (editable gap in calendar days) and what waits on it. PM/Admin add and
// remove - saved straight away, each audited; Executive reads. Phases
// that would close a loop aren't offered. Dates shown are the page's
// (unsaved edits included).

function phaseName(r) {
  return `${r.module} – ${r.phase || 'new phase'}`;
}

export default function DependencyDialog({ row, rows, deps, projectId, canEdit, onClose, onDepsChanged }) {
  const { showToast } = useToast();
  const [predId, setPredId] = useState('');
  const [lag, setLag] = useState('0');
  const [busy, setBusy] = useState(false);
  const byId = useMemo(() => new Map(rows.filter((r) => r.id != null).map((r) => [r.id, r])), [rows]);
  const before = deps.filter((d) => d.successorRowId === row.id);
  const after = deps.filter((d) => d.predecessorRowId === row.id);
  const groups = useMemo(
    () =>
      groupByModule(rows.filter((r) => r.id != null && r.id !== row.id))
        .map((g) => ({
          ...g,
          rows: g.rows.filter((r) => !before.some((d) => d.predecessorRowId === r.id) && !wouldCreateCycle(deps, r.id, row.id)),
        }))
        .filter((g) => g.rows.length),
    [rows, row.id, deps], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const call = async (fn, done) => {
    setBusy(true);
    try {
      onDepsChanged(await fn());
      showToast(done, 'success');
      return true;
    } catch (err) {
      showToast(err.message, 'error');
      return false;
    } finally {
      setBusy(false);
    }
  };

  const base = `/project-timeline/projects/${projectId}/dependencies`;
  const lagNum = Number(lag);
  const lagOk = /^\d+$/.test(lag) && lagNum <= 365;

  const add = async () => {
    const ok = await call(
      () => apiFetch(base, { method: 'POST', body: JSON.stringify({ predecessorRowId: Number(predId), successorRowId: row.id, lagDays: lagNum }) }),
      'Dependency added.',
    );
    if (ok) {
      setPredId('');
      setLag('0');
    }
  };
  const setGap = (dep, value) => {
    const n = Number(value);
    if (!/^\d+$/.test(String(value)) || n > 365 || n === dep.lagDays) return;
    call(() => apiFetch(`${base}/${dep.id}`, { method: 'PATCH', body: JSON.stringify({ lagDays: n }) }), 'Gap updated.');
  };
  const remove = (dep) => call(() => apiFetch(`${base}/${dep.id}`, { method: 'DELETE' }), 'Dependency removed.');

  const line = (dep, other, isPred) => {
    const pred = isPred ? other : row;
    const succ = isPred ? row : other;
    const earliest = pred?.endDate ? earliestStart(pred.endDate, dep.lagDays) : null;
    const early = earliest && succ?.startDate && succ.startDate < earliest;
    return (
      <li key={dep.id} className={styles.depItem}>
        <div className={styles.depMain}>
          <span className={styles.depName}>{other ? phaseName(other) : 'Removed phase'}</span>
          <span className={styles.muted}>
            {other ? `${formatDate(other.startDate)} – ${formatDate(other.endDate)}` : ''}
            {early && (
              <span className={styles.issueError}>
                {' '}
                · starts too early - earliest {formatDate(earliest)}
              </span>
            )}
          </span>
        </div>
        {isPred && (
          <label className={styles.depGap}>
            <span>Gap (days)</span>
            {canEdit ? (
              <input
                type="number"
                min={0}
                max={365}
                className={styles.input}
                defaultValue={dep.lagDays}
                disabled={busy}
                onBlur={(e) => setGap(dep, e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
                aria-label={`Gap in days after ${other ? phaseName(other) : 'phase'}`}
              />
            ) : (
              <strong>{dep.lagDays}</strong>
            )}
          </label>
        )}
        {canEdit && (
          <button type="button" className={styles.iconButton} onClick={() => remove(dep)} disabled={busy} aria-label={`Remove link with ${other ? phaseName(other) : 'phase'}`} title="Remove">
            <Trash2 size={16} aria-hidden="true" />
          </button>
        )}
      </li>
    );
  };

  return (
    <Modal open onClose={onClose} title={`Dependencies – ${row.phase || 'new phase'}`} size="md" footer={<Button variant="secondary" onClick={onClose}>Close</Button>}>
      <p className={styles.muted} style={{ marginTop: 0 }}>
        {phaseName(row)} · {formatDate(row.startDate)} – {formatDate(row.endDate)}. A phase may start the day after the phases it depends on
        finish, plus the gap.{canEdit ? ' Links are saved straight away; moving dates never moves other phases unless you choose to.' : ''}
      </p>

      <h3 className={styles.depHeading}>Starts after</h3>
      {before.length === 0 ? <p className={styles.muted}>Nothing - this phase can start any time.</p> : <ul className={styles.depList}>{before.map((d) => line(d, byId.get(d.predecessorRowId), true))}</ul>}

      {canEdit && (
        <div className={styles.depAdd}>
          <div className={styles.depAddPick}>
            <label className={styles.label} htmlFor="dep-pred">
              Add: starts after
            </label>
            <select id="dep-pred" className={styles.input} value={predId} onChange={(e) => setPredId(e.target.value)} disabled={busy}>
              <option value="">Choose a phase…</option>
              {groups.map((g) => (
                <optgroup key={g.key} label={g.name}>
                  {g.rows.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.phase} ({formatDate(r.endDate)})
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>
          <div className={styles.depAddGap}>
            <label className={styles.label} htmlFor="dep-lag">
              Gap (days)
            </label>
            <input id="dep-lag" type="number" min={0} max={365} className={styles.input} value={lag} onChange={(e) => setLag(e.target.value)} disabled={busy} />
          </div>
          <Button onClick={add} disabled={busy || !predId || !lagOk} loading={busy}>
            Add
          </Button>
        </div>
      )}
      {canEdit && !lagOk && <p className={styles.issueError}>The gap must be a whole number of days from 0 to 365.</p>}

      <h3 className={styles.depHeading}>Waiting on this phase</h3>
      {after.length === 0 ? <p className={styles.muted}>No phase waits on this one.</p> : <ul className={styles.depList}>{after.map((d) => line(d, byId.get(d.successorRowId), false))}</ul>}
    </Modal>
  );
}
