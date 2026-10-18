import { useEffect, useState } from 'react';
import Link from 'next/link';
import styles from '../styles/issues.module.css';
import { apiFetch } from '../lib/api';
import { formatDate } from '../lib/formatDate';

// Return to QA (2026-10-18): tickets a Program Manager sent back to me,
// shown above QA Review / My Defects. Renders nothing when there are none.
export default function ReturnedToQaList() {
  const [rows, setRows] = useState([]);

  useEffect(() => {
    apiFetch('/tasks/returned-to-qa').then(setRows).catch(() => setRows([]));
  }, []);

  if (!rows.length) return null;
  return (
    <section className={styles.card} style={{ marginBottom: 'var(--space-4)', borderLeft: '4px solid var(--ds-color-primary-500)' }} aria-labelledby="returned-to-qa-title">
      <h2 id="returned-to-qa-title" className={styles.cardTitle}>
        Returned to you by a PM ({rows.length})
      </h2>
      <p className={styles.helpText} style={{ marginTop: 0 }}>
        Fix what the PM asked for, then send each one back to the developer from its page.
      </p>
      <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {rows.map((r) => (
          <li key={r.id} style={{ padding: 'var(--ds-space-2) 0', borderTop: '1px solid var(--ds-border)' }}>
            <Link href={`/tasks/${r.id}`}>
              #{r.id} {r.title}
            </Link>{' '}
            <span className={styles.issueMeta}>
              · {r.isDefect ? 'Defect' : 'Task'} · {r.projectName} · from {r.returnedByEmail} on {formatDate(r.returnedAt)}
            </span>
            <div style={{ whiteSpace: 'pre-wrap', marginTop: 'var(--ds-space-1)' }}>{r.reason}</div>
          </li>
        ))}
      </ul>
    </section>
  );
}
