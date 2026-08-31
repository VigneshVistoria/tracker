import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import AppShell from '../../../components/AppShell';
import Breadcrumbs from '../../../components/ui/Breadcrumbs';
import CompletionVsTargetBar from '../../../components/CompletionVsTargetBar';
import styles from '../../../styles/issues.module.css';
import { apiFetch } from '../../../lib/api';
import { useToast } from '../../../lib/toast';
import { getSocket } from '../../../lib/socket';

const RISK_STYLE = {
  High: { background: 'var(--color-red-tint)', color: 'var(--color-red-dark)' },
  Medium: { background: 'var(--color-amber-tint)', color: 'var(--color-amber-dark)' },
  Low: { background: 'var(--color-teal-tint)', color: 'var(--color-teal-dark)' },
};

// Solid (non-tint) equivalents of RISK_STYLE, for left-border accents -
// kept in sync with the badge colors above so risk reads as one
// continuous color language from project -> module -> issue.
const RISK_BORDER_COLOR = {
  High: 'var(--color-red)',
  Medium: 'var(--color-amber)',
  Low: 'var(--color-teal)',
};

const STATUS_FILTERS = ['All', 'At Risk', 'In Progress', 'Completed'];

// High risk first, so problem modules surface without scrolling past
// everything that's fine. Array.sort is stable, so same-risk modules
// keep their original relative order.
const RISK_SORT_RANK = { High: 0, Medium: 1, Low: 2 };

function RiskBadge({ level }) {
  return (
    <span className={styles.badge} style={RISK_STYLE[level] || RISK_STYLE.Low}>
      {level} risk
    </span>
  );
}

function StatRow({ completionPercent, riskLevel, keyFocusArea, status, issueCount }) {
  return (
    <div>
      <div style={{ display: 'flex', gap: 'var(--space-4)', alignItems: 'center', flexWrap: 'wrap' }}>
        <span className={styles.badge}>{status}</span>
        <RiskBadge level={riskLevel} />
        <span className={styles.issueMeta}>{issueCount} issue{issueCount === 1 ? '' : 's'}</span>
        <span className={styles.issueMeta}>Key focus: {keyFocusArea}</span>
      </div>
      <div style={{ marginTop: 'var(--space-2)', maxWidth: '420px' }}>
        <CompletionVsTargetBar label="Completion" percent={completionPercent} />
      </div>
    </div>
  );
}

