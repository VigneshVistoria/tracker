import { useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle } from 'lucide-react';
import AppShell from '../../components/AppShell';
import styles from '../../styles/issues.module.css';
import { apiFetch } from '../../lib/api';
import { useToast } from '../../lib/toast';

const STATUS_OPTIONS = ['Open', 'Under Review', 'Assigned', 'In Progress', 'Resolved', 'Closed', 'Blocked', 'Escalated'];
const BLOCKED_STATUSES = ['Blocked', 'Escalated'];
const RESOLVED_STATUSES = ['Resolved', 'Closed'];
const PRIORITY_OPTIONS = ['Critical', 'High', 'Medium', 'Low'];
const IMPACT_OPTIONS = ['Critical', 'High', 'Medium', 'Low'];

const EMPTY_CREATE_FORM = {
  title: '',
  description: '',
  blockingReason: '',
  requestedTeam: '',
  ownerUserId: '',
  priority: 'Medium',
  requiredByDate: '',
  impactedIssueId: '',
  businessJustification: '',
  impactLevel: 'Medium',
  blocking: false,
  estimatedDelayDays: '',
};

function formatDate(value) {
  if (!value) return '—';
  return new Date(value).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

// Collapses the entity's 8 workflow statuses down to the 3 buckets an
// inbox actually needs to scan at a glance - the precise status is still
// shown as the badge text, this just drives the color.
function statusBucketStyle(status) {
  if (BLOCKED_STATUSES.includes(status)) {
    return { background: 'var(--color-red-tint)', color: 'var(--color-red-dark)', border: 'var(--color-red)' };
  }
  if (RESOLVED_STATUSES.includes(status)) {
    return { background: 'var(--color-teal-tint)', color: 'var(--color-teal-dark)', border: 'var(--color-teal)' };
  }
  return { background: 'var(--color-moss-tint)', color: 'var(--color-moss-dark)', border: 'var(--color-moss)' };
}

// Overdue -> red, due within 2 days -> amber, otherwise neutral - so the
// due-date chip carries its own urgency signal without needing the row's
// status to also be "Blocked".
function dueMeta(requiredByDate) {
  if (!requiredByDate) return null;
  const due = new Date(requiredByDate);
  const today = new Date(new Date().toDateString());
  const diffDays = Math.round((due - today) / 86400000);
  if (diffDays < 0) {
    return { label: `Overdue · ${formatDate(requiredByDate)}`, style: { background: 'var(--color-red-tint)', color: 'var(--color-red-dark)' } };
  }
  if (diffDays <= 2) {
    return { label: `Due ${formatDate(requiredByDate)}`, style: { background: 'var(--color-moss-tint)', color: 'var(--color-moss-dark)' } };
  }
  return { label: `Due ${formatDate(requiredByDate)}`, style: { background: 'var(--color-slate-tint)', color: 'var(--color-ink-soft)' } };
}

function DependencyCard({ dependency, perspective, onStatusChange, busy }) {
  const bucket = statusBucketStyle(dependency.status);
  const due = dueMeta(dependency.requiredByDate);
  const isHighPriority = dependency.priority === 'Critical' || dependency.priority === 'High';

  return (
    <div className={styles.card} style={{ borderLeft: `3px solid ${bucket.border}`, marginBottom: 'var(--space-3)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 'var(--space-2)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
          {isHighPriority && (
            <span title={`${dependency.priority} priority`} style={{ color: 'var(--color-red-dark)', display: 'flex' }}>
              <AlertTriangle size={16} aria-hidden="true" />
            </span>
          )}
          <span className={styles.badge} style={{ background: bucket.background, color: bucket.color }}>
            {dependency.status}
          </span>
        </div>
        {due && <span className={styles.badge} style={due.style}>{due.label}</span>}
      </div>

      <p style={{ margin: 'var(--space-2) 0 0', fontWeight: 600 }}>
        {perspective === 'received'
          ? <>From {dependency.createdByEmail} &middot; {dependency.requestedTeam}</>
          : <>To {dependency.ownerEmail} &middot; {dependency.requestedTeam}</>}
      </p>

      <p className={styles.issueMeta} style={{ margin: 'var(--space-1) 0 0' }}>
        Blocking <Link href={`/issues/${dependency.impactedIssueId}`}>#{dependency.impactedIssueId}</Link> &middot; {dependency.title}
      </p>

      {dependency.blockingReason && (
        <p
          className={styles.issueMeta}
          style={{ margin: 'var(--space-1) 0 0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
        >
          {dependency.blockingReason}
        </p>
      )}

      <div className={styles.actions} style={{ marginTop: 'var(--space-3)', alignItems: 'center' }}>
        <select
          className={styles.select}
          value={dependency.status}
          disabled={busy === dependency.id}
          onChange={(e) => onStatusChange(dependency.id, e.target.value)}
        >
          {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <Link href={`/issues/${dependency.impactedIssueId}`} className={styles.backLink}>View ticket &rarr;</Link>
      </div>
    </div>
  );
}

export default function DependenciesInboxPage() {
  const { showToast } = useToast();
  const [tab, setTab] = useState('received');
  const [received, setReceived] = useState([]);
  const [sent, setSent] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(null);
  const [currentUser, setCurrentUser] = useState(null);
  const [assignableUsers, setAssignableUsers] = useState([]);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createForm, setCreateForm] = useState(EMPTY_CREATE_FORM);

  const load = () => {
    setLoading(true);
    setError('');
    Promise.all([apiFetch('/dependencies/received'), apiFetch('/dependencies/sent')])
      .then(([receivedList, sentList]) => {
        setReceived(receivedList);
        setSent(sentList);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    apiFetch('/users/me').then(setCurrentUser).catch(() => {});
    apiFetch('/users/assignable').then(setAssignableUsers).catch(() => {});
    load();
  }, []);

  const applyUpdate = (updated) => {
    setReceived((prev) => prev.map((d) => (d.id === updated.id ? updated : d)));
    setSent((prev) => prev.map((d) => (d.id === updated.id ? updated : d)));
  };

  const handleStatusChange = async (id, status) => {
    setBusy(id);
    setError('');
    try {
      const updated = await apiFetch(`/dependencies/${id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      });
      applyUpdate(updated);
      showToast(`Dependency #${id} marked ${status}`, 'success');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    setError('');
    setCreating(true);
    try {
      const owner = assignableUsers.find((u) => String(u.id) === createForm.ownerUserId);
      const dependency = await apiFetch('/dependencies', {
        method: 'POST',
        body: JSON.stringify({
          title: createForm.title,
          description: createForm.description,
          blockingReason: createForm.blockingReason,
          requestedTeam: createForm.requestedTeam,
          ownerUserId: owner ? owner.id : undefined,
          ownerEmail: owner ? owner.email : '',
          priority: createForm.priority,
          requiredByDate: createForm.requiredByDate,
          impactedIssueId: Number(createForm.impactedIssueId),
          businessJustification: createForm.businessJustification,
          impactLevel: createForm.impactLevel,
          blocking: createForm.blocking,
          estimatedDelayDays: createForm.estimatedDelayDays !== '' ? Number(createForm.estimatedDelayDays) : undefined,
        }),
      });
      showToast(`Dependency #${dependency.id} filed`, 'success');
      setSent((prev) => [dependency, ...prev]);
      setShowCreateForm(false);
      setCreateForm(EMPTY_CREATE_FORM);
      setTab('sent');
    } catch (err) {
      setError(err.message);
    } finally {
      setCreating(false);
    }
  };

  const list = tab === 'received' ? received : sent;
  const blockedCount = received.filter((d) => BLOCKED_STATUSES.includes(d.status)).length;
  const overdueCount = received.filter((d) => {
    if (!d.requiredByDate || RESOLVED_STATUSES.includes(d.status)) return false;
    const diffDays = Math.round((new Date(d.requiredByDate) - new Date(new Date().toDateString())) / 86400000);
    return diffDays <= 0;
  }).length;
  const canCreate = currentUser && currentUser.role !== 'executive' && currentUser.role !== 'client';

  return (
    <AppShell>
      <div className={styles.pageHeader}>
        <div>
          <h1 className={styles.pageTitle}>Dependencies</h1>
          <p className={styles.pageSubtitle}>Cross-team blockers routed to you, and ones you&apos;ve filed against others.</p>
        </div>
        {canCreate && (
          <button className={`${styles.button} ${styles.buttonAccent}`} type="button" onClick={() => setShowCreateForm((v) => !v)}>
            {showCreateForm ? 'Cancel' : 'New Dependency'}
          </button>
        )}
      </div>

      {error && <div className={styles.error}>{error}</div>}

      {!loading && (
        <div style={{ display: 'flex', gap: 'var(--space-2)', marginBottom: 'var(--space-4)', flexWrap: 'wrap' }}>
          <span className={styles.badge} style={{ background: 'var(--color-red-tint)', color: 'var(--color-red-dark)' }}>
            {blockedCount} blocking you
          </span>
          <span className={styles.badge} style={{ background: 'var(--color-moss-tint)', color: 'var(--color-moss-dark)' }}>
            {overdueCount} due or overdue
          </span>
          <span className={styles.badge} style={{ background: 'var(--color-slate-tint)', color: 'var(--color-ink-soft)' }}>
            {received.length} received &middot; {sent.length} sent
          </span>
        </div>
      )}

      {showCreateForm && (
        <form onSubmit={handleCreate} className={styles.card} style={{ marginBottom: 'var(--space-4)' }}>
          <p className={styles.helpText} style={{ marginTop: 0 }}>
            Files a cross-team dependency against a specific ticket, routed to whoever owns it.
          </p>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="depTitle">Title</label>
            <input
              className={styles.input}
              id="depTitle"
              required
              value={createForm.title}
              onChange={(e) => setCreateForm({ ...createForm, title: e.target.value })}
            />
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="depDescription">Description</label>
            <textarea
              className={styles.textarea}
              id="depDescription"
              required
              value={createForm.description}
              onChange={(e) => setCreateForm({ ...createForm, description: e.target.value })}
            />
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="depImpactedIssue">Impacted ticket #</label>
            <input
              className={styles.input}
              id="depImpactedIssue"
              type="number"
              min="1"
              required
              value={createForm.impactedIssueId}
              onChange={(e) => setCreateForm({ ...createForm, impactedIssueId: e.target.value })}
              placeholder="e.g. 42"
            />
            <p className={styles.helpText}>The ticket this dependency blocks or affects - find its ID on the ticket&apos;s page.</p>
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="depOwner">Dependency owner</label>
            <select
              className={styles.select}
              id="depOwner"
              required
              value={createForm.ownerUserId}
              onChange={(e) => setCreateForm({ ...createForm, ownerUserId: e.target.value })}
            >
              <option value="">Select who this is waiting on&hellip;</option>
              {assignableUsers.map((u) => (
                <option key={u.id} value={u.id}>{u.fullName || u.email}</option>
              ))}
            </select>
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="depTeam">Requested team</label>
            <input
              className={styles.input}
              id="depTeam"
              required
              value={createForm.requestedTeam}
              onChange={(e) => setCreateForm({ ...createForm, requestedTeam: e.target.value })}
              placeholder="e.g. DevOps, Data Platform"
            />
          </div>

          <div style={{ display: 'flex', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
            <div className={styles.field} style={{ flex: '1 1 160px' }}>
              <label className={styles.label} htmlFor="depPriority">Priority</label>
              <select
                className={styles.select}
                id="depPriority"
                value={createForm.priority}
                onChange={(e) => setCreateForm({ ...createForm, priority: e.target.value })}
              >
                {PRIORITY_OPTIONS.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <div className={styles.field} style={{ flex: '1 1 160px' }}>
              <label className={styles.label} htmlFor="depImpact">Impact level</label>
              <select
                className={styles.select}
                id="depImpact"
                value={createForm.impactLevel}
                onChange={(e) => setCreateForm({ ...createForm, impactLevel: e.target.value })}
              >
                {IMPACT_OPTIONS.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <div className={styles.field} style={{ flex: '1 1 160px' }}>
              <label className={styles.label} htmlFor="depDueDate">Required by</label>
              <input
                className={styles.input}
                id="depDueDate"
                type="date"
                required
                value={createForm.requiredByDate}
                onChange={(e) => setCreateForm({ ...createForm, requiredByDate: e.target.value })}
              />
            </div>
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="depBlockingReason">Blocking reason</label>
            <textarea
              className={styles.textarea}
              id="depBlockingReason"
              required
              value={createForm.blockingReason}
              onChange={(e) => setCreateForm({ ...createForm, blockingReason: e.target.value })}
            />
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="depJustification">Business justification</label>
            <textarea
              className={styles.textarea}
              id="depJustification"
              required
              value={createForm.businessJustification}
              onChange={(e) => setCreateForm({ ...createForm, businessJustification: e.target.value })}
            />
          </div>

          <label className={styles.checkboxRow}>
            <input
              type="checkbox"
              checked={createForm.blocking}
              onChange={(e) => setCreateForm({ ...createForm, blocking: e.target.checked })}
            />
            This is actively blocking the linked ticket
          </label>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="depDelay">Estimated delay in days (optional)</label>
            <input
              className={styles.input}
              id="depDelay"
              type="number"
              min="0"
              value={createForm.estimatedDelayDays}
              onChange={(e) => setCreateForm({ ...createForm, estimatedDelayDays: e.target.value })}
            />
          </div>

          <div className={styles.actions}>
            <button className={`${styles.button} ${styles.buttonAccent}`} type="submit" disabled={creating}>
              {creating ? 'Filing...' : 'File Dependency'}
            </button>
          </div>
        </form>
      )}

      <div style={{ display: 'flex', gap: 'var(--space-2)', marginBottom: 'var(--space-4)', borderBottom: '1px solid var(--color-border)' }}>
        {[
          { key: 'received', label: `Received (${received.length})` },
          { key: 'sent', label: `Sent (${sent.length})` },
        ].map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            style={{
              padding: 'var(--space-2) var(--space-3)',
              border: 'none',
              background: 'none',
              cursor: 'pointer',
              fontWeight: 600,
              fontSize: '0.95rem',
              color: tab === t.key ? 'var(--color-ink)' : 'var(--color-slate)',
              borderBottom: tab === t.key ? '2px solid var(--color-amber)' : '2px solid transparent',
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {loading && <div className={styles.empty}>Loading...</div>}

      {!loading && list.length === 0 && (
        <div className={styles.card}>
          <div className={styles.empty}>
            {tab === 'received' ? 'No dependencies have been routed to you yet.' : "You haven't filed any dependency requests yet."}
          </div>
        </div>
      )}

      {!loading && list.map((dependency) => (
        <DependencyCard
          key={dependency.id}
          dependency={dependency}
          perspective={tab}
          onStatusChange={handleStatusChange}
          busy={busy}
        />
      ))}
    </AppShell>
  );
}
