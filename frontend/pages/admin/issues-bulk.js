import { useEffect, useRef, useState } from 'react';
import AppShell from '../../components/AppShell';
import styles from '../../styles/issues.module.css';
import { apiFetch, apiDownload } from '../../lib/api';
import { useToast } from '../../lib/toast';

// Strips the "data:...;base64," prefix FileReader.readAsDataURL adds -
// the backend expects raw base64 only, same convention as the mobile
// app's photo-attachment upload.
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

export default function IssuesBulkPage() {
  const { showToast } = useToast();
  const fileInputRef = useRef(null);

  const [projects, setProjects] = useState([]);
  const [exportFormat, setExportFormat] = useState('csv');
  const [exportProjectId, setExportProjectId] = useState('');
  const [exporting, setExporting] = useState(false);

  const [importFormat, setImportFormat] = useState('csv');
  const [fileName, setFileName] = useState('');
  const [selectedFile, setSelectedFile] = useState(null);
  const [importing, setImporting] = useState(false);
  const [downloadingTemplate, setDownloadingTemplate] = useState('');
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    apiFetch('/projects').then(setProjects).catch(() => {});
  }, []);

  const handleExport = async () => {
    setError('');
    setExporting(true);
    try {
      const query = new URLSearchParams({ format: exportFormat });
      if (exportProjectId) query.set('projectId', exportProjectId);
      await apiDownload(`/issues/bulk-export?${query.toString()}`, `issues-export.${exportFormat}`);
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
      await apiDownload(`/issues/bulk-import-template?format=${format}`, `issues-import-template.${format}`);
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
      const outcome = await apiFetch('/issues/bulk-import', {
        method: 'POST',
        body: JSON.stringify({ format: importFormat, fileBase64 }),
      });
      setResult(outcome);
      if (outcome.success) {
        const createdCount = outcome.created?.length || 0;
        const updatedCount = outcome.updated?.length || 0;
        showToast(`Imported: ${createdCount} created, ${updatedCount} updated`, 'success');
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
          <h1 className={styles.pageTitle}>Bulk Import / Export Issues</h1>
          <p className={styles.pageSubtitle}>
            Export issues to a spreadsheet, edit offline, and re-upload to bulk create or update them. Rows with no
            Issue ID create a new issue; rows with an existing Issue ID update that issue. Every row in the file must
            be valid or nothing is imported.
          </p>
        </div>
      </div>

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
          <div className={styles.field} style={{ marginBottom: 0 }}>
            <label className={styles.label} htmlFor="exportProject">Project (optional)</label>
            <select
              id="exportProject"
              className={styles.select}
              value={exportProjectId}
              onChange={(e) => setExportProjectId(e.target.value)}
            >
              <option value="">All projects</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
          <button className={`${styles.button} ${styles.buttonAccent}`} type="button" onClick={handleExport} disabled={exporting}>
            {exporting ? 'Exporting...' : 'Export'}
          </button>
        </div>
      </div>

      <div className={styles.card}>
        <h3 style={{ marginTop: 0, fontSize: '1rem' }}>Import</h3>
        <p className={styles.helpText}>
          Not sure what columns are expected? Download a template with two example rows (one showing a new-issue
          row with no Issue ID, one showing an update row with an Issue ID) already filled in correctly.
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

        {error && <div className={styles.error}>{error}</div>}
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

      {result && (
        <div className={styles.card}>
          <h3 style={{ marginTop: 0, fontSize: '1rem' }}>Import Results</h3>
          {result.success ? (
            <p className={styles.issueMeta}>
              {result.created?.length || 0} created, {result.updated?.length || 0} updated.
            </p>
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
