import { useEffect, useState } from 'react';
import Link from 'next/link';
import AppShell from '../../components/AppShell';
import styles from '../../styles/issues.module.css';
import { apiFetch } from '../../lib/api';
import { badgeClassFor } from '../../lib/status';

function formatDate(value) {
  if (!value) return '—';
  return new Date(value).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export default function ReceivedDependencies() {
  const [dependencies, setDependencies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    apiFetch('/issues/dependencies/received')
      .then(setDependencies)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  return (
    <AppShell>
      <div className={styles.pageHeader}>
        <div>
          <h1 className={styles.pageTitle}>Dependency</h1>
          <p className={styles.pageSubtitle}>Dependency tickets other people have routed to you to own.</p>
        </div>
      </div>

      {error && <div className={styles.error}>{error}</div>}

      {loading && <div className={styles.empty}>Loading...</div>}

      {!loading && dependencies.length === 0 && (
        <div className={styles.card}>
          <div className={styles.empty}>No dependencies have been routed to you yet.</div>
        </div>
      )}

      {!loading && dependencies.length > 0 && (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Ticket #</th>
                <th>Title</th>
                <th>From</th>
                <th>Project</th>
                <th>Related Issue</th>
                <th>Status</th>
                <th>Received On</th>
              </tr>
            </thead>
            <tbody>
              {dependencies.map((dep) => (
                <tr key={dep.id}>
                  <td className={styles.issueId}>
                    <Link href={`/issues/${dep.id}`}>#{dep.id}</Link>
                  </td>
                  <td className={styles.tableTitleCell}>
                    <Link href={`/issues/${dep.id}`}>{dep.title}</Link>
                  </td>
                  <td>{dep.createdByEmail || '—'}</td>
                  <td>{dep.projectName || '—'}</td>
                  <td>
                    {dep.parentIssueId ? <Link href={`/issues/${dep.parentIssueId}`}>#{dep.parentIssueId}</Link> : '—'}
                  </td>
                  <td>
                    <span className={`${styles.badge} ${badgeClassFor(dep.status, styles)}`}>{dep.status}</span>
                  </td>
                  <td>{formatDate(dep.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </AppShell>
  );
}
