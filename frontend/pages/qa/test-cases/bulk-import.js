import { useRef, useState } from 'react';
import Link from 'next/link';
import AppShell from '../../../components/AppShell';
import styles from '../../../styles/issues.module.css';
import { apiFetch, apiDownload } from '../../../lib/api';
import { useToast } from '../../../lib/toast';

export default function BulkImportTestCases() {
  const { showToast } = useToast();
  const fileInputRef = useRef(null);
  const [fileName, setFileName] = useState('');
  const [csvText, setCsvText] = useState('');
  const [importing, setImporting] = useState(false);
  const [downloadingTemplate, setDownloadingTemplate] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');

  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setResult(null);
    setError('');
    const reader = new FileReader();
    reader.onload = () => setCsvText(String(reader.result || ''));
    reader.readAsText(file);
  };

  const handleImport = async (e) => {
    e.preventDefault();
    setError('');
    setResult(null);
    if (!csvText.trim()) {
      setError('Choose a CSV file first.');
      return;
    }
    setImporting(true);
    try {
      const outcome = await apiFetch('/test-cases/bulk-import', {
        method: 'POST',
        body: JSON.stringify({ csvText }),
      });
      setResult(outcome);
      if (outcome.created.length > 0) {
        showToast(`Imported ${outcome.created.length} test case${outcome.created.length === 1 ? '' : 's'}`, 'success');
      }
      if (outcome.errors.length === 0) {
        setCsvText('');
        setFileName('');
        if (fileInputRef.current) fileInputRef.current.value = '';
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setImporting(false);
    }
  };

  // Server-generated (TestCasesService.buildCsvTemplate()), not a
  // hardcoded client-side string, so the template can never drift out of
  // sync with the columns bulkImport() actually reads.
  const downloadTemplate = async () => {
    setError('');
    setDownloadingTemplate(true);
    try {
      await apiDownload('/test-cases/bulk-import-template', 'test-cases-template.csv');
    } catch (err) {
      setError(err.message);
    } finally {
      setDownloadingTemplate(false);
    }
  };

  return (
    <AppShell>
      <div className={styles.pageHeader}>
        <div>
          <h1 className={styles.pageTitle}>Bulk Import Test Cases</h1>
          <p className={styles.pageSubtitle}>
            Upload a CSV with columns: title, description, preconditions, steps, expectedResult, priority, category,
            projectName, moduleName, phaseName. Title, steps, and expectedResult are required - moduleName requires a
            projectName on the same row, phaseName requires a moduleName.
          </p>
        </div>
      </div>

      <div className={styles.card}>
        {error && <div className={styles.error}>{error}</div>}

        <form onSubmit={handleImport}>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="csvFile">CSV File</label>
            <input
              ref={fileInputRef}
              className={styles.input}
              id="csvFile"
              type="file"
              accept=".csv,text/csv"
              onChange={handleFileChange}
            />
            {fileName && <p className={styles.helpText}>Selected: {fileName}</p>}
          </div>

          <div className={styles.actions}>
            <button className={`${styles.button} ${styles.buttonAccent}`} type="submit" disabled={importing || !csvText}>
              {importing ? 'Importing...' : 'Import'}
            </button>
            <button className={styles.buttonSecondary} type="button" onClick={downloadTemplate} disabled={downloadingTemplate}>
              {downloadingTemplate ? 'Downloading...' : 'Download CSV Template'}
            </button>
            <Link href="/qa/test-cases" className={styles.buttonSecondary}>Cancel</Link>
          </div>
        </form>
      </div>

      {result && (
        <div className={styles.card}>
          <h3 style={{ marginTop: 0, fontSize: '1rem' }}>Import Results</h3>
          <p className={styles.issueMeta}>
            {result.created.length} created, {result.errors.length} row{result.errors.length === 1 ? '' : 's'} skipped.
          </p>

          {result.errors.length > 0 && (
            <div className={styles.tableWrap} style={{ marginTop: 'var(--space-3)' }}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Row</th>
                    <th>Problem</th>
                  </tr>
                </thead>
                <tbody>
                  {result.errors.map((e, i) => (
                    <tr key={i}>
                      <td>{e.row === 0 ? '—' : e.row}</td>
                      <td style={{ color: 'var(--color-red-dark)' }}>{e.message}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {result.created.length > 0 && (
            <div className={styles.tableWrap} style={{ marginTop: 'var(--space-3)' }}>
              <table className={styles.table}>
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
                        <Link href={`/qa/test-cases/${tc.id}`}>{tc.caseNumber || `#${tc.id}`}</Link>
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
