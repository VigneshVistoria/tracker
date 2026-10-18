import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import { Hash, FileText, FolderKanban, User, CalendarClock, Hourglass, Repeat } from 'lucide-react';
import AppShell from '../../components/AppShell';
import Table from '../../components/ui/Table';
import ColHeader from '../../components/ColHeader';
import LoadingState from '../../components/ui/LoadingState';
import styles from '../../styles/issues.module.css';
import { apiFetch } from '../../lib/api';
import { formatDate } from '../../lib/formatDate';
import { redirectToSignIn } from '../../lib/session';

// Backend mirror: PmReviewsController's PM_REVIEW_ROLES.
const VIEW_ROLES = ['admin', 'program_manager'];

// PM review gate (2026-10-13) - tasks a developer submitted in a project
// with the gate on, waiting for a Program Manager before QA sees them.
// Longest waiting first. Each row opens the task page, where the PM reads
// the description, resolution and evidence and chooses Send to QA or Send
// back to developer (the "PM review" card at the top).
export default function PmReviewPage() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [data, setData] = useState({ items: [], statCounts: { pending: 0 } });
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
    apiFetch('/pm-review/queue')
      .then(setData)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [router]);

  const columns = useMemo(
    () => [
      {
        key: 'taskId',
        header: <ColHeader icon={Hash} label="Ticket" />,
        width: 70,
        sortable: true,
        render: (r) => (
          <Link href={`/tasks/${r.taskId}#pm-review`} className={styles.issueId} onClick={(e) => e.stopPropagation()}>
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
        key: 'assigneeName',
        header: <ColHeader icon={User} label="Developer" />,
        sortable: true,
        render: (r) => r.assigneeName || r.submittedByName || '—',
      },
      {
        key: 'submittedAt',
        header: <ColHeader icon={CalendarClock} label="Submitted" />,
        sortable: true,
        render: (r) => formatDate(r.submittedAt),
      },
      {
        key: 'waitingWorkingDays',
        header: <ColHeader icon={Hourglass} label="Waiting" />,
        width: 110,
        sortable: true,
        render: (r) => `${r.waitingWorkingDays} working ${r.waitingWorkingDays === 1 ? 'day' : 'days'}`,
      },
      {
        key: 'pmRound',
        header: <ColHeader icon={Repeat} label="PM round" />,
        width: 130,
        sortable: true,
        render: (r) => (r.pmSendBacks > 0 ? `${r.pmRound} (${r.pmSendBacks} sent back)` : String(r.pmRound)),
      },
    ],
    [],
  );

  if (!user) return null;

  return (
    <AppShell>
      <div className={styles.pageHeader}>
        <div>
          <h1 className={styles.pageTitle}>PM Review</h1>
          <p className={styles.pageSubtitle}>
            Tasks waiting for a Program Manager before QA. Open one to read the description, resolution and evidence, then send it to
            QA or back to the developer with feedback. Waiting time here never counts against the developer.
          </p>
        </div>
      </div>

      {error && <div className={styles.error}>{error}</div>}
      {loading && <LoadingState />}

      {!loading && !error && (
        <div className={styles.card}>
          <Table
            columns={columns}
            rows={data.items}
            getRowId={(r) => r.taskId}
            onRowClick={(r) => router.push(`/tasks/${r.taskId}#pm-review`)}
            emptyState="Nothing is waiting for PM review."
          />
        </div>
      )}
    </AppShell>
  );
}
