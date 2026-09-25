import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import AppShell from '../../../components/AppShell';
import styles from '../../../styles/issues.module.css';
import { apiFetch, apiDownload } from '../../../lib/api';
import { formatDate } from '../../../lib/formatDate';

const STATUS_OPTIONS = ['Active', 'Deprecated'];

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
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [canManage, setCanManage] = useState(false);

  const [search, setSearch] = useState('');
  const [projectFilter, setProjectFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  useEffect(() => {
    const storedUser = localStorage.getItem('user');
    if (storedUser) {
      const role = JSON.parse(storedUser).role;
      setCanManage(role === 'admin' || role === 'qa');
    }
    apiFetch('/projects').then(setProjects).catch(() => {});
    apiFetch('/test-cases')
      .then(setTestCases)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  const filteredTestCases = useMemo(() => {
    const term = search.trim().toLowerCase();
    return testCases.filter((tc) => {
      if (term && !tc.title.toLowerCase().includes(term) && !(tc.caseNumber || '').toLowerCase().includes(term)) {
        return false;
      }
      if (projectFilter && String(tc.projectId) !== projectFilter) return false;
      if (statusFilter && tc.status !== statusFilter) return false;
      return true;
    });
  }, [testCases, search, projectFilter, statusFilter]);

  const handleExport = async () => {
    setError('');
    try {
      const params = new URLSearchParams();
      if (projectFilter) params.set('projectId', projectFilter);
      await apiDownload(`/test-cases/bulk-export?${params.toString()}`, 'test-cases.csv');
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <AppShell>
      <div className={styles.pageHeader}>
        <div>
          <h1 className={styles.pageTitle}>Test Cases</h1>
          <p className={styles.pageSubtitle}>The QA test case catalog and its run history.</p>
        </div>
        <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
          <button className={styles.buttonSecondary} type="button" onClick={handleExport}>
            Export CSV
          </button>
          {canManage && (
            <>
              <Link href="/qa/test-cases/bulk-import" className={styles.buttonSecondary}>
                Bulk Import
              </Link>
              <Link href="/qa/test-cases/new" className={`${styles.button} ${styles.buttonAccent}`}>
                + New Test Case
              </Link>
            </>
          )}
        </div>
      </div>

      <div className={styles.card} style={{ display: 'flex', gap: 'var(--space-3)', flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div className={styles.field} style={{ margin: 0, minWidth: 220 }}>
          <label className={styles.label} htmlFor="tcSearch">Search</label>
          <input
            className={styles.input}
            id="tcSearch"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Title or case #..."
          />
        </div>
        <div className={styles.field} style={{ margin: 0, minWidth: 180 }}>
          <label className={styles.label} htmlFor="tcProjectFilter">Project</label>
          <select className={styles.select} id="tcProjectFilter" value={projectFilter} onChange={(e) => setProjectFilter(e.target.value)}>
            <option value="">All projects</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
        <div className={styles.field} style={{ margin: 0, minWidth: 160 }}>
          <label className={styles.label} htmlFor="tcStatusFilter">Status</label>
          <select className={styles.select} id="tcStatusFilter" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">All statuses</option>
            {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
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

      {!loading && testCases.length > 0 && filteredTestCases.length === 0 && (
        <div className={styles.card}>
          <div className={styles.empty}>No test cases match these filters.</div>
        </div>
      )}

      {!loading && filteredTestCases.length > 0 && (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Case #</th>
                <th>Title</th>
                <th>Project</th>
                <th>Module</th>
                <th>Phase</th>
                <th>Priority</th>
                <th>Category</th>
                <th>Status</th>
                <th>Last Result</th>
                <th>Last Run</th>
              </tr>
            </thead>
            <tbody>
              {filteredTestCases.map((tc) => (
                <tr key={tc.id} onClick={() => router.push(`/qa/test-cases/${tc.id}`)} style={{ cursor: 'pointer' }}>
                  <td className={styles.issueId}>{tc.caseNumber || `#${tc.id}`}</td>
                  <td className={styles.tableTitleCell}>{tc.title}</td>
                  <td>{tc.projectName || '—'}</td>
                  <td>{tc.moduleName || '—'}</td>
                  <td>{tc.phaseName || '—'}</td>
                  <td>{tc.priority || '—'}</td>
                  <td>{tc.category || '—'}</td>
                  <td>{tc.status}</td>
                  <td><ResultBadge result={tc.lastResult} /></td>
                  <td>{formatDate(tc.lastExecutedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </AppShell>
  );
}
