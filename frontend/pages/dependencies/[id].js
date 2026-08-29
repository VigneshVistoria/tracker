import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { AlertTriangle, User, UserCheck } from 'lucide-react';
import AppShell from '../../components/AppShell';
import Breadcrumbs from '../../components/ui/Breadcrumbs';
import styles from '../../styles/issues.module.css';
import { apiFetch } from '../../lib/api';
import { useToast } from '../../lib/toast';
import { badgeClassFor } from '../../lib/status';
import {
  STATUS_OPTIONS,
  statusBucketStyle,
  dueMeta,
  formatDateTime,
  canEditDependency,
} from '../../lib/dependencyStatus';

export default function DependencyDetailPage() {
  const router = useRouter();
  const { id } = router.query;
  const { showToast } = useToast();
  const [dependency, setDependency] = useState(null);
  const [impactedIssue, setImpactedIssue] = useState(null);
  const [currentUser, setCurrentUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [updatingStatus, setUpdatingStatus] = useState(false);

  const load = () => {
    if (!id) return;
    setLoading(true);
    setError('');
    setDependency(null);
    apiFetch('/users/me')
      .then((me) => {
        setCurrentUser(me);
        return apiFetch(`/dependencies/${id}`);
      })
      .then((dep) => {
        setDependency(dep);
        return apiFetch(`/issues/${dep.impactedIssueId}`).catch(() => null);
      })
      .then(setImpactedIssue)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const handleStatusChange = async (status) => {
    setUpdatingStatus(true);
    setError('');
    try {
      const updated = await apiFetch(`/dependencies/${id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      });
      setDependency(updated);
      showToast(`Marked ${status}`, 'success');
    } catch (err) {
      setError(err.message);
    } finally {
      setUpdatingStatus(false);
    }
  };

  if (loading) {
    return <AppShell><div className={styles.empty}>Loading...</div></AppShell>;
  }

  if (!dependency) {
    return (
      <AppShell>
        <div className={styles.error}>{error || 'Dependency not found.'}</div>
        <Link href="/dependencies" className={styles.backLink}>&larr; Back to dependencies</Link>
      </AppShell>
    );
  }

  const bucket = statusBucketStyle(dependency.status);
  const due = dueMeta(dependency.requiredByDate);
  const isHighPriority = dependency.priority === 'Critical' || dependency.priority === 'High';
  const canEdit = canEditDependency(dependency, currentUser);

  return (
    <AppShell>
      <Breadcrumbs
        items={[
          { label: 'Dependencies', href: '/dependencies' },
          { label: `#${dependency.id}` },
        ]}
      />

      <div className={styles.pageHeader}>
        <div>
          <h1 className={styles.pageTitle}>
            <span className={styles.issueId}>#{dependency.id}</span>
            {dependency.title}
          </h1>
          <p className={styles.pageSubtitle}>Filed {formatDateTime(dependency.createdAt)}</p>
        </div>
        <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
          {isHighPriority && (
            <span title={`${dependency.priority} priority`} style={{ color: 'var(--color-red-dark)', display: 'flex' }}>
              <AlertTriangle size={18} aria-hidden="true" />
            </span>
          )}
          <span className={styles.badge} style={{ background: bucket.background, color: bucket.color }}>
            {dependency.status}
          </span>
          {due && <span className={styles.badge} style={due.style}>{due.label}</span>}
        </div>
      </div>

      {error && <div className={styles.error}>{error}</div>}

      <div className={styles.card} style={{ borderLeft: `3px solid ${bucket.border}` }}>
        <div style={{ display: 'flex', gap: 'var(--space-4)', flexWrap: 'wrap' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-1)' }}>
            <User size={14} aria-hidden="true" /> Filed by {dependency.createdByEmail}
          </span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-1)' }}>
            <UserCheck size={14} aria-hidden="true" /> Waiting on {dependency.ownerEmail}
          </span>
          <span className={styles.issueMeta}>Team: {dependency.requestedTeam}</span>
          <span className={styles.issueMeta}>Priority: {dependency.priority}</span>
          <span className={styles.issueMeta}>Impact: {dependency.impactLevel}</span>
          {dependency.blocking && (
            <span className={styles.badge} style={{ background: 'var(--color-red-tint)', color: 'var(--color-red-dark)' }}>
              Actively blocking
            </span>
          )}
        </div>

        <div style={{ marginTop: 'var(--space-4)' }}>
          <p className={styles.label} style={{ marginBottom: 'var(--space-1)' }}>Impacted ticket</p>
          {impactedIssue ? (
            <p style={{ margin: 0 }}>
              <Link href={`/issues/${dependency.impactedIssueId}`}>#{dependency.impactedIssueId} {impactedIssue.title}</Link>{' '}
              <span className={`${styles.badge} ${badgeClassFor(impactedIssue.status, styles)}`}>{impactedIssue.status}</span>
            </p>
          ) : (
            <Link href={`/issues/${dependency.impactedIssueId}`}>#{dependency.impactedIssueId}</Link>
          )}
        </div>

        <div style={{ marginTop: 'var(--space-4)' }}>
          <p className={styles.label} style={{ marginBottom: 'var(--space-1)' }}>Description</p>
          <p style={{ margin: 0 }}>{dependency.description}</p>
        </div>

        <div style={{ marginTop: 'var(--space-4)' }}>
          <p className={styles.label} style={{ marginBottom: 'var(--space-1)' }}>Blocking reason</p>
          <p style={{ margin: 0 }}>{dependency.blockingReason}</p>
        </div>

        <div style={{ marginTop: 'var(--space-4)' }}>
          <p className={styles.label} style={{ marginBottom: 'var(--space-1)' }}>Business justification</p>
          <p style={{ margin: 0 }}>{dependency.businessJustification}</p>
        </div>

        {dependency.estimatedDelayDays != null && (
          <p className={styles.issueMeta} style={{ marginTop: 'var(--space-3)' }}>
            Estimated delay: {dependency.estimatedDelayDays} day{dependency.estimatedDelayDays === 1 ? '' : 's'}
          </p>
        )}

        {canEdit && (
          <div className={styles.actions} style={{ marginTop: 'var(--space-4)', alignItems: 'center' }}>
            <label className={styles.label} htmlFor="depStatus" style={{ margin: 0 }}>Status</label>
            <select
              className={styles.select}
              id="depStatus"
              value={dependency.status}
              disabled={updatingStatus}
              onChange={(e) => handleStatusChange(e.target.value)}
            >
              {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
        )}

        <div style={{ marginTop: 'var(--space-4)', display: 'flex', gap: 'var(--space-4)', flexWrap: 'wrap' }}>
          <span className={styles.issueMeta}>Created {formatDateTime(dependency.createdAt)}</span>
          <span className={styles.issueMeta}>Updated {formatDateTime(dependency.updatedAt)}</span>
          {dependency.resolvedAt && <span className={styles.issueMeta}>Resolved {formatDateTime(dependency.resolvedAt)}</span>}
          {dependency.escalatedAt && <span className={styles.issueMeta}>Escalated {formatDateTime(dependency.escalatedAt)}</span>}
        </div>
      </div>
    </AppShell>
  );
}
