import { useState } from 'react';
import Link from 'next/link';
import { Building2, Plus, Pencil, CheckCircle2, RotateCcw } from 'lucide-react';
import Badge from '../ui/Badge';
import Button from '../ui/Button';
import Input from '../ui/Input';
import Modal from '../ui/Modal';
import Select from '../ui/Select';
import fieldStyles from '../ui/Field.module.css';
import { apiFetch } from '../../lib/api';
import { formatDate } from '../../lib/formatDate';
import { daysBetween, waitingLabel } from '../../lib/dailyScrumText';
import { useToast } from '../../lib/toast';
import styles from '../../styles/dailyScrum.module.css';

// Daily Scrum Stage 3 - "Waiting on the city office". A hand-kept list
// (GET/POST/PATCH /daily-scrum/external-waits): PM/Executive/Admin see it,
// Admin and Program Manager add, edit and resolve
// (DailyScrumController.ROLES_ALLOWED_TO_EDIT_EXTERNAL_WAITS). Rows are
// resolved, never deleted.

const EMPTY = { title: '', party: 'City office', taskId: '', followUpUserId: '', requestedOn: '', expectedBy: '', note: '' };

function toForm(wait, today) {
  if (!wait) return { ...EMPTY, requestedOn: today };
  return {
    title: wait.title,
    party: wait.party,
    taskId: wait.taskId ?? '',
    followUpUserId: wait.followUpUserId ?? '',
    requestedOn: wait.requestedOn,
    expectedBy: wait.expectedBy ?? '',
    note: wait.note ?? '',
  };
}

function WaitForm({ wait, today, people, onClose, onSaved }) {
  const { showToast } = useToast();
  const [form, setForm] = useState(() => toForm(wait, today));
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (!form.title.trim()) {
      setError('Say what the team is waiting for.');
      return;
    }
    if (form.taskId !== '' && !/^\d+$/.test(String(form.taskId).trim())) {
      setError('Ticket must be a ticket number, like 123.');
      return;
    }
    const body = {
      title: form.title.trim(),
      party: form.party.trim() || 'City office',
      taskId: form.taskId === '' ? null : Number(String(form.taskId).trim()),
      followUpUserId: form.followUpUserId === '' ? null : Number(form.followUpUserId),
      requestedOn: form.requestedOn,
      expectedBy: form.expectedBy || null,
      note: form.note.trim() || null,
    };
    setSaving(true);
    try {
      await apiFetch(wait ? `/daily-scrum/external-waits/${wait.id}` : '/daily-scrum/external-waits', {
        method: wait ? 'PATCH' : 'POST',
        body: JSON.stringify(body),
      });
      showToast(wait ? 'External wait updated.' : 'External wait added.', 'success');
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={wait ? 'Edit external wait' : 'Add external wait'}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" form="external-wait-form" loading={saving}>
            {wait ? 'Save' : 'Add'}
          </Button>
        </>
      }
    >
      <form id="external-wait-form" className={styles.form} onSubmit={submit} noValidate>
        {error && (
          <p className={fieldStyles.error} role="alert">
            {error}
          </p>
        )}
        <Input label="Waiting for" required maxLength={200} value={form.title} onChange={set('title')} placeholder="e.g. Building permit stamp" />
        <div className={styles.formRow}>
          <Input label="Waiting on" maxLength={120} value={form.party} onChange={set('party')} hint="City office unless you change it" />
          <Input label="Ticket number" inputMode="numeric" value={form.taskId} onChange={set('taskId')} hint="Optional - the ticket it holds up" />
        </div>
        <Select label="Follow-up person" value={form.followUpUserId} onChange={set('followUpUserId')}>
          <option value="">Nobody</option>
          {people.map((p) => (
            <option key={p.userId} value={p.userId}>
              {p.name}
            </option>
          ))}
        </Select>
        <div className={styles.formRow}>
          <Input label="Requested on" type="date" required value={form.requestedOn} onChange={set('requestedOn')} />
          <Input label="Expected by" type="date" value={form.expectedBy} min={form.requestedOn || undefined} onChange={set('expectedBy')} />
        </div>
        <div className={fieldStyles.field}>
          <label className={fieldStyles.label} htmlFor="external-wait-note">
            Note
          </label>
          <textarea id="external-wait-note" className={`${fieldStyles.input} ${styles.textarea}`} rows={3} maxLength={2000} value={form.note} onChange={set('note')} />
        </div>
      </form>
    </Modal>
  );
}

