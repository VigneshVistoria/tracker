import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import AppShell from '../../components/AppShell';
import LoadingState from '../../components/ui/LoadingState';
import styles from '../../styles/issues.module.css';
import { apiFetch } from '../../lib/api';
import { useToast } from '../../lib/toast';
import { useConfirm } from '../../lib/confirm';
import { redirectToSignIn } from '../../lib/session';
import { CLASSIFICATION_FIELDS, CLASSIFICATION_LABELS } from '../../components/DefectClassificationFields';

// Defect triage settings (2026-10-27) - Admin and Program Manager (backend:
// DefectTriageController, DEFECT_TRIAGE_SETTINGS_ROLES). Per project: the
// switch (off by default). Tenant-wide: the lists QA classifies with, the
// dispute reasons, which classification fields are required, and how many
// working days a developer has to accept or dispute. Every defect keeps the
// values as they were picked, so editing a list never changes history.
// Mirrors LIST_ITEM_MAX / LIST_MAX_COUNT / TRIAGE_WORKING_DAYS_MAX in
// backend/src/tasks/defect-triage.ts.
const ITEM_MAX = 100;
const MAX_ITEMS = 30;
const DAYS_MAX = 10;
const EDIT_ROLES = ['admin', 'program_manager'];

const LISTS = [
  { key: 'severities', title: 'Severity', help: 'Most severe first.', placeholder: 'e.g. Blocker' },
  { key: 'types', title: 'Defect type', help: '', placeholder: 'e.g. Accessibility' },
  { key: 'origins', title: 'Origin (found in)', help: '', placeholder: 'e.g. Security review' },
  { key: 'environments', title: 'Environment', help: '', placeholder: 'e.g. Pre-production' },
];

