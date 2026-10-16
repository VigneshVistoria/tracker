import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, AlertTriangle, CheckCircle2, Info, Upload, Wand2 } from 'lucide-react';
import Button from '../ui/Button';
import Badge from '../ui/Badge';
import styles from '../../styles/projectTimeline.module.css';
import { apiFetch, apiDownload } from '../../lib/api';
import { useToast } from '../../lib/toast';
import { useConfirm } from '../../lib/confirm';
import { readFileAsBase64 } from '../../lib/testCaseFields';
import { formatDate } from '../../lib/formatDate';
import { TIMELINE_STATUSES, dateRange, formatFor } from '../../lib/projectTimeline';

const FIELD_LABEL = { module: 'Module', phase: 'Phase', team: 'Team', status: 'Status', startDate: 'Start Date', endDate: 'End Date' };
const DIFF_TONE = { new: 'success', changed: 'info', unchanged: 'neutral' };
const DIFF_LABEL = { new: 'New', changed: 'Changed', unchanged: 'Unchanged' };
const FILTERS = [
  ['all', 'All rows'],
  ['errors', 'Errors'],
  ['warnings', 'Warnings'],
  ['suggestions', 'Suggestions'],
  ['changes', 'New or changed'],
];

const suggestionKey = (rowNumber, s) => `${rowNumber}:${s.field}:${s.to}`;

function Stat({ label, value, tone }) {
  return (
    <div className={`${styles.stat} ${tone === 'error' ? styles.statError : ''} ${tone === 'warning' ? styles.statWarning : ''}`}>
      <div className={styles.statValue}>{value}</div>
      <div className={styles.statLabel}>{label}</div>
    </div>
  );
}

