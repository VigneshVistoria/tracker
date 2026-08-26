import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import AppShell from '../../components/AppShell';
import styles from '../../styles/issues.module.css';
import { apiFetch } from '../../lib/api';
import { useToast } from '../../lib/toast';

function ReviewCard({ issue, onDecide, deciding }) {
  let reasons = [];
  try {
    reasons = JSON.parse(issue.showstopperFlagReasons || '[]');
  } catch (_) {
    reasons = [];
  }

  return (
    <div className={styles.card} style={{ borderLeft: '3px solid var(--color-amber)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <p style={{ margin: 0, fontWeight: 600 }}>
            <Link href={`/issues/${issue.id}`}>#{issue.id} {issue.title}</Link>
          </p>
          <p className={styles.issueMeta} style={{ margin: 'var(--space-1) 0 0' }}>
            Reported by {issue.createdByEmail} &middot; {issue.projectName || 'No project'}
          </p>
        </div>
        <span className={styles.badge} style={{ background: 'var(--color-amber-tint)', color: 'var(--color-amber-dark)' }}>
          Needs review
        </span>
      </div>

      {reasons.length > 0 && (
        <ul className={styles.suggestionList} style={{ marginTop: 'var(--space-3)' }}>
          {reasons.map((r, i) => <li key={i}>{r}</li>)}
        </ul>
      )}

      <div className={styles.actions} style={{ marginTop: 'var(--space-3)' }}>
        <button
          className={`${styles.button} ${styles.buttonAccent}`}
          type="button"
          onClick={() => onDecide(issue.id, 'confirm')}
          disabled={deciding === issue.id}
        >
          Confirm Showstopper
        </button>
        <button
          className={styles.buttonSecondary}
          type="button"
          onClick={() => onDecide(issue.id, 'downgrade')}
          disabled={deciding === issue.id}
        >
          Downgrade
        </button>
      </div>
    </div>
  );
}

export default function ShowstopperReviewPage() {
  const router = useRouter();
  const { showToast } = useToast();
  const [flagged, setFlagged] = useState([]);
  const [loading, setLoading] = useState(true);
  const [deciding, setDeciding] = useState(null);
  const [error, setError] = useState('');

  const load = () => {
    apiFetch('/issues/showstoppers/flagged')
      .then(setFlagged)
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
    if (role !== 'admin' && role !== 'program_manager' && role !== 'qa') {
      router.replace('/dashboard');
      return;
    }
    load();
  }, [router]);

  const handleDecide = async (id, decision) => {
    setError('');
    setDeciding(id);
    try {
      await apiFetch(`/issues/${id}/showstopper-review`, {
        method: 'POST',
        body: JSON.stringify({ decision }),
      });
      showToast(decision === 'confirm' ? 'Showstopper confirmed' : 'Showstopper downgraded', 'success');
      setFlagged((prev) => prev.filter((i) => i.id !== id));
    } catch (err) {
      setError(err.message);
    } finally {
      setDeciding(null);
    }
  };

  return (
    <AppShell>
      <div className={styles.pageHeader}>
        <div>
          <h1 className={styles.pageTitle}>Showstopper Review</h1>
          <p className={styles.pageSubtitle}>
            Tickets marked Showstopper that our heuristic flagged as questionable - confirm they're genuinely
            blocking, or downgrade them.
          </p>
        </div>
      </div>

      {error && <div className={styles.error}>{error}</div>}
      {loading && <div className={styles.empty}>Loading...</div>}

      {!loading && flagged.length === 0 && (
        <div className={styles.card}>
          <div className={styles.empty}>Nothing needs review right now.</div>
        </div>
      )}

      {flagged.map((issue) => (
        <ReviewCard key={issue.id} issue={issue} onDecide={handleDecide} deciding={deciding} />
      ))}
    </AppShell>
  );
}
