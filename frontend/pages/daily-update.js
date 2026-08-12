import { useState } from 'react';
import AppShell from '../components/AppShell';
import StatusLight from '../components/StatusLight';
import issueStyles from '../styles/issues.module.css';
import styles from '../styles/dailyupdate.module.css';
import { apiFetch } from '../lib/api';
import { useToast } from '../lib/toast';

export default function DailyUpdatePage() {
  const { showToast } = useToast();
  const [form, setForm] = useState({ completedText: '', pendingText: '', blockersText: '' });
  const [result, setResult] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const handleChange = (e) => setForm({ ...form, [e.target.name]: e.target.value });

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);

    try {
      const update = await apiFetch('/daily-updates', {
        method: 'POST',
        body: JSON.stringify(form),
      });
      setResult(update);
      showToast('Daily update submitted', 'success');
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleNewUpdate = () => {
    setResult(null);
    setForm({ completedText: '', pendingText: '', blockersText: '' });
  };

  return (
    <AppShell>
      <div className={issueStyles.pageHeader}>
        <div>
          <h1 className={issueStyles.pageTitle}>Daily Update</h1>
          <p className={issueStyles.pageSubtitle}>
            List what you did today, one item per line. We'll handle the rest.
          </p>
        </div>
      </div>

      {error && <div className={issueStyles.error}>{error}</div>}

      {!result && (
        <div className={issueStyles.card}>
          <form onSubmit={handleSubmit}>
            <div className={issueStyles.field}>
              <label className={issueStyles.label} htmlFor="completedText">Completed today</label>
              <textarea
                className={issueStyles.textarea}
                id="completedText"
                name="completedText"
                value={form.completedText}
                onChange={handleChange}
                placeholder={'Fixed login bug\nWrote unit tests for auth flow'}
              />
              <p className={issueStyles.helpText}>One item per line.</p>
            </div>

            <div className={issueStyles.field}>
              <label className={issueStyles.label} htmlFor="pendingText">Still pending</label>
              <textarea
                className={issueStyles.textarea}
                id="pendingText"
                name="pendingText"
                value={form.pendingText}
                onChange={handleChange}
                placeholder={'Deploy to staging\nUpdate documentation'}
              />
            </div>

            <div className={issueStyles.field}>
              <label className={issueStyles.label} htmlFor="blockersText">Risks or blockers (optional)</label>
              <textarea
                className={issueStyles.textarea}
                id="blockersText"
                name="blockersText"
                value={form.blockersText}
                onChange={handleChange}
                placeholder={'Waiting on DevOps for staging access'}
              />
            </div>

            <button className={`${issueStyles.button} ${issueStyles.buttonAccent}`} type="submit" disabled={submitting}>
              {submitting ? 'Submitting...' : 'Submit Update'}
            </button>
          </form>
        </div>
      )}

      {result && (
        <div className={issueStyles.card}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 'var(--space-3)' }}>
            <h3 style={{ margin: 0 }}>Today's Breakdown</h3>
            <StatusLight status={result.status} />
          </div>

          <div style={{ marginTop: 'var(--space-4)' }}>
            <p className={issueStyles.label} style={{ marginBottom: 'var(--space-1)' }}>Productivity Score</p>
            <div className={styles.scoreBarTrack}>
              <div
                className={styles.scoreBarFill}
                style={{
                  width: `${result.productivityScore}%`,
                  background: result.productivityScore >= 70
                    ? 'var(--color-teal)'
                    : result.productivityScore >= 40
                      ? 'var(--color-amber)'
                      : 'var(--color-red)',
                }}
              />
            </div>
            <p style={{ fontFamily: 'var(--font-mono)', fontSize: '0.85rem', color: 'var(--color-ink-soft)' }}>
              {result.productivityScore}%
            </p>
          </div>

          <div className={styles.columns}>
            <div className={styles.columnCard}>
              <p className={styles.columnTitle}>Completed ({result.completedTasks.length})</p>
              {result.completedTasks.length === 0
                ? <p className={issueStyles.helpText}>Nothing marked complete.</p>
                : <ul className={styles.summaryList}>{result.completedTasks.map((t, i) => <li key={i}>{t}</li>)}</ul>}
            </div>

            <div className={styles.columnCard}>
              <p className={styles.columnTitle}>Pending ({result.pendingTasks.length})</p>
              {result.pendingTasks.length === 0
                ? <p className={issueStyles.helpText}>Nothing pending.</p>
                : <ul className={styles.summaryList}>{result.pendingTasks.map((t, i) => <li key={i}>{t}</li>)}</ul>}
            </div>

            <div className={styles.columnCard}>
              <p className={styles.columnTitle}>Carried Forward ({result.carryForwardTasks.length})</p>
              {result.carryForwardTasks.length === 0
                ? <p className={issueStyles.helpText}>Nothing carried over.</p>
                : <ul className={styles.summaryList}>{result.carryForwardTasks.map((t, i) => <li key={i}>{t}</li>)}</ul>}
            </div>

            <div className={styles.columnCard}>
              <p className={styles.columnTitle}>Risks / Blockers ({result.risks.length})</p>
              {result.risks.length === 0
                ? <p className={issueStyles.helpText}>None reported.</p>
                : <ul className={styles.summaryList}>{result.risks.map((t, i) => <li key={i}>{t}</li>)}</ul>}
            </div>
          </div>

          <div style={{ marginTop: 'var(--space-5)' }}>
            <p className={styles.columnTitle}>Manager Summary</p>
            <p style={{ fontSize: '0.9rem', color: 'var(--color-ink-soft)', lineHeight: 1.6 }}>
              {result.managerSummary}
            </p>
          </div>

          <div className={issueStyles.actions}>
            <button className={issueStyles.buttonSecondary} onClick={handleNewUpdate} type="button">
              Submit Another Update
            </button>
          </div>
        </div>
      )}
    </AppShell>
  );
}
