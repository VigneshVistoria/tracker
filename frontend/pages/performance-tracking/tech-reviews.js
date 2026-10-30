import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import AppShell from '../../components/AppShell';
import LoadingState from '../../components/ui/LoadingState';
import Modal from '../../components/ui/Modal';
import Badge from '../../components/ui/Badge';
import styles from '../../styles/issues.module.css';
import { apiFetch } from '../../lib/api';
import { useToast } from '../../lib/toast';
import { redirectToSignIn } from '../../lib/session';
import { formatDate, formatDateTime } from '../../lib/formatDate';

const thisMonth = () => new Date().toISOString().slice(0, 7);
const emptyDraft = (criteria) => ({ revieweeUserId: '', projectId: '', itemTitle: '', taskId: '', itemLink: '', comment: '', scores: Object.fromEntries(criteria.map((c) => [c, ''])) });

// Technical Review (Performance Tracking Q5, 2026-10-30). The named
// reviewers (Technical Director by default - Performance Tracking
// Settings) score items of work on a 1-5 rubric, a set number per person
// per month (default 2), and keep an evidence log on each review. PM,
// Executive and Admin see everyone; developers see their own. Rules:
// backend/src/tech-reviews/tech-reviews.ts.
export default function TechReviewsPage() {
  const router = useRouter();
  const { showToast } = useToast();
  const [month, setMonth] = useState(thisMonth());
  const [page, setPage] = useState(null);
  const [error, setError] = useState('');
  const [dialog, setDialog] = useState(null);
  const [draft, setDraft] = useState(null);
  const [evidence, setEvidence] = useState({ note: '', link: '' });
  const [busy, setBusy] = useState(false);

  const load = (m = month) =>
    apiFetch(`/tech-reviews?month=${m}`)
      .then((p) => {
        setPage(p);
        setError('');
      })
      .catch((err) => setError(err.message));

  useEffect(() => {
    if (!localStorage.getItem('user')) {
      redirectToSignIn(router);
      return;
    }
    load(month);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router, month]);

  const openNew = (userId = '') => {
    setError('');
    setDraft({ ...emptyDraft(page.criteria), revieweeUserId: userId ? String(userId) : '', projectId: page.projects.length === 1 ? String(page.projects[0].id) : '' });
    setDialog({ type: 'edit', review: null });
  };
  const openEdit = (r) => {
    setError('');
    setDraft({
      revieweeUserId: String(r.revieweeUserId),
      projectId: String(r.projectId),
      itemTitle: r.itemTitle,
      taskId: r.taskId ? String(r.taskId) : '',
      itemLink: r.itemLink || '',
      comment: r.comment || '',
      scores: Object.fromEntries(page.criteria.map((c) => [c, r.scores[c] ? String(r.scores[c]) : ''])),
    });
    setDialog({ type: 'edit', review: r });
  };

  const save = async (e) => {
    e.preventDefault();
    const missing = page.criteria.filter((c) => !draft.scores[c]);
    if (!draft.revieweeUserId || !draft.itemTitle.trim() || missing.length) {
      setError(missing.length ? `Score every item of the rubric (missing: ${missing.join(', ')}).` : 'Pick the person and name the item reviewed.');
      return;
    }
    if (!dialog.review && !draft.taskId.trim() && !draft.projectId) {
      setError('Pick the project, or give a task number.');
      return;
    }
    const body = {
      itemTitle: draft.itemTitle.trim(),
      taskId: draft.taskId.trim() ? Number(draft.taskId.replace('#', '')) : null,
      itemLink: draft.itemLink.trim() || null,
      comment: draft.comment.trim() || null,
      scores: Object.fromEntries(page.criteria.map((c) => [c, Number(draft.scores[c])])),
    };
    setBusy(true);
    try {
      if (dialog.review) await apiFetch(`/tech-reviews/${dialog.review.id}`, { method: 'PATCH', body: JSON.stringify(body) });
      else
        await apiFetch('/tech-reviews', {
          method: 'POST',
          body: JSON.stringify({ ...body, revieweeUserId: Number(draft.revieweeUserId), month, ...(draft.projectId ? { projectId: Number(draft.projectId) } : {}) }),
        });
      showToast(dialog.review ? 'Review updated' : 'Review saved', 'success');
      setDialog(null);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const addEvidence = async (e) => {
    e.preventDefault();
    if (!evidence.note.trim()) {
      setError('Write what the evidence shows.');
      return;
    }
    setBusy(true);
    try {
      await apiFetch(`/tech-reviews/${dialog.review.id}/evidence`, { method: 'POST', body: JSON.stringify({ note: evidence.note.trim(), link: evidence.link.trim() || undefined }) });
      setEvidence({ note: '', link: '' });
      showToast('Evidence added', 'success');
      const next = await apiFetch(`/tech-reviews?month=${month}`);
      setPage(next);
      setDialog({ type: 'evidence', review: next.reviews.find((r) => r.id === dialog.review.id) });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AppShell>
      <div className={styles.pageHeader}>
        <div>
          <h1 className={styles.pageTitle}>Technical Review</h1>
          <p className={styles.pageSubtitle}>
            Items of work scored 1-5 on the rubric by the Technical Director or architect
            {page ? `, ${page.required} per person per month` : ''}. Each review keeps an evidence log.
          </p>
        </div>
        <div className={styles.actions}>
          <label className={styles.label} htmlFor="trMonth" style={{ margin: 0 }}>Month</label>
          <input id="trMonth" type="month" className={styles.input} value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} />
          {page?.canReview && (
            <button className={`${styles.button} ${styles.buttonAccent}`} type="button" onClick={() => openNew()}>
              New review
            </button>
          )}
        </div>
      </div>

      {error && <div className={styles.error} role="alert">{error}</div>}
      {!page && !error && <LoadingState />}

      {page && (
        <>
          {page.people.length > 0 && (
            <div className={styles.card} style={{ marginBottom: 'var(--space-4)' }}>
              <h2 className={styles.cardTitle}>Coverage for {month}</h2>
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>Person</th>
                      <th>Reviews</th>
                      <th>Average</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {page.people.map((p) => (
                      <tr key={p.userId}>
                        <td>{p.name}</td>
                        <td>
                          {p.count} of {page.required}{' '}
                          {p.count >= page.required ? <Badge tone="success">Done</Badge> : <Badge tone="warning">{page.required - p.count} to do</Badge>}
                        </td>
                        <td>{p.average ?? '—'}</td>
                        <td>
                          {page.canReview && p.count < page.required && (
                            <button className={styles.buttonSecondary} type="button" onClick={() => openNew(p.userId)}>
                              Review
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className={styles.card}>
            <h2 className={styles.cardTitle}>Reviews</h2>
            {page.reviews.length === 0 ? (
              <p style={{ margin: 0 }}>No reviews for {month}.</p>
            ) : (
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>Person</th>
                      <th>Item</th>
                      {page.criteria.map((c) => (
                        <th key={c}>{c}</th>
                      ))}
                      <th>Average</th>
                      <th>Reviewer</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {page.reviews.map((r) => (
                      <tr key={r.id}>
                        <td>{r.revieweeName}</td>
                        <td>
                          {r.itemTitle}
                          {r.taskId && (
                            <>
                              {' '}
                              (<Link href={`/tasks/${r.taskId}`}>#{r.taskId}</Link>)
                            </>
                          )}
                          {r.itemLink && (
                            <>
                              {' '}
                              <a href={r.itemLink} target="_blank" rel="noreferrer">link</a>
                            </>
                          )}
                        </td>
                        {page.criteria.map((c) => (
                          <td key={c}>{r.scores[c] ?? '—'}</td>
                        ))}
                        <td>
                          <strong>{r.average}</strong>
                        </td>
                        <td>
                          {r.reviewerName}
                          <div className={styles.issueMeta}>{formatDate(r.reviewedAt)}</div>
                        </td>
                        <td>
                          <div className={styles.actions} style={{ margin: 0 }}>
                            <button className={styles.buttonSecondary} type="button" onClick={() => setDialog({ type: 'evidence', review: r })}>
                              Evidence ({r.evidence.length})
                            </button>
                            {r.canEdit && (
                              <button className={styles.buttonSecondary} type="button" onClick={() => openEdit(r)}>
                                Edit
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {dialog?.type === 'edit' && draft && (
        <Modal title={dialog.review ? 'Edit review' : `New review for ${month}`} onClose={() => setDialog(null)}>
          <form onSubmit={save}>
            {!dialog.review && (
              <div className={styles.field}>
                <label className={styles.label} htmlFor="trPerson">Person</label>
                <select id="trPerson" className={styles.input} value={draft.revieweeUserId} onChange={(e) => setDraft({ ...draft, revieweeUserId: e.target.value })}>
                  <option value="">Pick...</option>
                  {page.people.map((p) => (
                    <option key={p.userId} value={p.userId}>{p.name}</option>
                  ))}
                </select>
              </div>
            )}
            {!dialog.review && (
              <div className={styles.fieldNarrow}>
                <label className={styles.label} htmlFor="trProject">Project (the task&apos;s, if a task is given)</label>
                <select id="trProject" className={styles.input} value={draft.projectId} onChange={(e) => setDraft({ ...draft, projectId: e.target.value })}>
                  <option value="">Pick...</option>
                  {page.projects.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>
            )}
            <div className={styles.field}>
              <label className={styles.label} htmlFor="trItem">Item reviewed</label>
              <input id="trItem" className={styles.input} maxLength={200} value={draft.itemTitle} onChange={(e) => setDraft({ ...draft, itemTitle: e.target.value })} />
            </div>
            <div className={styles.fieldNarrow}>
              <label className={styles.label} htmlFor="trTask">Task # (optional)</label>
              <input id="trTask" className={styles.input} inputMode="numeric" maxLength={10} value={draft.taskId} onChange={(e) => setDraft({ ...draft, taskId: e.target.value })} />
            </div>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="trLink">Link, e.g. pull request (optional)</label>
              <input id="trLink" className={styles.input} maxLength={500} value={draft.itemLink} onChange={(e) => setDraft({ ...draft, itemLink: e.target.value })} />
            </div>
            <fieldset className={styles.field} style={{ border: 0, padding: 0 }}>
              <legend className={styles.label}>Rubric (1 = poor, 5 = excellent)</legend>
              {page.criteria.map((c) => (
                <div key={c} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: 'var(--space-1)' }}>
                  <span style={{ minWidth: '12rem' }}>{c}</span>
                  {[1, 2, 3, 4, 5].map((n) => (
                    <label key={n} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
                      <input type="radio" name={`score-${c}`} value={n} checked={draft.scores[c] === String(n)} onChange={() => setDraft({ ...draft, scores: { ...draft.scores, [c]: String(n) } })} />
                      {n}
                    </label>
                  ))}
                </div>
              ))}
            </fieldset>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="trComment">Comment (optional)</label>
              <textarea id="trComment" className={styles.textarea} rows={3} maxLength={4000} value={draft.comment} onChange={(e) => setDraft({ ...draft, comment: e.target.value })} />
            </div>
            {error && <div className={styles.error} role="alert">{error}</div>}
            <div className={styles.actions}>
              <button className={`${styles.button} ${styles.buttonAccent}`} type="submit" disabled={busy}>
                {busy ? 'Saving...' : 'Save'}
              </button>
              <button className={styles.buttonSecondary} type="button" onClick={() => setDialog(null)} disabled={busy}>
                Cancel
              </button>
            </div>
          </form>
        </Modal>
      )}

      {dialog?.type === 'evidence' && (
        <Modal title={`Evidence: ${dialog.review.itemTitle}`} onClose={() => setDialog(null)}>
          {dialog.review.comment && <p style={{ whiteSpace: 'pre-wrap' }}>{dialog.review.comment}</p>}
          {dialog.review.evidence.length === 0 ? (
            <p>No evidence logged yet.</p>
          ) : (
            <ul>
              {dialog.review.evidence.map((ev) => (
                <li key={ev.id} style={{ marginBottom: 'var(--space-2)' }}>
                  <span style={{ whiteSpace: 'pre-wrap' }}>{ev.note}</span>
                  {ev.link && (
                    <>
                      {' '}
                      <a href={ev.link} target="_blank" rel="noreferrer">link</a>
                    </>
                  )}
                  <div className={styles.issueMeta}>
                    {ev.addedByName}, {formatDateTime(ev.createdAt)}
                  </div>
                </li>
              ))}
            </ul>
          )}
          {dialog.review.canAddEvidence && (
            <form onSubmit={addEvidence}>
              <div className={styles.field}>
                <label className={styles.label} htmlFor="evNote">Add evidence</label>
                <textarea id="evNote" className={styles.textarea} rows={2} maxLength={2000} value={evidence.note} onChange={(e) => setEvidence({ ...evidence, note: e.target.value })} />
              </div>
              <div className={styles.field}>
                <label className={styles.label} htmlFor="evLink">Link (optional)</label>
                <input id="evLink" className={styles.input} maxLength={500} value={evidence.link} onChange={(e) => setEvidence({ ...evidence, link: e.target.value })} />
              </div>
              {error && <div className={styles.error} role="alert">{error}</div>}
              <div className={styles.actions}>
                <button className={`${styles.button} ${styles.buttonAccent}`} type="submit" disabled={busy}>
                  {busy ? 'Adding...' : 'Add to log'}
                </button>
              </div>
            </form>
          )}
        </Modal>
      )}
    </AppShell>
  );
}
