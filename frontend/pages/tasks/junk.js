import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import AppShell from '../../components/AppShell';
import styles from '../../styles/issues.module.css';
import { apiFetch } from '../../lib/api';
import { useToast } from '../../lib/toast';
import { useConfirm } from '../../lib/confirm';
import { formatDateTime } from '../../lib/formatDate';
import { statusLabel } from '../../lib/taskTableShared';
import LoadingState from '../../components/ui/LoadingState';

// Backend mirror: TasksController.ROLES_ALLOWED_TO_VIEW_JUNK /
// ROLES_ALLOWED_TO_MANAGE_JUNK - Admin views, Program Manager restores.
const VIEW_ROLES = ['admin', 'program_manager'];

// Every ticket marked as Junk (created by mistake / not a real issue),
// with who marked it, when, why and the status it goes back to. These are
// hidden from Developers and QA and left out of every count; Restore puts
// one back exactly where it was.
export default function JunkPage() {
  const router = useRouter();
  const { showToast } = useToast();
  const confirmAction = useConfirm();

  const [user, setUser] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState(null);

  const load = () => {
    setLoading(true);
    setError('');
    apiFetch('/tasks/junk')
      .then(setTasks)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    const storedUser = localStorage.getItem('user');
    if (!storedUser) {
      router.replace('/');
      return;
    }
    const parsed = JSON.parse(storedUser);
    if (!VIEW_ROLES.includes(parsed.role)) {
      router.replace('/dashboard');
      return;
    }
    setUser(parsed);
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  if (!user) return null;

  const canRestore = user.role === 'program_manager';

  const handleRestore = async (task) => {
    const target = statusLabel(task.statusBeforeJunk || 'Escalated');
    if (!await confirmAction({
      title: 'Restore from Junk?',
      message: `Task #${task.id} goes back to ${target} and counts again from now on. Its history is kept.`,
      confirmLabel: 'Restore',
    })) return;
    setBusyId(task.id);
    setError('');
    try {
      const updated = await apiFetch(`/tasks/${task.id}/restore-junk`, { method: 'PATCH' });
      showToast(`Task #${task.id} restored as ${statusLabel(updated.status)}`, 'success');
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  };

  const columnCount = canRestore ? 8 : 7;

  return (
    <AppShell>
      <div className={styles.pageHeader}>
        <div>
          <h1 className={styles.pageTitle}>Junk</h1>
          <p className={styles.pageSubtitle}>
            Tickets marked as created by mistake or not a real issue. They are hidden from Developers and QA and left out of every
            count, report and KPI. Nothing is deleted{canRestore ? ' - Restore puts a ticket back in the status it had.' : '.'}
          </p>
        </div>
      </div>

      {error && <div className={styles.error} role="alert">{error}</div>}

      {loading && <LoadingState />}

      {!loading && (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <caption className="sr-only">Tickets in Junk, most recently marked first</caption>
            <thead>
              <tr>
                <th>Ticket</th>
                <th className={styles.colCompact}>Project</th>
                <th className={styles.colCompact}>Assignee</th>
                <th className={styles.colCompact}>Previous status</th>
                <th>Reason</th>
                <th className={styles.colCompact}>Marked by</th>
                <th>When</th>
                {canRestore && <th><span className="sr-only">Actions</span></th>}
              </tr>
            </thead>
            <tbody>
              {tasks.length === 0 && (
                <tr>
                  <td colSpan={columnCount} className={styles.empty}>No tickets in Junk.</td>
                </tr>
              )}
              {tasks.map((task) => (
                <tr key={task.id}>
                  {/* Not .tableDescCell: its -webkit-box display breaks the row layout here. */}
                  <td style={{ whiteSpace: 'normal', overflowWrap: 'anywhere', minWidth: '160px' }}>
                    <Link href={`/tasks/${task.id}`} className={styles.issueId} target="_blank" rel="noopener noreferrer">#{task.id}</Link>{' '}
                    {task.isDefect && <span className={styles.issueMeta}>Defect · </span>}
                    {task.title}
                  </td>
                  <td className={styles.colCompact} title={task.projectName}>{task.projectName}</td>
                  <td className={styles.colCompact}>{task.assigneeEmail || '—'}</td>
                  <td className={styles.colCompact}>{statusLabel(task.statusBeforeJunk || 'Escalated')}</td>
                  <td style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', minWidth: '180px' }}>{task.junkReason || '—'}</td>
                  <td className={styles.colCompact}>{task.junkedByEmail || '—'}</td>
                  <td style={{ whiteSpace: 'normal', minWidth: '110px' }}>{task.junkedAt ? formatDateTime(task.junkedAt) : '—'}</td>
                  {canRestore && (
                    <td>
                      <button
                        className={styles.buttonSecondary}
                        type="button"
                        disabled={busyId === task.id}
                        onClick={() => handleRestore(task)}
                        aria-label={`Restore task #${task.id}`}
                      >
                        {busyId === task.id ? 'Restoring...' : 'Restore'}
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </AppShell>
  );
}