export default function DefectTriageSettingsPage() {
  const router = useRouter();
  const { showToast } = useToast();
  const confirmAction = useConfirm();
  const [page, setPage] = useState(null);
  const [days, setDays] = useState('1');
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState('');

  const load = () =>
    apiFetch('/defect-triage/settings')
      .then((p) => {
        setPage(p);
        setDays(String(p.settings.triageWorkingDays));
      })
      .catch((err) => setError(err.message));

  useEffect(() => {
    const stored = localStorage.getItem('user');
    if (!stored) {
      redirectToSignIn(router);
      return;
    }
    if (!EDIT_ROLES.includes(JSON.parse(stored).role)) {
      router.replace('/dashboard');
      return;
    }
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  const save = async (next, message) => {
    setBusy('settings');
    setError('');
    try {
      const saved = await apiFetch('/defect-triage/settings', { method: 'PATCH', body: JSON.stringify(next) });
      setPage((p) => ({ ...p, settings: saved }));
      setDays(String(saved.triageWorkingDays));
      showToast(message, 'success');
      return true;
    } catch (err) {
      setError(err.message);
      return false;
    } finally {
      setBusy(null);
    }
  };

  const toggle = async (project) => {
    const enabled = !project.defectTriageEnabled;
    if (!enabled && project.pendingCount > 0) {
      const ok = await confirmAction({
        title: `Turn off defect triage for ${project.name}?`,
        message: `${project.pendingCount} ${project.pendingCount === 1 ? 'defect is' : 'defects are'} waiting for the developer to accept or dispute. ${project.pendingCount === 1 ? 'It' : 'They'} will no longer need triage. Disputed defects stay with the PM until decided.`,
        confirmLabel: 'Turn off',
      });
      if (!ok) return;
    }
    setBusy(`p${project.id}`);
    setError('');
    try {
      await apiFetch(`/defect-triage/projects/${project.id}`, { method: 'PATCH', body: JSON.stringify({ enabled }) });
      showToast(
        enabled ? `Defect triage is on for ${project.name} - new defects need classification and triage` : `Defect triage is off for ${project.name}`,
        'success',
      );
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  };

  const saveDays = (e) => {
    e.preventDefault();
    const n = Number(days);
    if (!Number.isInteger(n) || n < 1 || n > DAYS_MAX) {
      setError(`Working days must be a whole number from 1 to ${DAYS_MAX}.`);
      return;
    }
    save({ ...page.settings, triageWorkingDays: n }, 'Triage time saved');
  };

  const toggleRequired = (field) => {
    const s = page.settings;
    const requiredFields = s.requiredFields.includes(field) ? s.requiredFields.filter((f) => f !== field) : [...s.requiredFields, field];
    save({ ...s, requiredFields }, `${CLASSIFICATION_LABELS[field]} is now ${requiredFields.includes(field) ? 'required' : 'optional'}`);
  };

  return (
    <AppShell>
      <div className={styles.pageHeader}>
        <div>
          <h1 className={styles.pageTitle}>Defect Triage Settings</h1>
          <p className={styles.pageSubtitle}>
            When a project has defect triage on, QA classifies every new defect and the developer accepts it or disputes it with a reason.
            A dispute goes to a Program Manager and is never a QA rejection. Late triage shows on the Non-compliance report for
            information only.
          </p>
        </div>
      </div>

      {error && (
        <div className={styles.error} role="alert">
          {error}
        </div>
      )}
      {!page && !error && <LoadingState />}

      {page && (
        <>
          <div className={styles.card} style={{ marginBottom: 'var(--space-4)' }}>
            <h2 className={styles.cardTitle}>Projects</h2>
            <p className={styles.helpText} style={{ marginTop: 0 }}>
              Off by default. Turning a project on affects new defects only - defects already open there don&apos;t need triage.
            </p>
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Project</th>
                    <th>Defect triage</th>
                    <th>Waiting for triage</th>
                    <th>Disputed</th>
                  </tr>
                </thead>
                <tbody>
                  {page.projects.map((p) => (
                    <tr key={p.id}>
                      <td>{p.name}</td>
                      <td>
                        <button
                          type="button"
                          className={p.defectTriageEnabled ? `${styles.button} ${styles.buttonAccent}` : styles.buttonSecondary}
                          onClick={() => toggle(p)}
                          disabled={busy !== null}
                          aria-pressed={p.defectTriageEnabled}
                          aria-label={`Defect triage for ${p.name}: ${p.defectTriageEnabled ? 'on' : 'off'}`}
                        >
                          {busy === `p${p.id}` ? 'Saving...' : p.defectTriageEnabled ? 'On' : 'Off'}
                        </button>
                      </td>
                      <td>{p.pendingCount}</td>
                      <td>{p.disputedCount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className={styles.card} style={{ marginBottom: 'var(--space-4)' }}>
            <h2 className={styles.cardTitle}>Rules</h2>
            <form onSubmit={saveDays} className={styles.actions} style={{ alignItems: 'end' }}>
              <div className={styles.field} style={{ marginBottom: 0 }}>
                <label className={styles.label} htmlFor="triageDays">
                  Working days to accept or dispute
                </label>
                <input
                  id="triageDays"
                  className={styles.input}
                  type="number"
                  min={1}
                  max={DAYS_MAX}
                  value={days}
                  onChange={(e) => setDays(e.target.value)}
                  style={{ maxWidth: 120 }}
                />
              </div>
              <button className={`${styles.button} ${styles.buttonAccent}`} type="submit" disabled={busy !== null}>
                Save
              </button>
            </form>
            <p className={styles.helpText}>
              Counted from when the defect reaches the developer; weekends are skipped. After that the developer gets one reminder and it
              shows as late triage.
            </p>
            <fieldset style={{ border: 0, padding: 0, margin: 'var(--space-3) 0 0' }}>
              <legend className={styles.label} style={{ padding: 0 }}>
                Required when QA files a defect
              </legend>
              {CLASSIFICATION_FIELDS.map((f) => (
                <label key={f} style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-1)', marginRight: 'var(--space-4)' }}>
                  <input type="checkbox" checked={page.settings.requiredFields.includes(f)} onChange={() => toggleRequired(f)} disabled={busy !== null} />
                  {CLASSIFICATION_LABELS[f]}
                </label>
              ))}
            </fieldset>
          </div>

          {LISTS.map((list) => (
            <ListEditor
              key={list.key}
              title={list.title}
              help={list.help}
              placeholder={list.placeholder}
              items={page.settings[list.key]}
              busy={busy !== null}
              onSave={(items, message) => save({ ...page.settings, [list.key]: items }, message)}
            />
          ))}

          <DisputeReasonsEditor
            reasons={page.settings.disputeReasons}
            busy={busy !== null}
            onSave={(disputeReasons, message) => save({ ...page.settings, disputeReasons }, message)}
          />
        </>
      )}
    </AppShell>
  );
}

function moveItem(items, index, delta) {
  const next = [...items];
  const [item] = next.splice(index, 1);
  next.splice(index + delta, 0, item);
  return next;
}

function ListEditor({ title, help, placeholder, items, busy, onSave }) {
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');
  const id = `list-${title.replace(/\W+/g, '-').toLowerCase()}`;

  const add = async (e) => {
    e.preventDefault();
    const v = draft.trim();
    if (!v) return;
    if (items.some((x) => x.toLowerCase() === v.toLowerCase())) {
      setError(`"${v}" is already on the list.`);
      return;
    }
    setError('');
    if (await onSave([...items, v], `Added "${v}"`)) setDraft('');
  };

  return (
    <div className={styles.card} style={{ marginBottom: 'var(--space-4)' }}>
      <h2 className={styles.cardTitle}>{title}</h2>
      <p className={styles.helpText} style={{ marginTop: 0 }}>
        {help} Shown in this order. At least one is needed.
      </p>
      <ol style={{ margin: '0 0 var(--space-4)', paddingLeft: 'var(--space-5)' }}>
        {items.map((item, i) => (
          <li key={item} style={{ marginBottom: 'var(--space-2)' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
              <span>{item}</span>
              <button className={styles.buttonSecondary} type="button" onClick={() => onSave(moveItem(items, i, -1), 'Order saved')} disabled={busy || i === 0} aria-label={`Move "${item}" up`}>
                Up
              </button>
              <button
                className={styles.buttonSecondary}
                type="button"
                onClick={() => onSave(moveItem(items, i, 1), 'Order saved')}
                disabled={busy || i === items.length - 1}
                aria-label={`Move "${item}" down`}
              >
                Down
              </button>
              <button
                className={styles.buttonSecondary}
                type="button"
                onClick={() => onSave(items.filter((x) => x !== item), `Removed "${item}"`)}
                disabled={busy || items.length === 1}
                aria-label={`Remove "${item}"`}
              >
                Remove
              </button>
            </span>
          </li>
        ))}
      </ol>
      {error && (
        <div className={styles.error} role="alert">
          {error}
        </div>
      )}
      <form onSubmit={add} className={styles.actions} style={{ alignItems: 'end' }}>
        <div className={styles.field} style={{ marginBottom: 0, flex: '1 1 260px' }}>
          <label className={styles.label} htmlFor={id}>
            New item
          </label>
          <input
            id={id}
            className={styles.input}
            value={draft}
            maxLength={ITEM_MAX}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={placeholder}
            disabled={busy || items.length >= MAX_ITEMS}
          />
        </div>
        <button className={`${styles.button} ${styles.buttonAccent}`} type="submit" disabled={busy || !draft.trim() || items.length >= MAX_ITEMS}>
          Add
        </button>
      </form>
    </div>
  );
}

function DisputeReasonsEditor({ reasons, busy, onSave }) {
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');

  const update = (index, patch, message) => onSave(reasons.map((r, i) => (i === index ? { ...r, ...patch } : r)), message);

  const add = async (e) => {
    e.preventDefault();
    const v = draft.trim();
    if (!v) return;
    if (reasons.some((r) => r.label.toLowerCase() === v.toLowerCase())) {
      setError(`"${v}" is already on the list.`);
      return;
    }
    setError('');
    if (await onSave([...reasons, { label: v, needsTicket: false, notLateTriage: false }], `Added "${v}"`)) setDraft('');
  };

  return (
    <div className={styles.card} style={{ marginBottom: 'var(--space-4)' }}>
      <h2 className={styles.cardTitle}>Dispute reasons</h2>
      <p className={styles.helpText} style={{ marginTop: 0 }}>
        What a developer picks when disputing a defect. &quot;Needs a ticket number&quot; asks for the ticket it duplicates. &quot;Never late
        triage&quot; means a dispute with this reason is never counted as late triage. At least one is needed.
      </p>
      <ol style={{ margin: '0 0 var(--space-4)', paddingLeft: 'var(--space-5)' }}>
        {reasons.map((r, i) => (
          <li key={r.label} style={{ marginBottom: 'var(--space-2)' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
              <span>{r.label}</span>
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-1)' }}>
                <input
                  type="checkbox"
                  checked={r.needsTicket}
                  onChange={() => update(i, { needsTicket: !r.needsTicket }, `"${r.label}" ${r.needsTicket ? 'no longer needs' : 'now needs'} a ticket number`)}
                  disabled={busy}
                />
                Needs a ticket number
              </label>
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-1)' }}>
                <input
                  type="checkbox"
                  checked={r.notLateTriage}
                  onChange={() => update(i, { notLateTriage: !r.notLateTriage }, `"${r.label}" ${r.notLateTriage ? 'can now count' : 'never counts'} as late triage`)}
                  disabled={busy}
                />
                Never late triage
              </label>
              <button className={styles.buttonSecondary} type="button" onClick={() => onSave(moveItem(reasons, i, -1), 'Order saved')} disabled={busy || i === 0} aria-label={`Move "${r.label}" up`}>
                Up
              </button>
              <button
                className={styles.buttonSecondary}
                type="button"
                onClick={() => onSave(moveItem(reasons, i, 1), 'Order saved')}
                disabled={busy || i === reasons.length - 1}
                aria-label={`Move "${r.label}" down`}
              >
                Down
              </button>
              <button
                className={styles.buttonSecondary}
                type="button"
                onClick={() => onSave(reasons.filter((x) => x.label !== r.label), `Removed "${r.label}"`)}
                disabled={busy || reasons.length === 1}
                aria-label={`Remove "${r.label}"`}
              >
                Remove
              </button>
            </span>
          </li>
        ))}
      </ol>
      {error && (
        <div className={styles.error} role="alert">
          {error}
        </div>
      )}
      <form onSubmit={add} className={styles.actions} style={{ alignItems: 'end' }}>
        <div className={styles.field} style={{ marginBottom: 0, flex: '1 1 260px' }}>
          <label className={styles.label} htmlFor="newDisputeReason">
            New reason
          </label>
          <input
            id="newDisputeReason"
            className={styles.input}
            value={draft}
            maxLength={ITEM_MAX}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="e.g. Already fixed in another ticket"
            disabled={busy || reasons.length >= MAX_ITEMS}
          />
        </div>
        <button className={`${styles.button} ${styles.buttonAccent}`} type="submit" disabled={busy || !draft.trim() || reasons.length >= MAX_ITEMS}>
          Add
        </button>
      </form>
    </div>
  );
}
