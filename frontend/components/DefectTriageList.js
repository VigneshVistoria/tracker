import { useEffect, useState } from 'react';
import Link from 'next/link';
import Badge from './ui/Badge';
import styles from '../styles/issues.module.css';
import { apiFetch } from '../lib/api';
import { formatDate } from '../lib/formatDate';

// Defect triage (2026-10-27): my defects waiting for Accept or Dispute, shown
// above My Tasks for Developer/Designer/DevOps. Renders nothing when there
// are none.
export default function DefectTriageList() {
  const [rows, setRows] = useState([]);

  useEffect(() => {
    apiFetch('/defect-triage/mine').then(setRows).catch(() => setRows([]));
  }, []);

  if (!rows.length) return null;
  return (
    <section className={styles.card} style={{ marginBottom: 'var(--space-4)', borderLeft: '4px solid var(--ds-color-warning)' }} aria-labelledby="defect-triage-list-title">
      <h2 id="defect-triage-list-title" className={styles.cardTitle}>
        Defects to accept or dispute ({rows.length})
      </h2>
      <p className={styles.helpText} style={{ marginTop: 0 }}>
        Open each one and accept it, or dispute it with a reason. A defect can be submitted for QA once you accept it.
      </p>
      <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {rows.map((r) => (
          <li key={r.id} style={{ padding: 'var(--ds-space-2) 0', borderTop: '1px solid var(--ds-border)' }}>
            <Link href={`/tasks/${r.id}#defect-triage`}>
              #{r.id} {r.title}
            </Link>{' '}
            <span className={styles.issueMeta}>
              · {r.projectName}
              {r.severity ? ` · ${r.severity}` : ''} · from {r.raisedByEmail}
              {r.dueDate ? ` · due ${formatDate(r.dueDate)}` : ''}
            </span>{' '}
            {r.late && <Badge tone="error">Late</Badge>}
          </li>
        ))}
      </ul>
    </section>
  );
}