function EditModuleForm({ module, onSaved, onCancel }) {
  const { showToast } = useToast();
  const [form, setForm] = useState({ name: module.name, description: module.description || '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      await apiFetch(`/modules/${module.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ name: form.name, description: form.description || undefined }),
      });
      showToast('Module updated', 'success');
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} style={{ marginTop: 'var(--space-2)' }} onClick={(e) => e.stopPropagation()}>
      {error && <div className={styles.error}>{error}</div>}
      <div className={styles.field}>
        <label className={styles.label} htmlFor={`moduleName-${module.id}`}>Name</label>
        <input
          className={styles.input}
          id={`moduleName-${module.id}`}
          required
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
        />
      </div>
      <div className={styles.field}>
        <label className={styles.label} htmlFor={`moduleDescription-${module.id}`}>Description</label>
        <textarea
          className={styles.textarea}
          id={`moduleDescription-${module.id}`}
          value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
        />
      </div>
      <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
        <button className={`${styles.button} ${styles.buttonAccent}`} type="submit" disabled={saving}>
          {saving ? 'Saving...' : 'Save'}
        </button>
        <button className={styles.buttonSecondary} type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function ModuleRow({ module, projectId, initialExpanded, isAdmin, onChanged }) {
  const { showToast } = useToast();
  const [expanded, setExpanded] = useState(initialExpanded);
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(false);

  const fetchDetail = () => {
    setLoading(true);
    const path = module.id == null ? `/projects/${projectId}/modules/unassigned` : `/modules/${module.id}/overview`;
    apiFetch(path)
      .then(setDetail)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (initialExpanded) fetchDetail();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggle = () => {
    if (expanded) {
      setExpanded(false);
      return;
    }
    setExpanded(true);
    if (detail) return;
    fetchDetail();
  };

  const handleDelete = async (e) => {
    e.stopPropagation();
    try {
      await apiFetch(`/modules/${module.id}`, { method: 'DELETE' });
      showToast('Module deleted', 'success');
      onChanged();
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  const canManage = isAdmin && module.id != null;

  return (
    <div
      className={styles.card}
      style={{ marginBottom: 'var(--space-3)', borderLeft: `3px solid ${RISK_BORDER_COLOR[module.riskLevel] || RISK_BORDER_COLOR.Low}` }}
    >
      <div
        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }}
        onClick={toggle}
      >
        <div>
          <p style={{ margin: 0, fontWeight: 600 }}>{module.name}</p>
          {module.description && <p className={styles.issueMeta} style={{ margin: 0 }}>{module.description}</p>}
        </div>
        <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'center' }}>
          {canManage && !editing && (
            <>
              <button
                type="button"
                className={styles.buttonSecondary}
                onClick={(e) => {
                  e.stopPropagation();
                  setEditing(true);
                }}
              >
                Edit
              </button>
              <button type="button" className={styles.buttonSecondary} onClick={handleDelete}>
                Delete
              </button>
            </>
          )}
          <span className={styles.issueMeta}>{expanded ? '–' : '+'}</span>
        </div>
      </div>
      {editing && (
        <EditModuleForm
          module={module}
          onCancel={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            onChanged();
          }}
        />
      )}
      <div style={{ marginTop: 'var(--space-2)' }}>
        <StatRow {...module} />
      </div>

      {expanded && (
        <div style={{ marginTop: 'var(--space-4)' }}>
          {loading && <p className={styles.issueMeta}>Loading issues...</p>}
          {error && <div className={styles.error}>{error}</div>}
          {detail && detail.issues.length === 0 && (
            <p className={styles.issueMeta}>No issues in this module yet.</p>
          )}
          {detail && detail.issues.length > 0 && (
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Ticket #</th>
                    <th>Title</th>
                    <th>% Complete</th>
                    <th>Risk</th>
                    <th>Key Focus</th>
                    <th>Assignee</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.issues.map((issue) => (
                    <tr key={issue.id}>
                      <td
                        className={styles.issueId}
                        style={{ borderLeft: `3px solid ${RISK_BORDER_COLOR[issue.riskLevel] || RISK_BORDER_COLOR.Low}` }}
                      >
                        <Link href={`/issues/${issue.id}`}>#{issue.id}</Link>
                      </td>
                      <td className={styles.tableTitleCell}>
                        <Link href={`/issues/${issue.id}`}>{issue.title}</Link>
                      </td>
                      <td>{issue.completionPercent}%</td>
                      <td><RiskBadge level={issue.riskLevel} /></td>
                      <td>{issue.keyFocusArea}</td>
                      <td>{issue.assigneeEmail || 'Unassigned'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function CreateModuleForm({ projectId, onCreated }) {
  const { showToast } = useToast();
  const [form, setForm] = useState({ name: '', description: '' });
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setCreating(true);
    try {
      await apiFetch('/modules', {
        method: 'POST',
        body: JSON.stringify({ projectId: Number(projectId), name: form.name, description: form.description || undefined }),
      });
      setForm({ name: '', description: '' });
      showToast('Module created', 'success');
      onCreated();
    } catch (err) {
      setError(err.message);
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className={styles.card}>
      <h3 style={{ marginTop: 0, fontSize: '1rem' }}>Create a module</h3>
      {error && <div className={styles.error}>{error}</div>}
      <form onSubmit={handleSubmit}>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="moduleName">Name</label>
          <input
            className={styles.input}
            id="moduleName"
            required
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
        </div>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="moduleDescription">Description</label>
          <textarea
            className={styles.textarea}
            id="moduleDescription"
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
          />
        </div>
        <button className={`${styles.button} ${styles.buttonAccent}`} type="submit" disabled={creating}>
          {creating ? 'Creating...' : 'Create Module'}
        </button>
      </form>
    </div>
  );
}

export default function ProjectOverview() {
  const router = useRouter();
  const { id } = router.query;
  const [overview, setOverview] = useState(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [statusFilter, setStatusFilter] = useState('All');

  const loadOverview = () => {
    if (!id) return;
    // Reset before every fetch (including a refresh after creating a
    // module) rather than leaving stale data on screen if it fails - same
    // reasoning as the fix applied to the issue detail page's load().
    setLoading(true);
    setError('');
    setOverview(null);
    apiFetch(`/projects/${id}/overview`)
      .then(setOverview)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    const storedUser = localStorage.getItem('user');
    if (storedUser) setIsAdmin(JSON.parse(storedUser).role === 'admin');
  }, []);

  useEffect(() => {
    loadOverview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Refetch the whole overview on any module change for this project -
  // the payload is a derived aggregate (completion/risk are computed, not
  // stored), so a full refetch is simpler and more correct than trying to
  // merge a raw module row into it client-side. Mirrors admin/projects.js's
  // socket-listener pattern for the sibling project list page.
  useEffect(() => {
    const socket = getSocket();
    if (!socket || !id) return;
    const projectId = Number(id);
    const onModuleCreatedOrUpdated = (module) => {
      if (module.projectId === projectId) loadOverview();
    };
    const onModuleDeleted = () => loadOverview();
    socket.on('module:created', onModuleCreatedOrUpdated);
    socket.on('module:updated', onModuleCreatedOrUpdated);
    socket.on('module:deleted', onModuleDeleted);
    return () => {
      socket.off('module:created', onModuleCreatedOrUpdated);
      socket.off('module:updated', onModuleCreatedOrUpdated);
      socket.off('module:deleted', onModuleDeleted);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const sortedModules = useMemo(() => {
    if (!overview) return [];
    return [...overview.modules].sort(
      (a, b) => (RISK_SORT_RANK[a.riskLevel] ?? 2) - (RISK_SORT_RANK[b.riskLevel] ?? 2),
    );
  }, [overview]);

  const filterCounts = useMemo(() => {
    const counts = { All: sortedModules.length, 'At Risk': 0, 'In Progress': 0, Completed: 0 };
    sortedModules.forEach((m) => {
      if (counts[m.status] !== undefined) counts[m.status] += 1;
    });
    return counts;
  }, [sortedModules]);

  const visibleModules = statusFilter === 'All'
    ? sortedModules
    : sortedModules.filter((m) => m.status === statusFilter);

  return (
    <AppShell>
      <Breadcrumbs
        items={[
          { label: 'Projects', href: '/admin/projects' },
          { label: overview ? overview.project.name : 'Project' },
        ]}
      />
      <div className={styles.pageHeader}>
        <div>
          <h1 className={styles.pageTitle}>{overview ? overview.project.name : 'Project'}</h1>
          <p className={styles.pageSubtitle}>Status, completion, and risk, drilled down by module and issue.</p>
        </div>
      </div>

      {loading && <div className={styles.empty}>Loading...</div>}
      {error && <div className={styles.error}>{error}</div>}

      {overview && (
        <>
          <div className={styles.card} style={{ borderLeft: `3px solid ${RISK_BORDER_COLOR[overview.riskLevel] || RISK_BORDER_COLOR.Low}` }}>
            <h3 style={{ marginTop: 0, fontSize: '1rem' }}>Overall</h3>
            {overview.project.description && (
              <p className={styles.issueMeta} style={{ marginTop: 0 }}>{overview.project.description}</p>
            )}
            <StatRow {...overview} />
          </div>

          {isAdmin && <CreateModuleForm projectId={id} onCreated={loadOverview} />}

          <h3 style={{ fontSize: '1rem' }}>Modules ({overview.modules.length})</h3>

          {overview.modules.length > 0 && (
            <div style={{ display: 'flex', gap: 'var(--space-2)', marginBottom: 'var(--space-3)', flexWrap: 'wrap' }}>
              {STATUS_FILTERS.map((f) => (
                <button
                  key={f}
                  type="button"
                  className={statusFilter === f ? `${styles.button} ${styles.buttonAccent}` : styles.buttonSecondary}
                  onClick={() => setStatusFilter(f)}
                >
                  {f} ({filterCounts[f] ?? 0})
                </button>
              ))}
            </div>
          )}

          {overview.modules.length === 0 && (
            <div className={styles.card}>
              <div className={styles.empty}>No modules yet for this project.</div>
            </div>
          )}
          {overview.modules.length > 0 && visibleModules.length === 0 && (
            <div className={styles.card}>
              <div className={styles.empty}>No modules match &quot;{statusFilter}&quot;.</div>
            </div>
          )}
          {visibleModules.map((module) => (
            <ModuleRow
              key={module.id ?? 'unassigned'}
              module={module}
              projectId={id}
              initialExpanded={module.riskLevel === 'High'}
              isAdmin={isAdmin}
              onChanged={loadOverview}
            />
          ))}
        </>
      )}
    </AppShell>
  );
}
