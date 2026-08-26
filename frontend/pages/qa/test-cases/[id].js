import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import AppShell from '../../../components/AppShell';
import styles from '../../../styles/issues.module.css';
import { apiFetch } from '../../../lib/api';
import { useToast } from '../../../lib/toast';

const RESULT_OPTIONS = ['Passed', 'Failed', 'Blocked'];

const RESULT_BADGE_STYLE = {
  Passed: { background: 'var(--color-teal-tint)', color: 'var(--color-teal-dark)' },
  Failed: { background: 'var(--color-red-tint)', color: 'var(--color-red-dark)' },
  Blocked: { background: 'var(--color-amber-tint)', color: 'var(--color-amber-dark)' },
};

function ResultBadge({ result }) {
  if (!result) return <span className={styles.issueMeta}>Not run</span>;
  return <span className={styles.badge} style={RESULT_BADGE_STYLE[result]}>{result}</span>;
}

export default function TestCaseDetail() {
  const router = useRouter();
  const { id } = router.query;
  const { showToast } = useToast();

  const [testCase, setTestCase] = useState(null);
  const [executions, setExecutions] = useState([]);
  const [canManage, setCanManage] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [runForm, setRunForm] = useState({ result: 'Passed', notes: '', defectIssueId: '' });
  const [recording, setRecording] = useState(false);

  const load = () => {
    if (!id) return;
    setLoading(true);
    setError('');
    Promise.all([apiFetch(`/test-cases/${id}`), apiFetch(`/test-cases/${id}/executions`)])
      .then(([tc, execs]) => {
        setTestCase(tc);
        setExecutions(execs);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    const storedUser = localStorage.getItem('user');
    if (storedUser) {
      const role = JSON.parse(storedUser).role;
      setCanManage(role === 'admin' || role === 'qa');
    }
  }, []);

  useEffect(load, [id]);

  const handleRecordRun = async (e) => {
    e.preventDefault();
    setError('');
    setRecording(true);
    try {
      await apiFetch(`/test-cases/${id}/executions`, {
        method: 'POST',
        body: JSON.stringify({
          result: runForm.result,
          notes: runForm.notes || undefined,
          defectIssueId: runForm.defectIssueId ? Number(runForm.defectIssueId) : undefined,
        }),
      });
      showToast('Run recorded', 'success');
      setRunForm({ result: 'Passed', notes: '', defectIssueId: '' });
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setRecording(false);
    }
  };

  if (loading) return <AppShell><div className={styles.empty}>Loading...</div></AppShell>;
  if (!testCase) {
    return (
      <AppShell>
        <div className={styles.error}>{error || 'Test case not found.'}</div>
        <Link href="/qa/test-cases" className={styles.backLink}>&larr; Back to test cases</Link>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className={styles.pageHeader}>
        <div>
          <h1 className={styles.pageTitle}>
            <span className={styles.issueId}>#{testCase.id}</span> {testCase.title}
          </h1>
          <p className={styles.pageSubtitle}>{testCase.projectName || 'No project'} &middot; {testCase.status}</p>
        </div>
        <ResultBadge result={testCase.lastResult} />
      </div>

      {error && <div className={styles.error}>{error}</div>}

      <div className={styles.card}>
        {testCase.description && (
          <>
            <p style={{ fontWeight: 600, marginBottom: 'var(--space-2)' }}>Description</p>
            <p className={styles.issueMeta}>{testCase.description}</p>
          </>
        )}
        {testCase.preconditions && (
          <>
            <p style={{ fontWeight: 600, marginBottom: 'var(--space-2)' }}>Preconditions</p>
            <p className={styles.issueMeta} style={{ whiteSpace: 'pre-wrap' }}>{testCase.preconditions}</p>
          </>
        )}
        <p style={{ fontWeight: 600, marginBottom: 'var(--space-2)' }}>Steps</p>
        <p className={styles.issueMeta} style={{ whiteSpace: 'pre-wrap' }}>{testCase.steps}</p>
        <p style={{ fontWeight: 600, marginBottom: 'var(--space-2)' }}>Expected Result</p>
        <p className={styles.issueMeta} style={{ whiteSpace: 'pre-wrap' }}>{testCase.expectedResult}</p>
        <div style={{ display: 'flex', gap: 'var(--space-4)', marginTop: 'var(--space-3)' }}>
          <span className={styles.issueMeta}>Priority: {testCase.priority || '—'}</span>
          <span className={styles.issueMeta}>Category: {testCase.category || '—'}</span>
        </div>
      </div>

      {canManage && (
        <div className={styles.card}>
          <h3 style={{ marginTop: 0, fontSize: '1rem' }}>Record a Run</h3>
          <form onSubmit={handleRecordRun}>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="result">Result</label>
              <select
                className={styles.select}
                id="result"
                value={runForm.result}
                onChange={(e) => setRunForm({ ...runForm, result: e.target.value })}
              >
                {RESULT_OPTIONS.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="notes">Notes</label>
              <textarea
                className={styles.textarea}
                id="notes"
                value={runForm.notes}
                onChange={(e) => setRunForm({ ...runForm, notes: e.target.value })}
                placeholder="Actual result, what you observed..."
              />
            </div>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="defectIssueId">Defect Ticket # (optional)</label>
              <input
                className={styles.input}
                id="defectIssueId"
                type="number"
                min="1"
                value={runForm.defectIssueId}
                onChange={(e) => setRunForm({ ...runForm, defectIssueId: e.target.value })}
                placeholder="e.g. 42, if this run raised a bug"
              />
            </div>
            <button className={`${styles.button} ${styles.buttonAccent}`} type="submit" disabled={recording}>
              {recording ? 'Recording...' : 'Record Run'}
            </button>
          </form>
        </div>
      )}

      <div className={styles.card}>
        <h3 style={{ marginTop: 0, fontSize: '1rem' }}>Run History ({executions.length})</h3>
        {executions.length === 0 && <p className={styles.issueMeta}>Never run yet.</p>}
        {executions.length > 0 && (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Result</th>
                  <th>Notes</th>
                  <th>Defect</th>
                  <th>By</th>
                  <th>When</th>
                </tr>
              </thead>
              <tbody>
                {executions.map((exec) => (
                  <tr key={exec.id}>
                    <td><ResultBadge result={exec.result} /></td>
                    <td>{exec.notes || '—'}</td>
                    <td>{exec.defectIssueId ? <Link href={`/issues/${exec.defectIssueId}`}>#{exec.defectIssueId}</Link> : '—'}</td>
                    <td>{exec.executedByEmail || '—'}</td>
                    <td>{new Date(exec.executedAt).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </AppShell>
  );
}
