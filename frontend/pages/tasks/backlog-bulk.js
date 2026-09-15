import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import AppShell from '../../components/AppShell';
import styles from '../../styles/issues.module.css';
import { apiFetch, apiDownload } from '../../lib/api';
import { useToast } from '../../lib/toast';

const VIEW_ROLES = ['admin', 'program_manager'];

// Strips the "data:...;base64," prefix FileReader.readAsDataURL adds -
// the backend expects raw base64 only, same convention as
// admin/issues-bulk.js's own readFileAsBase64().
function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      resolve(result.slice(result.indexOf(',') + 1));
    };
    reader.onerror = () => reject(new Error('Could not read the selected file.'));
    reader.readAsDataURL(file);
  });
}

export default function TaskBacklogBulkPage() {
  const router = useRouter();
  const { showToast } = useToast();
  const fileInputRef = useRef(null);

  const [user, setUser] = useState(null);

  const [exportFormat, setExportFormat] = useState('csv');
  const [exporting, setExporting] = useState(false);

  const [importFormat, setImportFormat] = useState('csv');
  const [fileName, setFileName] = useState('');
  const [selectedFile, setSelectedFile] = useState(null);
  const [importing, setImporting] = useState(false);
  const [downloadingTemplate, setDownloadingTemplate] = useState('');
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const storedUser = localStorage.getItem('user');
    if (!storedUser) {
      router.replace('/');
      return;
    }
    const parsed = JSON.parse(storedUser);
    if (!VIEW_ROLES.includes(parsed.role)) {
      router.replace('/dashboard');
      return;
    }
    setUser(parsed);
  }, [router]);

  if (!user) return null;

  // Import creates tasks - Program Manager only, matching who can create
  // a task one at a time on the Task Backlog page. Admin can still export
  // and download the template (view-only access, same as everywhere else
  // in Tasks).
  const canImport = user.role === 'program_manager';

  const handleExport = async () => {
    setError('');
    setExporting(true);
    try {
      await apiDownload(`/tasks/bulk-export?format=${exportFormat}`, `task-backlog-export.${exportFormat}`);
      showToast('Export downloaded', 'success');
    } catch (err) {
      setError(err.message);
    } finally {
      setExporting(false);
    }
  };

  const handleDownloadTemplate = async (format) => {
    setError('');
    setDownloadingTemplate(format);
    try {
      await apiDownload(`/tasks/bulk-import-template?format=${format}`, `task-backlog-import-template.${format}`);
    } catch (err) {
      setError(err.message);
    } finally {
      setDownloadingTemplate('');
    }
  };

  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setSelectedFile(file);
    setResult(null);
    setError('');
    setImportFormat(file.name.toLowerCase().endsWith('.xlsx') ? 'xlsx' : 'csv');
  };

  const handleImport = async (e) => {
    e.preventDefault();
    setError('');
    setResult(null);
    if (!selectedFile) {
      setError('Choose a file first.');
      return;
    }
    setImporting(true);
    try {
      const fileBase64 = await readFileAsBase64(selectedFile);
      const outcome = await apiFetch('/tasks/bulk-import', {
        method: 'POST',
        body: JSON.stringify({ format: importFormat, fileBase64 }),
      });
      setResult(outcome);
      if (outcome.success) {
        showToast(`Imported: ${outcome.created?.length || 0} task(s) created`, 'success');
        setSelectedFile(null);
        setFileName('');
        if (fileInputRef.current) fileInputRef.current.value = '';
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setImporting(false);
    }
  };

  return (
    <AppShell>
      <div className={styles.pageHeader}>
        <div>
          <h1 className={styles.pageTitle}>Bulk Import / Export Task Backlog</h1>
          <p className={styles.pageSubtitle}>
            Export the current Task Backlog (unassigned tasks) to a spreadsheet, or upload one to create many
            Backlog tasks at once instead of adding them one by one.
          </p>
        </div>
        <Link href="/tasks/backlog" className={styles.backLink}>&larr; Back to Task Backlog</Link>
      </div>

      {error && <div className={styles.error}>{error}</div>}

      <div className={styles.card}>
        <h3 style={{ marginTop: 0, fontSize: '1rem' }}>Export</h3>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
          <div className={styles.field} style={{ marginBottom: 0 }}>
            <label className={styles.label} htmlFor="exportFormat">Format</label>
            <select
              id="exportFormat"
              className={styles.select}
              value={exportFormat}
              onChange={(e) => setExportFormat(e.target.value)}
            >
              <option value="csv">CSV</option>
              <option value="xlsx">Excel (.xlsx)</option>
            </select>
          </div>
          <button className={`${styles.button} ${styles.buttonAccent}`} type="button" onClick={handleExport} disabled={exporting}>
            {exporting ? 'Exporting...' : 'Export'}
          </button>
        </div>
      </div>

      {canImport && (
        <div className={styles.card}>
          <h3 style={{ marginTop: 0, fontSize: '1rem' }}>Import</h3>
          <p className={styles.helpText}>
            Columns: Project, Module, Phase, Title, Description (optional), Priority (optional), Assignee (optional
            - an email; leave blank to create the task unassigned in the Task Backlog, same as today). Not sure what
            columns are expected? Download a template with two example rows already filled in correctly.
          </p>
          <div className={styles.actions} style={{ marginBottom: 'var(--space-4)' }}>
            <button
              className={styles.buttonSecondary}
              type="button"
              onClick={() => handleDownloadTemplate('csv')}
              disabled={downloadingTemplate !== ''}
            >
              {downloadingTemplate === 'csv' ? 'Downloading...' : 'Download CSV Template'}
            </button>
            <button
              className={styles.buttonSecondary}
              type="button"
              onClick={() => handleDownloadTemplate('xlsx')}
              disabled={downloadingTemplate !== ''}
            >
              {downloadingTemplate === 'xlsx' ? 'Downloading...' : 'Download Excel Template'}
            </button>
          </div>

          <form onSubmit={handleImport}>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="bulkFile">Spreadsheet File</label>
              <input
                ref={fileInputRef}
                className={styles.input}
                id="bulkFile"
                type="file"
                accept=".csv,text/csv,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                onChange={handleFileChange}
              />
              {fileName && <p className={styles.helpText}>Selected: {fileName} ({importFormat})</p>}
            </div>

            <div className={styles.actions}>
              <button className={`${styles.button} ${styles.buttonAccent}`} type="submit" disabled={importing || !selectedFile}>
                {importing ? 'Importing...' : 'Import'}
              </button>
            </div>
          </form>
        </div>
      )}

      {result && (
        <div className={styles.card}>
          <h3 style={{ marginTop: 0, fontSize: '1rem' }}>Import Results</h3>
          {result.success ? (
            <p className={styles.issueMeta}>{result.created?.length || 0} task(s) created.</p>
          ) : (
            <p className={styles.issueMeta}>
              {result.errors.length} error{result.errors.length === 1 ? '' : 's'} found - nothing was imported.
            </p>
          )}

          {result.errors.length > 0 && (
            <div className={styles.tableWrap} style={{ marginTop: 'var(--space-3)' }}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Row</th>
                    <th>Field</th>
                    <th>Problem</th>
                  </tr>
                </thead>
                <tbody>
                  {result.errors.map((e, i) => (
                    <tr key={i}>
                      <td>{e.row === 0 ? '—' : e.row}</td>
                      <td>{e.field || '—'}</td>
                      <td style={{ color: 'var(--color-red-dark)' }}>{e.message}</td>
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
