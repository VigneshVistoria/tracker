import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import AppShell from '../../../components/AppShell';
import styles from '../../../styles/issues.module.css';
import { apiFetch } from '../../../lib/api';
import { formatDateTime } from '../../../lib/formatDate';
import { useToast } from '../../../lib/toast';
import { REVIEW_STATUS, REVIEW_BADGE_STYLE, SUBMITTABLE_REVIEW_STATUSES } from '../../../lib/testCaseReview';
import { formatCustomFieldValue } from '../../../lib/testCaseFields';

const RESULT_OPTIONS = ['Passed', 'Failed', 'Blocked'];

const RESULT_BADGE_STYLE = {
  Passed: { background: 'var(--color-teal-tint)', color: 'var(--color-teal-dark)' },
  Failed: { background: 'var(--color-red-tint)', color: 'var(--color-red-dark)' },
  Blocked: { background: 'var(--color-amber-tint)', color: 'var(--color-amber-dark)' },
};

function ResultBadge({ result }) {
  if (!result) return <span className={styles.issueMeta}>Not run</span>;
  return <span className={styles.badge} style={RESULT_BADGE_STYLE[result]}>{result}</span>;
}

export default function TestCaseDetail() {
  const router = useRouter();
  const { id } = router.query;
  const { showToast } = useToast();

  const [testCase, setTestCase] = useState(null);
  const [executions, setExecutions] = useState([]);
  const [labels, setLabels] = useState([]);
  const [customFieldDefs, setCustomFieldDefs] = useState([]);
  const [canManage, setCanManage] = useState(false);
  const [canReview, setCanReview] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [runForm, setRunForm] = useState({ result: 'Passed', notes: '', defectIssueId: '' });
  const [recording, setRecording] = useState(false);

  const [reviewComment, setReviewComment] = useState('');
  const [reviewBusy, setReviewBusy] = useState(false);

  const load = () => {
    if (!id) return;
    setLoading(true);
    setError('');
    Promise.all([apiFetch(`/test-cases/${id}`), apiFetch(`/test-cases/${id}/executions`)])
      .then(([tc, execs]) => {
        setTestCase(tc);
        setExecutions(execs);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    const storedUser = localStorage.getItem('user');
    if (storedUser) {
      const role = JSON.parse(storedUser).role;
      setCanManage(role === 'admin' || role === 'qa' || role === 'program_manager');
      setCanReview(role === 'program_manager');
    }
    apiFetch('/labels').then(setLabels).catch(() => {});
    apiFetch('/test-case-custom-fields').then(setCustomFieldDefs).catch(() => {});
  }, []);

  useEffect(load, [id]);

  const handleRecordRun = async (e) => {
    e.preventDefault();
    setError('');
    setRecording(true);
    try {
      await apiFetch(`/test-cases/${id}/executions`, {
        method: 'POST',
        body: JSON.stringify({
          result: runForm.result,
          notes: runForm.notes || undefined,
          defectIssueId: runForm.defectIssueId ? Number(runForm.defectIssueId) : undefined,
        }),
      });
      showToast('Run recorded', 'success');
      setRunForm({ result: 'Passed', notes: '', defectIssueId: '' });
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setRecording(false);
    }
  };

  const runReviewAction = async (path, body, successMessage) => {
    setError('');
    setReviewBusy(true);
    try {
      await apiFetch(`/test-cases/${path}`, { method: 'POST', body: JSON.stringify({ ids: [Number(id)], ...body }) });
      showToast(successMessage, 'success');
      setReviewComment('');
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setReviewBusy(false);
    }
  };

  if (loading) return <AppShell><div className={styles.empty}>Loading...</div></AppShell>;
  if (!testCase) {
    return (
      <AppShell>
        <div className={styles.error}>{error || 'Test case not found.'}</div>
        <Link href="/qa/test-cases" className={styles.backLink}>&larr; Back to test cases</Link>
      </AppShell>
    );
  }

  const testCaseLabels = labels.filter((l) => (testCase.labelIds || []).includes(l.id));

  return (
    <AppShell>
      <div className={styles.pageHeader}>
        <div>
          <h1 className={styles.pageTitle}>
            <span className={styles.issueId}>{testCase.caseNumber || `#${testCase.id}`}</span> {testCase.title}
          </h1>
          <p className={styles.pageSubtitle}>
            {[testCase.projectName, testCase.moduleName, testCase.phaseName].filter(Boolean).join(' / ') || 'No project'}
            {' '}&middot; {testCase.status}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
          <span className={styles.badge} style={REVIEW_BADGE_STYLE[testCase.reviewStatus]}>{testCase.reviewStatus}</span>
          <ResultBadge result={testCase.lastResult} />
          {canManage && testCase.reviewStatus !== REVIEW_STATUS.PENDING && (
            <Link href={`/qa/test-cases/new?id=${testCase.id}`} className={styles.buttonSecondary}>
              Edit
            </Link>
          )}
        </div>
      </div>

      {error && <div className={styles.error}>{error}</div>}

      <div className={styles.card}>
        <h3 style={{ marginTop: 0, fontSize: '1rem' }}>PM Review</h3>
        <p className={styles.issueMeta}>
          {testCase.reviewStatus === REVIEW_STATUS.DRAFT && 'Not yet submitted. Submit it to the Program Manager - runs can be recorded once it is approved.'}
          {testCase.reviewStatus === REVIEW_STATUS.PENDING &&
            `Waiting for PM review - submitted by ${testCase.submittedForReviewByEmail || 'QA'} on ${formatDateTime(testCase.submittedForReviewAt)}.`}
          {testCase.reviewStatus === REVIEW_STATUS.READY &&
            (testCase.reviewedByEmail
              ? `Approved by ${testCase.reviewedByEmail} on ${formatDateTime(testCase.reviewedAt)} - ready for execution.`
              : 'Ready for execution.')}
          {testCase.reviewStatus === REVIEW_STATUS.REJECTED &&
            `Rejected by ${testCase.reviewedByEmail} on ${formatDateTime(testCase.reviewedAt)}. Update it and submit again.`}
        </p>
        {testCase.reviewComment && (
          <p className={styles.issueMeta} style={{ whiteSpace: 'pre-wrap' }}>
            <strong>PM comment:</strong> {testCase.reviewComment}
          </p>
        )}

        {canManage && SUBMITTABLE_REVIEW_STATUSES.includes(testCase.reviewStatus) && testCase.status !== 'Deprecated' && (
          <button
            className={`${styles.button} ${styles.buttonAccent}`}
            type="button"
            disabled={reviewBusy}
            onClick={() => runReviewAction('submit-for-review', {}, 'Sent to PM for review')}
          >
            {reviewBusy ? 'Submitting...' : testCase.reviewStatus === REVIEW_STATUS.REJECTED ? 'Resubmit for PM Review' : 'Submit for PM Review'}
          </button>
        )}

        {canReview && testCase.reviewStatus === REVIEW_STATUS.PENDING && (
          <>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="reviewComment">Comment (required to reject)</label>
              <textarea
                className={styles.textarea}
                id="reviewComment"
                value={reviewComment}
                onChange={(e) => setReviewComment(e.target.value)}
                placeholder="Feedback for QA..."
              />
            </div>
            <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
              <button
                className={`${styles.button} ${styles.buttonAccent}`}
                type="button"
                disabled={reviewBusy}
                onClick={() => runReviewAction('approve', { comment: reviewComment || undefined }, 'Approved - Ready for Execution')}
              >
                Approve
              </button>
              <button
                className={styles.buttonSecondary}
                type="button"
                disabled={reviewBusy || !reviewComment.trim()}
                onClick={() => runReviewAction('reject', { comment: reviewComment }, 'Test case rejected')}
              >
                Reject
              </button>
            </div>
          </>
        )}
      </div>

      <div className={styles.card}>
        {testCase.description && (
          <>
            <p style={{ fontWeight: 600, marginBottom: 'var(--space-2)' }}>Description</p>
            <p className={styles.issueMeta}>{testCase.description}</p>
          </>
        )}
        {testCase.preconditions && (
          <>
            <p style={{ fontWeight: 600, marginBottom: 'var(--space-2)' }}>Preconditions</p>
            <p className={styles.issueMeta} style={{ whiteSpace: 'pre-wrap' }}>{testCase.preconditions}</p>
          </>
        )}
        <p style={{ fontWeight: 600, marginBottom: 'var(--space-2)' }}>Steps</p>
        <p className={styles.issueMeta} style={{ whiteSpace: 'pre-wrap' }}>{testCase.steps}</p>
        <p style={{ fontWeight: 600, marginBottom: 'var(--space-2)' }}>Expected Result</p>
        <p className={styles.issueMeta} style={{ whiteSpace: 'pre-wrap' }}>{testCase.expectedResult}</p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-4)', marginTop: 'var(--space-3)' }}>
          <span className={styles.issueMeta}>Priority: {testCase.priority || '—'}</span>
          <span className={styles.issueMeta}>Category: {testCase.category || '—'}</span>
          {/* Custom fields with a value, plus active ones that are still empty. */}
          {customFieldDefs
            .filter((f) => f.isActive || (testCase.customFields?.[f.id] ?? '') !== '')
            .map((f) => (
              <span key={f.id} className={styles.issueMeta}>
                {f.name}: {formatCustomFieldValue(f, testCase.customFields?.[f.id])}
              </span>
            ))}
        </div>
        {testCaseLabels.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)', marginTop: 'var(--space-3)' }} aria-label="Labels">
            {testCaseLabels.map((l) => (
              <span key={l.id} className={`${styles.badge} ${styles.badgeOpen}`}>{l.name}</span>
            ))}
          </div>
        )}
      </div>

      {canManage && testCase.reviewStatus === REVIEW_STATUS.READY && (
        <div className={styles.card}>
          <h3 style={{ marginTop: 0, fontSize: '1rem' }}>Record a Run</h3>
          <form onSubmit={handleRecordRun}>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="result">Result</label>
              <select
                className={styles.select}
                id="result"
                value={runForm.result}
                onChange={(e) => setRunForm({ ...runForm, result: e.target.value })}
              >
                {RESULT_OPTIONS.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="notes">Notes</label>
              <textarea
                className={styles.textarea}
                id="notes"
                value={runForm.notes}
                onChange={(e) => setRunForm({ ...runForm, notes: e.target.value })}
                placeholder="Actual result, what you observed..."
              />
            </div>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="defectIssueId">Defect Ticket # (optional)</label>
              <input
                className={styles.input}
                id="defectIssueId"
                type="number"
                min="1"
                value={runForm.defectIssueId}
                onChange={(e) => setRunForm({ ...runForm, defectIssueId: e.target.value })}
                placeholder="e.g. 42, if this run raised a bug"
              />
            </div>
            <button className={`${styles.button} ${styles.buttonAccent}`} type="submit" disabled={recording}>
              {recording ? 'Recording...' : 'Record Run'}
            </button>
          </form>
        </div>
      )}

      <div className={styles.card}>
        <h3 style={{ marginTop: 0, fontSize: '1rem' }}>Run History ({executions.length})</h3>
        {executions.length === 0 && <p className={styles.issueMeta}>Never run yet.</p>}
        {executions.length > 0 && (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Result</th>
                  <th>Notes</th>
                  <th>Defect</th>
                  <th>By</th>
                  <th>When</th>
                </tr>
              </thead>
              <tbody>
                {executions.map((exec) => (
                  <tr key={exec.id}>
                    <td><ResultBadge result={exec.result} /></td>
                    <td>{exec.notes || '—'}</td>
                    <td>{exec.defectIssueId ? <Link href={`/issues/${exec.defectIssueId}`}>#{exec.defectIssueId}</Link> : '—'}</td>
                    <td>{exec.executedByEmail || '—'}</td>
                    <td>{formatDateTime(exec.executedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </AppShell>
  );
}
