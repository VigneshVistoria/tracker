import { useEffect, useState } from 'react';
import { Clock, Users } from 'lucide-react';
import AppShell from '../components/AppShell';
import StatCard from '../components/ui/StatCard';
import styles from '../styles/issues.module.css';
import { apiFetch } from '../lib/api';
import { useToast } from '../lib/toast';

function toDateInputValue(date) {
  return date.toISOString().slice(0, 10);
}

function LogTimeForm({ issues, projects, onLogged }) {
  const { showToast } = useToast();
  const [logAgainst, setLogAgainst] = useState('issue');
  const [form, setForm] = useState({ issueId: '', projectId: '', date: toDateInputValue(new Date()), hours: '', notes: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      await apiFetch('/time-entries', {
        method: 'POST',
        body: JSON.stringify({
          issueId: logAgainst === 'issue' && form.issueId ? Number(form.issueId) : undefined,
          projectId: logAgainst === 'project' && form.projectId ? Number(form.projectId) : undefined,
          date: form.date,
          hours: Number(form.hours),
          notes: form.notes || undefined,
        }),
      });
      setForm({ issueId: '', projectId: '', date: toDateInputValue(new Date()), hours: '', notes: '' });
      showToast('Time logged', 'success');
      onLogged();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={styles.card}>
      <h3 style={{ marginTop: 0, fontSize: '1rem' }}>Log time</h3>
      {error && <div className={styles.error}>{error}</div>}
      <form onSubmit={handleSubmit}>
        <div style={{ display: 'flex', gap: 'var(--space-2)', marginBottom: 'var(--space-3)' }}>
          <button
            type="button"
            className={logAgainst === 'issue' ? styles.button : styles.buttonSecondary}
            onClick={() => setLogAgainst('issue')}
          >
            Against a ticket
          </button>
          <button
            type="button"
            className={logAgainst === 'project' ? styles.button : styles.buttonSecondary}
            onClick={() => setLogAgainst('project')}
          >
            Against a project
          </button>
        </div>

        {logAgainst === 'issue' && (
          <div className={styles.field}>
            <label className={styles.label} htmlFor="issueId">Ticket</label>
            <select
              className={styles.select}
              id="issueId"
              required
              value={form.issueId}
              onChange={(e) => setForm({ ...form, issueId: e.target.value })}
            >
              <option value="">Select a ticket...</option>
              {issues.map((i) => <option key={i.id} value={i.id}>#{i.id} - {i.title}</option>)}
            </select>
          </div>
        )}

        {logAgainst === 'project' && (
          <div className={styles.field}>
            <label className={styles.label} htmlFor="projectId">Project</label>
            <select
              className={styles.select}
              id="projectId"
              required
              value={form.projectId}
              onChange={(e) => setForm({ ...form, projectId: e.target.value })}
            >
              <option value="">Select a project...</option>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
        )}

        <div style={{ display: 'flex', gap: 'var(--space-4)', flexWrap: 'wrap' }}>
          <div className={styles.field} style={{ margin: 0 }}>
            <label className={styles.label} htmlFor="date">Date</label>
            <input
              className={styles.input}
              id="date"
              type="date"
              required
              value={form.date}
              onChange={(e) => setForm({ ...form, date: e.target.value })}
            />
          </div>
          <div className={styles.field} style={{ margin: 0 }}>
            <label className={styles.label} htmlFor="hours">Hours</label>
            <input
              className={styles.input}
              id="hours"
              type="number"
              step="0.25"
              min="0.25"
              max="24"
              required
              value={form.hours}
              onChange={(e) => setForm({ ...form, hours: e.target.value })}
            />
          </div>
        </div>

        <div className={styles.field}>
          <label className={styles.label} htmlFor="notes">Notes</label>
          <textarea
            className={styles.textarea}
            id="notes"
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
          />
        </div>

        <button className={`${styles.button} ${styles.buttonAccent}`} type="submit" disabled={saving}>
          {saving ? 'Logging...' : 'Log Time'}
        </button>
      </form>
    </div>
  );
}

function MyWeek({ entries, onChanged }) {
  const { showToast } = useToast();
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState({ hours: '', notes: '' });

  const totalHours = entries.reduce((sum, e) => sum + Number(e.hours), 0);

  const startEdit = (entry) => {
    setEditingId(entry.id);
    setEditForm({ hours: entry.hours, notes: entry.notes || '' });
  };

  const saveEdit = async (id) => {
    try {
      await apiFetch(`/time-entries/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ hours: Number(editForm.hours), notes: editForm.notes || undefined }),
      });
      setEditingId(null);
      showToast('Time entry updated', 'success');
      onChanged();
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  const remove = async (id) => {
    try {
      await apiFetch(`/time-entries/${id}`, { method: 'DELETE' });
      showToast('Time entry deleted', 'success');
      onChanged();
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  return (
    <div className={styles.card}>
      <h3 style={{ marginTop: 0, fontSize: '1rem' }}>My Week</h3>
      <div style={{ marginBottom: 'var(--space-3)' }}>
        <StatCard label="Total Hours This Week" value={totalHours} icon={Clock} accent="primary" />
      </div>
      {entries.length === 0 && <p className={styles.issueMeta}>No time logged this week yet.</p>}
      {entries.length > 0 && (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Date</th>
                <th>Against</th>
                <th>Hours</th>
                <th>Notes</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.id}>
                  <td>{entry.date}</td>
                  <td>{entry.issueId ? `#${entry.issueId} - ${entry.issueTitle}` : entry.projectName}</td>
                  {editingId === entry.id ? (
                    <>
                      <td>
                        <input
                          className={styles.input}
                          type="number"
                          step="0.25"
                          min="0.25"
                          max="24"
                          value={editForm.hours}
                          onChange={(e) => setEditForm({ ...editForm, hours: e.target.value })}
                        />
                      </td>
                      <td>
                        <input
                          className={styles.input}
                          value={editForm.notes}
                          onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })}
                        />
                      </td>
                      <td>
                        <button className={styles.buttonSecondary} type="button" onClick={() => saveEdit(entry.id)}>Save</button>
                        <button className={styles.buttonSecondary} type="button" onClick={() => setEditingId(null)}>Cancel</button>
                      </td>
                    </>
                  ) : (
                    <>
                      <td>{entry.hours}</td>
                      <td>{entry.notes || '—'}</td>
                      <td>
                        <button className={styles.buttonSecondary} type="button" onClick={() => startEdit(entry)}>Edit</button>
                        <button className={styles.buttonSecondary} type="button" onClick={() => remove(entry.id)}>Delete</button>
                      </td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function TeamReport({ report, users, onRefresh, userId, setUserId }) {
  return (
    <div className={styles.card}>
      <h3 style={{ marginTop: 0, fontSize: '1rem' }}>Team Report {report ? `(${report.startDate} – ${report.endDate})` : ''}</h3>
      <div className={styles.field} style={{ maxWidth: '260px' }}>
        <label className={styles.label} htmlFor="userFilter">User</label>
        <select className={styles.select} id="userFilter" value={userId} onChange={(e) => { setUserId(e.target.value); onRefresh(e.target.value); }}>
          <option value="">All users</option>
          {users.map((u) => <option key={u.id} value={u.id}>{u.fullName || u.email}</option>)}
        </select>
      </div>
      {report && (
        <>
          <div style={{ marginBottom: 'var(--space-3)' }}>
            <StatCard label="Total Hours" value={report.totalHours} icon={Users} accent="primary" />
          </div>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>User</th>
                  <th>Total Hours</th>
                </tr>
              </thead>
              <tbody>
                {report.byUser.length === 0 && (
                  <tr><td colSpan={2} className={styles.issueMeta}>No time logged for this range.</td></tr>
                )}
                {report.byUser.map((row) => (
                  <tr key={row.userId}>
                    <td>{row.userEmail}</td>
                    <td>{row.totalHours}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

export default function TimeSheets() {
  const [currentUser, setCurrentUser] = useState(null);
  const [issues, setIssues] = useState([]);
  const [projects, setProjects] = useState([]);
  const [users, setUsers] = useState([]);
  const [myEntries, setMyEntries] = useState([]);
  const [report, setReport] = useState(null);
  const [reportUserId, setReportUserId] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const storedUser = localStorage.getItem('user');
    if (storedUser) setCurrentUser(JSON.parse(storedUser));
  }, []);

  const canLogTime = currentUser && ['admin', 'developer'].includes(currentUser.role);
  const isWideView = currentUser && ['admin', 'executive', 'program_manager'].includes(currentUser.role);

  const loadMine = () => {
    apiFetch('/time-entries/me')
      .then(setMyEntries)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  };

  const loadReport = (userId) => {
    const params = new URLSearchParams();
    if (userId) params.set('userId', userId);
    apiFetch(`/time-entries/report?${params.toString()}`).then(setReport).catch((err) => setError(err.message));
  };

  useEffect(() => {
    if (!currentUser) return;
    setLoading(true);
    setError('');

    if (canLogTime) {
      apiFetch('/issues').then(setIssues).catch(() => {});
      apiFetch('/projects').then(setProjects).catch(() => {});
      loadMine();
    } else {
      setLoading(false);
    }
    if (isWideView) {
      apiFetch('/users/assignable').then(setUsers).catch(() => {});
      loadReport();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser]);

  return (
    <AppShell>
      <div className={styles.pageHeader}>
        <div>
          <h1 className={styles.pageTitle}>Time Sheets</h1>
          <p className={styles.pageSubtitle}>
            {canLogTime ? 'Log your time and see your weekly summary.' : 'Aggregated time-tracking report across the team.'}
          </p>
        </div>
      </div>

      {error && <div className={styles.error}>{error}</div>}
      {loading && <div className={styles.empty}>Loading...</div>}

      {!loading && (
        <>
          {canLogTime && (
            <>
              <LogTimeForm issues={issues} projects={projects} onLogged={loadMine} />
              <MyWeek entries={myEntries} onChanged={loadMine} />
            </>
          )}
          {isWideView && (
            <TeamReport
              report={report}
              users={users}
              userId={reportUserId}
              setUserId={setReportUserId}
              onRefresh={loadReport}
            />
          )}
        </>
      )}
    </AppShell>
  );
}
