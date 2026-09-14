import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import AppShell from '../../components/AppShell';
import SearchSelectField from '../../components/SearchSelectField';
import styles from '../../styles/issues.module.css';
import { apiFetch } from '../../lib/api';
import { useToast } from '../../lib/toast';

const VIEW_ROLES = ['admin', 'program_manager'];

function userToOption(u) {
  return { id: u.id, name: u.fullName || u.email };
}

// PM Escalation queue - tasks QA escalated instead of Approve/Reject.
// Program Manager can Reassign (to any Developer) or Close as Junk;
// Admin can view but not act, same view/mutate split as Task Backlog.
export default function EscalationsPage() {
  const router = useRouter();
  const { showToast } = useToast();

  const [user, setUser] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [developers, setDevelopers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [reassigningId, setReassigningId] = useState(null);
  const [reassignee, setReassignee] = useState(null);
  const [busyId, setBusyId] = useState(null);

  const load = () => {
    setLoading(true);
    setError('');
    apiFetch('/tasks/escalations')
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
    apiFetch('/users/assignable?role=developer').then((rows) => setDevelopers(rows.map(userToOption))).catch(() => {});
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  if (!user) return null;

  const canManage = user.role === 'program_manager';

  const startReassign = (task) => {
    setReassigningId(task.id);
    setReassignee(null);
  };

  const handleReassign = async (task) => {
    if (!reassignee) return;
    setBusyId(task.id);
    setError('');
    try {
      await apiFetch(`/tasks/${task.id}/escalation-reassign`, {
        method: 'PATCH',
        body: JSON.stringify({ assigneeUserId: reassignee.id }),
      });
      showToast(`Task #${task.id} reassigned to ${reassignee.name}`, 'success');
      setReassigningId(null);
      setReassignee(null);
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  };

  const handleCloseAsJunk = async (task) => {
    if (!confirm(`Close task #${task.id} as Junk? This is a final status and cannot be undone.`)) return;
    setBusyId(task.id);
    setError('');
    try {
      await apiFetch(`/tasks/${task.id}/escalation-junk`, { method: 'PATCH' });
      showToast(`Task #${task.id} closed as Junk`, 'success');
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <AppShell>
      <div className={styles.pageHeader}>
        <div>
          <h1 className={styles.pageTitle}>Escalations</h1>
          <p className={styles.pageSubtitle}>
            Tasks QA escalated instead of Approve/Reject - reassign to a Developer to send it back into the normal
            flow, or close it as Junk if it was never a real issue.
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
                <th className={styles.colCompact}>Project</th>
                <th className={styles.colCompact}>Module</th>
                <th className={styles.colCompact}>Phase</th>
                <th>Description</th>
                <th className={styles.colCompact}>Assignee</th>
                <th>Escalation</th>
                {canManage && <th></th>}
              </tr>
            </thead>
            <tbody>
              {tasks.length === 0 && (
                <tr>
                  <td colSpan={canManage ? 7 : 6} className={styles.empty}>No escalated tasks right now.</td>
                </tr>
              )}
              {tasks.map((task) => (
                <tr key={task.id}>
                  <td className={styles.colCompact} title={task.projectName}>{task.projectName}</td>
                  <td className={styles.colCompact} title={task.moduleName}>{task.moduleName}</td>
                  <td className={styles.colCompact} title={task.phaseName}>{task.phaseName}</td>
                  <td className={styles.tableDescCell} title={task.title}>
                    <Link href={`/tasks/${task.id}`} className={styles.issueId} target="_blank" rel="noopener noreferrer">#{task.id}</Link> {task.title}
                  </td>
                  <td className={styles.colCompact}>{task.assigneeEmail || '—'}</td>
                  <td>
                    {task.escalationComment ? (
                      <>
                        <span className={styles.issueMeta}>By {task.escalatedByEmail}:</span> {task.escalationComment}
                      </>
                    ) : '—'}
                  </td>
                  {canManage && (
                    <td style={{ minWidth: 260 }}>
                      {reassigningId === task.id ? (
                        <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'flex-end', flexWrap: 'wrap' }}>
                          <div style={{ minWidth: 180 }}>
                            <SearchSelectField
                              label="Reassign to"
                              id={`reassignee-${task.id}`}
                              value={reassignee}
                              onChange={setReassignee}
                              options={developers}
                            />
                          </div>
                          <button
                            className={`${styles.button} ${styles.buttonAccent}`}
                            type="button"
                            disabled={!reassignee || busyId === task.id}
                            onClick={() => handleReassign(task)}
                          >
                            {busyId === task.id ? 'Working...' : 'Confirm'}
                          </button>
                          <button className={styles.buttonSecondary} type="button" onClick={() => setReassigningId(null)}>
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                          <button className={styles.buttonSecondary} type="button" onClick={() => startReassign(task)}>
                            Reassign
                          </button>
                          <button
                            className={styles.button}
                            type="button"
                            disabled={busyId === task.id}
                            onClick={() => handleCloseAsJunk(task)}
                          >
                            Close as Junk
                          </button>
                        </div>
                      )}
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
