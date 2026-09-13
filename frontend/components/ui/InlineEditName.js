import { useState } from 'react';
import { Pencil, Check, X } from 'lucide-react';
import styles from './InlineEditName.module.css';

// Click-to-edit name field for admin catalog tables (Project Phases,
// Project Teams, Issue Categories) - a pencil icon turns the plain text
// into an inline textbox with Save/Cancel, no popup/modal. `onSave` is an
// async function the caller provides (a PATCH request); a thrown error
// (e.g. the backend's 409 on a duplicate name) is shown right next to
// this field and leaves editing open so the user can fix it, rather than
// a page-level banner disconnected from which row failed.
export default function InlineEditName({ value, onSave, canEdit = false }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  if (!canEdit) {
    return <span>{value}</span>;
  }

  const startEdit = () => {
    setDraft(value);
    setError('');
    setEditing(true);
  };

  const cancel = () => {
    setEditing(false);
    setError('');
  };

  const save = async () => {
    const trimmed = draft.trim();
    if (!trimmed) {
      setError('Name is required.');
      return;
    }
    if (trimmed === value) {
      setEditing(false);
      return;
    }
    setSaving(true);
    setError('');
    try {
      await onSave(trimmed);
      setEditing(false);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  if (!editing) {
    return (
      <span className={styles.wrap}>
        <span>{value}</span>
        <button type="button" className={styles.iconButton} aria-label={`Edit ${value}`} onClick={startEdit}>
          <Pencil size={13} aria-hidden="true" />
        </button>
      </span>
    );
  }

  return (
    <span className={styles.wrap}>
      <input
        className={styles.input}
        value={draft}
        autoFocus
        disabled={saving}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') save();
          if (e.key === 'Escape') cancel();
        }}
      />
      <button type="button" className={styles.iconButton} aria-label="Save" onClick={save} disabled={saving}>
        <Check size={14} aria-hidden="true" />
      </button>
      <button type="button" className={styles.iconButton} aria-label="Cancel" onClick={cancel} disabled={saving}>
        <X size={14} aria-hidden="true" />
      </button>
      {error && <span className={styles.error}>{error}</span>}
    </span>
  );
}
