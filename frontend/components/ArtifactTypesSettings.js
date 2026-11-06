import { useEffect, useState } from 'react';
import styles from '../styles/issues.module.css';
import { apiFetch } from '../lib/api';
import { useToast } from '../lib/toast';

// Artifact types section of Admin -> Submission Checklist Settings
// (2026-11-06). Admin and Program Manager (backend:
// SubmissionChecklistController + ArtifactTypesService): add, rename,
// deactivate and reorder the submission artifact types, and per role
// (Developer / Designer / DevOps) choose which types are offered and which
// are required. A role with no rules is offered every active type, all
// optional. The code a type was created with never changes - renaming only
// changes what people see. Every change is audited on the server.
const LABEL_MAX = 60;
const TYPES_MAX = 50;
const NOT_OFFERED = '';

export default function ArtifactTypesSettings() {
  const { showToast } = useToast();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(null);
  const [newLabel, setNewLabel] = useState('');
  const [editing, setEditing] = useState(null); // { id, label }
  // Per role: null = not editing; otherwise { mode: 'all' | 'choose', picks: { [typeId]: 'optional' | 'required' } }
  const [drafts, setDrafts] = useState({});

  useEffect(() => {
    apiFetch('/submission-checklist/artifact-types')
      .then(setData)
      .catch((err) => setError(err.message));
  }, []);

  const run = async (key, fn, message) => {
    setBusy(key);
    setError('');
    try {
      const next = await fn();
      setData(next);
      showToast(message, 'success');
      return true;
    } catch (err) {
      setError(err.message);
      return false;
    } finally {
      setBusy(null);
    }
  };

  if (!data) {
    return (
      <div className={styles.card} style={{ marginBottom: 'var(--space-4)' }}>
        <h2 className={styles.cardTitle}>Artifact types</h2>
        {error ? (
          <div className={styles.error} role="alert">
            {error}
          </div>
        ) : (
          <p className={styles.helpText}>Loading...</p>
        )}
      </div>
    );
  }

  const types = data.types;
  const labelOf = (id) => types.find((t) => t.id === id)?.label ?? `#${id}`;
  const disabled = busy !== null;

  const addType = async (e) => {
    e.preventDefault();
    const label = newLabel.trim();
    if (!label) return;
    const ok = await run('add', () => apiFetch('/submission-checklist/artifact-types', { method: 'POST', body: JSON.stringify({ label }) }), `Added "${label}"`);
    if (ok) setNewLabel('');
  };

  const saveLabel = async (e) => {
    e.preventDefault();
    const label = editing.label.trim();
    const ok = await run(
      `t${editing.id}`,
      () => apiFetch(`/submission-checklist/artifact-types/${editing.id}`, { method: 'PATCH', body: JSON.stringify({ label }) }),
      `Renamed to "${label}"`,
    );
    if (ok) setEditing(null);
  };

  const setActive = (t, active) =>
    run(
      `t${t.id}`,
      () => apiFetch(`/submission-checklist/artifact-types/${t.id}`, { method: 'PATCH', body: JSON.stringify({ active }) }),
      active ? `"${t.label}" is active again` : `"${t.label}" is inactive - past submissions keep it`,
    );

  const move = (index, delta) => {
    const ids = types.map((t) => t.id);
    const [id] = ids.splice(index, 1);
    ids.splice(index + delta, 0, id);
    run('order', () => apiFetch('/submission-checklist/artifact-types/order', { method: 'PUT', body: JSON.stringify({ ids }) }), 'Order saved');
  };

  const rulesFor = (role) => data.rules.filter((r) => r.role === role);

  const startEditRules = (role) => {
    const rules = rulesFor(role);
    const picks = {};
    rules.forEach((r) => {
      picks[r.artifactTypeId] = r.requirement;
    });
    setDrafts((d) => ({ ...d, [role]: { mode: rules.length ? 'choose' : 'all', picks } }));
  };
  const cancelRules = (role) => setDrafts((d) => ({ ...d, [role]: null }));
  const setDraft = (role, patch) => setDrafts((d) => ({ ...d, [role]: { ...d[role], ...patch } }));

  const saveRules = async (role, roleLabel) => {
    const draft = drafts[role];
    const rules =
      draft.mode === 'all'
        ? []
        : Object.entries(draft.picks)
            .filter(([, v]) => v !== NOT_OFFERED)
            .map(([id, requirement]) => ({ artifactTypeId: Number(id), requirement }));
    if (draft.mode === 'choose' && rules.length === 0) {
      setError(`Pick at least one type for ${roleLabel}, or choose "Offer every active type".`);
      return;
    }
    const ok = await run(
      `r${role}`,
      () => apiFetch(`/submission-checklist/artifact-rules/${role}`, { method: 'PUT', body: JSON.stringify({ rules }) }),
      `Saved the artifact rules for ${roleLabel}`,
    );
    if (ok) cancelRules(role);
  };

  const ruleSummary = (role) => {
    const rules = rulesFor(role);
    if (!rules.length) return 'Every active type, all optional';
    const required = rules.filter((r) => r.requirement === 'required').map((r) => labelOf(r.artifactTypeId));
    const optional = rules.filter((r) => r.requirement === 'optional').map((r) => labelOf(r.artifactTypeId));
    return [required.length ? `Required: ${required.join(', ')}` : 'Nothing required', optional.length ? `Optional: ${optional.join(', ')}` : null]
      .filter(Boolean)
      .join('. ');
  };

  return (
    <div className={styles.card} style={{ marginBottom: 'var(--space-4)' }}>
      <h2 className={styles.cardTitle}>Artifact types</h2>
      <p className={styles.helpText} style={{ marginTop: 0 }}>
        The types a developer, designer or DevOps engineer can attach when submitting for feedback or peer review. Renaming changes only
        the name people see - past submissions keep their type. Types can be made inactive but not deleted.
      </p>
      <p className={styles.helpText} role="note">
        Not used on the submit forms yet: new types, renames, role rules and required types are saved now and take effect in a later
        update.
      </p>

      {error && (
        <div className={styles.error} role="alert">
          {error}
        </div>
      )}

      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Name</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {types.map((t, i) => (
              <tr key={t.id}>
                <td>
                  {editing?.id === t.id ? (
                    <form onSubmit={saveLabel} className={styles.actions} style={{ margin: 0 }}>
                      <label className="sr-only" htmlFor={`atName${t.id}`}>
                        New name for {t.label}
                      </label>
                      <input
                        id={`atName${t.id}`}
                        className={styles.input}
                        value={editing.label}
                        maxLength={LABEL_MAX}
                        onChange={(e) => setEditing({ ...editing, label: e.target.value })}
                        autoFocus
                      />
                      <button className={`${styles.button} ${styles.buttonAccent}`} type="submit" disabled={disabled || !editing.label.trim()}>
                        {busy === `t${t.id}` ? 'Saving...' : 'Save'}
                      </button>
                      <button className={styles.buttonSecondary} type="button" onClick={() => setEditing(null)} disabled={disabled}>
                        Cancel
                      </button>
                    </form>
                  ) : (
                    <>
                      {t.label}
                      {t.label !== t.code && <div className={styles.issueMeta}>Stored as &quot;{t.code}&quot;</div>}
                    </>
                  )}
                </td>
                <td>{t.active ? 'Active' : <span className={styles.issueMeta}>Inactive</span>}</td>
                <td>
                  <span style={{ display: 'inline-flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
                    <button className={styles.buttonSecondary} type="button" onClick={() => move(i, -1)} disabled={disabled || i === 0} aria-label={`Move "${t.label}" up`}>
                      Up
                    </button>
                    <button
                      className={styles.buttonSecondary}
                      type="button"
                      onClick={() => move(i, 1)}
                      disabled={disabled || i === types.length - 1}
                      aria-label={`Move "${t.label}" down`}
                    >
                      Down
                    </button>
                    <button
                      className={styles.buttonSecondary}
                      type="button"
                      onClick={() => setEditing({ id: t.id, label: t.label })}
                      disabled={disabled || editing !== null}
                      aria-label={`Rename "${t.label}"`}
                    >
                      Rename
                    </button>
                    <button
                      className={styles.buttonSecondary}
                      type="button"
                      onClick={() => setActive(t, !t.active)}
                      disabled={disabled}
                      aria-label={`${t.active ? 'Deactivate' : 'Reactivate'} "${t.label}"`}
                    >
                      {t.active ? 'Deactivate' : 'Reactivate'}
                    </button>
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <form onSubmit={addType} className={styles.actions} style={{ alignItems: 'end', marginBottom: 'var(--space-5)' }}>
        <div className={styles.field} style={{ marginBottom: 0, flex: '1 1 260px' }}>
          <label className={styles.label} htmlFor="atNewLabel">
            New artifact type
          </label>
          <input
            id="atNewLabel"
            className={styles.input}
            value={newLabel}
            maxLength={LABEL_MAX}
            onChange={(e) => setNewLabel(e.target.value)}
            placeholder="e.g. Figma board"
            disabled={disabled || types.length >= TYPES_MAX}
          />
        </div>
        <button className={`${styles.button} ${styles.buttonAccent}`} type="submit" disabled={disabled || !newLabel.trim() || types.length >= TYPES_MAX}>
          {busy === 'add' ? 'Adding...' : 'Add'}
        </button>
      </form>

      <h3 className={styles.label} style={{ fontSize: 'var(--ds-text-base)' }}>
        By role
      </h3>
      <p className={styles.helpText} style={{ marginTop: 0 }}>
        Which types each role is offered, and which they must attach. Required applies when submitting for feedback and for peer review.
        A role with no rules is offered every active type, all optional.
      </p>
      {data.roles.map(({ value: role, label: roleLabel }) => {
        const draft = drafts[role];
        return (
          <fieldset key={role} style={{ border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: 'var(--space-3)', margin: '0 0 var(--space-3)' }}>
            <legend className={styles.label} style={{ padding: '0 var(--space-1)' }}>
              {roleLabel}
            </legend>
            {!draft ? (
              <div className={styles.actions} style={{ margin: 0, justifyContent: 'space-between', alignItems: 'center' }}>
                <span>{ruleSummary(role)}</span>
                <button className={styles.buttonSecondary} type="button" onClick={() => startEditRules(role)} disabled={disabled} aria-label={`Edit artifact rules for ${roleLabel}`}>
                  Edit
                </button>
              </div>
            ) : (
              <>
                <div role="radiogroup" aria-label={`Artifact types offered to ${roleLabel}`} style={{ display: 'flex', gap: 'var(--space-4)', flexWrap: 'wrap', marginBottom: 'var(--space-2)' }}>
                  <label style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-1)' }}>
                    <input type="radio" name={`atMode${role}`} checked={draft.mode === 'all'} onChange={() => setDraft(role, { mode: 'all' })} />
                    Offer every active type, all optional
                  </label>
                  <label style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-1)' }}>
                    <input type="radio" name={`atMode${role}`} checked={draft.mode === 'choose'} onChange={() => setDraft(role, { mode: 'choose' })} />
                    Choose types for {roleLabel}
                  </label>
                </div>
                {draft.mode === 'choose' && (
                  <div className={styles.tableWrap}>
                    <table className={styles.table}>
                      <thead>
                        <tr>
                          <th>Type</th>
                          <th>For {roleLabel}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {types
                          .filter((t) => t.active)
                          .map((t) => (
                            <tr key={t.id}>
                              <td>
                                <label htmlFor={`atRule${role}${t.id}`}>{t.label}</label>
                              </td>
                              <td>
                                <select
                                  id={`atRule${role}${t.id}`}
                                  className={styles.input}
                                  style={{ maxWidth: 180 }}
                                  value={draft.picks[t.id] ?? NOT_OFFERED}
                                  onChange={(e) => setDraft(role, { picks: { ...draft.picks, [t.id]: e.target.value } })}
                                >
                                  <option value={NOT_OFFERED}>Not offered</option>
                                  <option value="optional">Optional</option>
                                  <option value="required">Required</option>
                                </select>
                              </td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                )}
                <div className={styles.actions} style={{ marginBottom: 0 }}>
                  <button className={`${styles.button} ${styles.buttonAccent}`} type="button" onClick={() => saveRules(role, roleLabel)} disabled={disabled}>
                    {busy === `r${role}` ? 'Saving...' : 'Save'}
                  </button>
                  <button className={styles.buttonSecondary} type="button" onClick={() => cancelRules(role)} disabled={disabled}>
                    Cancel
                  </button>
                </div>
              </>
            )}
          </fieldset>
        );
      })}
    </div>
  );
}
