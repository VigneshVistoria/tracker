import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import AppShell from '../../components/AppShell';
import styles from '../../styles/issues.module.css';
import { apiFetch } from '../../lib/api';

const VIEW_ROLES = ['admin', 'executive', 'program_manager', 'qa', 'developer'];

const STATUS_COLOR = {
  Development: { bg: 'var(--color-slate-tint)', fg: 'var(--color-ink-soft)' },
  Feedback: { bg: 'var(--color-plum-tint)', fg: 'var(--color-plum-dark)' },
  'Re-Feedback': { bg: 'var(--color-plum-tint)', fg: 'var(--color-plum-dark)' },
  Pass: { bg: 'var(--color-moss-tint)', fg: 'var(--color-moss-dark)' },
  Failed: { bg: 'var(--color-red-tint)', fg: 'var(--color-red-dark)' },
  'Released - No Showstoppers': { bg: 'var(--color-teal-tint)', fg: 'var(--color-teal-dark)' },
  'Released - With Showstoppers': { bg: 'var(--color-red-tint)', fg: 'var(--color-red-dark)' },
};

function StatusBadge({ status }) {
  if (!status) return <span className={styles.issueMeta}>Not started</span>;
  const color = STATUS_COLOR[status] || { bg: 'var(--color-slate-tint)', fg: 'var(--color-ink-soft)' };
  return (
    <span className={styles.badge} style={{ background: color.bg, color: color.fg }}>
      {status}
    </span>
  );
}

function ProgressBar({ percent }) {
  if (percent === null || percent === undefined) {
    return <span className={styles.issueMeta}>—</span>;
  }
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
      <div style={{ width: 80, height: 8, borderRadius: 4, background: 'var(--color-slate-tint)', overflow: 'hidden' }}>
        <div style={{ width: `${percent}%`, height: '100%', background: 'var(--color-teal)' }} />
      </div>
      <span style={{ fontSize: '0.85rem', color: 'var(--color-ink-soft)' }}>{percent}%</span>
    </div>
  );
}

export default function MyTasksPage() {
  const router = useRouter();

  const [user, setUser] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

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
    setLoading(true);
    apiFetch('/tasks/mine')
      .then(setTasks)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [router]);

  if (!user) return null;

  return (
    <AppShell>
      <div className={styles.pageHeader}>
        <div>
          <h1 className={styles.pageTitle}>My Tasks</h1>
          <p className={styles.pageSubtitle}>
            Tasks assigned to you. Open a task to set Estimated Hours and Due Date, and file a Dependency
            Ticket if you&apos;re blocked.
          </p>
        </div>
      </div>

      {error && <div className={styles.error}>{error}</div>}

      {loading && <div className={styles.empty}>Loading...</div>}

      {!loading && (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Project</th>
                <th>Module</th>
                <th>Phase</th>
                <th>Description</th>
                <th>E.Hrs</th>
                <th>Due Date</th>
                <th>Status</th>
                <th>% Complete</th>
                <th>Ageing</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {tasks.length === 0 && (
                <tr>
                  <td colSpan={10} className={styles.empty}>No tasks assigned to you yet.</td>
                </tr>
              )}
              {tasks.map((task) => (
                <tr key={task.id}>
                  <td>{task.projectName}</td>
                  <td>{task.moduleName}</td>
                  <td>{task.phaseName}</td>
                  <td style={{ maxWidth: 280 }}>{task.description}</td>
                  <td>{task.estimatedHours ?? '—'}</td>
                  <td>{task.dueDate || '—'}</td>
                  <td><StatusBadge status={task.status} /></td>
                  <td><ProgressBar percent={task.percentComplete} /></td>
                  <td>{task.ageingDays}d</td>
                  <td>
                    <Link href={`/tasks/${task.id}`} className={styles.buttonSecondary}>
                      Open
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </AppShell>
  );
}
