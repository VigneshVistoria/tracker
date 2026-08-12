import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import AppShell from '../../components/AppShell';
import StatusLight from '../../components/StatusLight';
import issueStyles from '../../styles/issues.module.css';
import dashStyles from '../../styles/dashboard.module.css';
import styles from '../../styles/dailyupdate.module.css';
import { apiFetch } from '../../lib/api';
import { getSocket } from '../../lib/socket';
import { useToast } from '../../lib/toast';

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

export default function TeamUpdatesPage() {
  const router = useRouter();
  const { showToast } = useToast();
  const [date, setDate] = useState(todayIso());
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = (d) => {
    setLoading(true);
    apiFetch(`/daily-updates/team-summary?date=${d}`)
      .then(setSummary)
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
    load(date);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;
    const onCreated = (update) => {
      if (update.date === date) {
        showToast(`${update.userEmail} submitted their update`, 'info');
        load(date);
      }
    };
    socket.on('dailyUpdate:created', onCreated);
    return () => socket.off('dailyUpdate:created', onCreated);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date]);

  const handleDateChange = (e) => {
    setDate(e.target.value);
    load(e.target.value);
  };

  return (
    <AppShell>
      <div className={issueStyles.pageHeader}>
        <div>
          <h1 className={issueStyles.pageTitle}>Team Daily Updates</h1>
          <p className={issueStyles.pageSubtitle}>Live as people submit.</p>
        </div>
        <input
          type="date"
          value={date}
          onChange={handleDateChange}
          className={issueStyles.input}
          style={{ width: 'auto' }}
        />
      </div>

      {error && <div className={issueStyles.error}>{error}</div>}

      {summary && (
        <div className={dashStyles.statsGrid}>
          <div className={`${dashStyles.statCard} ${dashStyles.accentNeutral}`}>
            <div className={dashStyles.statValue}>{summary.submittedCount}</div>
            <div className={dashStyles.statLabel}>Submitted</div>
          </div>
          <div className={`${dashStyles.statCard} ${dashStyles.accentOpen}`}>
            <div className={dashStyles.statValue}>{summary.counts.on_track || 0}</div>
            <div className={dashStyles.statLabel}>On Track</div>
          </div>
          <div className={`${dashStyles.statCard} ${dashStyles.accentInProgress}`}>
            <div className={dashStyles.statValue}>{summary.counts.at_risk || 0}</div>
            <div className={dashStyles.statLabel}>At Risk</div>
          </div>
          <div className={`${dashStyles.statCard} ${dashStyles.accentClosed}`} style={{ borderLeftColor: 'var(--color-red)' }}>
            <div className={dashStyles.statValue}>{summary.counts.blocked || 0}</div>
            <div className={dashStyles.statLabel}>Blocked</div>
          </div>
          <div className={`${dashStyles.statCard} ${dashStyles.accentNeutral}`}>
            <div className={dashStyles.statValue}>{summary.avgProductivity}%</div>
            <div className={dashStyles.statLabel}>Avg. Productivity</div>
          </div>
        </div>
      )}

      {loading && <div className={issueStyles.empty}>Loading...</div>}

      {!loading && summary && summary.updates.length === 0 && (
        <div className={issueStyles.card}>
          <div className={issueStyles.empty}>No updates submitted for this day yet.</div>
        </div>
      )}

      {!loading && summary && summary.updates.map((u) => (
        <div key={u.id} className={issueStyles.card}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 'var(--space-3)' }}>
            <div>
              <p className={issueStyles.issueTitle}>{u.userEmail}</p>
              <p className={issueStyles.issueMeta}>Productivity: {u.productivityScore}%</p>
            </div>
            <StatusLight status={u.status} />
          </div>

          <div className={styles.columns}>
            <div className={styles.columnCard}>
              <p className={styles.columnTitle}>Completed ({u.completedTasks.length})</p>
              <ul className={styles.summaryList}>{u.completedTasks.map((t, i) => <li key={i}>{t}</li>)}</ul>
            </div>
            <div className={styles.columnCard}>
              <p className={styles.columnTitle}>Carried Forward ({u.carryForwardTasks.length})</p>
              <ul className={styles.summaryList}>{u.carryForwardTasks.map((t, i) => <li key={i}>{t}</li>)}</ul>
            </div>
            <div className={styles.columnCard}>
              <p className={styles.columnTitle}>Risks ({u.risks.length})</p>
              <ul className={styles.summaryList}>{u.risks.map((t, i) => <li key={i}>{t}</li>)}</ul>
            </div>
          </div>

          <p style={{ fontSize: '0.88rem', color: 'var(--color-ink-soft)', marginTop: 'var(--space-3)', marginBottom: 0 }}>
            {u.managerSummary}
          </p>
        </div>
      ))}
    </AppShell>
  );
}
