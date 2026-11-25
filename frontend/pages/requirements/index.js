import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import AppShell from '../../components/AppShell';
import LoadingState from '../../components/ui/LoadingState';
import Modal from '../../components/ui/Modal';
import RequirementsTabs from '../../components/requirements/RequirementsTabs';
import RequirementPicker from '../../components/requirements/RequirementPicker';
import styles from '../../styles/requirements.module.css';
import forms from '../../styles/issues.module.css';
import { apiDownload, apiFetch, apiUpload } from '../../lib/api';
import { useToast } from '../../lib/toast';
import { useConfirm } from '../../lib/confirm';
import { useRequirementsSrs } from '../../lib/useRequirementsSrs';
import { SRS_STATUS_LABEL, STORY_STATUS_LABEL, dmy, failReasonError, plural, resultLabel, searchTree, storyLabel, todayIso } from '../../lib/requirementsTree';

// Requirements traceability - Tree view. Stage 1 (2026-11-25): SRS -> Epic
// -> User story -> Acceptance criteria -> linked Dev/QA tickets, progress
// from criteria passed, Pass/Fail. Stage 2: add/edit epics and stories
// (BA/PM/Admin), client sign-off (PM), At risk and client-item flags, and
// Pass/Fail only on Approved stories. The backend checks every right.

const Bar = ({ percent }) => (
  <>
    <span className={styles.bar} aria-hidden="true">
      <i style={{ width: `${percent}%` }} />
    </span>
    <span className={styles.pct}>{percent}%</span>
  </>
);

const tone = (t) => (t ? styles[t] : '');

function Branch({ open, onToggle, level, name, meta, children, label }) {
  return (
    <li>
      <div
        className={`${styles.node} ${styles.branch} ${open ? styles.open : ''}`}
        role="button"
        tabIndex={0}
        aria-expanded={open}
        aria-label={label}
        onClick={onToggle}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onToggle())}
      >
        <span className={styles.twisty} aria-hidden="true">›</span>
        <span className={styles.level}>{level}</span>
        <span className={styles.name}>{name}</span>
        <span className={styles.meta}>{meta}</span>
      </div>
      {open && <ul>{children}</ul>}
    </li>
  );
}

function Leaf({ level, name, meta }) {
  return (
    <li>
      <div className={`${styles.node} ${styles.leaf}`}>
        <span className={styles.twisty} aria-hidden="true">›</span>
        <span className={styles.level}>{level}</span>
        <span className={styles.name}>{name}</span>
        <span className={styles.meta}>{meta}</span>
      </div>
    </li>
  );
}

