import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import { useRouter } from 'next/router';
import AppShell from '../../../components/AppShell';
import styles from '../../../styles/issues.module.css';
import { apiFetch, apiDownload } from '../../../lib/api';
import { formatDate } from '../../../lib/formatDate';
import { useToast } from '../../../lib/toast';
import {
  REVIEW_STATUS,
  REVIEW_STATUS_OPTIONS,
  REVIEW_BADGE_STYLE,
  SUBMITTABLE_REVIEW_STATUSES,
} from '../../../lib/testCaseReview';

const STATUS_OPTIONS = ['Active', 'Deprecated'];

const RESULT_BADGE_STYLE = {
  Passed: { background: 'var(--color-teal-tint)', color: 'var(--color-teal-dark)' },
  Failed: { background: 'var(--color-red-tint)', color: 'var(--color-red-dark)' },
  Blocked: { background: 'var(--color-amber-tint)', color: 'var(--color-amber-dark)' },
};

function ResultBadge({ result }) {
  if (!result) return <span className={styles.issueMeta}>Not run</span>;
  return <span className={styles.badge} style={RESULT_BADGE_STYLE[result]}>{result}</span>;
}

function ReviewBadge({ status }) {
  return <span className={styles.badge} style={REVIEW_BADGE_STYLE[status]}>{status}</span>;
}

// Sorting is client-side: GET /test-cases isn't paginated, so the browser
// already holds every row and sorting here covers all of them. Case # sorts
// by id - caseNumber is derived from id, so that's numeric case-number
// order (TC-0002 before TC-0010). Ties on Title fall back to id.
const titleCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
const SORTERS = {
  caseNumber: (a, b) => a.id - b.id,
  title: (a, b) => titleCollator.compare(a.title, b.title) || a.id - b.id,
};

// Same click behaviour and icons as components/ui/Table.js: first click
// sorts ascending, the next toggles to descending.
function SortableHeader({ label, sortKey, sort, onSort }) {
  const active = sort.key === sortKey;
  const Icon = !active ? ArrowUpDown : sort.dir === 'asc' ? ArrowUp : ArrowDown;
  return (
    <th className={styles.sortableHeader} aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button type="button" className={styles.sortButton} onClick={() => onSort(sortKey)}>
        {label}
        <Icon size={13} aria-hidden="true" className={active ? undefined : styles.sortIdle} />
      </button>
    </th>
  );
}

