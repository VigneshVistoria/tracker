import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import AppShell from '../../components/AppShell';
import styles from '../../styles/issues.module.css';
import { apiFetch } from '../../lib/api';
import { useToast } from '../../lib/toast';
import { getSocket } from '../../lib/socket';

function CheckRow({ check }) {
  const [expanded, setExpanded] = useState(!check.passed);
  const canExpand = Boolean(check.details || check.error || check.stack);

  return (
    <div
      style={{
        border: '1px solid var(--color-border)',
        borderLeft: `3px solid ${check.passed ? 'var(--color-teal)' : 'var(--color-red)'}`,
        borderRadius: 'var(--radius-md)',
        padding: 'var(--space-3) var(--space-4)',
        marginBottom: 'var(--space-2)',
        background: check.passed ? 'transparent' : 'var(--color-red-tint)',
      }}
    >
      <div
        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: canExpand ? 'pointer' : 'default' }}
        onClick={() => canExpand && setExpanded((v) => !v)}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
          <span className={`${styles.badge} ${check.passed ? styles.badgeOpen : ''}`}
            style={!check.passed ? { background: 'var(--color-red-tint)', color: 'var(--color-red-dark)' } : undefined}>
            {check.passed ? 'Passed' : 'Failed'}
          </span>
          <span style={{ fontWeight: 600 }}>{check.name}</span>
          <span className={styles.issueMeta}>({check.category})</span>
        </div>
        <span className={styles.issueMeta}>
          {check.durationMs}ms {canExpand ? (expanded ? '\u2013' : '+') : ''}
        </span>
      </div>
      {expanded && (
        <div style={{ marginTop: 'var(--space-2)', fontSize: '0.875rem' }}>
          {check.passed && check.details && <p className={styles.issueMeta}>{check.details}</p>}
          {!check.passed && (
            <>
              <p style={{ color: 'var(--color-red-dark)', fontWeight: 500, margin: '0 0 var(--space-2)' }}>
                {check.error}
              </p>
              {check.stack && (
                <pre
                  style={{
                    whiteSpace: 'pre-wrap',
                    fontSize: '0.75rem',
                    background: 'var(--color-paper)',
                    padding: 'var(--space-3)',
                    borderRadius: 'var(--radius-sm)',
                    overflowX: 'auto',
                    margin: 0,
                  }}
                >
                  {check.stack}
                </pre>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function RunSummary({ run, defaultOpen }) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className={styles.card} style={{ marginBottom: 'var(--space-4)' }}>
      <div
        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }}
        onClick={() => setOpen((v) => !v)}
      >
        <div>
          <span
            className={styles.badge}
            style={
              run.status === 'passed'
                ? { background: 'var(--status-open-tint)', color: 'var(--color-teal-dark)' }
                : { background: 'var(--color-red-tint)', color: 'var(--color-red-dark)' }
            }
          >
            {run.status === 'passed' ? 'All checks passed' : `${run.failedCount} failed`}
          </span>{' '}
          <span style={{ marginLeft: 'var(--space-2)' }}>
            {new Date(run.startedAt).toLocaleString()}
          </span>
        </div>
        <span className={styles.issueMeta}>
          {run.passedCount}/{run.passedCount + run.failedCount} checks &middot; {run.totalDurationMs}ms
          {run.triggeredByEmail ? ` \u00b7 by ${run.triggeredByEmail}` : ''} {open ? '\u2013' : '+'}
        </span>
      </div>
      {open && (
        <div style={{ marginTop: 'var(--space-4)' }}>
          {(run.results || []).map((check, i) => (
            <CheckRow key={i} check={check} />
          ))}
        </div>
      )}
    </div>
  );
}

export default function RegressionTestingPage() {
  const router = useRouter();
  const { showToast } = useToast();
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');

  const load = () => {
    apiFetch('/regression-testing/runs')
      .then(setHistory)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    const storedUser = localStorage.getItem('user');
    if (!storedUser) {
      router.replace('/');
      return;
    }
    if (JSON.parse(storedUser).role !== 'admin') {
      router.replace('/dashboard');
      return;
    }
    load();
  }, [router]);

  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;
    const onCompleted = (run) => {
      setHistory((prev) => [run, ...prev.filter((r) => r.id !== run.id)]);
    };
    socket.on('regressionTest:completed', onCompleted);
    return () => socket.off('regressionTest:completed', onCompleted);
  }, []);

  const handleRun = async () => {
    setError('');
    setRunning(true);
    try {
      const run = await apiFetch('/regression-testing/run', { method: 'POST' });
      showToast(
        run.status === 'passed' ? 'Regression testing passed - all checks green' : `Regression testing found ${run.failedCount} issue(s)`,
        run.status === 'passed' ? 'success' : 'error',
      );
      setHistory((prev) => [run, ...prev.filter((r) => r.id !== run.id)]);
    } catch (err) {
      setError(err.message);
    } finally {
      setRunning(false);
    }
  };

  return (
    <AppShell>
      <div className={styles.pageHeader}>
        <div>
          <h1 className={styles.pageTitle}>Regression Testing</h1>
          <p className={styles.pageSubtitle}>
            Runs a set of health checks and feature tests against this environment - useful right
            after deploying to test. All test data created during a run is removed automatically
            afterward, whether it passes or fails.
          </p>
        </div>
        <button className={`${styles.button} ${styles.buttonAccent}`} type="button" onClick={handleRun} disabled={running}>
          {running ? 'Running...' : 'Run Regression Testing'}
        </button>
      </div>

      {error && <div className={styles.error}>{error}</div>}

      {loading && <div className={styles.empty}>Loading...</div>}
      {!loading && history.length === 0 && !running && (
        <div className={styles.empty}>No regression test runs yet - click "Run Regression Testing" above.</div>
      )}

      {history.map((run, i) => (
        <RunSummary key={run.id} run={run} defaultOpen={i === 0} />
      ))}
    </AppShell>
  );
}
