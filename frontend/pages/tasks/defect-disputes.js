import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import { Hash, FileText, FolderKanban, User, CalendarClock, Hourglass, MessageSquareWarning, Gauge } from 'lucide-react';
import AppShell from '../../components/AppShell';
import Table from '../../components/ui/Table';
import ColHeader from '../../components/ColHeader';
import LoadingState from '../../components/ui/LoadingState';
import styles from '../../styles/issues.module.css';
import { apiFetch } from '../../lib/api';
import { formatDate } from '../../lib/formatDate';
import { redirectToSignIn } from '../../lib/session';

// Backend mirror: DefectTriageController's DEFECT_DISPUTE_DECIDE_ROLES.
const VIEW_ROLES = ['admin', 'program_manager'];

// Defect triage (2026-10-27) - defects a developer disputed, waiting for a
// Program Manager. Longest waiting first. Each row opens the defect, where
// the "Defect triage" card shows the reason and the Decide button.
export default function DefectDisputesPage() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const stored = localStorage.getItem('user');
    if (!stored) {
      redirectToSignIn(router);
      return;
    }
    const parsed = JSON.parse(stored);
    if (!VIEW_ROLES.includes(parsed.role)) {
      router.replace('/dashboard');
      return;
    }
    setUser(parsed);
    apiFetch('/defect-triage/queue')
      .then((res) => setItems(res.items))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [router]);

  const columns = useMemo(
    () => [
      {
        key: 'taskId',
        header: <ColHeader icon={Hash} label="Defect" />,
        width: 70,
        sortable: true,
        render: (r) => (
          <Link href={`/tasks/${r.taskId}#defect-triage`} className={styles.issueId} onClick={(e) => e.stopPropagation()}>
            #{r.taskId}
          </Link>
        ),
      },
      {
        key: 'title',
        header: <ColHeader icon={FileText} label="Title" />,
        sortable: true,
        render: (r) => <span className={styles.descClamp} title={r.title}>{r.title}</span>,
      },
      {
        key: 'projectName',
        header: <ColHeader icon={FolderKanban} label="Project · Module" />,
        sortable: true,
        render: (r) => <span className={styles.issueMeta}>{r.projectName} &middot; {r.moduleName}</span>,
      },
      {
        key: 'severity',
        header: <ColHeader icon={Gauge} label="Severity" />,
        width: 110,
        sortable: true,
        render: (r) => r.severity || '—',
      },
      {
        key: 'developerName',
        header: <ColHeader icon={User} label="Developer" />,
        sortable: true,
        render: (r) => r.developerName || '—',
      },
      {
        key: 'reason',
        header: <ColHeader icon={MessageSquareWarning} label="Reason" />,
        sortable: true,
        render: (r) => (
          <span title={r.comment || ''}>
            {r.reason}
            {r.duplicateOfTaskId ? ` of #${r.duplicateOfTaskId}` : ''}
          </span>
        ),
      },
      {
        key: 'disputedAt',
        header: <ColHeader icon={CalendarClock} label="Disputed" />,
        sortable: true,
        render: (r) => formatDate(r.disputedAt),
      },
      {
        key: 'waitingWorkingDays',
        header: <ColHeader icon={Hourglass} label="Waiting" />,
        width: 110,
        sortable: true,
        render: (r) => `${r.waitingWorkingDays} working ${r.waitingWorkingDays === 1 ? 'day' : 'days'}`,
      },
    ],
    [],
  );

  if (!user) return null;

  return (
    <AppShell>
      <div className={styles.pageHeader}>
        <div>
          <h1 className={styles.pageTitle}>Defect Disputes</h1>
          <p className={styles.pageSubtitle}>
            Defects a developer disputed (duplicate, cannot reproduce, as designed, change request...). Open one to read the reason, then
            reject the dispute or agree - close it, reassign it, or convert it to a Backlog task. A dispute is never a QA rejection, and
            the waiting time here never counts against the developer.
          </p>
        </div>
      </div>

      {error && <div className={styles.error}>{error}</div>}
      {loading && <LoadingState />}

      {!loading && !error && (
        <div className={styles.card}>
          <Table
            columns={columns}
            rows={items}
            getRowId={(r) => r.taskId}
            onRowClick={(r) => router.push(`/tasks/${r.taskId}#defect-triage`)}
            emptyState="No disputed defects are waiting for a decision."
          />
        </div>
      )}
    </AppShell>
  );
}