// Upload -> preview -> Import for one project. Nothing is saved until the
// PM clicks Import: the file is only read (/import/parse), and every edit
// in the preview re-runs the server's validation (/import/preview, which
// saves nothing). Import re-validates from scratch on the server.
export default function ImportPanel({ project, onImported, onCancel }) {
  const { showToast } = useToast();
  const confirmAction = useConfirm();
  const fileInputRef = useRef(null);
  const [file, setFile] = useState(null);
  const [rows, setRows] = useState(null);
  const [ignoredColumns, setIgnoredColumns] = useState([]);
  const [preview, setPreview] = useState(null);
  const [previewing, setPreviewing] = useState(false);
  const [error, setError] = useState('');
  const [rejected, setRejected] = useState(() => new Set());
  const [deleteIds, setDeleteIds] = useState(() => new Set());
  const [filter, setFilter] = useState('all');
  const [importing, setImporting] = useState(false);
  const requestSeq = useRef(0);

  const reset = () => {
    setFile(null);
    setRows(null);
    setPreview(null);
    setRejected(new Set());
    setDeleteIds(new Set());
    setIgnoredColumns([]);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const onFileChange = async (e) => {
    const selected = e.target.files?.[0];
    setError('');
    reset();
    if (!selected) return;
    const format = formatFor(selected.name);
    if (!format) {
      setError('Choose a .csv or .xlsx file. For an older .xls file, open it in Excel and use Save As > Excel Workbook (.xlsx) first.');
      return;
    }
    try {
      const fileBase64 = await readFileAsBase64(selected);
      setFile({ name: selected.name, format });
      const parsed = await apiFetch('/project-timeline/import/parse', { method: 'POST', body: JSON.stringify({ format, fileBase64 }) });
      setIgnoredColumns(parsed.ignoredColumns || []);
      setRows(parsed.rows.map((r) => ({ ...r, include: true })));
    } catch (err) {
      setError(err.message);
      setFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  // Re-check on the server after every change (debounced); late answers
  // to older requests are dropped.
  useEffect(() => {
    if (!rows) return undefined;
    setPreviewing(true);
    const seq = ++requestSeq.current;
    const timer = setTimeout(() => {
      apiFetch(`/project-timeline/projects/${project.id}/import/preview`, { method: 'POST', body: JSON.stringify({ rows }) })
        .then((result) => {
          if (seq !== requestSeq.current) return;
          setPreview(result);
          setError('');
        })
        .catch((err) => seq === requestSeq.current && setError(err.message))
        .finally(() => seq === requestSeq.current && setPreviewing(false));
    }, 350);
    return () => clearTimeout(timer);
  }, [rows, project.id]);

  const updateRow = (rowNumber, patch) => setRows((prev) => prev.map((r) => (r.rowNumber === rowNumber ? { ...r, ...patch } : r)));

  const accept = (rowNumber, s) => updateRow(rowNumber, { [s.field]: s.to });
  const reject = (rowNumber, s) => setRejected((prev) => new Set(prev).add(suggestionKey(rowNumber, s)));

  const openSuggestions = (r) => r.suggestions.filter((s) => !rejected.has(suggestionKey(r.rowNumber, s)));
  const allOpenSuggestions = preview ? preview.rows.flatMap((r) => (r.include ? openSuggestions(r).map((s) => [r.rowNumber, s]) : [])) : [];

  const acceptAll = () => {
    const patches = new Map();
    for (const [rowNumber, s] of allOpenSuggestions) patches.set(rowNumber, { ...(patches.get(rowNumber) || {}), [s.field]: s.to });
    setRows((prev) => prev.map((r) => (patches.has(r.rowNumber) ? { ...r, ...patches.get(r.rowNumber) } : r)));
  };

  const previewByRow = useMemo(() => new Map((preview?.rows || []).map((r) => [r.rowNumber, r])), [preview]);
  const visibleRows = (rows || []).filter((raw) => {
    const p = previewByRow.get(raw.rowNumber);
    if (!p || filter === 'all') return true;
    if (filter === 'errors') return p.errors.length > 0;
    if (filter === 'warnings') return p.warnings.length > 0;
    if (filter === 'suggestions') return openSuggestions(p).length > 0;
    return p.diff === 'new' || p.diff === 'changed';
  });

  const s = preview?.summary;
  const after = s?.afterImport;
  const toApply = s ? s.toImport + deleteIds.size : 0;

  const runImport = async () => {
    const parts = [`${s.toImport} row${s.toImport === 1 ? '' : 's'} will be imported into ${project.name} (${s.newRows} new, ${s.changedRows} changed).`];
    if (s.errorRows) parts.push(`${s.errorRows} row${s.errorRows === 1 ? '' : 's'} with errors will be skipped.`);
    if (deleteIds.size) parts.push(`${deleteIds.size} row${deleteIds.size === 1 ? '' : 's'} missing from the file will be deleted from the plan.`);
    if (s.newTeams.length) parts.push(`New team${s.newTeams.length === 1 ? '' : 's'} added to the Team list: ${s.newTeams.join(', ')}.`);
    if (!(await confirmAction({ title: 'Import into the plan?', message: parts.join(' '), confirmLabel: 'Import' }))) return;
    setImporting(true);
    try {
      const result = await apiFetch(`/project-timeline/projects/${project.id}/import`, {
        method: 'POST',
        body: JSON.stringify({ rows, deleteIds: [...deleteIds] }),
      });
      showToast(
        `Imported: ${result.created} new, ${result.updated} updated, ${result.unchanged} unchanged${result.deleted ? `, ${result.deleted} deleted` : ''}${result.skipped ? `, ${result.skipped} skipped` : ''}.`,
        'success',
      );
      onImported(result.plan);
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setImporting(false);
    }
  };

  return (
    <section className={styles.panel} aria-labelledby="import-heading">
      <h2 id="import-heading" className={styles.sectionTitle} style={{ marginTop: 0 }}>
        Import a plan file into {project.name}
      </h2>
      <p className={styles.muted}>
        One row per Module + Phase, with the columns Module, Phase, Team, Status, Start Date, End Date (dates like 1-Jul-26). You will see
        every row checked before anything is saved. Uploading again updates the rows with the same Module + Phase and never creates duplicates.
      </p>
      <div className={styles.toolbar}>
        <div>
          <label className={styles.label} htmlFor="timeline-file">
            Plan file (.csv or .xlsx)
          </label>
          <input id="timeline-file" ref={fileInputRef} type="file" accept=".csv,.xlsx" onChange={onFileChange} />
        </div>
        <div className={styles.actions}>
          <Button variant="ghost" size="sm" onClick={() => apiDownload('/project-timeline/template?format=csv', 'project-timeline-template.csv').catch((e) => showToast(e.message, 'error'))}>
            Download CSV template
          </Button>
          <Button variant="ghost" size="sm" onClick={() => apiDownload('/project-timeline/template?format=xlsx', 'project-timeline-template.xlsx').catch((e) => showToast(e.message, 'error'))}>
            Download Excel template
          </Button>
        </div>
      </div>

      {error && (
        <div className={`${styles.notice} ${styles.noticeError}`} role="alert">
          {error}
        </div>
      )}
      {ignoredColumns.length > 0 && (
        <div className={`${styles.notice} ${styles.noticeInfo}`}>Columns not used (ignored): {ignoredColumns.join(', ')}</div>
      )}

      {rows && (
        <>
          <h3 className={styles.sectionTitle}>
            Preview of {file?.name} – nothing has been saved yet {previewing && <span className={styles.muted}>(checking…)</span>}
          </h3>
          {s && (
            <div aria-live="polite">
              <div className={styles.stats}>
                <Stat label="Rows in file" value={s.totalRows} />
                <Stat label="Modules" value={s.modules} />
                <Stat label="Rows with errors (skipped)" value={s.errorRows} tone={s.errorRows ? 'error' : undefined} />
                <Stat label={`Warnings (on ${s.warningRows} rows)`} value={s.warnings} tone={s.warnings ? 'warning' : undefined} />
                <Stat label="Name fixes suggested" value={allOpenSuggestions.length} />
                <Stat label="Rows to import" value={s.toImport} />
              </div>
              <p className={styles.muted}>
                Compared with the saved plan: {s.newRows} new, {s.changedRows} changed, {s.unchangedRows} unchanged, {s.missingRows} missing from
                the file{rows.some((r) => !r.include) ? `, ${rows.filter((r) => !r.include).length} unticked` : ''}.
              </p>
              <h4 className={styles.sectionTitle}>The plan after import</h4>
              <div className={styles.stats}>
                <Stat label="Rows in plan" value={after.rows} />
                <Stat label="Overdue (To Do, end date passed)" value={after.overdue} tone={after.overdue ? 'error' : undefined} />
                <Stat label="Delayed" value={after.delayed} tone={after.delayed ? 'error' : undefined} />
                <Stat label="Overlapping pairs" value={after.overlaps.length} tone={after.overlaps.length ? 'warning' : undefined} />
              </div>
              <p className={styles.muted}>Overdue uses today in the team time zone: {formatDate(preview.today)}.</p>
              {after.overlaps.length > 0 && (
                <details className={styles.details}>
                  <summary>Overlapping phases ({after.overlaps.length})</summary>
                  <ul>
                    {after.overlaps.map((p, i) => (
                      <li key={i}>
                        {p.module}: {p.a.phase} ({dateRange(p.a.startDate, p.a.endDate)}) and {p.b.phase} ({dateRange(p.b.startDate, p.b.endDate)})
                      </li>
                    ))}
                  </ul>
                </details>
              )}
              {(after.delayedPastEnd.length > 0 || after.inProgressPastEnd.length > 0) && (
                <details className={styles.details}>
                  <summary>
                    For information – past their end date but not counted as overdue: {after.delayedPastEnd.length} Delayed,{' '}
                    {after.inProgressPastEnd.length} In Progress
                  </summary>
                  <ul>
                    {[...after.delayedPastEnd, ...after.inProgressPastEnd].map((r, i) => (
                      <li key={i}>
                        {r.status}: {r.module} – {r.phase} (ended {formatDate(r.endDate)})
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          )}

          <div className={styles.filterBar} role="group" aria-label="Show rows">
            {FILTERS.map(([key, label]) => (
              <Button key={key} size="sm" variant={filter === key ? 'primary' : 'secondary'} aria-pressed={filter === key} onClick={() => setFilter(key)}>
                {label}
              </Button>
            ))}
            {allOpenSuggestions.length > 0 && (
              <Button size="sm" variant="secondary" leftIcon={Wand2} onClick={acceptAll}>
                Accept all {allOpenSuggestions.length} suggestions
              </Button>
            )}
          </div>

          <div className={styles.tableWrap}>
            <table className={`${styles.table} ${styles.previewTable}`}>
              <caption className="sr-only">Every row of the file; the line under each row lists its checks. Untick a row to leave it out.</caption>
              <thead>
                <tr>
                  <th scope="col">Import</th>
                  <th scope="col">Row</th>
                  {Object.values(FIELD_LABEL).map((l) => (
                    <th key={l} scope="col">
                      {l}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((raw) => {
                  const p = previewByRow.get(raw.rowNumber);
                  const hasErrors = p && p.errors.length > 0;
                  const label = `row ${raw.rowNumber}`;
                  return [
                    <tr key={raw.rowNumber} className={`${raw.include && hasErrors ? styles.rowError : ''} ${!raw.include ? styles.rowUnticked : ''}`}>
                      <td>
                        <input
                          type="checkbox"
                          checked={raw.include}
                          onChange={(e) => updateRow(raw.rowNumber, { include: e.target.checked })}
                          aria-label={`Import ${label}`}
                        />
                      </td>
                      <td>{raw.rowNumber}</td>
                      {Object.keys(FIELD_LABEL).map((field) => (
                        <td key={field}>
                          <input
                            className={`${styles.input} ${styles[`preview_${field}`]}`}
                            value={raw[field]}
                            list={field === 'status' ? 'timeline-statuses' : undefined}
                            onChange={(e) => updateRow(raw.rowNumber, { [field]: e.target.value })}
                            aria-label={`${FIELD_LABEL[field]}, ${label}`}
                            aria-invalid={hasErrors || undefined}
                          />
                          {(field === 'startDate' || field === 'endDate') && p?.values[field] && (
                            <div className={styles.issueInfo}>{formatDate(p.values[field])}</div>
                          )}
                        </td>
                      ))}
                    </tr>,
                    <tr key={`${raw.rowNumber}-checks`} className={`${styles.checksRow} ${raw.include && hasErrors ? styles.rowError : ''} ${!raw.include ? styles.rowUnticked : ''}`}>
                      <td />
                      <td colSpan={7} aria-label={`Checks for ${label}`}>
                        {p && (
                          <ul className={styles.issues}>
                            {p.diff && (
                              <li>
                                <Badge tone={DIFF_TONE[p.diff]}>{DIFF_LABEL[p.diff]}</Badge>
                              </li>
                            )}
                            {Object.entries(p.changes).map(([field, c]) => (
                              <li key={field} className={styles.issueInfo}>
                                {FIELD_LABEL[field]}: {c.old ?? '—'} → {c.new ?? '—'}
                              </li>
                            ))}
                            {p.errors.map((e) => (
                              <li key={e} className={styles.issueError}>
                                <AlertCircle size={12} aria-hidden="true" /> Error: {e}
                              </li>
                            ))}
                            {p.warnings.map((w) => (
                              <li key={w} className={styles.issueWarning}>
                                <AlertTriangle size={12} aria-hidden="true" /> Warning: {w}
                              </li>
                            ))}
                            {openSuggestions(p).map((sg) => (
                              <li key={suggestionKey(raw.rowNumber, sg)} className={styles.suggestion}>
                                <Info size={12} aria-hidden="true" />
                                <span>{sg.message}</span>
                                <button type="button" className={styles.linkButton} onClick={() => accept(raw.rowNumber, sg)}>
                                  Accept “{sg.to}”
                                </button>
                                <button type="button" className={styles.linkButton} onClick={() => reject(raw.rowNumber, sg)}>
                                  Reject
                                </button>
                              </li>
                            ))}
                            {p.tidied.length > 0 && (
                              <li className={styles.issueInfo}>Extra spaces removed from {p.tidied.map((f) => FIELD_LABEL[f]).join(', ')}</li>
                            )}
                            {p.newTeam && p.values.team && <li className={styles.issueInfo}>New team: {p.values.team}</li>}
                            {!hasErrors && !p.warnings.length && !openSuggestions(p).length && (
                              <li className={styles.issueInfo}>
                                <CheckCircle2 size={12} aria-hidden="true" /> OK
                              </li>
                            )}
                          </ul>
                        )}
                      </td>
                    </tr>,
                  ];
                })}
                {visibleRows.length === 0 && (
                  <tr>
                    <td colSpan={8} className={styles.muted}>
                      No rows match this filter.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
            <datalist id="timeline-statuses">
              {TIMELINE_STATUSES.map((st) => (
                <option key={st} value={st} />
              ))}
            </datalist>
          </div>

          {preview && preview.missing.length > 0 && (
            <>
              <h3 className={styles.sectionTitle}>In the saved plan but missing from this file ({preview.missing.length})</h3>
              <p className={styles.muted}>These are kept unless you tick them for deletion.</p>
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th scope="col">Delete</th>
                      <th scope="col">Module</th>
                      <th scope="col">Phase</th>
                      <th scope="col">Team</th>
                      <th scope="col">Status</th>
                      <th scope="col">Dates</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.missing.map((m) => (
                      <tr key={m.id}>
                        <td>
                          <input
                            type="checkbox"
                            checked={deleteIds.has(m.id)}
                            aria-label={`Delete ${m.module} – ${m.phase} from the plan`}
                            onChange={(e) =>
                              setDeleteIds((prev) => {
                                const next = new Set(prev);
                                if (e.target.checked) next.add(m.id);
                                else next.delete(m.id);
                                return next;
                              })
                            }
                          />
                        </td>
                        <td>{m.module}</td>
                        <td>{m.phase}</td>
                        <td>{m.teamName || '—'}</td>
                        <td>{m.status}</td>
                        <td>{dateRange(m.startDate, m.endDate)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}

      <div className={styles.saveBar}>
        <span className={styles.saveBarText}>
          {s ? `${s.toImport} row${s.toImport === 1 ? '' : 's'} ready to import${s.errorRows ? `, ${s.errorRows} will be skipped` : ''}.` : 'Choose a file to see the preview.'}
        </span>
        <Button variant="secondary" onClick={onCancel} disabled={importing}>
          Cancel
        </Button>
        <Button leftIcon={Upload} onClick={runImport} loading={importing} disabled={!s || previewing || importing || toApply === 0}>
          Import
        </Button>
      </div>
    </section>
  );
}
