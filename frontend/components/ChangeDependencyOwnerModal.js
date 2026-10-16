import { useEffect, useState } from 'react';
import Modal from './ui/Modal';
import Button from './ui/Button';
import styles from '../styles/issues.module.css';
import { roleLabel } from '../lib/status';

// PM/Admin moving an open dependency ticket to a different owner
// (2026-10-14). `people` is the Developer/Designer/DevOps list ({ id,
// name, role }) - the same owners the backend allows (see
// TaskDependencyTicketsService.changeOwner). The current owner and the
// person who raised the ticket are left out, since the backend rejects
// both. There is no "no owner" choice. The list is native radio buttons
// rather than SearchSelectField so it is fully keyboard operable and is
// not clipped by the dialog's scroll area. `submit` receives the chosen
// user id; on failure the server's message is shown in place and the
// dialog stays open.
export default function ChangeDependencyOwnerModal({ open, ticket, people, onClose, submit }) {
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (open) {
      setQuery('');
      setSelectedId(null);
      setError('');
      setBusy(false);
    }
  }, [open]);

  if (!ticket) return null;

  const q = query.trim().toLowerCase();
  const choices = people
    .filter((p) => p.id !== ticket.ownerUserId && p.id !== ticket.createdByUserId)
    .filter((p) => !q || p.name.toLowerCase().includes(q))
    .sort((a, b) => a.name.localeCompare(b.name));

  const handleSave = async () => {
    if (selectedId == null || busy) return;
    setBusy(true);
    setError('');
    try {
      await submit(selectedId);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={busy ? () => {} : onClose}
      title="Change dependency owner"
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={selectedId == null} loading={busy}>
            Save
          </Button>
        </>
      }
    >
      <p className={styles.issueMeta} style={{ marginTop: 0 }}>
        <strong>{ticket.title}</strong>
        <br />
        Current owner: {ticket.ownerName || ticket.ownerEmail}. The new owner gets a notification, and the change is
        recorded in the dependency history.
      </p>
      <label className={styles.label} htmlFor="dependencyOwnerSearch">
        Search people
      </label>
      <input
        id="dependencyOwnerSearch"
        className={styles.input}
        type="search"
        autoComplete="off"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Type a name"
        aria-controls="dependencyOwnerChoices"
      />
      <fieldset
        id="dependencyOwnerChoices"
        style={{
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--ds-radius-md)',
          margin: 'var(--ds-space-3) 0 0',
          padding: 'var(--ds-space-2)',
          maxHeight: 260,
          overflowY: 'auto',
        }}
      >
        <legend className={styles.label} style={{ padding: '0 var(--ds-space-1)' }}>
          New owner
        </legend>
        {choices.length === 0 && (
          <p className={styles.issueMeta} style={{ margin: 'var(--ds-space-2)' }}>
            No matching Developer, Designer or DevOps.
          </p>
        )}
        {choices.map((p) => (
          <label
            key={p.id}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--ds-space-2)',
              padding: 'var(--ds-space-2)',
              borderRadius: 'var(--ds-radius-sm)',
              cursor: 'pointer',
              background: selectedId === p.id ? 'var(--ds-bg-surface-sunken)' : undefined,
            }}
          >
            <input
              type="radio"
              name="dependencyOwner"
              value={p.id}
              checked={selectedId === p.id}
              onChange={() => setSelectedId(p.id)}
            />
            <span>{p.name}</span>
            {p.role && <span className={styles.issueMeta}>{roleLabel(p.role)}</span>}
          </label>
        ))}
      </fieldset>
      {error && (
        <p role="alert" style={{ color: 'var(--color-red-dark)', marginBottom: 0 }}>
          {error}
        </p>
      )}
    </Modal>
  );
}
