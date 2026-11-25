import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import AppShell from '../../components/AppShell';
import LoadingState from '../../components/ui/LoadingState';
import Modal from '../../components/ui/Modal';
import RequirementsTabs from '../../components/requirements/RequirementsTabs';
import styles from '../../styles/requirements.module.css';
import forms from '../../styles/issues.module.css';
import { apiFetch } from '../../lib/api';
import { useToast } from '../../lib/toast';
import { useRequirementsSrs } from '../../lib/useRequirementsSrs';
import { RESOLUTION_MIN, dmy } from '../../lib/requirementsTree';
import { formatDateTimeEAT } from '../../lib/formatDate';

// Open client items of an SRS (Requirements Stage 2, 2026-11-25): things to
// confirm with the client. While an item is open, the stories it is linked
// to show as Blocked. BA, PM and Admin add and edit open items; PM and
// Admin close them with a resolution. Everyone who sees the SRS sees them.
export default function ClientItemsPage() {
  const { showToast } = useToast();
  const { list, srsId, off, error, setError } = useRequirementsSrs();
  const [data, setData] = useState(null);
  const [stories, setStories] = useState([]);
  const [canLink, setCanLink] = useState(false);
  const [form, setForm] = useState(null); // { id?, number?, question, baseline, owner, storyIds }
  const [closing, setClosing] = useState(null); // { item, resolution }
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!srsId) return;
    try {
      const [items, tree] = await Promise.all([apiFetch(`/requirements/srs/${srsId}/client-items`), apiFetch(`/requirements/srs/${srsId}/tree`)]);
      setData(items);
      setCanLink(!!tree.permissions.canLinkTickets);
      setStories(tree.epics.flatMap((e) => e.stories.map((s) => ({ id: s.id, code: s.code, title: s.title, epic: e.code }))));
    } catch (err) {
      setError(err.message);
    }
  }, [srsId, setError]);

  useEffect(() => {
    load();
  }, [load]);

  const closeForm = useCallback(() => setForm(null), []);
  const closeClosing = useCallback(() => setClosing(null), []);
  const toggleStory = (id) => setForm((f) => ({ ...f, storyIds: f.storyIds.includes(id) ? f.storyIds.filter((x) => x !== id) : [...f.storyIds, id] }));

  const submitForm = async (e) => {
    e.preventDefault();
    if (!form.question.trim()) return setFormError('Write the question for the client.');
    setBusy(true);
    setFormError('');
    try {
      const body = JSON.stringify({ question: form.question, baseline: form.baseline, owner: form.owner, storyIds: form.storyIds });
      if (form.id) await apiFetch(`/requirements/client-items/${form.id}`, { method: 'PATCH', body });
      else await apiFetch(`/requirements/srs/${srsId}/client-items`, { method: 'POST', body });
      showToast(form.id ? `Client item ${form.number} saved` : 'Client item added', 'success');
      setForm(null);
      await load();
    } catch (err) {
      setFormError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const submitClose = async (e) => {
    e.preventDefault();
    if (closing.resolution.trim().length < RESOLUTION_MIN) return setFormError(`Please give the resolution (at least ${RESOLUTION_MIN} characters).`);
    setBusy(true);
    setFormError('');
    try {
      await apiFetch(`/requirements/client-items/${closing.item.id}/close`, { method: 'POST', body: JSON.stringify({ resolution: closing.resolution.trim() }) });
      showToast(`Client item ${closing.item.number} closed`, 'success');
      setClosing(null);
      await load();
    } catch (err) {
      setFormError(err.message);
    } finally {
      setBusy(false);
    }
  };

  if (off) {
    return (
      <AppShell>
        <h1 className={styles.title}>Requirements</h1>
        <p className={styles.subtitle}>Requirements is switched off at the moment.</p>
      </AppShell>
    );
  }

  const perms = data?.permissions || {};
  const items = data?.items || [];
  return (
    <AppShell>
      <div className={styles.headerRow}>
        <div className={styles.header}>
          <h1 className={styles.title}>Client items</h1>
          <p className={styles.subtitle}>
            {data ? `${data.srs.name} v${data.srs.version} · ${dmy(data.srs.issuedOn)} · ` : ''}Questions to confirm with the client. While an item is open, its stories are
            Blocked.
          </p>
        </div>
        {perms.canWrite && (
          <button
            type="button"
            className={forms.buttonSecondary}
            onClick={() => {
              setFormError('');
              setForm({ question: '', baseline: '', owner: 'Client', storyIds: [] });
            }}
          >
            Add client item
          </button>
        )}
      </div>
      {srsId && <RequirementsTabs srsId={srsId} canLinkTickets={canLink} />}
      {error && <div className={forms.error} role="alert">{error}</div>}
      {!error && list && list.length === 0 && <div className={`${styles.card} ${styles.empty}`}>No SRS on any project you are on yet.</div>}
      {!error && list?.length > 0 && !data && <LoadingState />}

      {data && (
        <ul className={`${styles.card} ${styles.plainList}`} style={{ padding: 'var(--ds-space-2) var(--ds-space-5)' }}>
          {items.map((i) => (
            <li key={i.id} style={{ padding: 'var(--ds-space-4) 0' }}>
              <div className={styles.headerRow}>
                <span>
                  <b>Item {i.number}:</b> {i.question}
                </span>
                <span className={`${styles.pill} ${i.status === 'open' ? styles.late : styles.ok}`}>{i.status === 'open' ? 'Open' : 'Closed'}</span>
              </div>
              <span className={styles.note}>
                {i.baseline ? `Baseline: ${i.baseline} · ` : ''}Owner: {i.owner || '—'} · Affects{' '}
                {i.stories.length
                  ? i.stories.map((s, k) => (
                      <span key={s.id}>
                        {k > 0 && ', '}
                        <Link href={`/requirements/stories/${s.id}`}>{s.code}</Link>
                      </span>
                    ))
                  : 'no story'}
              </span>
              {i.status === 'closed' && (
                <span className={styles.note}>
                  Resolution: {i.resolution} ({i.closedBy || 'Unknown'}, {formatDateTimeEAT(i.closedAt)})
                </span>
              )}
              {i.status === 'open' && (perms.canWrite || perms.canClose) && (
                <span className={styles.note}>
                  {perms.canWrite && (
                    <button
                      type="button"
                      className={styles.inlineLink}
                      style={{ marginLeft: 0 }}
                      onClick={() => {
                        setFormError('');
                        setForm({ id: i.id, number: i.number, question: i.question, baseline: i.baseline || '', owner: i.owner || '', storyIds: i.stories.map((s) => s.id) });
                      }}
                    >
                      Edit
                    </button>
                  )}
                  {perms.canClose && (
                    <button
                      type="button"
                      className={styles.inlineLink}
                      onClick={() => {
                        setFormError('');
                        setClosing({ item: i, resolution: '' });
                      }}
                    >
                      Close with a resolution
                    </button>
                  )}
                </span>
              )}
            </li>
          ))}
          {!items.length && <li className={styles.muted}>No client items yet.</li>}
        </ul>
      )}

      <Modal open={!!form} onClose={closeForm} size="lg" title={form?.id ? `Edit client item ${form.number}` : 'Add client item'}>
        {form && (
          <form onSubmit={submitForm} noValidate>
            <div className={forms.field}>
              <label className={forms.label} htmlFor="ci-q">Question for the client</label>
              <textarea id="ci-q" className={forms.textarea} value={form.question} onChange={(e) => setForm({ ...form, question: e.target.value })} />
            </div>
            <div className={forms.field}>
              <label className={forms.label} htmlFor="ci-b">Baseline until confirmed (optional)</label>
              <input id="ci-b" className={forms.input} value={form.baseline} onChange={(e) => setForm({ ...form, baseline: e.target.value })} />
            </div>
            <div className={forms.field}>
              <label className={forms.label} htmlFor="ci-o">Owner (optional)</label>
              <input id="ci-o" className={forms.input} value={form.owner} maxLength={255} onChange={(e) => setForm({ ...form, owner: e.target.value })} />
            </div>
            <fieldset className={styles.pickerBox}>
              <legend className={forms.label}>Stories it blocks while open ({form.storyIds.length} chosen)</legend>
              <div className={styles.pickerList}>
                {stories.map((s) => (
                  <label key={s.id} className={styles.pickerItem} htmlFor={`ci-s-${s.id}`}>
                    <input id={`ci-s-${s.id}`} type="checkbox" checked={form.storyIds.includes(s.id)} onChange={() => toggleStory(s.id)} />
                    <span>
                      <b>{s.code}</b> {s.title} <span className={styles.muted}>· {s.epic}</span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
            {formError && <div className={styles.fieldError} role="alert">{formError}</div>}
            <div className={styles.actionsRow}>
              <button type="submit" className={forms.button} disabled={busy}>
                {busy ? 'Saving...' : 'Save'}
              </button>
              <button type="button" className={forms.buttonSecondary} onClick={closeForm}>
                Cancel
              </button>
            </div>
          </form>
        )}
      </Modal>

      <Modal open={!!closing} onClose={closeClosing} title={closing ? `Close client item ${closing.item.number}` : ''}>
        {closing && (
          <form onSubmit={submitClose} noValidate>
            <p className={styles.criterionQuote}>{closing.item.question}</p>
            <div className={styles.field}>
              <label htmlFor="ci-res">What did the client decide?</label>
              <textarea id="ci-res" value={closing.resolution} onChange={(e) => setClosing({ ...closing, resolution: e.target.value })} maxLength={5000} />
            </div>
            <p className={forms.helpText}>Its stories stop being Blocked by this item.</p>
            {formError && <div className={styles.fieldError} role="alert">{formError}</div>}
            <div className={styles.actionsRow}>
              <button type="submit" className={forms.button} disabled={busy}>
                {busy ? 'Saving...' : 'Close item'}
              </button>
              <button type="button" className={forms.buttonSecondary} onClick={closeClosing}>
                Cancel
              </button>
            </div>
          </form>
        )}
      </Modal>
    </AppShell>
  );
}