export default function ExternalWaitsBox({ waits, today, canEdit, people, showResolved, onToggleResolved, onChanged }) {
  const { showToast } = useToast();
  const [editing, setEditing] = useState(null); // null | 'new' | wait
  const [busyId, setBusyId] = useState(null);
  const open = waits.filter((w) => w.status === 'open');
  const resolved = waits.filter((w) => w.status === 'resolved');

  const setStatus = async (wait, status) => {
    setBusyId(wait.id);
    try {
      await apiFetch(`/daily-scrum/external-waits/${wait.id}`, { method: 'PATCH', body: JSON.stringify({ status }) });
      showToast(status === 'resolved' ? 'Marked resolved.' : 'Reopened.', 'success');
      onChanged();
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setBusyId(null);
    }
  };

  const row = (w) => {
    const days = daysBetween(w.requestedOn, today);
    const late = w.status === 'open' && w.expectedBy && w.expectedBy < today;
    return (
      <li key={w.id} className={`${styles.card} ${styles.cardCompact}`}>
        <div className={styles.waitHead}>
          <span className={styles.waitTitle}>{w.title}</span>
          {w.status === 'open' ? (
            <Badge tone={late ? 'error' : days >= 5 ? 'warning' : 'neutral'}>{waitingLabel(w.requestedOn, today)}</Badge>
          ) : (
            <Badge tone="success">Resolved</Badge>
          )}
        </div>
        <p className={styles.cardMeta}>
          {w.party} · asked {formatDate(w.requestedOn)}
          {w.expectedBy ? ` · expected ${formatDate(w.expectedBy)}` : ''}
          {w.followUpName ? ` · follow-up ${w.followUpName}` : ''}
        </p>
        {w.taskId != null && (
          <p className={styles.cardMeta}>
            <Link href={`/tasks/${w.taskId}`} className={styles.link}>
              #{w.taskId} {w.taskTitle}
            </Link>
          </p>
        )}
        {w.note && <p className={styles.cardMeta}>{w.note}</p>}
        {w.status === 'resolved' && (
          <p className={styles.cardMeta}>
            Resolved {formatDate(w.resolvedAt)}
            {w.resolvedByName ? ` by ${w.resolvedByName}` : ''}
          </p>
        )}
        {(late || canEdit) && (
          <div className={styles.waitFoot}>
            {late && (
              <Badge tone="error" dot>
                Past expected date
              </Badge>
            )}
            {canEdit && (
              <span className={styles.rowActions}>
                {w.status === 'open' && (
                  <Button type="button" size="sm" variant="ghost" leftIcon={Pencil} onClick={() => setEditing(w)} aria-label={`Edit ${w.title}`}>
                    Edit
                  </Button>
                )}
                {w.status === 'open' ? (
                  <Button type="button" size="sm" variant="ghost" leftIcon={CheckCircle2} loading={busyId === w.id} onClick={() => setStatus(w, 'resolved')} aria-label={`Mark ${w.title} resolved`}>
                    Resolve
                  </Button>
                ) : (
                  <Button type="button" size="sm" variant="ghost" leftIcon={RotateCcw} loading={busyId === w.id} onClick={() => setStatus(w, 'open')} aria-label={`Reopen ${w.title}`}>
                    Reopen
                  </Button>
                )}
              </span>
            )}
          </div>
        )}
      </li>
    );
  };

  return (
    <section className={styles.panel} aria-labelledby="scrum-external">
      <h2 id="scrum-external" className={styles.panelTitle}>
        <Building2 size={16} aria-hidden="true" />
        <span>Waiting on the city office</span>
        <span className={styles.count}>{open.length}</span>
        {canEdit && (
          <Button type="button" size="sm" variant="secondary" leftIcon={Plus} onClick={() => setEditing('new')} className={styles.panelAction}>
            Add
          </Button>
        )}
      </h2>
      {open.length === 0 ? <p className={styles.empty}>The team isn&apos;t waiting on anything outside.</p> : <ul className={styles.cards}>{open.map(row)}</ul>}
      {showResolved && resolved.length > 0 && (
        <>
          <h3 className={styles.subHeading}>Resolved</h3>
          <ul className={styles.cards}>{resolved.map(row)}</ul>
        </>
      )}
      {showResolved && resolved.length === 0 && <p className={styles.empty}>Nothing resolved yet.</p>}
      <button type="button" className={styles.textButton} onClick={onToggleResolved} aria-pressed={showResolved}>
        {showResolved ? 'Hide resolved' : 'Show resolved'}
      </button>
      {editing && (
        <WaitForm
          wait={editing === 'new' ? null : editing}
          today={today}
          people={people}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            onChanged();
          }}
        />
      )}
    </section>
  );
}
