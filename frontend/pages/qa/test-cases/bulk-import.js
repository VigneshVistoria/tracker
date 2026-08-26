import { useRef, useState } from 'react';
import Link from 'next/link';
import AppShell from '../../../components/AppShell';
import styles from '../../../styles/issues.module.css';
import { apiFetch } from '../../../lib/api';
import { useToast } from '../../../lib/toast';

const CSV_TEMPLATE =
  'title,description,preconditions,steps,expectedResult,priority,category,projectName\n' +
  '"Login with valid credentials","Verify a user can log in","User has an active account","1. Go to login\n2. Enter valid email/password\n3. Submit","User is redirected to the dashboard","High","New Feature",""\n';

export default function BulkImportTestCases() {
  const { showToast } = useToast();
  const fileInputRef = useRef(null);
  const [fileName, setFileName] = useState('');
  const [csvText, setCsvText] = useState('');
  const [importing, setImporting] = useState(false);
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

  const downloadTemplate = () => {
    const blob = new Blob([CSV_TEMPLATE], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'test-cases-template.csv';
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <AppShell>
      <div className={styles.pageHeader}>
        <div>
          <h1 className={styles.pageTitle}>Bulk Import Test Cases</h1>
          <p className={styles.pageSubtitle}>
            Upload a CSV with columns: title, description, preconditions, steps, expectedResult, priority, category,
            projectName. Title, steps, and expectedResult are required.
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
            <button className={styles.buttonSecondary} type="button" onClick={downloadTemplate}>
              Download CSV Template
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
                    <th>Ticket #</th>
                    <th>Title</th>
                  </tr>
                </thead>
                <tbody>
                  {result.created.map((tc) => (
                    <tr key={tc.id}>
                      <td className={styles.issueId}>
                        <Link href={`/qa/test-cases/${tc.id}`}>#{tc.id}</Link>
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
