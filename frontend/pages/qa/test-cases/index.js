import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import AppShell from '../../../components/AppShell';
import styles from '../../../styles/issues.module.css';
import { apiFetch } from '../../../lib/api';

const RESULT_BADGE_STYLE = {
  Passed: { background: 'var(--color-teal-tint)', color: 'var(--color-teal-dark)' },
  Failed: { background: 'var(--color-red-tint)', color: 'var(--color-red-dark)' },
  Blocked: { background: 'var(--color-amber-tint)', color: 'var(--color-amber-dark)' },
};

function ResultBadge({ result }) {
  if (!result) return <span className={styles.issueMeta}>Not run</span>;
  return <span className={styles.badge} style={RESULT_BADGE_STYLE[result]}>{result}</span>;
}

export default function TestCasesList() {
  const router = useRouter();
  const [testCases, setTestCases] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [canManage, setCanManage] = useState(false);

  useEffect(() => {
    const storedUser = localStorage.getItem('user');
    if (storedUser) {
      const role = JSON.parse(storedUser).role;
      setCanManage(role === 'admin' || role === 'qa');
    }
    apiFetch('/test-cases')
      .then(setTestCases)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  return (
    <AppShell>
      <div className={styles.pageHeader}>
        <div>
          <h1 className={styles.pageTitle}>Test Cases</h1>
          <p className={styles.pageSubtitle}>The QA test case catalog and its run history.</p>
        </div>
        {canManage && (
          <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
            <Link href="/qa/test-cases/bulk-import" className={styles.buttonSecondary}>
              Bulk Import
            </Link>
            <Link href="/qa/test-cases/new" className={`${styles.button} ${styles.buttonAccent}`}>
              + New Test Case
            </Link>
          </div>
        )}
      </div>

      {error && <div className={styles.error}>{error}</div>}
      {loading && <div className={styles.empty}>Loading...</div>}

      {!loading && testCases.length === 0 && (
        <div className={styles.card}>
          <div className={styles.empty}>
            No test cases yet.
            {canManage && ' Create one, or bulk import a batch, above.'}
          </div>
        </div>
      )}

      {!loading && testCases.length > 0 && (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Title</th>
                <th>Project</th>
                <th>Priority</th>
                <th>Category</th>
                <th>Status</th>
                <th>Last Result</th>
                <th>Last Run</th>
              </tr>
            </thead>
            <tbody>
              {testCases.map((tc) => (
                <tr key={tc.id} onClick={() => router.push(`/qa/test-cases/${tc.id}`)} style={{ cursor: 'pointer' }}>
                  <td className={styles.tableTitleCell}>{tc.title}</td>
                  <td>{tc.projectName || '—'}</td>
                  <td>{tc.priority || '—'}</td>
                  <td>{tc.category || '—'}</td>
                  <td>{tc.status}</td>
                  <td><ResultBadge result={tc.lastResult} /></td>
                  <td>{tc.lastExecutedAt ? new Date(tc.lastExecutedAt).toLocaleDateString() : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </AppShell>
  );
}
