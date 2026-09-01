import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import AppShell from '../../components/AppShell';
import styles from '../../styles/issues.module.css';
import { apiFetch } from '../../lib/api';
import { useToast } from '../../lib/toast';

export default function TeamsPage() {
  const router = useRouter();
  const { showToast } = useToast();
  const [teams, setTeams] = useState([]);
  const [newTeam, setNewTeam] = useState({ name: '', description: '' });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = () => {
    apiFetch('/teams')
      .then(setTeams)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    const storedUser = localStorage.getItem('user');
    if (!storedUser) {
      router.replace('/');
      return;
    }
    const role = JSON.parse(storedUser).role;
    if (role !== 'admin' && role !== 'program_manager') {
      router.replace('/dashboard');
      return;
    }
    load();
  }, [router]);

  const handleAdd = async (e) => {
    e.preventDefault();
    setError('');
    try {
      await apiFetch('/teams', {
        method: 'POST',
        body: JSON.stringify(newTeam),
      });
      setNewTeam({ name: '', description: '' });
      showToast('Team added', 'success');
      load();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleUpdate = async (id, field, value) => {
    setError('');
    try {
      await apiFetch(`/teams/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ [field]: value }),
      });
      load();
    } catch (err) {
      setError(err.message);
      load();
    }
  };

  const handleToggleActive = async (team) => {
    setError('');
    try {
      await apiFetch(`/teams/${team.id}/${team.isActive ? 'deactivate' : 'activate'}`, {
        method: 'PATCH',
      });
      showToast(team.isActive ? 'Team deactivated' : 'Team activated', 'info');
      load();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleDelete = async (team) => {
    if (!confirm(`Delete "${team.name}"? This cannot be undone.`)) return;
    setError('');
    try {
      await apiFetch(`/teams/${team.id}`, { method: 'DELETE' });
      showToast('Team deleted', 'info');
      load();
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <AppShell>
      <div className={styles.pageHeader}>
        <div>
          <h1 className={styles.pageTitle}>Teams</h1>
          <p className={styles.pageSubtitle}>
            Admin/Program Manager-managed catalog of teams. Deactivate a team to hide it from future use without
            losing its history - every change here is audit-logged.
          </p>
        </div>
      </div>

      {error && <div className={styles.error}>{error}</div>}
      {loading && <div className={styles.empty}>Loading...</div>}

      {!loading && (
        <div className={styles.card}>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Description</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {teams.length === 0 && (
                  <tr>
                    <td colSpan={4} className={styles.empty}>No teams yet.</td>
                  </tr>
                )}
                {teams.map((team) => (
                  <tr key={team.id}>
                    <td>
                      <input
                        className={styles.input}
                        defaultValue={team.name}
                        onBlur={(e) => e.target.value !== team.name && handleUpdate(team.id, 'name', e.target.value)}
                      />
                    </td>
                    <td>
                      <input
                        className={styles.input}
                        defaultValue={team.description || ''}
                        placeholder="Optional"
                        onBlur={(e) => e.target.value !== (team.description || '') && handleUpdate(team.id, 'description', e.target.value)}
                      />
                    </td>
                    <td>
                      <span className={`${styles.badge} ${team.isActive ? styles.badgeQa : styles.badgeOpen}`}>
                        {team.isActive ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td style={{ display: 'flex', gap: 'var(--space-2)' }}>
                      <button className={styles.buttonSecondary} type="button" onClick={() => handleToggleActive(team)}>
                        {team.isActive ? 'Deactivate' : 'Activate'}
                      </button>
                      <button className={styles.buttonSecondary} type="button" onClick={() => handleDelete(team)}>
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <form onSubmit={handleAdd} style={{ marginTop: 'var(--space-4)', display: 'flex', gap: 'var(--space-3)', alignItems: 'flex-end' }}>
            <div className={styles.field} style={{ margin: 0, flex: 1 }}>
              <label className={styles.label}>Name</label>
              <input
                className={styles.input}
                required
                value={newTeam.name}
                onChange={(e) => setNewTeam({ ...newTeam, name: e.target.value })}
              />
            </div>
            <div className={styles.field} style={{ margin: 0, flex: 1 }}>
              <label className={styles.label}>Description</label>
              <input
                className={styles.input}
                placeholder="Optional"
                value={newTeam.description}
                onChange={(e) => setNewTeam({ ...newTeam, description: e.target.value })}
              />
            </div>
            <button className={styles.buttonSecondary} type="submit">Add Team</button>
          </form>
        </div>
      )}
    </AppShell>
  );
}
