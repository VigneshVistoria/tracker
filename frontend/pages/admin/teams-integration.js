import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import AppShell from '../../components/AppShell';
import styles from '../../styles/issues.module.css';
import { apiFetch } from '../../lib/api';
import { useToast } from '../../lib/toast';

export default function TeamsIntegrationPage() {
  const router = useRouter();
  const { showToast } = useToast();
  const [subscriptions, setSubscriptions] = useState([]);
  const [projects, setProjects] = useState([]);
  const [form, setForm] = useState({ teamId: '', channelId: '', channelName: '', projectId: '' });
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState('');

  const load = () => {
    apiFetch('/integrations/teams')
      .then(setSubscriptions)
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
    apiFetch('/projects').then(setProjects).catch(() => {});
    load();
  }, [router]);

  const handleChange = (e) => setForm({ ...form, [e.target.name]: e.target.value });

  const handleConnect = async (e) => {
    e.preventDefault();
    setError('');
    setConnecting(true);
    try {
      await apiFetch('/integrations/teams/connect', {
        method: 'POST',
        body: JSON.stringify({
          ...form,
          projectId: form.projectId ? Number(form.projectId) : undefined,
        }),
      });
      showToast('Teams channel connected', 'success');
      setForm({ teamId: '', channelId: '', channelName: '', projectId: '' });
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setConnecting(false);
    }
  };

  const handleDisconnect = async (id) => {
    try {
      await apiFetch(`/integrations/teams/${id}`, { method: 'DELETE' });
      showToast('Channel disconnected', 'info');
      load();
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <AppShell>
      <div className={styles.pageHeader}>
        <div>
          <h1 className={styles.pageTitle}>Microsoft Teams Integration</h1>
          <p className={styles.pageSubtitle}>
            Connect a Teams channel: tagging a teammate in a message creates a ticket assigned to them (Mode: Auto). Untagged messages are ignored.
          </p>
        </div>
      </div>

      {error && <div className={styles.error}>{error}</div>}

      <div className={styles.card}>
        <h3 style={{ marginTop: 0, fontSize: '1rem' }}>Connect a channel</h3>
        <p className={styles.helpText} style={{ marginBottom: 'var(--space-4)' }}>
          Requires MS_TENANT_ID, MS_CLIENT_ID, MS_CLIENT_SECRET, and MS_TEAMS_WEBHOOK_URL to already
          be set in the backend's environment - see TEAMS_INTEGRATION.md. Find the Team ID and
          Channel ID via the channel's "Get link to channel" option in Teams.
        </p>

        <form onSubmit={handleConnect}>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="teamId">Team ID</label>
            <input className={styles.input} id="teamId" name="teamId" required value={form.teamId} onChange={handleChange} />
          </div>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="channelId">Channel ID</label>
            <input className={styles.input} id="channelId" name="channelId" required value={form.channelId} onChange={handleChange} />
          </div>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="channelName">Channel name (for display only)</label>
            <input className={styles.input} id="channelName" name="channelName" value={form.channelName} onChange={handleChange} placeholder="e.g. Engineering Alerts" />
          </div>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="projectId">New tickets land in this project</label>
            <select className={styles.select} id="projectId" name="projectId" value={form.projectId} onChange={handleChange}>
              <option value="">No project</option>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <button className={`${styles.button} ${styles.buttonAccent}`} type="submit" disabled={connecting}>
            {connecting ? 'Connecting...' : 'Connect Channel'}
          </button>
        </form>
      </div>

      <div className={styles.card}>
        <h3 style={{ marginTop: 0, fontSize: '1rem' }}>Connected channels</h3>
        {loading && <div className={styles.empty}>Loading...</div>}
        {!loading && subscriptions.length === 0 && <div className={styles.empty}>No channels connected yet.</div>}
        {subscriptions.map((s) => (
          <div key={s.id} className={styles.issueRow} style={{ cursor: 'default' }}>
            <div className={styles.issueMain}>
              <p className={styles.issueTitle}>{s.channelName || s.channelId}</p>
              <p className={styles.issueMeta}>
                Expires {new Date(s.expirationDateTime).toLocaleString()} · {s.active ? 'Active' : 'Inactive'}
              </p>
            </div>
            <button className={styles.buttonSecondary} onClick={() => handleDisconnect(s.id)} type="button">
              Disconnect
            </button>
          </div>
        ))}
      </div>
    </AppShell>
  );
}
