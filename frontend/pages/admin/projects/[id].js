import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import AppShell from '../../../components/AppShell';
import styles from '../../../styles/issues.module.css';
import { apiFetch } from '../../../lib/api';

const RISK_STYLE = {
  High: { background: 'var(--color-red-tint)', color: 'var(--color-red-dark)' },
  Medium: { background: 'var(--color-amber-tint)', color: 'var(--color-amber-dark)' },
  Low: { background: 'var(--color-teal-tint)', color: 'var(--color-teal-dark)' },
};

function RiskBadge({ level }) {
  return (
    <span className={styles.badge} style={RISK_STYLE[level] || RISK_STYLE.Low}>
      {level} risk
    </span>
  );
}

function StatRow({ completionPercent, riskLevel, keyFocusArea, status, issueCount }) {
  return (
    <div style={{ display: 'flex', gap: 'var(--space-4)', alignItems: 'center', flexWrap: 'wrap' }}>
      <span className={styles.badge}>{status}</span>
      <RiskBadge level={riskLevel} />
      <span className={styles.issueMeta}>{completionPercent}% complete</span>
      <span className={styles.issueMeta}>{issueCount} issue{issueCount === 1 ? '' : 's'}</span>
      <span className={styles.issueMeta}>Key focus: {keyFocusArea}</span>
    </div>
  );
}

function ModuleRow({ module, projectId }) {
  const [expanded, setExpanded] = useState(false);
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const toggle = () => {
    if (expanded) {
      setExpanded(false);
      return;
    }
    setExpanded(true);
    if (detail) return;
    setLoading(true);
    const path = module.id == null ? `/projects/${projectId}/modules/unassigned` : `/modules/${module.id}/overview`;
    apiFetch(path)
      .then(setDetail)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  };

  return (
    <div className={styles.card} style={{ marginBottom: 'var(--space-3)' }}>
      <div
        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }}
        onClick={toggle}
      >
        <div>
          <p style={{ margin: 0, fontWeight: 600 }}>{module.name}</p>
          {module.description && <p className={styles.issueMeta} style={{ margin: 0 }}>{module.description}</p>}
        </div>
        <span className={styles.issueMeta}>{expanded ? '–' : '+'}</span>
      </div>
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
                      <td className={styles.issueId}>
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

export default function ProjectOverview() {
  const router = useRouter();
  const { id } = router.query;
  const [overview, setOverview] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    setError('');
    setOverview(null);
    apiFetch(`/projects/${id}/overview`)
      .then(setOverview)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [id]);

  return (
    <AppShell>
      <div className={styles.pageHeader}>
        <div>
          <h1 className={styles.pageTitle}>{overview ? overview.project.name : 'Project'}</h1>
          <p className={styles.pageSubtitle}>Status, completion, and risk, drilled down by module and issue.</p>
        </div>
        <Link href="/admin/projects" className={styles.backLink}>&larr; Back to projects</Link>
      </div>

      {loading && <div className={styles.empty}>Loading...</div>}
      {error && <div className={styles.error}>{error}</div>}

      {overview && (
        <>
          <div className={styles.card}>
            <h3 style={{ marginTop: 0, fontSize: '1rem' }}>Overall</h3>
            {overview.project.description && (
              <p className={styles.issueMeta} style={{ marginTop: 0 }}>{overview.project.description}</p>
            )}
            <StatRow {...overview} />
          </div>

          <h3 style={{ fontSize: '1rem' }}>Modules ({overview.modules.length})</h3>
          {overview.modules.length === 0 && (
            <div className={styles.card}>
              <div className={styles.empty}>No modules yet for this project.</div>
            </div>
          )}
          {overview.modules.map((module) => (
            <ModuleRow key={module.id ?? 'unassigned'} module={module} projectId={id} />
          ))}
        </>
      )}
    </AppShell>
  );
}
