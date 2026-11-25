import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import AppShell from '../../../components/AppShell';
import LoadingState from '../../../components/ui/LoadingState';
import Modal from '../../../components/ui/Modal';
import RequirementPicker from '../../../components/requirements/RequirementPicker';
import styles from '../../../styles/requirements.module.css';
import forms from '../../../styles/issues.module.css';
import { apiFetch } from '../../../lib/api';
import { useToast } from '../../../lib/toast';
import { useConfirm } from '../../../lib/confirm';
import { redirectToSignIn } from '../../../lib/session';
import { formatDateTimeEAT } from '../../../lib/formatDate';
import { STORY_STATUS_LABEL, failReasonError, resultLabel, storyLabel, aOrAn, AT_RISK_REASON_MIN } from '../../../lib/requirementsTree';

// Requirements traceability - User story page (Stage 2, 2026-11-25).
// BA/PM/Admin edit Draft stories (Approved ones: PM/Admin only); PM/Admin
// approve (or "approve at risk" before the client signs) and link tickets;
// QA/PM/Admin record Pass/Fail on Approved stories. The backend checks
// every right; this page only hides what you can't do.

const tone = (t) => (t ? styles[t] : '');

export default function StoryPage() {
  const router = useRouter();
  const { showToast } = useToast();
  const confirmAction = useConfirm();
  const [page, setPage] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [edit, setEdit] = useState(null); // story fields being edited
  const [requirements, setRequirements] = useState(null);
  const [newCriterion, setNewCriterion] = useState('');
  const [editCriterion, setEditCriterion] = useState(null); // { id, text, tested }
  const [failing, setFailing] = useState(null);
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState('');
  const [atRisk, setAtRisk] = useState(null); // reason text
  const [atRiskError, setAtRiskError] = useState('');
  const [trk, setTrk] = useState('');
  const [found, setFound] = useState(null);
  const [kinds, setKinds] = useState(['dev']);
  const [covers, setCovers] = useState([]);
  const [moving, setMoving] = useState(null); // { link, targets, storyId }

  // Stable onClose handlers: the Modal re-runs its focus effect when
  // onClose changes, which would steal focus while typing.
  const closeFail = useCallback(() => setFailing(null), []);
  const closeRisk = useCallback(() => setAtRisk(null), []);
  const closeMove = useCallback(() => setMoving(null), []);

  const id = router.query.id;
  const load = useCallback(
    () =>
      apiFetch(`/requirements/stories/${id}`)
        .then(setPage)
        .catch((err) => setError(err.message)),
    [id],
  );

  useEffect(() => {
    if (!router.isReady) return;
    if (!localStorage.getItem('user')) {
      redirectToSignIn(router);
      return;
    }
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router.isReady, id]);

  const run = async (fn, okMessage) => {
    setBusy(true);
    try {
      const out = await fn();
      if (okMessage) showToast(okMessage, 'success');
      await load();
      return out ?? true;
    } catch (err) {
      showToast(err.message, 'error');
      return false;
    } finally {
      setBusy(false);
    }
  };

  if (error) {
    return (
      <AppShell>
        <div className={forms.error} role="alert">{error}</div>
        <Link href="/requirements" className={forms.backLink}>Back to Requirements</Link>
      </AppShell>
    );
  }
  if (!page) {
    return (
      <AppShell>
        <LoadingState />
      </AppShell>
    );
  }

  const { srs, epic, story: st, permissions: perms } = page;
  const lbl = storyLabel(st);
  const testedIds = new Set(st.history.map((h) => h.criterionId));
  const criterionLabel = (cid) => {
    const c = st.criteria.find((x) => x.id === cid);
    return c ? `AC${c.position}` : null;
  };

  // ---- story edit ----
  const startEdit = async () => {
    setEdit({ title: st.title, asA: st.asA || '', iWant: st.iWant || '', soThat: st.soThat || '', epicId: epic.id, requirementIds: st.requirementDetails.map((r) => r.id) });
    if (!requirements) {
      try {
        setRequirements(await apiFetch(`/requirements/srs/${srs.id}/requirements`));
      } catch (err) {
        showToast(err.message, 'error');
      }
    }
  };
  const saveEdit = async (e) => {
    e.preventDefault();
    if (!edit.title.trim()) return showToast('The story needs a title.', 'error');
    if (await run(() => apiFetch(`/requirements/stories/${st.id}`, { method: 'PATCH', body: JSON.stringify(edit) }), 'Story saved')) setEdit(null);
  };
  const deleteStory = async () => {
    const ok = await confirmAction({ title: `Delete ${st.code}?`, message: 'It is kept in the history and its code is not reused. Stories with linked tickets or Pass/Fail results cannot be deleted.', confirmLabel: 'Delete story', danger: true });
    if (!ok) return;
    if (await run(() => apiFetch(`/requirements/stories/${st.id}`, { method: 'DELETE' }), `${st.code} deleted`)) router.push(`/requirements?srs=${srs.id}`);
  };

  // ---- approval ----
  const approve = async () => {
    const ok = await confirmAction({ title: `Approve ${st.code}?`, message: 'QA can then record Pass/Fail and tickets can be linked. After approval only a Program Manager or Admin can edit it.', confirmLabel: 'Approve' });
    if (ok) await run(() => apiFetch(`/requirements/stories/${st.id}/approve`, { method: 'POST' }), `${st.code} approved`);
  };
  const submitAtRisk = async (e) => {
    e.preventDefault();
    if (atRisk.trim().length < AT_RISK_REASON_MIN) return setAtRiskError(`Please give a reason (at least ${AT_RISK_REASON_MIN} characters).`);
    if (await run(() => apiFetch(`/requirements/stories/${st.id}/approve-at-risk`, { method: 'POST', body: JSON.stringify({ reason: atRisk.trim() }) }), `${st.code} approved at risk`)) setAtRisk(null);
  };

  // ---- criteria ----
  const addCriterion = async (e) => {
    e.preventDefault();
    if (!newCriterion.trim()) return;
    if (await run(() => apiFetch(`/requirements/stories/${st.id}/criteria`, { method: 'POST', body: JSON.stringify({ text: newCriterion }) }), 'Criterion added')) setNewCriterion('');
  };
  const saveCriterion = async (e) => {
    e.preventDefault();
    if (!editCriterion.text.trim()) return;
    const out = await run(() => apiFetch(`/requirements/criteria/${editCriterion.id}`, { method: 'PATCH', body: JSON.stringify({ text: editCriterion.text }) }));
    if (out) {
      showToast(out.reset ? 'Criterion changed - its result is back to Not run' : 'Criterion saved', 'success');
      setEditCriterion(null);
    }
  };
  const deleteCriterion = async (c) => {
    const ok = await confirmAction({ title: `Delete AC${c.position}?`, message: c.text, confirmLabel: 'Delete', danger: true });
    if (ok) await run(() => apiFetch(`/requirements/criteria/${c.id}`, { method: 'DELETE' }), `AC${c.position} deleted`);
  };
  const moveCriterion = (index, delta) => {
    const ids = st.criteria.map((c) => c.id);
    const j = index + delta;
    if (j < 0 || j >= ids.length) return;
    [ids[index], ids[j]] = [ids[j], ids[index]];
    run(() => apiFetch(`/requirements/stories/${st.id}/criteria/order`, { method: 'PUT', body: JSON.stringify({ criterionIds: ids }) }), 'Order saved');
  };
  const pass = (c) => run(() => apiFetch(`/requirements/criteria/${c.id}/result`, { method: 'PUT', body: JSON.stringify({ result: 'pass' }) }), `AC${c.position} passed`);
  const submitFail = async (e) => {
    e.preventDefault();
    const problem = failReasonError(reason);
    setReasonError(problem);
    if (problem) return;
    if (await run(() => apiFetch(`/requirements/criteria/${failing.id}/result`, { method: 'PUT', body: JSON.stringify({ result: 'fail', note: reason.trim() }) }), `AC${failing.position} failed`)) setFailing(null);
  };

  // ---- tickets ----
  const lookup = async (e) => {
    e.preventDefault();
    setFound(null);
    try {
      setFound(await apiFetch(`/requirements/stories/${st.id}/ticket-lookup?trk=${encodeURIComponent(trk)}`));
      setCovers([]);
    } catch (err) {
      showToast(err.message, 'error');
    }
  };
  const link = async () => {
    if (!kinds.length) return showToast('Choose Dev, QA or both.', 'error');
    const ok = await run(() => apiFetch(`/requirements/stories/${st.id}/tickets`, { method: 'POST', body: JSON.stringify({ taskId: found.taskId, kinds, criterionIds: covers }) }), `${found.trk} linked to ${st.code}`);
    if (ok) {
      setFound(null);
      setTrk('');
    }
  };
  const unlink = async (t) => {
    const ok = await confirmAction({ title: `Unlink ${t.trk} (${t.kind.toUpperCase()})?`, message: 'The ticket itself does not change.', confirmLabel: 'Unlink' });
    if (ok) await run(() => apiFetch(`/requirements/story-tickets/${t.linkId}`, { method: 'DELETE' }), `${t.trk} unlinked`);
  };
  const startMove = async (t) => {
    try {
      const tree = await apiFetch(`/requirements/srs/${srs.id}/tree`);
      const targets = tree.epics.flatMap((e) => e.stories).filter((s) => s.id !== st.id && s.canLinkTickets);
      setMoving({ link: t, targets, storyId: targets[0]?.id ?? '' });
    } catch (err) {
      showToast(err.message, 'error');
    }
  };
  const submitMove = async (e) => {
    e.preventDefault();
    if (!moving.storyId) return;
    if (await run(() => apiFetch(`/requirements/story-tickets/${moving.link.linkId}/move`, { method: 'POST', body: JSON.stringify({ storyId: Number(moving.storyId) }) }), `${moving.link.trk} moved`)) setMoving(null);
  };
  const toggleIn = (list, set, v) => set(list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  return (
    <AppShell>
      <div className={styles.crumb}>
        <Link href={`/requirements?srs=${srs.id}`}>
          {srs.name} v{srs.version}
        </Link>{' '}
        › {epic.code} {epic.name} › {st.code}
      </div>
      <div className={styles.headerRow}>
        <div>
          <h1 className={styles.title}>
            {st.code} {st.title}
          </h1>
          <p className={styles.subtitle}>
            Epic {epic.code} {epic.name}
            {epic.srsSection ? ` (${epic.srsSection})` : ''} · {st.percent}% complete
            {st.createdBy ? ` · Created by ${st.createdBy}` : ''}
            {st.approvedBy ? ` · Approved by ${st.approvedBy}, ${formatDateTimeEAT(st.approvedAt)}` : ''}
          </p>
        </div>
        <span className={`${styles.pill} ${tone(lbl.tone)}`}>
          {STORY_STATUS_LABEL[st.status]} · {lbl.text}
        </span>
      </div>

      {st.atRisk && (
        <div className={`${styles.card} ${styles.signoff}`} role="status">
          <span>
            <b className={styles.warn}>At risk:</b> approved before the client signed off{st.atRiskBy ? ` (${st.atRiskBy}, ${formatDateTimeEAT(st.atRiskAt)})` : ''}. Reason: {st.atRiskReason}
          </span>
        </div>
      )}
      {(st.clientItems.length > 0 || st.blockedBy.length > 0 || st.dependsOn.length > 0) && (
        <div className={`${styles.card} ${styles.panel}`}>
          {st.clientItems.map((c) => (
            <p key={c.id} className={styles.late} style={{ margin: '0 0 6px' }}>
              <b>Blocked:</b> waiting on client item {c.number}: {c.question}
            </p>
          ))}
          {st.blockedBy.map((b, i) => (
            <p key={`b${i}`} className={styles.late} style={{ margin: '0 0 6px' }}>
              <b>Blocked ({b.trk}):</b> {b.reason}
            </p>
          ))}
          {st.dependsOn.map((d, i) => (
            <p key={`d${i}`} className={styles.warn} style={{ margin: '0 0 6px' }}>
              <b>Depends on ({d.trk}):</b> {d.title}
            </p>
          ))}
        </div>
      )}

      {edit ? (
        <form className={`${styles.card} ${styles.panel}`} onSubmit={saveEdit} noValidate>
          <h2 className={styles.panelTitle}>Edit {st.code}</h2>
          <div className={forms.field}>
            <label className={forms.label} htmlFor="ed-title">Title</label>
            <input id="ed-title" className={forms.input} value={edit.title} maxLength={255} onChange={(e) => setEdit({ ...edit, title: e.target.value })} />
          </div>
          {[
            ['asA', 'As a'],
            ['iWant', 'I want'],
            ['soThat', 'So that'],
          ].map(([k, label]) => (
            <div className={forms.field} key={k}>
              <label className={forms.label} htmlFor={`ed-${k}`}>{label}</label>
              <input id={`ed-${k}`} className={forms.input} value={edit[k]} onChange={(e) => setEdit({ ...edit, [k]: e.target.value })} />
            </div>
          ))}
          <div className={forms.field}>
            <label className={forms.label} htmlFor="ed-epic">Epic</label>
            <select id="ed-epic" className={forms.select} value={edit.epicId} onChange={(e) => setEdit({ ...edit, epicId: Number(e.target.value) })}>
              {page.epics.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.code} {e.name}
                </option>
              ))}
            </select>
          </div>
          {requirements ? <RequirementPicker requirements={requirements} value={edit.requirementIds} onChange={(ids) => setEdit({ ...edit, requirementIds: ids })} idPrefix="ed-req" /> : <LoadingState />}
          <div className={styles.actionsRow}>
            <button type="submit" className={forms.button} disabled={busy}>
              Save
            </button>
            <button type="button" className={forms.buttonSecondary} onClick={() => setEdit(null)}>
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <>
          <p className={styles.userStory}>
            <b>As {aOrAn(st.asA)}</b> {st.asA || '…'}, <b>I want</b> {st.iWant || '…'}, <b>so that</b> {st.soThat || '…'}.
          </p>
          <div className={styles.actionsRow} style={{ marginTop: 0, marginBottom: 'var(--ds-space-4)' }}>
            {perms.canApprove &&
              (perms.approveNeedsRisk ? (
                <button
                  type="button"
                  className={forms.button}
                  disabled={busy}
                  onClick={() => {
                    setAtRiskError('');
                    setAtRisk('');
                  }}
                >
                  Approve at risk
                </button>
              ) : (
                <button type="button" className={forms.button} disabled={busy} onClick={approve}>
                  Approve
                </button>
              ))}
            {perms.canEdit && (
              <button type="button" className={forms.buttonSecondary} disabled={busy} onClick={startEdit}>
                Edit story
              </button>
            )}
            {perms.canEdit && (
              <button type="button" className={styles.textButton} disabled={busy} onClick={deleteStory}>
                Delete story
              </button>
            )}
            {perms.canApprove && perms.approveNeedsRisk && <span className={forms.helpText}>The SRS is not signed off by the client yet, so approval needs a reason.</span>}
          </div>
        </>
      )}

      <div className={styles.grid2}>
        <section className={`${styles.card} ${styles.panel}`} aria-labelledby="ac-title">
          <h2 id="ac-title" className={styles.panelTitle}>
            <span>Acceptance criteria</span>
            <span className={styles.muted}>
              {st.passed} of {st.total} passed
            </span>
          </h2>
          {!st.canRecordResults && perms.canRecordResults && st.status === 'draft' && <p className={forms.helpText}>Pass/Fail opens once the story is approved.</p>}
          <ol className={styles.acList}>
            {st.criteria.map((c, i) => {
              const r = resultLabel(c.result);
              return (
                <li key={c.id}>
                  <span className={styles.acNum}>AC{c.position}</span>
                  <span>
                    {editCriterion?.id === c.id ? (
                      <form onSubmit={saveCriterion} noValidate>
                        <label className={forms.label} htmlFor={`ac-edit-${c.id}`}>
                          Text of AC{c.position}
                        </label>
                        <textarea id={`ac-edit-${c.id}`} className={forms.textarea} value={editCriterion.text} onChange={(e) => setEditCriterion({ ...editCriterion, text: e.target.value })} />
                        {editCriterion.tested && <p className={forms.helpText}>This criterion has been tested. Changing its text sets it back to Not run (the old result stays in the history).</p>}
                        <div className={styles.inlineForm}>
                          <button type="submit" className={forms.button} disabled={busy}>
                            Save
                          </button>
                          <button type="button" className={forms.buttonSecondary} onClick={() => setEditCriterion(null)}>
                            Cancel
                          </button>
                        </div>
                      </form>
                    ) : (
                      c.text
                    )}
                    {c.result === 'fail' && c.note && <span className={`${styles.note} ${styles.late}`}>QA: {c.note}</span>}
                    {c.beforeApproval && <span className={styles.note}>Recorded before approval</span>}
                    {perms.canEdit && editCriterion?.id !== c.id && (
                      <span className={styles.note}>
                        <button type="button" className={styles.inlineLink} style={{ marginLeft: 0 }} onClick={() => setEditCriterion({ id: c.id, text: c.text, tested: c.result !== 'not_run' || testedIds.has(c.id) })}>
                          Edit
                        </button>
                        <button type="button" className={styles.inlineLink} disabled={busy || i === 0} onClick={() => moveCriterion(i, -1)} aria-label={`Move AC${c.position} up`}>
                          Up
                        </button>
                        <button type="button" className={styles.inlineLink} disabled={busy || i === st.criteria.length - 1} onClick={() => moveCriterion(i, 1)} aria-label={`Move AC${c.position} down`}>
                          Down
                        </button>
                        {!testedIds.has(c.id) && (
                          <button type="button" className={styles.inlineLink} onClick={() => deleteCriterion(c)}>
                            Delete
                          </button>
                        )}
                      </span>
                    )}
                  </span>
                  <span className={styles.acRes}>
                    <span className={`${styles.pill} ${tone(r.tone)}`}>{r.text}</span>
                    {st.canRecordResults && (
                      <span className={styles.resultActions}>
                        <button type="button" disabled={busy || c.result === 'pass'} onClick={() => pass(c)} aria-label={`Pass AC${c.position}`}>
                          Pass
                        </button>
                        <button
                          type="button"
                          className={styles.failButton}
                          disabled={busy}
                          onClick={() => {
                            setReason('');
                            setReasonError('');
                            setFailing(c);
                          }}
                          aria-label={`Fail AC${c.position}`}
                        >
                          Fail
                        </button>
                      </span>
                    )}
                  </span>
                </li>
              );
            })}
          </ol>
          {!st.criteria.length && <p className={styles.muted}>No acceptance criteria yet.</p>}
          {perms.canEdit && (
            <form className={styles.inlineForm} onSubmit={addCriterion} noValidate>
              <div style={{ flex: 1, minWidth: 220 }}>
                <label className={forms.label} htmlFor="ac-new">
                  Add a criterion
                </label>
                <input id="ac-new" className={forms.input} value={newCriterion} onChange={(e) => setNewCriterion(e.target.value)} placeholder="What must be true for this story to be done" />
              </div>
              <button type="submit" className={forms.buttonSecondary} disabled={busy || !newCriterion.trim()}>
                Add
              </button>
            </form>
          )}
        </section>

        <div>
          <section className={`${styles.card} ${styles.panel}`} aria-labelledby="req-title">
            <h2 id="req-title" className={styles.panelTitle}>
              Traces to SRS
            </h2>
            <ul className={styles.plainList}>
              {st.requirementDetails.map((r) => (
                <li key={r.id}>
                  <b>{r.code}</b> {r.text}
                  <span className={styles.note}>Priority: {r.priority[0].toUpperCase() + r.priority.slice(1)}</span>
                </li>
              ))}
              {!st.requirementDetails.length && <li className={styles.muted}>Not traced to any requirement yet.</li>}
            </ul>
          </section>

          <section className={`${styles.card} ${styles.panel}`} aria-labelledby="tk-title">
            <h2 id="tk-title" className={styles.panelTitle}>
              Development and QA tickets
            </h2>
            <ul className={styles.plainList}>
              {st.tickets.map((t) => (
                <li key={t.linkId}>
                  <a href={`/tasks/${t.taskId}`}>{t.trk}</a> {t.title}
                  <span className={styles.note}>
                    {t.kind === 'qa' ? 'QA' : 'Dev'} · {t.status}
                    {t.assignee ? ` · ${t.assignee}` : ''}
                    {t.criterionIds.length > 0 && ` · covers ${t.criterionIds.map(criterionLabel).filter(Boolean).join(', ')}`}
                  </span>
                  {perms.canLinkTickets && (
                    <span className={styles.note}>
                      <button type="button" className={styles.inlineLink} style={{ marginLeft: 0 }} onClick={() => startMove(t)}>
                        Move to another story
                      </button>
                      <button type="button" className={styles.inlineLink} onClick={() => unlink(t)}>
                        Unlink
                      </button>
                    </span>
                  )}
                </li>
              ))}
              {!st.tickets.length && <li className={styles.muted}>No tickets linked yet.</li>}
            </ul>
            {perms.canLinkTickets && !st.canLinkTickets && <p className={forms.helpText}>Tickets can be linked once the story is approved.</p>}
            {st.canLinkTickets && (
              <>
                <form className={styles.inlineForm} onSubmit={lookup} noValidate>
                  <div style={{ flex: 1, minWidth: 160 }}>
                    <label className={forms.label} htmlFor="trk">
                      Link a ticket
                    </label>
                    <input id="trk" className={forms.input} value={trk} onChange={(e) => setTrk(e.target.value)} placeholder="TRK number, e.g. TRK-412" />
                  </div>
                  <button type="submit" className={forms.buttonSecondary} disabled={!trk.trim()}>
                    Find
                  </button>
                </form>
                {found && (
                  <div className={styles.panel} style={{ paddingLeft: 0, paddingRight: 0 }}>
                    <p style={{ margin: '0 0 8px' }}>
                      <b>{found.trk}</b> {found.title}
                      <span className={styles.note}>
                        {found.status}
                        {found.assignee ? ` · ${found.assignee}` : ''}
                        {found.links.length > 0 && ` · already linked: ${found.links.map((l) => `${l.code} (${l.kind.toUpperCase()})`).join(', ')}`}
                      </span>
                    </p>
                    <fieldset style={{ border: 0, padding: 0, margin: '0 0 8px' }}>
                      <legend className={forms.label}>Link as</legend>
                      {['dev', 'qa'].map((k) => (
                        <label key={k} className={styles.checkRow}>
                          <input type="checkbox" checked={kinds.includes(k)} onChange={() => toggleIn(kinds, setKinds, k)} /> {k === 'dev' ? 'Dev' : 'QA'}
                        </label>
                      ))}
                    </fieldset>
                    {st.criteria.length > 0 && (
                      <fieldset style={{ border: 0, padding: 0, margin: '0 0 8px' }}>
                        <legend className={forms.label}>Criteria it covers (optional)</legend>
                        {st.criteria.map((c) => (
                          <label key={c.id} className={styles.checkRow}>
                            <input type="checkbox" checked={covers.includes(c.id)} onChange={() => toggleIn(covers, setCovers, c.id)} /> AC{c.position}
                          </label>
                        ))}
                      </fieldset>
                    )}
                    <button type="button" className={forms.button} disabled={busy} onClick={link}>
                      Link {found.trk}
                    </button>
                  </div>
                )}
              </>
            )}
          </section>

          {st.history.length > 0 && (
            <section className={`${styles.card} ${styles.panel}`} aria-labelledby="hist-title">
              <h2 id="hist-title" className={styles.panelTitle}>
                Pass/Fail history
              </h2>
              <ul className={styles.plainList}>
                {st.history.map((h, i) => (
                  <li key={i}>
                    <span className={tone(resultLabel(h.result).tone)}>{resultLabel(h.result).text}</span> {criterionLabel(h.criterionId) || 'Removed criterion'}
                    <span className={styles.note}>
                      {h.by || 'Unknown'} · {formatDateTimeEAT(h.recordedAt)}
                      {h.beforeApproval ? ' · before approval' : ''}
                      {h.note ? ` · ${h.note}` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </div>

      <Modal open={!!failing} onClose={closeFail} title={failing ? `AC${failing.position} failed: reason required` : ''}>
        {failing && (
          <form onSubmit={submitFail} noValidate>
            <p className={styles.criterionQuote}>{failing.text}</p>
            <div className={styles.field}>
              <label htmlFor="fail-reason">What failed?</label>
              <textarea id="fail-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Steps, expected and actual result" aria-invalid={!!reasonError} maxLength={2000} />
              {reasonError && <div className={styles.fieldError} role="alert">{reasonError}</div>}
            </div>
            <div className={styles.actionsRow}>
              <button type="submit" className={forms.button} disabled={busy}>
                Save
              </button>
              <button type="button" className={forms.buttonSecondary} onClick={() => setFailing(null)}>
                Cancel
              </button>
            </div>
          </form>
        )}
      </Modal>

      <Modal open={atRisk !== null} onClose={closeRisk} title={`Approve ${st.code} at risk`}>
        {atRisk !== null && (
          <form onSubmit={submitAtRisk} noValidate>
            <p className={forms.helpText}>The SRS is not signed off by the client yet. The story will show "At risk" until the client signs.</p>
            <div className={styles.field}>
              <label htmlFor="risk-reason">Why approve now?</label>
              <textarea id="risk-reason" value={atRisk} onChange={(e) => setAtRisk(e.target.value)} aria-invalid={!!atRiskError} maxLength={5000} />
              {atRiskError && <div className={styles.fieldError} role="alert">{atRiskError}</div>}
            </div>
            <div className={styles.actionsRow}>
              <button type="submit" className={forms.button} disabled={busy}>
                Approve at risk
              </button>
              <button type="button" className={forms.buttonSecondary} onClick={() => setAtRisk(null)}>
                Cancel
              </button>
            </div>
          </form>
        )}
      </Modal>

      <Modal open={!!moving} onClose={closeMove} title={moving ? `Move ${moving.link.trk} (${moving.link.kind.toUpperCase()})` : ''}>
        {moving && (
          <form onSubmit={submitMove} noValidate>
            {moving.targets.length ? (
              <div className={forms.field}>
                <label className={forms.label} htmlFor="move-to">
                  To story
                </label>
                <select id="move-to" className={forms.select} value={moving.storyId} onChange={(e) => setMoving({ ...moving, storyId: e.target.value })}>
                  {moving.targets.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.code} {s.title}
                    </option>
                  ))}
                </select>
                <p className={forms.helpText}>The criteria it covered belong to this story, so they are dropped. The ticket itself does not change.</p>
              </div>
            ) : (
              <p className={styles.muted}>No other approved story to move it to.</p>
            )}
            <div className={styles.actionsRow}>
              <button type="submit" className={forms.button} disabled={busy || !moving.targets.length}>
                Move
              </button>
              <button type="button" className={forms.buttonSecondary} onClick={() => setMoving(null)}>
                Cancel
              </button>
            </div>
          </form>
        )}
      </Modal>
    </AppShell>
  );
}
