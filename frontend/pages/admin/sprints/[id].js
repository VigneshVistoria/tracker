import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import AppShell from '../../../components/AppShell';
import styles from '../../../styles/issues.module.css';
import { apiFetch } from '../../../lib/api';
import { useToast } from '../../../lib/toast';
import { getSocket } from '../../../lib/socket';

const STATUS_OPTIONS = ['Planned', 'Active', 'Completed'];

function IssueCard({ issue, draggable, onDragStart, right }) {
  return (
    <div
      className={styles.issueRow}
      style={{ cursor: draggable ? 'grab' : 'default' }}
      draggable={draggable}
      onDragStart={draggable ? (e) => onDragStart(e, issue.id) : undefined}
    >
      <div className={styles.issueMain}>
        <p className={styles.issueTitle}>
          <span className={styles.issueId}>#{issue.id}</span> {issue.title}
        </p>
        <p className={styles.issueMeta}>
          {issue.assigneeEmail || 'Unassigned'} {issue.storyPoints != null ? `\u00b7 ${issue.storyPoints} pts` : ''}
        </p>
      </div>
      {right}
    </div>
  );
}

export default function SprintDetailPage() {
  const router = useRouter();
  const { id } = router.query;
  const { showToast } = useToast();

  const [sprint, setSprint] = useState(null);
  const [backlog, setBacklog] = useState([]);
  const [selected, setSelected] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [isAdmin, setIsAdmin] = useState(false);
  const [editForm, setEditForm] = useState({ name: '', goal: '', startDate: '', endDate: '', status: 'Planned' });
  const [saving, setSaving] = useState(false);
  const [addingSelected, setAddingSelected] = useState(false);
  const [dragOverTarget, setDragOverTarget] = useState(null);

  const load = () => {
    if (!id) return;
    apiFetch(`/sprints/${id}`)
      .then((data) => {
        setSprint(data);
        setEditForm({
          name: data.name,
          goal: data.goal || '',
          startDate: data.startDate || '',
          endDate: data.endDate || '',
          status: data.status,
        });
        return apiFetch(`/issues`).then((allIssues) => {
          const inThisProject = allIssues.filter((i) => i.projectId === data.projectId);
          setBacklog(inThisProject.filter((i) => i.sprintId == null));
        });
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    const storedUser = localStorage.getItem('user');
    if (!storedUser) {
      router.replace('/');
      return;
    }
    setIsAdmin(JSON.parse(storedUser).role === 'admin');
  }, [router]);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;
    const onIssueUpdated = () => load();
    const onSprintUpdated = (updated) => {
      if (String(updated.id) === String(id)) load();
    };
    socket.on('issue:updated', onIssueUpdated);
    socket.on('issue:created', onIssueUpdated);
    socket.on('sprint:updated', onSprintUpdated);
    return () => {
      socket.off('issue:updated', onIssueUpdated);
      socket.off('issue:created', onIssueUpdated);
      socket.off('sprint:updated', onSprintUpdated);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const selectedIds = useMemo(() => Object.keys(selected).filter((k) => selected[k]).map(Number), [selected]);

  const toggleSelected = (issueId) => setSelected({ ...selected, [issueId]: !selected[issueId] });

  const handleSaveSprint = async (e) => {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      const updated = await apiFetch(`/sprints/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(editForm),
      });
      setSprint({ ...sprint, ...updated });
      showToast('Sprint saved', 'success');
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleAddSelected = async () => {
    if (selectedIds.length === 0) return;
    setError('');
    setAddingSelected(true);
    try {
      await apiFetch(`/sprints/${id}/issues`, {
        method: 'POST',
        body: JSON.stringify({ issueIds: selectedIds }),
      });
      showToast(`Added ${selectedIds.length} issue(s) to the sprint`, 'success');
      setSelected({});
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setAddingSelected(false);
    }
  };

  const handleRemoveIssue = async (issueId) => {
    setError('');
    try {
      await apiFetch(`/sprints/${id}/issues/${issueId}`, { method: 'DELETE' });
      showToast(`Issue #${issueId} moved back to the backlog`, 'info');
      load();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleDragStart = (e, issueId) => {
    e.dataTransfer.setData('text/issue-id', String(issueId));
  };

  const handleDropOnSprint = async (e) => {
    e.preventDefault();
    setDragOverTarget(null);
    const issueId = Number(e.dataTransfer.getData('text/issue-id'));
    if (!issueId) return;
    try {
      await apiFetch(`/sprints/${id}/issues`, {
        method: 'POST',
        body: JSON.stringify({ issueIds: [issueId] }),
      });
      load();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleDropOnBacklog = async (e) => {
    e.preventDefault();
    setDragOverTarget(null);
    const issueId = Number(e.dataTransfer.getData('text/issue-id'));
    if (!issueId) return;
    handleRemoveIssue(issueId);
  };

  if (loading) {
    return <AppShell><div className={styles.empty}>Loading...</div></AppShell>;
  }

  if (!sprint) {
    return (
      <AppShell>
        <div className={styles.error}>{error || 'Sprint not found.'}</div>
        <Link href="/admin/sprints" className={styles.backLink}>&larr; Back to sprints</Link>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className={styles.pageHeader}>
        <div>
          <h1 className={styles.pageTitle}>{sprint.name}</h1>
          <p className={styles.pageSubtitle}>
            {sprint.projectName} &middot; {sprint.totalStoryPoints} total story point{sprint.totalStoryPoints === 1 ? '' : 's'}
          </p>
        </div>
        <Link href="/admin/sprints" className={styles.buttonSecondary}>Back to sprints</Link>
      </div>

      {error && <div className={styles.error}>{error}</div>}

      {isAdmin && (
        <div className={styles.card}>
          <h3 style={{ marginTop: 0, fontSize: '1rem' }}>Sprint details</h3>
          <form onSubmit={handleSaveSprint}>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="name">Name</label>
              <input
                className={styles.input}
                id="name"
                value={editForm.name}
                onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
              />
            </div>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="goal">Goal</label>
              <input
                className={styles.input}
                id="goal"
                value={editForm.goal}
                onChange={(e) => setEditForm({ ...editForm, goal: e.target.value })}
              />
            </div>
            <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
              <div className={styles.field} style={{ flex: 1 }}>
                <label className={styles.label} htmlFor="startDate">Start date</label>
                <input
                  className={styles.input}
                  id="startDate"
                  type="date"
                  value={editForm.startDate || ''}
                  onChange={(e) => setEditForm({ ...editForm, startDate: e.target.value })}
                />
              </div>
              <div className={styles.field} style={{ flex: 1 }}>
                <label className={styles.label} htmlFor="endDate">End date</label>
                <input
                  className={styles.input}
                  id="endDate"
                  type="date"
                  value={editForm.endDate || ''}
                  onChange={(e) => setEditForm({ ...editForm, endDate: e.target.value })}
                />
              </div>
              <div className={styles.field} style={{ flex: 1 }}>
                <label className={styles.label} htmlFor="status">Status</label>
                <select
                  className={styles.select}
                  id="status"
                  value={editForm.status}
                  onChange={(e) => setEditForm({ ...editForm, status: e.target.value })}
                >
                  {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
            </div>
            <button className={`${styles.button} ${styles.buttonAccent}`} type="submit" disabled={saving}>
              {saving ? 'Saving...' : 'Save sprint'}
            </button>
          </form>
        </div>
      )}

      <div style={{ display: 'flex', gap: 'var(--space-4)', alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div
          className={styles.card}
          style={{ flex: 1, minWidth: 320, background: dragOverTarget === 'backlog' ? 'var(--color-paper)' : undefined }}
          onDragOver={(e) => { e.preventDefault(); setDragOverTarget('backlog'); }}
          onDragLeave={() => setDragOverTarget(null)}
          onDrop={handleDropOnBacklog}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 style={{ marginTop: 0, fontSize: '1rem' }}>Backlog ({backlog.length})</h3>
            {isAdmin && (
              <button
                className={`${styles.button} ${styles.buttonAccent}`}
                type="button"
                disabled={selectedIds.length === 0 || addingSelected}
                onClick={handleAddSelected}
              >
                {addingSelected ? 'Adding...' : `Add ${selectedIds.length || ''} to Sprint`}
              </button>
            )}
          </div>
          <p className={styles.helpText}>Drag an issue into the sprint, or check issues and click "Add to Sprint".</p>
          {backlog.length === 0 && <div className={styles.empty}>Nothing in the backlog for this project.</div>}
          {backlog.map((issue) => (
            <IssueCard
              key={issue.id}
              issue={issue}
              draggable={isAdmin}
              onDragStart={handleDragStart}
              right={
                isAdmin ? (
                  <label className={styles.checkboxRow} style={{ marginLeft: 'var(--space-3)' }}>
                    <input
                      type="checkbox"
                      checked={Boolean(selected[issue.id])}
                      onChange={() => toggleSelected(issue.id)}
                    />
                  </label>
                ) : null
              }
            />
          ))}
        </div>

        <div
          className={styles.card}
          style={{ flex: 1, minWidth: 320, background: dragOverTarget === 'sprint' ? 'var(--color-paper)' : undefined }}
          onDragOver={(e) => { e.preventDefault(); setDragOverTarget('sprint'); }}
          onDragLeave={() => setDragOverTarget(null)}
          onDrop={handleDropOnSprint}
        >
          <h3 style={{ marginTop: 0, fontSize: '1rem' }}>In this sprint ({sprint.issues.length})</h3>
          <p className={styles.helpText}>Drag an issue back to the backlog, or click Remove.</p>
          {sprint.issues.length === 0 && <div className={styles.empty}>Nothing planned into this sprint yet.</div>}
          {sprint.issues.map((issue) => (
            <IssueCard
              key={issue.id}
              issue={issue}
              draggable={isAdmin}
              onDragStart={handleDragStart}
              right={
                isAdmin ? (
                  <button className={styles.buttonSecondary} type="button" onClick={() => handleRemoveIssue(issue.id)}>
                    Remove
                  </button>
                ) : null
              }
            />
          ))}
        </div>
      </div>
    </AppShell>
  );
}
