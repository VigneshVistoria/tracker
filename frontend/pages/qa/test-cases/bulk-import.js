import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import AppShell from '../../../components/AppShell';
import styles from '../../../styles/issues.module.css';
import { apiFetch, apiDownload } from '../../../lib/api';
import { useToast } from '../../../lib/toast';
import { readFileAsBase64 } from '../../../lib/testCaseFields';

// Long files render only this many "ready to import" rows in the preview
// table - the counts above it are always for the whole file.
const PREVIEW_ROW_LIMIT = 200;

function formatFor(fileName) {
  const ext = fileName.split('.').pop().toLowerCase();
  if (ext === 'csv') return 'csv';
  if (ext === 'xlsx') return 'xlsx';
  return null;
}

function ProblemTable({ caption, rows, color }) {
  if (rows.length === 0) return null;
  return (
    <div className={styles.tableWrap} style={{ marginTop: 'var(--space-3)' }}>
      <table className={styles.table}>
        <caption style={{ textAlign: 'left', fontWeight: 600, padding: 'var(--space-2) 0' }}>{caption}</caption>
        <thead>
          <tr>
            <th>Row</th>
            <th>Title</th>
            <th>Details</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <td>{r.row === 0 ? 'File' : r.row}</td>
              <td>{r.title || '—'}</td>
              <td style={color ? { color } : undefined}>{r.message}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Two steps so a file can't create a mess: "Check File" runs the import
// as a dry run (TestCasesService.bulkImport() with dryRun) and shows what
// would be created, skipped as already existing, or rejected - nothing
// is saved. "Import" then sends the same file for real; the backend
// re-validates it from scratch rather than trusting the preview.
export default function BulkImportTestCases() {
  const { showToast } = useToast();
  const fileInputRef = useRef(null);
  const [file, setFile] = useState(null); // { name, format, base64 }
  const [checking, setChecking] = useState(false);
  const [importing, setImporting] = useState(false);
  const [downloading, setDownloading] = useState('');
  const [preview, setPreview] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [canConfigure, setCanConfigure] = useState(false);

  useEffect(() => {
    const storedUser = localStorage.getItem('user');
    if (storedUser) {
      const role = JSON.parse(storedUser).role;
      setCanConfigure(role === 'admin' || role === 'program_manager');
    }
  }, []);

  const resetFile = () => {
    setFile(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleFileChange = async (e) => {
    const selected = e.target.files?.[0];
    setPreview(null);
    setResult(null);
    setError('');
    if (!selected) {
      setFile(null);
      return;
    }
    const format = formatFor(selected.name);
    if (!format) {
      setError('Choose a .xlsx or .csv file. For an older .xls file, open it in Excel and use Save As > Excel Workbook (.xlsx) first.');
      resetFile();
      return;
    }
    try {
      setFile({ name: selected.name, format, base64: await readFileAsBase64(selected) });
    } catch (err) {
      setError(err.message);
      resetFile();
    }
  };

  const runImport = (dryRun) =>
    apiFetch('/test-cases/bulk-import', {
      method: 'POST',
      body: JSON.stringify({ format: file.format, fileBase64: file.base64, dryRun }),
    });

  const handleCheck = async (e) => {
    e.preventDefault();
    if (!file) {
      setError('Choose a file first.');
      return;
    }
    setError('');
    setResult(null);
    setChecking(true);
    try {
      setPreview(await runImport(true));
    } catch (err) {
      setError(err.message);
    } finally {
      setChecking(false);
    }
  };

  const handleImport = async () => {
    setError('');
    setImporting(true);
    try {
      const outcome = await runImport(false);
      setResult(outcome);
      setPreview(null);
      resetFile();
      if (outcome.created.length > 0) {
        showToast(`Imported ${outcome.created.length} test case${outcome.created.length === 1 ? '' : 's'}`, 'success');
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setImporting(false);
    }
  };

  // Server-generated (TestCasesService.buildTemplate()) so it always has
  // this tenant's current custom field columns.
  const downloadTemplate = async (format) => {
    setError('');
    setDownloading(format);
    try {
      await apiDownload(`/test-cases/bulk-import-template?format=${format}`, `test-cases-template.${format}`);
    } catch (err) {
      setError(err.message);
    } finally {
      setDownloading('');
    }
  };

  const fileErrors = preview ? preview.errors.filter((e) => e.row === 0) : [];
  const readyCount = preview ? preview.toImport.length : 0;

  return (
    <AppShell>
      <div className={styles.pageHeader}>
        <div>
          <h1 className={styles.pageTitle}>Bulk Import Test Cases</h1>
          <p className={styles.pageSubtitle}>
            Upload an Excel (.xlsx) or CSV file with one test case per row. You'll see a preview before anything is saved.
          </p>
        </div>
      </div>

      <div className={styles.card}>
        <h2 style={{ marginTop: 0, fontSize: '1rem' }}>How it works</h2>
        <ul className={styles.issueMeta} style={{ paddingLeft: 'var(--space-5)', lineHeight: 1.6 }}>
          <li>
            <strong>Required columns:</strong> title, steps, expectedResult. Header names are flexible: "Expected Result",
            "expected_result" and "Test Steps" all work.
          </li>
          <li>
            <strong>Optional columns:</strong> description, preconditions, priority, category, projectName, moduleName, phaseName,
            labels (comma-separated), plus one column per custom field, named exactly like the field.
          </li>
          <li>
            <strong>No duplicates:</strong> a row with the same title in the same project as an existing test case is skipped, and so
            is a re-imported export row whose caseNumber already exists.
          </li>
          <li>Columns that don't match any field are listed in the preview, never silently dropped.</li>
          <li>Imported test cases start as Draft and need PM review before they can be run.</li>
        </ul>
        <p className={styles.helpText}>
          The Excel template includes dropdowns and an Instructions sheet with every valid project, module, phase and label.
          {canConfigure && (
            <>
              {' '}Need more columns? Add them under <Link href="/qa/test-cases/fields">Test Case Fields</Link> and{' '}
              <Link href="/admin/labels">Labels</Link>, then download a fresh template.
            </>
          )}
        </p>
        <div className={styles.actions}>
          <button className={styles.buttonSecondary} type="button" onClick={() => downloadTemplate('xlsx')} disabled={!!downloading}>
            {downloading === 'xlsx' ? 'Downloading...' : 'Download Excel Template'}
          </button>
          <button className={styles.buttonSecondary} type="button" onClick={() => downloadTemplate('csv')} disabled={!!downloading}>
            {downloading === 'csv' ? 'Downloading...' : 'Download CSV Template'}
          </button>
        </div>
      </div>

      <div className={styles.card}>
        {error && <div className={styles.error} role="alert">{error}</div>}

        <form onSubmit={handleCheck}>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="importFile">Step 1: Choose your file</label>
            <input
              ref={fileInputRef}
              className={styles.input}
              id="importFile"
              type="file"
              accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
              onChange={handleFileChange}
            />
            <p className={styles.helpText}>
              {file ? `Selected: ${file.name}` : 'Excel: only the first sheet is read. Row 1 must be the column headers.'}
            </p>
          </div>

          <div className={styles.actions}>
            <button className={`${styles.button} ${styles.buttonAccent}`} type="submit" disabled={checking || importing || !file}>
              {checking ? 'Checking...' : 'Step 2: Check File'}
            </button>
            <Link href="/qa/test-cases" className={styles.buttonSecondary}>Cancel</Link>
          </div>
        </form>
      </div>

      {preview && (
        <div className={styles.card} aria-live="polite">
          <h2 style={{ marginTop: 0, fontSize: '1rem' }}>Preview - nothing has been saved yet</h2>

          {fileErrors.length > 0 ? (
            <>
              <div className={styles.error} role="alert">
                This file can't be imported yet:
                <ul style={{ margin: 'var(--space-2) 0 0', paddingLeft: 'var(--space-5)' }}>
                  {fileErrors.map((e, i) => <li key={i}>{e.message}</li>)}
                </ul>
              </div>
            </>
          ) : (
            <p className={styles.issueMeta}>
              {preview.totalRows} row{preview.totalRows === 1 ? '' : 's'} in the file: <strong>{readyCount} ready to import</strong>,{' '}
              {preview.skipped.length} already exist{preview.skipped.length === 1 ? 's' : ''} (will be skipped),{' '}
              {preview.errors.length} with errors (will be skipped).
            </p>
          )}

          {preview.warnings.length > 0 && (
            <div className={styles.card} style={{ background: 'var(--ds-color-warning-tint)', color: 'var(--ds-color-warning-dark)', marginTop: 'var(--space-3)' }}>
              <strong>Check these columns:</strong>
              <ul style={{ margin: 'var(--space-2) 0 0', paddingLeft: 'var(--space-5)' }}>
                {preview.warnings.map((w, i) => <li key={i}>{w}</li>)}
              </ul>
            </div>
          )}

          <ProblemTable
            caption={`Rows with errors (${preview.errors.length - fileErrors.length}) - fix these in your file and check again`}
            rows={preview.errors.filter((e) => e.row !== 0)}
            color="var(--color-red-dark)"
          />
          <ProblemTable caption={`Already in the portal - will be skipped (${preview.skipped.length})`} rows={preview.skipped} />

          {readyCount > 0 && (
            <div className={styles.tableWrap} style={{ marginTop: 'var(--space-3)' }}>
              <table className={styles.table}>
                <caption style={{ textAlign: 'left', fontWeight: 600, padding: 'var(--space-2) 0' }}>
                  Ready to import ({readyCount}){readyCount > PREVIEW_ROW_LIMIT ? ` - showing the first ${PREVIEW_ROW_LIMIT}` : ''}
                </caption>
                <thead>
                  <tr>
                    <th>Row</th>
                    <th>Title</th>
                    <th>Project / Module / Phase</th>
                    <th>Priority</th>
                    <th>Labels</th>
                    <th>Custom Fields</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.toImport.slice(0, PREVIEW_ROW_LIMIT).map((r) => (
                    <tr key={r.row}>
                      <td>{r.row}</td>
                      <td>{r.title}</td>
                      <td>{[r.projectName, r.moduleName, r.phaseName].filter(Boolean).join(' / ') || '—'}</td>
                      <td>{r.priority || '—'}</td>
                      <td>{r.labels.length > 0 ? r.labels.join(', ') : '—'}</td>
                      <td>{r.customFieldCount > 0 ? `${r.customFieldCount} set` : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className={styles.actions} style={{ marginTop: 'var(--space-4)' }}>
            <button
              className={`${styles.button} ${styles.buttonAccent}`}
              type="button"
              onClick={handleImport}
              disabled={importing || readyCount === 0 || fileErrors.length > 0}
            >
              {importing ? 'Importing...' : `Step 3: Import ${readyCount} Test Case${readyCount === 1 ? '' : 's'}`}
            </button>
            {readyCount === 0 && fileErrors.length === 0 && (
              <span className={styles.helpText}>Nothing new to import from this file.</span>
            )}
          </div>
        </div>
      )}

      {result && (
        <div className={styles.card} aria-live="polite">
          <h2 style={{ marginTop: 0, fontSize: '1rem' }}>Import complete</h2>
          <p className={styles.issueMeta}>
            {result.created.length} created, {result.skipped.length} skipped as already existing, {result.errors.length} with errors.
            New test cases are in Draft - <Link href="/qa/test-cases?review=Draft">submit them for PM review</Link>.
          </p>
          <ProblemTable caption="Not imported - errors" rows={result.errors} color="var(--color-red-dark)" />
          <ProblemTable caption="Not imported - already existed" rows={result.skipped} />
          {result.created.length > 0 && (
            <div className={styles.tableWrap} style={{ marginTop: 'var(--space-3)' }}>
              <table className={styles.table}>
                <caption style={{ textAlign: 'left', fontWeight: 600, padding: 'var(--space-2) 0' }}>Created ({result.created.length})</caption>
                <thead>
                  <tr>
                    <th>Case #</th>
                    <th>Title</th>
                  </tr>
                </thead>
                <tbody>
                  {result.created.map((tc) => (
                    <tr key={tc.id}>
                      <td className={styles.issueId}>
                        <Link href={`/qa/test-cases/${tc.id}`}>{tc.caseNumber}</Link>
                      </td>
                      <td>{tc.title}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </AppShell>
  );
}
