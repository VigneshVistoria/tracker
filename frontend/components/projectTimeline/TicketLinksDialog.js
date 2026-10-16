import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Search, Trash2 } from 'lucide-react';
import Modal from '../ui/Modal';
import Button from '../ui/Button';
import { apiFetch } from '../../lib/api';
import { formatDate } from '../../lib/formatDate';
import { progressText, ticketMismatches } from '../../lib/projectTimelineTickets';
import { useToast } from '../../lib/toast';
import styles from '../../styles/projectTimeline.module.css';

// Project Timeline Stage C - one phase's tickets. PM/Admin link an app
// Module (+ optional Phase) - every ticket there counts, including ones
// created later - or single tickets found by #id or title. Saved straight
// away, each audited; Executive reads. Tickets are only read: progress is
// the average "% Complete" from Task Status Config, Junk/Closed left out.

export default function TicketLinksDialog({ row, info, projectId, canEdit, onClose, onChanged }) {
  const { showToast } = useToast();
  const [options, setOptions] = useState(null);
  const [moduleId, setModuleId] = useState('');
  const [phaseId, setPhaseId] = useState('');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [busy, setBusy] = useState(false);
  const base = `/project-timeline/projects/${projectId}`;
  const links = info?.links || [];
  const tickets = info?.tickets || [];
  const progress = info?.progress || null;
  const mismatches = ticketMismatches(row.status, progress, links.length);
  const linkedTaskIds = useMemo(() => new Set(links.filter((l) => l.taskId != null).map((l) => l.taskId)), [links]);

  useEffect(() => {
    if (!canEdit) return;
    apiFetch(`${base}/ticket-link-options`)
      .then(setOptions)
      .catch((err) => showToast(err.message, 'error'));
  }, [base, canEdit]); // eslint-disable-line react-hooks/exhaustive-deps

  // Ticket search, 300 ms after typing stops.
  useEffect(() => {
    if (!canEdit || !query.trim()) {
      setResults([]);
      return undefined;
    }
    const id = setTimeout(() => {
      setSearching(true);
      apiFetch(`${base}/ticket-search?q=${encodeURIComponent(query.trim())}`)
        .then(setResults)
        .catch((err) => showToast(err.message, 'error'))
        .finally(() => setSearching(false));
    }, 300);
    return () => clearTimeout(id);
  }, [query, base, canEdit]); // eslint-disable-line react-hooks/exhaustive-deps

  const call = async (fn, done) => {
    setBusy(true);
    try {
      onChanged(await fn());
      showToast(done, 'success');
      return true;
    } catch (err) {
      showToast(err.message, 'error');
      return false;
    } finally {
      setBusy(false);
    }
  };

  const addModule = async () => {
    const ok = await call(
      () =>
        apiFetch(`${base}/ticket-links`, {
          method: 'POST',
          body: JSON.stringify({ rowId: row.id, moduleId: Number(moduleId), ...(phaseId ? { phaseId: Number(phaseId) } : {}) }),
        }),
      'Linked.',
    );
    if (ok) {
      setModuleId('');
      setPhaseId('');
    }
  };
  const addTicket = (taskId) => call(() => apiFetch(`${base}/ticket-links`, { method: 'POST', body: JSON.stringify({ rowId: row.id, taskId }) }), `Ticket #${taskId} linked.`);
  const remove = (link) => call(() => apiFetch(`${base}/ticket-links/${link.id}`, { method: 'DELETE' }), 'Link removed.');

  const linkLabel = (l) => (l.kind === 'ticket' ? `Ticket #${l.taskId} ${l.taskTitle || ''}` : `${l.moduleName || 'Module'}${l.phaseName ? ` › ${l.phaseName}` : ' (all phases)'}`);
  const phasesFor = options?.find((m) => String(m.id) === moduleId)?.phases || [];

  return (
    <Modal open onClose={onClose} title={`Tickets – ${row.phase || 'new phase'}`} size="lg" footer={<Button variant="secondary" onClick={onClose}>Close</Button>}>
      <p className={styles.muted} style={{ marginTop: 0 }}>
        {row.module} – {row.phase} · {row.status} · {formatDate(row.startDate)} – {formatDate(row.endDate)}
      </p>

      <div className={styles.ticketProgress}>
        <div
          className={styles.ticketBar}
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={progress?.percent ?? 0}
          aria-label={`Ticket progress: ${progressText(progress)}`}
        >
          <span style={{ width: `${progress?.percent ?? 0}%` }} />
        </div>
        <strong>{progressText(progress)}</strong>
        {progress?.hold > 0 && <span className={styles.muted}>{progress.hold} on hold</span>}
        {progress?.leftOut > 0 && <span className={styles.muted}>{progress.leftOut} closed, not counted</span>}
      </div>
      {mismatches.map((m) => (
        <p key={m.code} className={styles.flagWarning} role="status">
          {m.text}
        </p>
      ))}

      <h3 className={styles.depHeading}>Linked to</h3>
      {links.length === 0 ? (
        <p className={styles.muted}>Nothing yet{canEdit ? ' - link a module or tickets below.' : '.'}</p>
      ) : (
        <ul className={styles.depList}>
          {links.map((l) => (
            <li key={l.id} className={styles.depItem}>
              <div className={styles.depMain}>
                <span className={styles.depName}>{linkLabel(l)}</span>
                <span className={styles.muted}>{l.kind === 'ticket' ? 'One ticket' : 'Every ticket here, including new ones'}</span>
              </div>
              {canEdit && (
                <button type="button" className={styles.iconButton} onClick={() => remove(l)} disabled={busy} aria-label={`Remove link: ${linkLabel(l)}`} title="Remove">
                  <Trash2 size={16} aria-hidden="true" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {canEdit && (
        <>
          <div className={styles.depAdd}>
            <div className={styles.depAddPick}>
              <label className={styles.label} htmlFor="tl-module">
                Link a module
              </label>
              <select
                id="tl-module"
                className={styles.input}
                value={moduleId}
                onChange={(e) => {
                  setModuleId(e.target.value);
                  setPhaseId('');
                }}
                disabled={busy || !options}
              >
                <option value="">{options ? (options.length ? 'Choose a module…' : 'This project has no modules') : 'Loading…'}</option>
                {(options || []).map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                    {m.isActive ? '' : ' (inactive)'}
                  </option>
                ))}
              </select>
            </div>
            <div className={styles.depAddPick}>
              <label className={styles.label} htmlFor="tl-phase">
                Phase (optional)
              </label>
              <select id="tl-phase" className={styles.input} value={phaseId} onChange={(e) => setPhaseId(e.target.value)} disabled={busy || !moduleId}>
                <option value="">All phases</option>
                {phasesFor.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                    {p.isActive ? '' : ' (inactive)'}
                  </option>
                ))}
              </select>
            </div>
            <Button onClick={addModule} disabled={busy || !moduleId}>
              Link
            </Button>
          </div>

          <div className={styles.ticketSearch}>
            <label className={styles.label} htmlFor="tl-search">
              Or link single tickets
            </label>
            <div className={styles.searchWrap}>
              <Search size={16} aria-hidden="true" />
              <input
                id="tl-search"
                className={styles.input}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="#123 or words from the title"
                autoComplete="off"
              />
            </div>
            {query.trim() && (
              <ul className={styles.searchResults} aria-live="polite" aria-busy={searching}>
                {results.length === 0 && !searching && <li className={styles.muted}>No tickets in this project match.</li>}
                {results.map((t) => (
                  <li key={t.id}>
                    <span className={styles.searchResultText}>
                      <strong>#{t.id}</strong> {t.title}
                      <span className={styles.muted}>
                        {' '}
                        · {t.status}
                        {t.moduleName ? ` · ${t.moduleName}` : ''}
                      </span>
                    </span>
                    <Button size="sm" variant="secondary" onClick={() => addTicket(t.id)} disabled={busy || linkedTaskIds.has(t.id)}>
                      {linkedTaskIds.has(t.id) ? 'Linked' : 'Link'}
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}

      <h3 className={styles.depHeading}>Tickets ({tickets.length})</h3>
      {tickets.length === 0 ? (
        <p className={styles.muted}>No tickets match the links yet.</p>
      ) : (
        <ul className={styles.ticketList}>
          {tickets.map((t) => (
            <li key={t.id}>
              <Link href={`/tasks/${t.id}`} className={styles.ticketLink}>
                #{t.id} {t.title}
              </Link>
              <span className={styles.muted}>
                {t.status} · {['Junk', 'Closed'].includes(t.status) ? 'not counted' : `${t.percent}%`}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
