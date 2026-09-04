import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import AppShell from '../../components/AppShell';
import styles from '../../styles/issues.module.css';
import { apiFetch } from '../../lib/api';
import { useToast } from '../../lib/toast';

export default function RollbackPage() {
  const router = useRouter();
  const { showToast } = useToast();
  const [releases, setReleases] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedId, setSelectedId] = useState(null);
  const [confirmText, setConfirmText] = useState('');
  const [rollingBack, setRollingBack] = useState(false);
  const [result, setResult] = useState(null);

  const load = () => {
    apiFetch('/ops/releases')
      .then(setReleases)
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

  const selected = releases.find((r) => r.releaseId === selectedId) || null;
  const confirmMatches = selected && (confirmText === 'ROLLBACK' || confirmText === selected.releaseId);

  const unsafeMigrations = (() => {
    if (!selected) return [];
    const targetSet = new Set(selected.migrations);
    const currentReleaseIndex1 = releases.find((r) => r.index === 1);
    if (!currentReleaseIndex1) return [];
    return currentReleaseIndex1.migrations.filter((m) => !targetSet.has(m));
  })();

  const handleRollback = async () => {
    if (!selected || !confirmMatches) return;
    setError('');
    setResult(null);
    setRollingBack(true);

    // rollback.sh restarts tracker-backend itself, which kills the very
    // request that kicked it off - so POST /ops/rollback only starts it
    // and returns immediately. Poll for the real outcome instead, and
    // treat errors while polling as "backend mid-restart," not failure.
    try {
      await apiFetch('/ops/rollback', {
        method: 'POST',
        body: JSON.stringify({ releaseId: selected.releaseId, confirmText }),
      });
    } catch (err) {
      setError(err.message);
      setRollingBack(false);
      return;
    }

    const deadline = Date.now() + 5 * 60 * 1000;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 3000));
      try {
        const status = await apiFetch('/ops/rollback/status');
        if (status.status !== 'running' && status.status !== 'unknown') {
          const success = status.status === 'success';
          setResult({ success, smokeCheckPassed: status.smokeCheckPassed, output: status.reason || status.status });
          showToast(
            success && status.smokeCheckPassed
              ? 'Rollback complete - smoke check passed'
              : 'Rollback finished but something needs attention - see details below',
            success && status.smokeCheckPassed ? 'success' : 'error',
          );
          setConfirmText('');
          load();
          setRollingBack(false);
          return;
        }
      } catch {
        // backend likely mid-restart - keep polling until the deadline
      }
    }

    setError('Timed out waiting for the rollback to finish - check logs/rollback.log on the server.');
    setRollingBack(false);
  };

  return (
    <AppShell>
      <div className={styles.pageHeader}>
        <div>
          <h1 className={styles.pageTitle}>Rollback</h1>
          <p className={styles.pageSubtitle}>
            Revert the live app to a previous release snapshot, rebuild, restart, and run a smoke check - all in one
            action. This is destructive: it replaces the current source tree and restarts both
            tracker-backend/tracker-frontend. Every rollback is logged to the audit log.
          </p>
        </div>
      </div>

      {error && <div className={styles.error}>{error}</div>}
      {loading && <div className={styles.empty}>Loading...</div>}

      {!loading && (
        <>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th></th>
                  <th>#</th>
                  <th>Release</th>
                  <th>Timestamp (UTC)</th>
                  <th>Git commit</th>
                  <th>Description</th>
                </tr>
              </thead>
              <tbody>
                {releases.map((r) => (
                  <tr key={r.releaseId}>
                    <td>
                      <input
                        type="radio"
                        name="release"
                        checked={selectedId === r.releaseId}
                        onChange={() => {
                          setSelectedId(r.releaseId);
                          setConfirmText('');
                          setResult(null);
                        }}
                      />
                    </td>
                    <td>{r.index}</td>
                    <td style={{ fontFamily: 'monospace' }}>{r.releaseId}</td>
                    <td className={styles.issueMeta}>{new Date(r.timestamp).toLocaleString()}</td>
                    <td className={styles.issueMeta} style={{ fontFamily: 'monospace' }}>
                      {r.gitHead ? r.gitHead.slice(0, 8) : 'n/a'}
                      {r.gitDirty ? ' (dirty)' : ''}
                    </td>
                    <td className={styles.issueMeta}>{r.description}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {selected && (
            <div className={styles.tableWrap} style={{ padding: '16px', marginTop: '16px' }}>
              <h3 style={{ marginTop: 0 }}>Roll back to {selected.releaseId}</h3>
              <p className={styles.issueMeta}>{selected.description}</p>

              {unsafeMigrations.length > 0 && (
                <div className={styles.error}>
                  This release predates {unsafeMigrations.length} migration(s) that have since been applied and have
                  no down-script: {unsafeMigrations.join(', ')}. Rolling back code alone may not be safe - the
                  underlying rollback.sh will refuse unless every one of these has a paired
                  <code> .down.sql</code> file.
                </div>
              )}

              <label style={{ display: 'block', margin: '12px 0 4px', fontWeight: 600 }}>
                Type <code>ROLLBACK</code> or the release id (<code>{selected.releaseId}</code>) to confirm
              </label>
              <input
                className={styles.input}
                style={{ width: '320px' }}
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                placeholder="ROLLBACK"
              />

              <div style={{ marginTop: '12px' }}>
                <button
                  className={styles.button}
                  type="button"
                  disabled={!confirmMatches || rollingBack}
                  onClick={handleRollback}
                >
                  {rollingBack ? 'Rolling back... this can take a few minutes' : 'Roll Back to This Release'}
                </button>
              </div>
            </div>
          )}

          {result && (
            <div style={{ marginTop: '16px' }}>
              <div className={result.success && result.smokeCheckPassed ? styles.successBanner : styles.error}>
                Rollback {result.success ? 'completed' : 'FAILED'} - smoke check{' '}
                {result.smokeCheckPassed ? 'PASSED' : 'FAILED'}
              </div>
              <p className={styles.issueMeta} style={{ marginTop: '8px' }}>
                {result.output ? `Status: ${result.output}. ` : ''}
                Full script output is on the server at <code>logs/last-rollback-output.log</code>.
              </p>
            </div>
          )}
        </>
      )}
    </AppShell>
  );
}
