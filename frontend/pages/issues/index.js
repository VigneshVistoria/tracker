import { useEffect, useState, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import AppShell from '../../components/AppShell';
import styles from '../../styles/issues.module.css';
import { apiFetch } from '../../lib/api';
import { getSocket } from '../../lib/socket';
import { useToast } from '../../lib/toast';
import { badgeClassFor, STATUS_OPTIONS, MODE_OPTIONS, canCreateTickets } from '../../lib/status';

function formatDate(value) {
  if (!value) return '—';
  const d = new Date(value);
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export default function IssuesList() {
  const router = useRouter();
  const [issues, setIssues] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [user, setUser] = useState(null);
  const { showToast } = useToast();

  const [modeFilter, setModeFilter] = useState('All');
  const [statusFilter, setStatusFilter] = useState('All');
  const [showstopperFilter, setShowstopperFilter] = useState('All');
  const [search, setSearch] = useState('');

  const load = useCallback(() => {
    apiFetch('/issues')
      .then(setIssues)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const token = localStorage.getItem('accessToken');
    const storedUser = localStorage.getItem('user');
    if (!token || !storedUser) {
      router.replace('/');
      return;
    }
    setUser(JSON.parse(storedUser));
    load();
  }, [router, load]);

  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;

    const upsert = (issue) => {
      setIssues((prev) => {
        const exists = prev.some((i) => i.id === issue.id);
        if (exists) return prev.map((i) => (i.id === issue.id ? issue : i));
        return [issue, ...prev];
      });
    };

    const onCreated = (issue) => {
      showToast(`New issue: "${issue.title}"`, 'info');
      upsert(issue);
    };
    const onUpdated = (issue) => {
      showToast(`Issue #${issue.id} updated \u2192 ${issue.status}`, 'success');
      upsert(issue);
    };

    socket.on('issue:created', onCreated);
    socket.on('issue:updated', onUpdated);
    return () => {
      socket.off('issue:created', onCreated);
      socket.off('issue:updated', onUpdated);
    };
  }, [showToast]);

  const visibleIssues = useMemo(() => {
    return issues.filter((issue) => {
      if (modeFilter !== 'All' && issue.mode !== modeFilter) return false;
      if (statusFilter !== 'All' && issue.status !== statusFilter) return false;
      if (showstopperFilter !== 'All') {
        const wants = showstopperFilter === 'Yes';
        if (Boolean(issue.showstopper) !== wants) return false;
      }
      if (search.trim()) {
        const q = search.trim().toLowerCase();
        const matchesTitle = issue.title.toLowerCase().includes(q);
        const matchesId = String(issue.id).includes(q);
        if (!matchesTitle && !matchesId) return false;
      }
      return true;
    });
  }, [issues, modeFilter, statusFilter, showstopperFilter, search]);

  return (
    <AppShell>
      <div className={styles.pageHeader}>
        <div>
          <h1 className={styles.pageTitle}>Issues</h1>
          <p className={styles.pageSubtitle}>Updates appear here live as they happen.</p>
        </div>
        {canCreateTickets(user?.role) ? (
          <Link href="/issues/new" className={`${styles.button} ${styles.buttonAccent}`}>
            + New Issue
          </Link>
        ) : (
          <span
            className={`${styles.button} ${styles.buttonAccent}`}
            style={{ opacity: 0.55, cursor: 'not-allowed' }}
            title="Only Admins, Program Managers, QA, and Executives can create tickets. Ask one of them to file this for you."
          >
            + New Issue
          </span>
        )}
      </div>

      {error && <div className={styles.error}>{error}</div>}

      <div className={styles.filterBar}>
        <div className={styles.filterGroup}>
          <label className={styles.filterLabel} htmlFor="search">Search</label>
          <input
            id="search"
            className={styles.searchInput}
            placeholder="Title or ticket #"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <div className={styles.filterGroup}>
          <label className={styles.filterLabel} htmlFor="modeFilter">Mode</label>
          <select id="modeFilter" className={styles.filterSelect} value={modeFilter} onChange={(e) => setModeFilter(e.target.value)}>
            <option value="All">All</option>
            {MODE_OPTIONS.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>

        <div className={styles.filterGroup}>
          <label className={styles.filterLabel} htmlFor="statusFilter">Status</label>
          <select id="statusFilter" className={styles.filterSelect} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="All">All</option>
            {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>

        <div className={styles.filterGroup}>
          <label className={styles.filterLabel} htmlFor="showstopperFilter">Showstopper</label>
          <select id="showstopperFilter" className={styles.filterSelect} value={showstopperFilter} onChange={(e) => setShowstopperFilter(e.target.value)}>
            <option value="All">All</option>
            <option value="Yes">Yes</option>
            <option value="No">No</option>
          </select>
        </div>
      </div>

      {loading && <div className={styles.empty}>Loading...</div>}

      {!loading && visibleIssues.length === 0 && (
        <div className={styles.card}>
          <div className={styles.empty}>
            {issues.length === 0 ? (
              <>
                <p style={{ margin: '0 0 var(--space-3)' }}>No issues yet.</p>
                {canCreateTickets(user?.role) && (
                  <Link href="/issues/new" className={`${styles.button} ${styles.buttonAccent}`}>
                    + Create your first issue
                  </Link>
                )}
              </>
            ) : (
              'No issues match these filters.'
            )}
          </div>
        </div>
      )}

      {!loading && visibleIssues.length > 0 && (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Mode</th>
                <th>Ticket #</th>
                <th>Title</th>
                <th>Created On</th>
                <th>Status</th>
                <th>Showstopper</th>
                <th>Closed On</th>
              </tr>
            </thead>
            <tbody>
              {visibleIssues.map((issue) => (
                <tr key={issue.id} onClick={() => router.push(`/issues/${issue.id}`)}>
                  <td><span className={styles.modeTag}>{issue.mode}</span></td>
                  <td className={styles.issueId}>#{issue.id}</td>
                  <td className={styles.tableTitleCell}>{issue.title}</td>
                  <td>{formatDate(issue.createdAt)}</td>
                  <td>
                    <span className={`${styles.badge} ${badgeClassFor(issue.status, styles)}`}>
                      {issue.status}
                    </span>
                  </td>
                  <td className={issue.showstopper ? styles.showstopperYes : styles.showstopperNo}>
                    {issue.showstopper ? 'Yes' : 'No'}
                  </td>
                  <td>{formatDate(issue.closedOn)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </AppShell>
  );
}
