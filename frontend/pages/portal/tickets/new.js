import { useRef, useState } from 'react';
import { useRouter } from 'next/router';
import PortalShell from '../../../components/portal/PortalShell';
import Button from '../../../components/ui/Button';
import Input from '../../../components/ui/Input';
import Select from '../../../components/ui/Select';
import { apiFetch } from '../../../lib/api';
import { useToast } from '../../../lib/toast';
import { CATEGORIES, PRIORITIES, SEVERITIES, uploadTicketFiles } from '../../../lib/clientTickets';
import { FilePicker } from '../../../components/portal/TicketFiles';
import styles from '../../../styles/portal.module.css';

// Radio cards (category, severity). Native radios inside labels, so
// keyboard and screen readers get a normal radio group.
function OptionGroup({ legend, name, options, value, onChange, extra }) {
  return (
    <fieldset className={styles.fieldset}>
      <legend className={styles.legend}>{legend}</legend>
      <div className={styles.options}>
        {options.map((o) => (
          <label key={o.value} className={`${styles.option} ${value === o.value ? styles.optionSelected : ''}`}>
            <input type="radio" name={name} value={o.value} checked={value === o.value} onChange={() => onChange(o.value)} />
            <span className={styles.optionLabel}>{o.label}</span>
            <span className={styles.optionHint}>{o.hint}</span>
            {extra && <span className={styles.optionHint}>{extra(o)}</span>}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function TextArea({ id, label, value, onChange, error, required, rows = 5, hint }) {
  return (
    <div>
      <label htmlFor={id} className={styles.fieldLabel}>
        {label}
        {required && <span aria-hidden="true"> *</span>}
      </label>
      {hint && <p id={`${id}-hint`} className={styles.muted}>{hint}</p>}
      <textarea
        id={id}
        className={styles.textarea}
        rows={rows}
        maxLength={10000}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
        aria-invalid={Boolean(error)}
        aria-describedby={[hint && `${id}-hint`, error && `${id}-error`].filter(Boolean).join(' ') || undefined}
      />
      {error && <p id={`${id}-error`} className={styles.fieldError} role="alert">{error}</p>}
    </div>
  );
}

function NewTicket({ me }) {
  const router = useRouter();
  const { showToast } = useToast();
  const modules = me.portalClient.modules;
  const [form, setForm] = useState({
    category: 'bug',
    severity: 'major',
    priority: 'medium',
    moduleId: modules.length === 1 ? String(modules[0].id) : '',
    title: '',
    description: '',
    stepsToReproduce: '',
    expectedResult: '',
  });
  const [files, setFiles] = useState([]);
  const [errors, setErrors] = useState({});
  const [submitError, setSubmitError] = useState('');
  const [saving, setSaving] = useState(false);
  const errorSummary = useRef(null);
  const set = (key) => (value) => setForm((f) => ({ ...f, [key]: value }));
  const isBug = form.category === 'bug';

  const submit = async (e) => {
    e.preventDefault();
    const next = {};
    if (!form.moduleId) next.moduleId = 'Choose the module.';
    if (!form.title.trim()) next.title = 'Give the ticket a short title.';
    if (!form.description.trim()) next.description = 'Describe what happened.';
    setErrors(next);
    if (Object.keys(next).length) {
      document.getElementById(`ticket-${Object.keys(next)[0]}`)?.focus();
      return;
    }
    setSaving(true);
    setSubmitError('');
    try {
      const ticket = await apiFetch('/client-portal/tickets', {
        method: 'POST',
        body: JSON.stringify({
          category: form.category,
          severity: form.severity,
          priority: form.priority,
          moduleId: Number(form.moduleId),
          title: form.title.trim(),
          description: form.description.trim(),
          ...(isBug ? { stepsToReproduce: form.stepsToReproduce.trim(), expectedResult: form.expectedResult.trim() } : {}),
        }),
      });
      if (files.length) {
        try {
          await uploadTicketFiles(ticket.id, files);
        } catch (err) {
          // The ticket exists - say so, and let them add the files from the ticket page.
          showToast(`Ticket ${ticket.key} submitted, but the files were not attached: ${err.message} You can add them from the ticket.`, 'error', 9000);
          router.push(`/portal/tickets/${ticket.id}`);
          return;
        }
      }
      showToast(`Ticket ${ticket.key} submitted. The team has been notified.`, 'success');
      router.push(`/portal/tickets/${ticket.id}`);
    } catch (err) {
      setSubmitError(err.message);
      setSaving(false);
      errorSummary.current?.focus();
    }
  };

  return (
    <>
      <div className={styles.pageHeader}>
        <div>
          <p className={styles.kicker}>New ticket</p>
          <h1 className={styles.pageTitle}>Report an issue</h1>
          <p className={styles.pageSubtitle}>Tell us what happened. The right team is notified the moment you submit.</p>
        </div>
      </div>

      {submitError && (
        <div className={styles.error} role="alert" tabIndex={-1} ref={errorSummary}>
          {submitError}
        </div>
      )}

      <form className={styles.form} onSubmit={submit} noValidate>
        <OptionGroup legend="1. What kind of ticket is this?" name="category" options={CATEGORIES} value={form.category} onChange={set('category')} />
        <OptionGroup
          legend="2. How serious is it?"
          name="severity"
          options={SEVERITIES}
          value={form.severity}
          onChange={set('severity')}
          extra={(o) => o.target}
        />

        <div className={styles.row2}>
          <Select id="ticket-moduleId" label="Module" required value={form.moduleId} onChange={(e) => set('moduleId')(e.target.value)} error={errors.moduleId}>
            <option value="">Choose a module</option>
            {modules.map((m) => (
              <option key={m.id} value={m.id}>{m.name}</option>
            ))}
          </Select>
          <Select label="Priority for your team" value={form.priority} onChange={(e) => set('priority')(e.target.value)}>
            {PRIORITIES.map((p) => (
              <option key={p.value} value={p.value}>{p.label}</option>
            ))}
          </Select>
        </div>

        <Input
          id="ticket-title"
          label="Title"
          required
          maxLength={120}
          value={form.title}
          onChange={(e) => set('title')(e.target.value)}
          error={errors.title}
          hint="A short summary, e.g. “Claim totals exclude the last line”"
        />
        <TextArea id="ticket-description" label="Description" required value={form.description} onChange={set('description')} error={errors.description} />
        {isBug && (
          <div className={styles.row2}>
            <TextArea id="ticket-steps" label="Steps to reproduce" rows={4} value={form.stepsToReproduce} onChange={set('stepsToReproduce')} hint="Optional" />
            <TextArea id="ticket-expected" label="Expected result" rows={4} value={form.expectedResult} onChange={set('expectedResult')} hint="Optional" />
          </div>
        )}

        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>Screenshots or documents (optional)</legend>
          <FilePicker files={files} onChange={setFiles} disabled={saving} />
        </fieldset>

        <div className={styles.formActions}>
          <Button type="button" variant="secondary" href="/portal/tickets">Cancel</Button>
          <Button type="submit" loading={saving}>Submit ticket</Button>
        </div>
      </form>
    </>
  );
}

export default function NewPortalTicketPage() {
  return <PortalShell>{(ctx) => <NewTicket {...ctx} />}</PortalShell>;
}
