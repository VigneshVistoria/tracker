import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import AppShell from '../components/AppShell';
import issueStyles from '../styles/issues.module.css';
import styles from '../styles/dashboard.module.css';
import { apiFetch } from '../lib/api';
import { getSocket } from '../lib/socket';
import { useToast } from '../lib/toast';
import { badgeClassFor, railClassFor } from '../lib/status';

export default function Dashboard() {
  const [user, setUser] = useState(null);
  const [issues, setIssues] = useState([]);
  const [projectCount, setProjectCount] = useState(null);
  const [loading, setLoading] = useState(true);
  const { showToast } = useToast();

  const load = useCallback(() => {
    Promise.all([apiFetch('/issues'), apiFetch('/projects')])
      .then(([issueList, projects]) => {
        setIssues(issueList);
        setProjectCount(projects.length);
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const storedUser = localStorage.getItem('user');
    if (!storedUser) return;
    setUser(JSON.parse(storedUser));
    load();
  }, [load]);

  // Live updates: refresh counts the moment anyone creates/updates an issue.
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;

    const onCreated = (issue) => {
      showToast(`New issue opened: "${issue.title}"`, 'info');
      load();
    };
    const onUpdated = (issue) => {
      showToast(`Issue #${issue.id} updated - now ${issue.status}`, 'success');
      load();
    };

    socket.on('issue:created', onCreated);
    socket.on('issue:updated', onUpdated);
    return () => {
      socket.off('issue:created', onCreated);
      socket.off('issue:updated', onUpdated);
    };
  }, [load, showToast]);

  if (!user) return <AppShell>{null}</AppShell>;

  const counts = {
    Open: issues.filter((i) => i.status === 'Open').length,
    'In Progress': issues.filter((i) => i.status === 'In Progress').length,
    'Client Review': issues.filter((i) => i.status === 'Client Review').length,
    Closed: issues.filter((i) => i.status === 'Closed').length,
  };

  const recentIssues = issues.slice(0, 5);

  return (
    <AppShell>
      <div className={issueStyles.pageHeader}>
        <div>
          <h1 className={issueStyles.pageTitle}>
            Welcome{user.fullName ? `, ${user.fullName.split(' ')[0]}` : ''}
          </h1>
          <p className={issueStyles.pageSubtitle}>
            {user.role === 'admin'
              ? 'Here\u2019s what\u2019s happening across every project.'
              : 'Here\u2019s what\u2019s on your plate right now.'}
          </p>
        </div>
        <Link href="/issues/new" className={`${issueStyles.button} ${issueStyles.buttonAccent}`}>
          + New Issue
        </Link>
      </div>

      <div className={styles.statsGrid}>
        <div className={`${styles.statCard} ${styles.accentOpen}`}>
          <div className={styles.statValue}>{loading ? '\u2013' : counts.Open}</div>
          <div className={styles.statLabel}>Open</div>
        </div>
        <div className={`${styles.statCard} ${styles.accentInProgress}`}>
          <div className={styles.statValue}>{loading ? '\u2013' : counts['In Progress']}</div>
          <div className={styles.statLabel}>In Progress</div>
        </div>
        <div className={`${styles.statCard} ${styles.accentReview}`}>
          <div className={styles.statValue}>{loading ? '\u2013' : counts['Client Review']}</div>
          <div className={styles.statLabel}>Client Review</div>
        </div>
        <div className={`${styles.statCard} ${styles.accentClosed}`}>
          <div className={styles.statValue}>{loading ? '\u2013' : counts.Closed}</div>
          <div className={styles.statLabel}>Closed</div>
        </div>
        <div className={`${styles.statCard} ${styles.accentNeutral}`}>
          <div className={styles.statValue}>{loading ? '\u2013' : projectCount}</div>
          <div className={styles.statLabel}>{user.role === 'admin' ? 'Total Projects' : 'My Projects'}</div>
        </div>
      </div>

      <div className={styles.sectionHeader}>
        <h2 className={styles.sectionTitle}>
          {user.role === 'admin' ? 'Recent Issues' : 'Your Assigned Issues'}
        </h2>
        <Link href="/issues" className={issueStyles.backLink}>View all →</Link>
      </div>

      <div>
        {loading && <div className={issueStyles.empty}>Loading...</div>}
        {!loading && recentIssues.length === 0 && (
          <div className={issueStyles.card}>
            <div className={issueStyles.empty}>Nothing here yet. Create your first issue to get started.</div>
          </div>
        )}
        {recentIssues.map((issue) => (
          <Link
            key={issue.id}
            href={`/issues/${issue.id}`}
            className={`${issueStyles.issueRow} ${railClassFor(issue.status, issueStyles)}`}
          >
            <div className={issueStyles.issueMain}>
              <p className={issueStyles.issueTitle}>
                <span className={issueStyles.issueId}>#{issue.id}</span>
                {issue.title}
              </p>
              <div className={issueStyles.issueMeta}>
                {issue.projectName && <span>{issue.projectName}</span>}
                <span>{issue.assigneeEmail ? `Assigned to ${issue.assigneeEmail}` : 'Unassigned'}</span>
              </div>
            </div>
            <span className={`${issueStyles.badge} ${badgeClassFor(issue.status, issueStyles)}`}>
              {issue.status}
            </span>
          </Link>
        ))}
      </div>

      <div className={styles.quickLinks}>
        <Link href="/admin/projects" className={styles.quickLink}>
          <span className={styles.quickLinkIcon}>{'\u25A2'}</span>
          {user.role === 'admin' ? 'Manage Projects' : 'My Projects'}
        </Link>
        {user.role === 'admin' && (
          <Link href="/admin/users" className={styles.quickLink}>
            <span className={styles.quickLinkIcon}>{'\u25CE'}</span>
            User Management
          </Link>
        )}
      </div>
    </AppShell>
  );
}