export default function TestCasesList() {
  const router = useRouter();
  const { showToast } = useToast();
  const [testCases, setTestCases] = useState([]);
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [canManage, setCanManage] = useState(false);
  // Program Manager only - approve/reject (backend requireReviewer()).
  const [canReview, setCanReview] = useState(false);
  // Admin/Program Manager define custom fields and labels.
  const [canConfigure, setCanConfigure] = useState(false);
  const [labels, setLabels] = useState([]);

  const [search, setSearch] = useState('');
  const [projectFilter, setProjectFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [reviewFilter, setReviewFilter] = useState('');
  const [labelFilter, setLabelFilter] = useState('');
  const [sort, setSort] = useState({ key: 'caseNumber', dir: 'asc' });

  const [selectedIds, setSelectedIds] = useState([]);
  const [rejecting, setRejecting] = useState(false);
  const [rejectComment, setRejectComment] = useState('');
  const [busy, setBusy] = useState(false);

  const load = () =>
    apiFetch('/test-cases')
      .then(setTestCases)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));

  useEffect(() => {
    const storedUser = localStorage.getItem('user');
    if (storedUser) {
      const role = JSON.parse(storedUser).role;
      setCanManage(role === 'admin' || role === 'qa' || role === 'program_manager');
      setCanReview(role === 'program_manager');
      setCanConfigure(role === 'admin' || role === 'program_manager');
    }
    apiFetch('/projects').then(setProjects).catch(() => {});
    apiFetch('/labels').then(setLabels).catch(() => {});
    load();
  }, []);

  // ?review=Pending%20Review deep-links straight to the PM's queue.
  useEffect(() => {
    if (router.isReady && REVIEW_STATUS_OPTIONS.includes(router.query.review)) {
      setReviewFilter(router.query.review);
    }
  }, [router.isReady, router.query.review]);

  const filteredTestCases = useMemo(() => {
    const term = search.trim().toLowerCase();
    return testCases.filter((tc) => {
      if (term && !tc.title.toLowerCase().includes(term) && !(tc.caseNumber || '').toLowerCase().includes(term)) {
        return false;
      }
      if (projectFilter && String(tc.projectId) !== projectFilter) return false;
      if (statusFilter && tc.status !== statusFilter) return false;
      if (reviewFilter && tc.reviewStatus !== reviewFilter) return false;
      if (labelFilter && !(tc.labelIds || []).includes(Number(labelFilter))) return false;
      return true;
    });
  }, [testCases, search, projectFilter, statusFilter, reviewFilter, labelFilter]);

  const sortedTestCases = useMemo(() => {
    const sorted = [...filteredTestCases].sort(SORTERS[sort.key]);
    return sort.dir === 'desc' ? sorted.reverse() : sorted;
  }, [filteredTestCases, sort]);

  const handleSort = (key) =>
    setSort((current) => ({ key, dir: current.key === key && current.dir === 'asc' ? 'desc' : 'asc' }));

  const labelById = useMemo(() => new Map(labels.map((l) => [l.id, l])), [labels]);

  const pendingCount = testCases.filter((tc) => tc.reviewStatus === REVIEW_STATUS.PENDING).length;

  // Only rows the current user can actually act on are selectable: Draft/
  // Rejected (submit) for editors, Pending Review (approve/reject) for PM.
  const isSelectable = (tc) =>
    (canManage && SUBMITTABLE_REVIEW_STATUSES.includes(tc.reviewStatus) && tc.status !== 'Deprecated') ||
    (canReview && tc.reviewStatus === REVIEW_STATUS.PENDING);
  const selectableVisible = filteredTestCases.filter(isSelectable);
  const selectedCases = testCases.filter((tc) => selectedIds.includes(tc.id));
  const selectedSubmittable = selectedCases.filter((tc) => SUBMITTABLE_REVIEW_STATUSES.includes(tc.reviewStatus));
  const selectedPending = selectedCases.filter((tc) => tc.reviewStatus === REVIEW_STATUS.PENDING);
  const allVisibleSelected = selectableVisible.length > 0 && selectableVisible.every((tc) => selectedIds.includes(tc.id));

  const toggleSelected = (id) =>
    setSelectedIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));
  const toggleAllVisible = () =>
    setSelectedIds(allVisibleSelected ? [] : selectableVisible.map((tc) => tc.id));

  const runReviewAction = async (path, ids, body, successMessage) => {
    setBusy(true);
    setError('');
    try {
      await apiFetch(`/test-cases/${path}`, { method: 'POST', body: JSON.stringify({ ids, ...body }) });
      showToast(successMessage, 'success');
      setSelectedIds([]);
      setRejecting(false);
      setRejectComment('');
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const handleSubmitForReview = () =>
    runReviewAction(
      'submit-for-review',
      selectedSubmittable.map((tc) => tc.id),
      {},
      `${selectedSubmittable.length} test case(s) sent to PM for review`,
    );
  const handleApprove = () =>
    runReviewAction(
      'approve',
      selectedPending.map((tc) => tc.id),
      {},
      `${selectedPending.length} test case(s) approved - Ready for Execution`,
    );
  const handleReject = () =>
    runReviewAction(
      'reject',
      selectedPending.map((tc) => tc.id),
      { comment: rejectComment },
      `${selectedPending.length} test case(s) rejected`,
    );

  const handleExport = async (format) => {
    setError('');
    try {
      const params = new URLSearchParams({ format });
      if (projectFilter) params.set('projectId', projectFilter);
      await apiDownload(`/test-cases/bulk-export?${params.toString()}`, `test-cases.${format}`);
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <AppShell>
      <div className={styles.pageHeader}>
        <div>
          <h1 className={styles.pageTitle}>Test Cases</h1>
          <p className={styles.pageSubtitle}>The QA test case catalog and its run history.</p>
        </div>
        <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
          <button className={styles.buttonSecondary} type="button" onClick={() => handleExport('xlsx')}>
            Export Excel
          </button>
          <button className={styles.buttonSecondary} type="button" onClick={() => handleExport('csv')}>
            Export CSV
          </button>
          {canConfigure && (
            <Link href="/qa/test-cases/fields" className={styles.buttonSecondary}>
              Test Case Fields
            </Link>
          )}
          {canManage && (
            <>
              <Link href="/qa/test-cases/bulk-import" className={styles.buttonSecondary}>
                Bulk Import
              </Link>
              <Link href="/qa/test-cases/new" className={`${styles.button} ${styles.buttonAccent}`}>
                + New Test Case
              </Link>
            </>
          )}
        </div>
      </div>

      {canReview && pendingCount > 0 && reviewFilter !== REVIEW_STATUS.PENDING && (
        <div className={styles.card} role="status" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
          <span>{pendingCount} test case(s) waiting for your review.</span>
          <button className={styles.buttonSecondary} type="button" onClick={() => setReviewFilter(REVIEW_STATUS.PENDING)}>
            Show Pending Review
          </button>
        </div>
      )}

      <div className={styles.card} style={{ display: 'flex', gap: 'var(--space-3)', flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div className={styles.field} style={{ margin: 0, minWidth: 220 }}>
          <label className={styles.label} htmlFor="tcSearch">Search</label>
          <input
            className={styles.input}
            id="tcSearch"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Title or case #..."
          />
        </div>
        <div className={styles.field} style={{ margin: 0, minWidth: 180 }}>
          <label className={styles.label} htmlFor="tcProjectFilter">Project</label>
          <select className={styles.select} id="tcProjectFilter" value={projectFilter} onChange={(e) => setProjectFilter(e.target.value)}>
            <option value="">All projects</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
        <div className={styles.field} style={{ margin: 0, minWidth: 160 }}>
          <label className={styles.label} htmlFor="tcStatusFilter">Status</label>
          <select className={styles.select} id="tcStatusFilter" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">All statuses</option>
            {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div className={styles.field} style={{ margin: 0, minWidth: 180 }}>
          <label className={styles.label} htmlFor="tcReviewFilter">Review Status</label>
          <select className={styles.select} id="tcReviewFilter" value={reviewFilter} onChange={(e) => setReviewFilter(e.target.value)}>
            <option value="">All review statuses</option>
            {REVIEW_STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        {labels.length > 0 && (
          <div className={styles.field} style={{ margin: 0, minWidth: 160 }}>
            <label className={styles.label} htmlFor="tcLabelFilter">Label</label>
            <select className={styles.select} id="tcLabelFilter" value={labelFilter} onChange={(e) => setLabelFilter(e.target.value)}>
              <option value="">All labels</option>
              {labels.map((l) => <option key={l.id} value={l.id}>{l.name}{l.isActive ? '' : ' (inactive)'}</option>)}
            </select>
          </div>
        )}
      </div>

      {selectedIds.length > 0 && (
        <div className={styles.card} role="region" aria-label="Actions for selected test cases">
          <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center', flexWrap: 'wrap' }}>
            <span>{selectedIds.length} selected</span>
            {canManage && selectedSubmittable.length > 0 && (
              <button className={`${styles.button} ${styles.buttonAccent}`} type="button" disabled={busy} onClick={handleSubmitForReview}>
                Submit {selectedSubmittable.length} for PM Review
              </button>
            )}
            {canReview && selectedPending.length > 0 && !rejecting && (
              <>
                <button className={`${styles.button} ${styles.buttonAccent}`} type="button" disabled={busy} onClick={handleApprove}>
                  Approve {selectedPending.length}
                </button>
                <button className={styles.buttonSecondary} type="button" disabled={busy} onClick={() => setRejecting(true)}>
                  Reject {selectedPending.length}
                </button>
              </>
            )}
            <button className={styles.buttonSecondary} type="button" disabled={busy} onClick={() => { setSelectedIds([]); setRejecting(false); }}>
              Clear selection
            </button>
          </div>
          {rejecting && (
            <div style={{ marginTop: 'var(--space-3)' }}>
              <div className={styles.field}>
                <label className={styles.label} htmlFor="bulkRejectComment">Reason for rejection (required)</label>
                <textarea
                  className={styles.textarea}
                  id="bulkRejectComment"
                  value={rejectComment}
                  onChange={(e) => setRejectComment(e.target.value)}
                  placeholder="What should QA fix before resubmitting?"
                />
              </div>
              <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                <button className={styles.button} type="button" disabled={busy || !rejectComment.trim()} onClick={handleReject}>
                  {busy ? 'Working...' : `Confirm Reject (${selectedPending.length})`}
                </button>
                <button className={styles.buttonSecondary} type="button" disabled={busy} onClick={() => setRejecting(false)}>
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {error && <div className={styles.error}>{error}</div>}
      {loading && <div className={styles.empty}>Loading...</div>}

      {!loading && testCases.length === 0 && (
        <div className={styles.card}>
          <div className={styles.empty}>
            No test cases yet.
            {canManage && ' Create one, or bulk import a batch, above.'}
          </div>
        </div>
      )}

      {!loading && testCases.length > 0 && filteredTestCases.length === 0 && (
        <div className={styles.card}>
          <div className={styles.empty}>No test cases match these filters.</div>
        </div>
      )}

      {!loading && filteredTestCases.length > 0 && (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                {(canManage || canReview) && (
                  <th style={{ width: 36 }}>
                    <input
                      type="checkbox"
                      aria-label="Select all actionable test cases shown"
                      checked={allVisibleSelected}
                      disabled={selectableVisible.length === 0}
                      onChange={toggleAllVisible}
                    />
                  </th>
                )}
                <SortableHeader label="Case #" sortKey="caseNumber" sort={sort} onSort={handleSort} />
                <SortableHeader label="Title" sortKey="title" sort={sort} onSort={handleSort} />
                <th>Project</th>
                <th>Module</th>
                <th>Phase</th>
                <th>Priority</th>
                <th>Category</th>
                <th>Labels</th>
                <th>Status</th>
                <th>Review</th>
                <th>Last Result</th>
                <th>Last Run</th>
              </tr>
            </thead>
            <tbody>
              {sortedTestCases.map((tc) => (
                <tr key={tc.id} onClick={() => router.push(`/qa/test-cases/${tc.id}`)} style={{ cursor: 'pointer' }}>
                  {(canManage || canReview) && (
                    <td onClick={(e) => e.stopPropagation()}>
                      {isSelectable(tc) && (
                        <input
                          type="checkbox"
                          aria-label={`Select ${tc.caseNumber || `#${tc.id}`}`}
                          checked={selectedIds.includes(tc.id)}
                          onChange={() => toggleSelected(tc.id)}
                        />
                      )}
                    </td>
                  )}
                  <td className={styles.issueId}>{tc.caseNumber || `#${tc.id}`}</td>
                  <td className={styles.tableTitleCell}>{tc.title}</td>
                  <td>{tc.projectName || '—'}</td>
                  <td>{tc.moduleName || '—'}</td>
                  <td>{tc.phaseName || '—'}</td>
                  <td>{tc.priority || '—'}</td>
                  <td>{tc.category || '—'}</td>
                  <td>
                    {(tc.labelIds || []).length === 0
                      ? '—'
                      : tc.labelIds.map((id) => labelById.get(id)?.name).filter(Boolean).join(', ')}
                  </td>
                  <td>{tc.status}</td>
                  <td><ReviewBadge status={tc.reviewStatus} /></td>
                  <td><ResultBadge result={tc.lastResult} /></td>
                  <td>{formatDate(tc.lastExecutedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </AppShell>
  );
}
