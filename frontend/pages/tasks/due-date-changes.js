import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import { Hash, FileText, FolderKanban, User, CalendarClock, CalendarRange, MessageSquareText } from 'lucide-react';
import AppShell from '../../components/AppShell';
import Table from '../../components/ui/Table';
import ColHeader from '../../components/ColHeader';
import LoadingState from '../../components/ui/LoadingState';
import styles from '../../styles/issues.module.css';
import { apiFetch } from '../../lib/api';
import { formatDate } from '../../lib/formatDate';
import { redirectToSignIn } from '../../lib/session';

// Backend mirror: DUE_DATE_DECIDE_ROLES in backend/src/tasks/due-date-change.ts.
const VIEW_ROLES = ['admin', 'program_manager'];

// Performance Tracking S2 (2026-10-28) - Due date change requests waiting
// for a Program Manager or Admin, longest waiting first. Each row opens the
// task, where the "Due date commitment" card has Approve and Reject.
export default function DueDateChangesPage() {
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
    apiFetch('/tasks/due-date-changes')
      .then((res) => setItems(res.items))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [router]);

  const columns = useMemo(
    () => [
      {
        key: 'taskId',
        header: <ColHeader icon={Hash} label="Task" />,
        width: 70,
        sortable: true,
        render: (r) => (
          <Link href={`/tasks/${r.taskId}#due-date`} className={styles.issueId} onClick={(e) => e.stopPropagation()}>
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
        header: <ColHeader icon={FolderKanban} label="Project" />,
        sortable: true,
        render: (r) => <span className={styles.issueMeta}>{r.projectName}</span>,
      },
      {
        key: 'requestedByName',
        header: <ColHeader icon={User} label="Asked by" />,
        sortable: true,
        render: (r) =>
          r.own ? (
            <span>
              You <span className={styles.issueMeta}>(another PM or Admin decides)</span>
            </span>
          ) : (
            r.requestedByName || '—'
          ),
      },
      {
        key: 'requestedDueDate',
        header: <ColHeader icon={CalendarRange} label="Due date" />,
        sortable: true,
        render: (r) => (
          <span>
            {formatDate(r.currentDueDate)} &rarr; <strong>{formatDate(r.requestedDueDate)}</strong>{' '}
            <span className={styles.issueMeta}>({r.direction})</span>
          </span>
        ),
      },
      {
        key: 'reason',
        header: <ColHeader icon={MessageSquareText} label="Reason" />,
        sortable: true,
        render: (r) => <span className={styles.descClamp} title={r.reason}>{r.reason}</span>,
      },
      {
        key: 'createdAt',
        header: <ColHeader icon={CalendarClock} label="Asked" />,
        sortable: true,
        render: (r) => formatDate(r.createdAt),
      },
    ],
    [],
  );

  if (!user) return null;

  return (
    <AppShell>
      <div className={styles.pageHeader}>
        <div>
          <h1 className={styles.pageTitle}>Date Change Requests</h1>
          <p className={styles.pageSubtitle}>
            Developers asking to move a Due date they committed to (projects with Performance Tracking on). Open one to approve or reject
            it - a rejection needs a note. The Due date does not change until a request is approved.
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
            getRowId={(r) => r.id}
            onRowClick={(r) => router.push(`/tasks/${r.taskId}#due-date`)}
            emptyState="No date change requests are waiting for a decision."
          />
        </div>
      )}
    </AppShell>
  );
}
