import { useEffect, useState } from 'react';
import AppShell from './AppShell';
import DeveloperTaskWorkboard from './DeveloperTaskWorkboard';
import issueStyles from '../styles/issues.module.css';
import { apiFetch } from '../lib/api';

const ACTIVE_CARD_STORAGE_KEY = 'dashboardActiveCard';

// Developer-only Dashboard: shows the same 5 stat cards (My Tasks/
// Rejected/Inbound/Outbound/Overdue) and collapsible task table as My
// Tasks (components/DeveloperTaskWorkboard.js), built from the same 3
// fetches - My Tasks (/tasks/mine), Dependency Clearance's own
// "Outbound" queue (/task-dependency-tickets/mine), and the mirror-image
// "Inbound" endpoint (/task-dependency-tickets/created-by-me).
export default function DeveloperDashboard({ user }) {
  const [tasks, setTasks] = useState([]);
  const [outbound, setOutbound] = useState([]);
  const [inbound, setInbound] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    setLoading(true);
    setError('');
    Promise.all([
      apiFetch('/tasks/mine'),
      apiFetch('/task-dependency-tickets/mine'),
      apiFetch('/task-dependency-tickets/created-by-me'),
    ])
      .then(([taskList, outboundList, inboundList]) => {
        setTasks(taskList);
        setOutbound(outboundList);
        setInbound(inboundList);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  return (
    <AppShell>
      <div className={issueStyles.pageHeader}>
        <div>
          <h1 className={issueStyles.pageTitle}>
            Welcome{user.fullName ? `, ${user.fullName.split(' ')[0]}` : ''}
          </h1>
          <p className={issueStyles.pageSubtitle}>Here&rsquo;s what&rsquo;s on your plate right now.</p>
        </div>
      </div>

      {error && <div className={issueStyles.error}>{error}</div>}

      <DeveloperTaskWorkboard
        tasks={tasks}
        outbound={outbound}
        inbound={inbound}
        loading={loading}
        storageKey={ACTIVE_CARD_STORAGE_KEY}
        hideEmptyCards
      />
    </AppShell>
  );
}