export default function RequirementsPage() {
  const { showToast } = useToast();
  const confirmAction = useConfirm();
  const { list, srsId, chooseSrs, off, error, setError } = useRequirementsSrs();
  const [tree, setTree] = useState(null);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(() => new Set(['srs']));
  const [busy, setBusy] = useState(null);
  const [failing, setFailing] = useState(null);
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState('');
  const [epicForm, setEpicForm] = useState(null); // { id?, name, srsSection }
  const [storyForm, setStoryForm] = useState(null); // { epic, title, asA, iWant, soThat, requirementIds }
  const [requirements, setRequirements] = useState(null);
  const [signOff, setSignOff] = useState(null); // { clientName, signedOn, file }
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(
    (id = srsId) =>
      apiFetch(`/requirements/srs/${id}/tree`)
        .then(setTree)
        .catch((err) => setError(err.message)),
    [srsId, setError],
  );

  useEffect(() => {
    if (!srsId) return;
    setTree(null);
    setOpen(new Set(['srs']));
    load(srsId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [srsId]);

  const found = useMemo(() => (tree ? searchTree(tree.epics, query) : null), [tree, query]);
  const isOpen = (key) => (found ? true : open.has(key));
  const toggle = (key) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const expandAll = () => tree && setOpen(new Set(['srs', ...tree.epics.map((e) => `e${e.id}`), ...tree.epics.flatMap((e) => e.stories.map((s) => `s${s.id}`))]));
  const collapseAll = () => setOpen(new Set(['srs']));

  // ---- Pass / Fail ----
  const save = async (criterion, story, body) => {
    setBusy(criterion.id);
    try {
      setTree(await apiFetch(`/requirements/criteria/${criterion.id}/result`, { method: 'PUT', body: JSON.stringify(body) }));
      showToast(`${story.code} AC${criterion.position} ${body.result === 'pass' ? 'passed' : 'failed'}`, 'success');
      return true;
    } catch (err) {
      showToast(err.message, 'error');
      return false;
    } finally {
      setBusy(null);
    }
  };
  const closeFail = useCallback(() => setFailing(null), []);
  const startFail = (criterion, story) => {
    setReason('');
    setReasonError('');
    setFailing({ criterion, story });
  };
  const submitFail = async (e) => {
    e.preventDefault();
    const problem = failReasonError(reason);
    setReasonError(problem);
    if (problem) return;
    if (await save(failing.criterion, failing.story, { result: 'fail', note: reason.trim() })) setFailing(null);
  };

  // ---- epics ----
  const closeEpic = useCallback(() => setEpicForm(null), []);
  const submitEpic = async (e) => {
    e.preventDefault();
    if (!epicForm.name.trim()) return setFormError('Give the epic a name.');
    setSaving(true);
    setFormError('');
    try {
      const body = JSON.stringify({ name: epicForm.name, srsSection: epicForm.srsSection });
      if (epicForm.id) await apiFetch(`/requirements/epics/${epicForm.id}`, { method: 'PATCH', body });
      else {
        const created = await apiFetch(`/requirements/srs/${srsId}/epics`, { method: 'POST', body });
        setOpen((prev) => new Set([...prev, `e${created.id}`]));
      }
      showToast(epicForm.id ? 'Epic saved' : 'Epic added', 'success');
      setEpicForm(null);
      await load();
    } catch (err) {
      setFormError(err.message);
    } finally {
      setSaving(false);
    }
  };
  const deleteEpic = async (epic) => {
    const ok = await confirmAction({ title: `Delete epic ${epic.code}?`, message: `"${epic.name}" has no stories. It is kept in the history; its code is not reused.`, confirmLabel: 'Delete epic', danger: true });
    if (!ok) return;
    try {
      await apiFetch(`/requirements/epics/${epic.id}`, { method: 'DELETE' });
      showToast(`Epic ${epic.code} deleted`, 'success');
      await load();
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  // ---- stories ----
  const closeStory = useCallback(() => setStoryForm(null), []);
  const startStory = async (epic) => {
    setFormError('');
    setStoryForm({ epic, title: '', asA: '', iWant: '', soThat: '', requirementIds: [] });
    if (!requirements) {
      try {
        setRequirements(await apiFetch(`/requirements/srs/${srsId}/requirements`));
      } catch (err) {
        setFormError(err.message);
      }
    }
  };
  const submitStory = async (e) => {
    e.preventDefault();
    if (!storyForm.title.trim()) return setFormError('Give the story a title.');
    setSaving(true);
    setFormError('');
    try {
      const { epic, ...body } = storyForm;
      const created = await apiFetch(`/requirements/epics/${epic.id}/stories`, { method: 'POST', body: JSON.stringify(body) });
      showToast(`${created.code} added as Draft`, 'success');
      setStoryForm(null);
      setOpen((prev) => new Set([...prev, `e${epic.id}`]));
      await load();
    } catch (err) {
      setFormError(err.message);
    } finally {
      setSaving(false);
    }
  };

  // ---- client sign-off ----
  const closeSignOff = useCallback(() => setSignOff(null), []);
  const submitSignOff = async (e) => {
    e.preventDefault();
    if (!signOff.clientName.trim() || !signOff.signedOn || !signOff.file) return setFormError('Client name, sign-off date and the signed document are all required.');
    setSaving(true);
    setFormError('');
    try {
      const fd = new FormData();
      fd.append('clientName', signOff.clientName.trim());
      fd.append('signedOn', signOff.signedOn);
      fd.append('file', signOff.file);
      await apiUpload(`/requirements/srs/${srsId}/client-sign-off`, fd);
      showToast('Client sign-off recorded', 'success');
      setSignOff(null);
      await load();
    } catch (err) {
      setFormError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const perms = tree?.permissions || {};
  const srs = tree?.srs;
  const s = tree?.summary;

  if (off) {
    return (
      <AppShell>
        <h1 className={styles.title}>Requirements</h1>
        <p className={styles.subtitle}>Requirements is switched off at the moment. Ask a Program Manager to switch it on.</p>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className={styles.header}>
        <h1 className={styles.title}>Requirements</h1>
        {srs && (
          <p className={styles.subtitle}>
            {srs.projectName} · {srs.name} v{srs.version} · {SRS_STATUS_LABEL[srs.status] || srs.status} · {dmy(srs.issuedOn)}
            {srs.reviewers.length > 0 && ` · Reviewer${srs.reviewers.length > 1 ? 's' : ''}: ${srs.reviewers.join(', ')}`}
          </p>
        )}
        {list && list.length > 1 && (
          <div className={styles.picker}>
            <select aria-label="Choose an SRS" value={srsId ?? ''} onChange={(e) => chooseSrs(Number(e.target.value))}>
              {list.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.projectName} · {d.name} v{d.version}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {srsId && <RequirementsTabs srsId={srsId} canLinkTickets={!!perms.canLinkTickets} />}
      {error && <div className={forms.error} role="alert">{error}</div>}
      {!error && list && list.length === 0 && <div className={`${styles.card} ${styles.empty}`}>No SRS on any project you are on yet.</div>}
      {!error && (list === null || (srsId && !tree)) && <LoadingState />}

      {tree && (
        <>
          <div className={`${styles.card} ${styles.signoff}`}>
            {srs.status === 'client_signed_off' ? (
              <span>
                <b className={styles.ok}>Signed off by client</b>: {srs.clientName}, {dmy(srs.clientSignedOn)} ·{' '}
                <a
                  href="#signed-document"
                  onClick={(e) => {
                    e.preventDefault();
                    apiDownload(`/requirements/srs/${srs.id}/client-sign-off/file`, srs.clientFileName).catch((err) => showToast(err.message, 'error'));
                  }}
                >
                  {srs.clientFileName}
                </a>
              </span>
            ) : (
              <span>
                <b className={styles.warn}>Not signed off by the client yet.</b> Stories can be approved only "at risk", with a reason, until the client signs.
              </span>
            )}
            {perms.canRecordClientSignOff && (
              <button
                type="button"
                className={forms.buttonSecondary}
                onClick={() => {
                  setFormError('');
                  setSignOff({ clientName: '', signedOn: todayIso(), file: null });
                }}
              >
                Record client sign-off
              </button>
            )}
          </div>

          <div className={`${styles.card} ${styles.summary}`} aria-label="Summary">
            <div>
              <b>{s.percent}%</b>
              <span>
                overall ({s.criteriaPassed} of {s.criteriaTotal} criteria passed)
              </span>
            </div>
            <div>
              <b className={styles.ok}>{s.storiesDone}</b>
              <span>stories done (100%)</span>
            </div>
            <div>
              <b className={styles.late}>{s.storiesFailed}</b>
              <span>stories with failed criteria</span>
            </div>
            <div>
              <b className={styles.late}>{s.storiesBlocked}</b>
              <span>blocked</span>
            </div>
            <div>
              <b className={styles.warn}>{s.storiesWaiting}</b>
              <span>waiting on a dependency</span>
            </div>
          </div>

          <div className={styles.toolbar}>
            <input
              type="search"
              className={styles.search}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search a requirement ID (e.g. LN-10), epic, story or TRK number"
              aria-label="Search a requirement ID, epic, story or TRK number"
            />
            <button type="button" className={styles.textButton} onClick={expandAll} disabled={!!found}>
              Expand all
            </button>
            <button type="button" className={styles.textButton} onClick={collapseAll} disabled={!!found}>
              Collapse all
            </button>
            {perms.canWrite && (
              <button
                type="button"
                className={forms.buttonSecondary}
                onClick={() => {
                  setFormError('');
                  setEpicForm({ name: '', srsSection: '' });
                }}
              >
                Add epic
              </button>
            )}
          </div>
          {found && (
            <p className={styles.legend} role="status" style={{ margin: '0 4px 12px' }}>
              {found.storyIds.size ? `${plural(found.storyIds.size, 'story', 'stories')} found` : 'Nothing found'}
            </p>
          )}

          <div className={`${styles.card} ${styles.treeCard}`}>
            <ul className={styles.tree}>
              <Branch
                open={isOpen('srs')}
                onToggle={() => toggle('srs')}
                level="SRS"
                label={`SRS ${srs.name} v${srs.version}`}
                name={
                  <>
                    {srs.name} v{srs.version}
                    <small>
                      {plural(srs.requirementCount, 'requirement')} · {plural(srs.epicCount, 'epic')} · {plural(srs.storyCount, 'story', 'stories')}
                    </small>
                  </>
                }
                meta={
                  <>
                    <Bar percent={srs.percent} />
                    <span>
                      {srs.storiesDone} of {srs.storyCount} stories done
                    </span>
                  </>
                }
              >
                {tree.epics
                  .filter((e) => !found || found.epicIds.has(e.id))
                  .map((e) => (
                    <Branch
                      key={e.id}
                      open={isOpen(`e${e.id}`)}
                      onToggle={() => toggle(`e${e.id}`)}
                      level={`Epic ${e.code}`}
                      label={`Epic ${e.code} ${e.name}`}
                      name={
                        <>
                          {e.name}
                          {e.srsSection && <small>{e.srsSection}</small>}
                        </>
                      }
                      meta={
                        <>
                          <Bar percent={e.percent} />
                          <span>{plural(e.stories.length, 'story', 'stories')}</span>
                        </>
                      }
                    >
                      {perms.canWrite && !found && (
                        <Leaf
                          level=""
                          name={
                            <span>
                              <button type="button" className={styles.inlineLink} style={{ marginLeft: 0 }} onClick={() => startStory(e)}>
                                + Add story to {e.code}
                              </button>
                              <button
                                type="button"
                                className={styles.inlineLink}
                                onClick={() => {
                                  setFormError('');
                                  setEpicForm({ id: e.id, code: e.code, name: e.name, srsSection: e.srsSection || '' });
                                }}
                              >
                                Edit epic
                              </button>
                              {e.stories.length === 0 && (
                                <button type="button" className={styles.inlineLink} onClick={() => deleteEpic(e)}>
                                  Delete epic
                                </button>
                              )}
                            </span>
                          }
                          meta={null}
                        />
                      )}
                      {e.stories
                        .filter((st) => !found || found.storyIds.has(st.id))
                        .map((st) => {
                          const lbl = storyLabel(st);
                          return (
                            <Branch
                              key={st.id}
                              open={isOpen(`s${st.id}`)}
                              onToggle={() => toggle(`s${st.id}`)}
                              level="Story"
                              label={`Story ${st.code} ${st.title}`}
                              name={
                                <>
                                  {st.code} {st.title}
                                  {st.requirements.length > 0 && <small>{st.requirements.join(', ')}</small>}
                                  {st.atRisk && <span className={`${styles.flag} ${styles.warn}`}>At risk: approved before client sign-off</span>}
                                  {st.clientItems.map((c) => (
                                    <span key={`c${c.id}`} className={`${styles.flag} ${styles.late}`}>
                                      Blocked: waiting on client item {c.number} ({c.question})
                                    </span>
                                  ))}
                                  {st.blockedBy.map((b, i) => (
                                    <span key={`b${i}`} className={`${styles.flag} ${styles.late}`}>
                                      Blocked ({b.trk}): {b.reason}
                                    </span>
                                  ))}
                                  {st.dependsOn.map((d, i) => (
                                    <span key={`d${i}`} className={`${styles.flag} ${styles.warn}`}>
                                      Depends on ({d.trk}): {d.title}
                                    </span>
                                  ))}
                                </>
                              }
                              meta={
                                <>
                                  <Bar percent={st.percent} />
                                  <span className={tone(lbl.tone)}>{lbl.text}</span>
                                </>
                              }
                            >
                              <Leaf
                                level=""
                                name={
                                  <Link href={`/requirements/stories/${st.id}`} className={styles.inlineLink} style={{ marginLeft: 0 }}>
                                    Open {st.code} ({STORY_STATUS_LABEL[st.status] || st.status})
                                  </Link>
                                }
                                meta={null}
                              />
                              {st.criteria.map((c) => {
                                const r = resultLabel(c.result);
                                return (
                                  <Leaf
                                    key={c.id}
                                    level={`AC${c.position}`}
                                    name={
                                      <>
                                        {c.text}
                                        {c.result === 'fail' && c.note && <span className={`${styles.note} ${styles.late}`}>QA: {c.note}</span>}
                                        {c.beforeApproval && <span className={styles.note}>Recorded before approval</span>}
                                      </>
                                    }
                                    meta={
                                      <>
                                        <span className={tone(r.tone)}>{r.text}</span>
                                        {st.canRecordResults && (
                                          <span className={styles.resultActions}>
                                            <button type="button" disabled={busy === c.id || c.result === 'pass'} onClick={() => save(c, st, { result: 'pass' })} aria-label={`Pass ${st.code} AC${c.position}`}>
                                              Pass
                                            </button>
                                            <button type="button" className={styles.failButton} disabled={busy === c.id} onClick={() => startFail(c, st)} aria-label={`Fail ${st.code} AC${c.position}`}>
                                              Fail
                                            </button>
                                          </span>
                                        )}
                                      </>
                                    }
                                  />
                                );
                              })}
                              {st.tickets.length ? (
                                st.tickets.map((t) => (
                                  <Leaf
                                    key={t.linkId}
                                    level={t.kind === 'qa' ? 'QA ticket' : 'Dev ticket'}
                                    name={
                                      <>
                                        <a href={`/tasks/${t.taskId}`}>{t.trk}</a> {t.title}
                                        {t.assignee && <small>{t.assignee}</small>}
                                      </>
                                    }
                                    meta={<span>{t.status}</span>}
                                  />
                                ))
                              ) : (
                                <Leaf level="Tickets" name={<span className={styles.muted}>No Dev or QA tickets linked yet</span>} meta={null} />
                              )}
                            </Branch>
                          );
                        })}
                    </Branch>
                  ))}
              </Branch>
            </ul>
          </div>
          <p className={styles.legend}>
            Structure: SRS → Epic (SRS section) → User story (traced to requirement IDs) → acceptance criteria → Dev and QA tickets. Progress rolls up from
            acceptance criteria passed: story = criteria passed ÷ total, epic = average of its stories, SRS = average of all stories. Pass/Fail is recorded on
            Approved stories.
          </p>
        </>
      )}

      <Modal open={!!failing} onClose={closeFail} title={failing ? `${failing.story.code} AC${failing.criterion.position} failed: reason required` : ''}>
        {failing && (
          <form onSubmit={submitFail} noValidate>
            <p className={styles.criterionQuote}>{failing.criterion.text}</p>
            <div className={styles.field}>
              <label htmlFor="fail-reason">What failed?</label>
              <textarea
                id="fail-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Steps, expected and actual result"
                aria-invalid={!!reasonError}
                aria-describedby={reasonError ? 'fail-reason-error' : undefined}
                maxLength={2000}
              />
              {reasonError && (
                <div id="fail-reason-error" className={styles.fieldError} role="alert">
                  {reasonError}
                </div>
              )}
            </div>
            <div className={styles.actionsRow}>
              <button type="submit" className={forms.button} disabled={busy === failing.criterion.id}>
                {busy === failing.criterion.id ? 'Saving...' : 'Save'}
              </button>
              <button type="button" className={forms.buttonSecondary} onClick={closeFail}>
                Cancel
              </button>
            </div>
          </form>
        )}
      </Modal>

      <Modal open={!!epicForm} onClose={closeEpic} title={epicForm?.id ? `Edit epic ${epicForm.code}` : 'Add epic'}>
        {epicForm && (
          <form onSubmit={submitEpic} noValidate>
            <div className={forms.field}>
              <label className={forms.label} htmlFor="epic-name">Name</label>
              <input id="epic-name" className={forms.input} value={epicForm.name} maxLength={255} onChange={(e) => setEpicForm({ ...epicForm, name: e.target.value })} />
            </div>
            <div className={forms.field}>
              <label className={forms.label} htmlFor="epic-section">SRS section (optional)</label>
              <input id="epic-section" className={forms.input} value={epicForm.srsSection} maxLength={100} placeholder="e.g. SRS 4.1, 4.3" onChange={(e) => setEpicForm({ ...epicForm, srsSection: e.target.value })} />
            </div>
            {formError && <div className={styles.fieldError} role="alert">{formError}</div>}
            <div className={styles.actionsRow}>
              <button type="submit" className={forms.button} disabled={saving}>
                {saving ? 'Saving...' : 'Save'}
              </button>
              <button type="button" className={forms.buttonSecondary} onClick={closeEpic}>
                Cancel
              </button>
            </div>
          </form>
        )}
      </Modal>

      <Modal open={!!storyForm} onClose={closeStory} size="lg" title={storyForm ? `Add a story to ${storyForm.epic.code} ${storyForm.epic.name}` : ''}>
        {storyForm && (
          <form onSubmit={submitStory} noValidate>
            <p className={forms.helpText}>It starts as Draft. A Program Manager or Admin approves it.</p>
            <div className={forms.field}>
              <label className={forms.label} htmlFor="story-title">Title</label>
              <input id="story-title" className={forms.input} value={storyForm.title} maxLength={255} onChange={(e) => setStoryForm({ ...storyForm, title: e.target.value })} />
            </div>
            {[
              ['asA', 'As a', 'e.g. bank officer'],
              ['iWant', 'I want', 'what they need to do'],
              ['soThat', 'So that', 'why it matters'],
            ].map(([k, label, ph]) => (
              <div className={forms.field} key={k}>
                <label className={forms.label} htmlFor={`story-${k}`}>{label}</label>
                <input id={`story-${k}`} className={forms.input} value={storyForm[k]} placeholder={ph} onChange={(e) => setStoryForm({ ...storyForm, [k]: e.target.value })} />
              </div>
            ))}
            {requirements ? (
              <RequirementPicker requirements={requirements} value={storyForm.requirementIds} onChange={(ids) => setStoryForm({ ...storyForm, requirementIds: ids })} idPrefix="new-story-req" />
            ) : (
              <LoadingState />
            )}
            {formError && <div className={styles.fieldError} role="alert">{formError}</div>}
            <div className={styles.actionsRow}>
              <button type="submit" className={forms.button} disabled={saving}>
                {saving ? 'Saving...' : 'Add story'}
              </button>
              <button type="button" className={forms.buttonSecondary} onClick={closeStory}>
                Cancel
              </button>
            </div>
          </form>
        )}
      </Modal>

      <Modal open={!!signOff} onClose={closeSignOff} title="Record client sign-off">
        {signOff && (
          <form onSubmit={submitSignOff} noValidate>
            <p className={forms.helpText}>
              {srs?.name} v{srs?.version} becomes "Signed off by client". Stories can then be approved normally, and the At risk labels go away.
            </p>
            <div className={forms.field}>
              <label className={forms.label} htmlFor="so-client">Client name</label>
              <input id="so-client" className={forms.input} value={signOff.clientName} maxLength={255} onChange={(e) => setSignOff({ ...signOff, clientName: e.target.value })} />
            </div>
            <div className={forms.field}>
              <label className={forms.label} htmlFor="so-date">Sign-off date</label>
              <input id="so-date" type="date" className={forms.input} value={signOff.signedOn} max={todayIso()} onChange={(e) => setSignOff({ ...signOff, signedOn: e.target.value })} />
            </div>
            <div className={forms.field}>
              <label className={forms.label} htmlFor="so-file">Signed document (PDF, PNG, JPEG or Word, up to 10 MB)</label>
              <input id="so-file" type="file" accept=".pdf,.png,.jpg,.jpeg,.docx" onChange={(e) => setSignOff({ ...signOff, file: e.target.files?.[0] || null })} />
            </div>
            {formError && <div className={styles.fieldError} role="alert">{formError}</div>}
            <div className={styles.actionsRow}>
              <button type="submit" className={forms.button} disabled={saving}>
                {saving ? 'Saving...' : 'Record sign-off'}
              </button>
              <button type="button" className={forms.buttonSecondary} onClick={closeSignOff}>
                Cancel
              </button>
            </div>
          </form>
        )}
      </Modal>
    </AppShell>
  );
}

