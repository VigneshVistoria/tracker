import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import AppShell from '../../components/AppShell';
import SearchSelectField from '../../components/SearchSelectField';
import RichTextEditor from '../../components/ui/RichTextEditor';
import ScreenshotAttach from '../../components/ScreenshotAttach';
import styles from '../../styles/issues.module.css';
import { apiFetch } from '../../lib/api';
import { useToast } from '../../lib/toast';
import { stripHtmlForPreview } from '../../lib/richText';
import { TASK_TITLE_MAX_LENGTH } from '../../lib/taskTitle';
import { formatRelativeTime } from '../../lib/formatDate';
import { uploadDefectScreenshots } from '../../lib/defectScreenshots';
import { redirectToSignIn } from '../../lib/session';

const VIEW_ROLES = ['qa'];

function userToOption(u) {
  return { id: u.id, name: u.fullName || u.email };
}

const EMPTY_FORM = { project: null, module: null, phase: null, title: '', description: '', assignee: null };

// Same list as QA_ARTIFACT_TYPES on the task detail page (pages/tasks/[id].js)
// - this is the same "QA's own evidence" concept, just captured at
// ticket-creation time instead of at Approve/Reject.
const ARTIFACT_TYPES = [
  'Test Case / Test Plan',
  'Test Execution Report',
  'Bug Report',
  'Screenshot',
  'Screen Recording / Video',
  'Log File',
  'Staging / Test Environment URL',
  'Regression Test Results',
  'Automated Test Run',
  'Sign-off / Acceptance Report',
];

// In-progress form autosave - same idea as the QA-rejection draft on the
// task detail page (qaRejectDraft:<taskId> in pages/tasks/[id].js), but
// localStorage rather than sessionStorage so a draft also survives a
// closed tab, a browser restart, or logging out and back in. Nothing here
// ever reaches the server - a draft is not a ticket, so it can't show up
// in My Defects, QA Review, counts, SLA, Daily Scrum or notifications.
// Keyed per user so a different user on the same browser never sees it,
// and kept on logout (that user gets it back when they log in again).
// Skipped entirely while impersonating, so drafts never cross users.
const DRAFT_SAVE_DELAY_MS = 2000;
const DRAFT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function draftKeyFor(userId) {
  return `defectDraft:new:${userId}`;
}

// Only text the user actually typed counts - a bare Project/Assignee
// pick on its own isn't worth a "Restore your draft?" prompt.
function hasDraftContent(form, artifacts) {
  return (
    !!form.title.trim() ||
    !!stripHtmlForPreview(form.description).trim() ||
    artifacts.some((row) => row.type || row.url.trim())
  );
}

function pickOption(option) {
  return option ? { id: option.id, name: option.name } : null;
}

// Returns the saved draft, or null - dropping (not just ignoring) one
// that's unreadable or older than DRAFT_MAX_AGE_MS.
function loadDraft(key) {
  try {
    const draft = JSON.parse(localStorage.getItem(key) || 'null');
    if (!draft) return null;
    if (!draft.form || typeof draft.savedAt !== 'number' || Date.now() - draft.savedAt > DRAFT_MAX_AGE_MS) {
      localStorage.removeItem(key);
      return null;
    }
    return draft;
  } catch {
    localStorage.removeItem(key);
    return null;
  }
}

// Create Defect - QA only, always category "Defect", assigned straight to
// a Developer, no Task Backlog step and never linked to another ticket.
// Project/Module/Phase stay required, same as every other task (needed
// for scoping/KPI/dashboards) - this form reuses the exact same
// cascading Project->Module->Phase pickers as Task Backlog's own create
// form (pages/tasks/backlog.js).
export default function NewDefectPage() {
  const router = useRouter();
  const { showToast } = useToast();

  const [user, setUser] = useState(null);
  const [projects, setProjects] = useState([]);
  const [developers, setDevelopers] = useState([]);
  const [modules, setModules] = useState([]);
  const [phases, setPhases] = useState([]);
  const [form, setForm] = useState(EMPTY_FORM);
  // Optional evidence (screenshot, bug report, etc.) attached at filing
  // time - empty by default, unlike the developer's later mandatory
  // submission artifacts.
  const [artifacts, setArtifacts] = useState([]);
  const [saving, setSaving] = useState(false);
  // Pasted/captured screenshots ({ id, blob, name, url }) - uploaded once
  // the defect exists. Never part of the draft. If the upload fails, the
  // defect is already created: createdDefect + screenshotError offer a
  // retry instead of a second Create (which would duplicate the defect).
  const [screenshots, setScreenshots] = useState([]);
  const [createdDefect, setCreatedDefect] = useState(null);
  const [screenshotError, setScreenshotError] = useState('');
  const screenshotsRef = useRef(screenshots);
  screenshotsRef.current = screenshots;
  const screenshotsUploadedRef = useRef(false);
  const [error, setError] = useState('');
  const [optionsLoaded, setOptionsLoaded] = useState(false);

  // Draft autosave state - see the comment on DRAFT_SAVE_DELAY_MS above.
  // draftReady stays false while a saved draft is waiting on Restore /
  // Discard, so typing in the meantime can't overwrite it.
  const [draftKey, setDraftKey] = useState(null);
  const [pendingDraft, setPendingDraft] = useState(null);
  const [draftReady, setDraftReady] = useState(false);
  const [draftStatus, setDraftStatus] = useState('');
  const [draftNotice, setDraftNotice] = useState('');
  const latestRef = useRef({ form, artifacts });
  latestRef.current = { form, artifacts };
  const draftKeyRef = useRef(null);
  draftKeyRef.current = draftReady ? draftKey : null;
  const submittedRef = useRef(false);
  // Only clear a stored draft this page itself wrote - otherwise an idle,
  // empty Create Defect tab would wipe a draft saved from another tab
  // just by being left or closed.
  const wroteDraftRef = useRef(false);

  const saveDraftNow = useCallback(() => {
    const key = draftKeyRef.current;
    if (!key || submittedRef.current) return;
    const { form: current, artifacts: currentArtifacts } = latestRef.current;
    try {
      if (!hasDraftContent(current, currentArtifacts)) {
        if (wroteDraftRef.current) localStorage.removeItem(key);
        wroteDraftRef.current = false;
        setDraftStatus('');
        return;
      }
      localStorage.setItem(
        key,
        JSON.stringify({
          savedAt: Date.now(),
          form: {
            project: pickOption(current.project),
            module: pickOption(current.module),
            phase: pickOption(current.phase),
            title: current.title,
            description: current.description,
            assignee: pickOption(current.assignee),
          },
          artifacts: currentArtifacts,
        }),
      );
      wroteDraftRef.current = true;
      setDraftStatus('saved');
    } catch {
      setDraftStatus('error');
    }
  }, []);

  useEffect(() => {
    const storedUser = localStorage.getItem('user');
    if (!storedUser) {
      redirectToSignIn(router);
      return;
    }
    const parsed = JSON.parse(storedUser);
    if (!VIEW_ROLES.includes(parsed.role)) {
      router.replace('/dashboard');
      return;
    }
    setUser(parsed);
    Promise.all([
      apiFetch('/projects').then(setProjects).catch(() => {}),
      apiFetch('/users/assignable?role=developer').then((rows) => setDevelopers(rows.map(userToOption))).catch(() => {}),
    ]).then(() => setOptionsLoaded(true));
    if (parsed.id && !localStorage.getItem('impersonator')) {
      const key = draftKeyFor(parsed.id);
      setDraftKey(key);
      const draft = loadDraft(key);
      if (draft) setPendingDraft(draft);
      else setDraftReady(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  useEffect(() => {
    if (!form.project) {
      setModules([]);
      return;
    }
    apiFetch(`/modules?projectId=${form.project.id}`).then(setModules).catch(() => setModules([]));
  }, [form.project]);

  useEffect(() => {
    if (!form.module) {
      setPhases([]);
      return;
    }
    apiFetch(`/phases?moduleId=${form.module.id}`).then(setPhases).catch(() => setPhases([]));
  }, [form.module]);

  // Debounced autosave - DRAFT_SAVE_DELAY_MS after the last change.
  useEffect(() => {
    if (!draftKey || !draftReady || submittedRef.current) return undefined;
    if (!hasDraftContent(form, artifacts)) {
      saveDraftNow();
      return undefined;
    }
    setDraftStatus('saving');
    const timer = setTimeout(saveDraftNow, DRAFT_SAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [draftKey, draftReady, form, artifacts, saveDraftNow]);

  // Leaving the page: in-app navigation (incl. Log out) just saves the
  // draft straight away - it can be restored, so no need to block. A
  // refresh/tab close also saves, and shows the browser's own "leave
  // site?" prompt while there's typed text that hasn't been submitted.
  useEffect(() => {
    const onBeforeUnload = (e) => {
      saveDraftNow();
      const { form: current, artifacts: currentArtifacts } = latestRef.current;
      const unsavedText = !submittedRef.current && hasDraftContent(current, currentArtifacts);
      const unsentScreenshots = screenshotsRef.current.length > 0 && !screenshotsUploadedRef.current;
      if (!unsavedText && !unsentScreenshots) return;
      e.preventDefault();
      e.returnValue = '';
    };
    router.events.on('routeChangeStart', saveDraftNow);
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      router.events.off('routeChangeStart', saveDraftNow);
      window.removeEventListener('beforeunload', onBeforeUnload);
    };
  }, [router.events, saveDraftNow]);

  if (!user) return null;

  // Restores the saved draft, re-matching Project/Module/Phase/Assignee
  // against what's currently selectable - anything deleted or
  // deactivated since (and whatever sits below it) is left blank with a
  // note, instead of submitting a stale id.
  const restoreDraft = async () => {
    const saved = pendingDraft.form;
    const missing = [];
    const project = saved.project ? projects.find((p) => p.id === saved.project.id) || null : null;
    if (saved.project && !project) missing.push(`Project "${saved.project.name}"`);
    let module = null;
    if (project && saved.module) {
      const moduleOptions = await apiFetch(`/modules?projectId=${project.id}`).catch(() => []);
      module = moduleOptions.find((m) => m.id === saved.module.id) || null;
      if (!module) missing.push(`Module "${saved.module.name}"`);
    }
    let phase = null;
    if (module && saved.phase) {
      const phaseOptions = await apiFetch(`/phases?moduleId=${module.id}`).catch(() => []);
      phase = phaseOptions.find((ph) => ph.id === saved.phase.id) || null;
      if (!phase) missing.push(`Phase "${saved.phase.name}"`);
    }
    const assignee = saved.assignee ? developers.find((d) => d.id === saved.assignee.id) || null : null;
    if (saved.assignee && !assignee) missing.push(`Assignee "${saved.assignee.name}"`);

    setForm({
      project,
      module,
      phase,
      title: saved.title || '',
      description: saved.description || '',
      assignee,
    });
    setArtifacts(Array.isArray(pendingDraft.artifacts) ? pendingDraft.artifacts : []);
    setDraftNotice(
      missing.length > 0
        ? `${missing.join(', ')} ${missing.length > 1 ? 'are' : 'is'} no longer available, so ${missing.length > 1 ? 'they were' : 'it was'} cleared (along with any fields below). Please reselect.`
        : '',
    );
    wroteDraftRef.current = true;
    setPendingDraft(null);
    setDraftReady(true);
  };

  const discardDraft = () => {
    localStorage.removeItem(draftKey);
    setPendingDraft(null);
    setDraftReady(true);
  };

  const addArtifactRow = () => {
    setArtifacts((prev) => [...prev, { type: '', url: '' }]);
  };

  const removeArtifactRow = (index) => {
    setArtifacts((prev) => prev.filter((_, i) => i !== index));
  };

  const updateArtifactRow = (index, field, value) => {
    setArtifacts((prev) => prev.map((row, i) => (i === index ? { ...row, [field]: value } : row)));
  };

  // Optional - only rows with both a Type and a URL are sent. A row with
  // just one of the two filled in is treated as a mistake rather than
  // silently dropped, same as the developer's own artifact rows on the
  // task detail page.
  const buildArtifactsPayload = () => {
    const incomplete = artifacts.some((row) => (row.type && !row.url.trim()) || (!row.type && row.url.trim()));
    if (incomplete) {
      throw new Error('Each artifact needs both a Type and a URL - remove any unused rows.');
    }
    return artifacts.filter((row) => row.type && row.url.trim()).map((row) => ({ type: row.type, url: row.url.trim() }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (!form.project || !form.module || !form.phase || !form.title.trim() || !stripHtmlForPreview(form.description).trim() || !form.assignee) {
      setError('Project, Module, Phase, Description, and Assignee are all required.');
      return;
    }
    let payloadArtifacts;
    try {
      payloadArtifacts = buildArtifactsPayload();
    } catch (err) {
      setError(err.message);
      return;
    }
    setSaving(true);
    try {
      const created = await apiFetch('/tasks/defects', {
        method: 'POST',
        body: JSON.stringify({
          projectId: form.project.id,
          moduleId: form.module.id,
          phaseId: form.phase.id,
          title: form.title.trim(),
          description: form.description,
          assigneeUserId: form.assignee.id,
          artifacts: payloadArtifacts,
        }),
      });
      submittedRef.current = true;
      if (draftKey) localStorage.removeItem(draftKey);
      setCreatedDefect(created);
      await finishWithScreenshots(created);
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  };

  // Uploads the screenshots (if any) to the just-created defect, then
  // opens it. On failure the defect stays created and the page offers
  // Retry / continue without them.
  const finishWithScreenshots = async (created) => {
    const count = screenshotsRef.current.length;
    if (count > 0) {
      setScreenshotError('');
      setSaving(true);
      try {
        await uploadDefectScreenshots(created.id, screenshotsRef.current);
        screenshotsUploadedRef.current = true;
      } catch (err) {
        setScreenshotError(err.message);
        setSaving(false);
        return;
      }
    }
    showToast(count > 0 ? `Defect created with ${count} screenshot${count > 1 ? 's' : ''}` : 'Defect created', 'success');
    router.push(`/tasks/${created.id}`);
  };

  return (
    <AppShell>
      <div className={styles.pageHeader}>
        <div>
          <h1 className={styles.pageTitle}>Create Defect</h1>
          <p className={styles.pageSubtitle}>
            A standalone defect ticket, assigned straight to a Developer - no Task Backlog step, no link to any
            other ticket. Feedback on this defect will route back to you specifically once it&apos;s submitted.
          </p>
        </div>
      </div>

      {pendingDraft && (
        <div className={styles.draftBanner} role="region" aria-label="Unsaved draft">
          <span>
            Restore your draft? You have an unsaved defect from {formatRelativeTime(pendingDraft.savedAt)}.
          </span>
          <div className={styles.draftBannerActions}>
            <button
              className={`${styles.button} ${styles.buttonAccent}`}
              type="button"
              onClick={restoreDraft}
              disabled={!optionsLoaded}
            >
              Restore
            </button>
            <button className={styles.buttonSecondary} type="button" onClick={discardDraft}>
              Discard
            </button>
          </div>
        </div>
      )}

      {draftNotice && (
        <div className={styles.draftBanner} role="status">
          <span>{draftNotice}</span>
          <div className={styles.draftBannerActions}>
            <button className={styles.buttonSecondary} type="button" onClick={() => setDraftNotice('')}>
              Dismiss
            </button>
          </div>
        </div>
      )}

      {error && <div className={styles.error}>{error}</div>}

      <form onSubmit={handleSubmit} className={styles.card}>
        <div className={styles.fieldGrid3}>
          <SearchSelectField
            label="Project"
            id="ndProject"
            required
            value={form.project}
            onChange={(v) => setForm({ ...form, project: v, module: null, phase: null })}
            options={projects}
          />
          <SearchSelectField
            label="Module"
            id="ndModule"
            required
            value={form.module}
            onChange={(v) => setForm({ ...form, module: v, phase: null })}
            options={modules}
            disabled={!form.project}
            placeholder="Select a Project first"
          />
          <SearchSelectField
            label="Phase"
            id="ndPhase"
            required
            value={form.phase}
            onChange={(v) => setForm({ ...form, phase: v })}
            options={phases}
            disabled={!form.module}
            placeholder="Select a Module first"
          />
        </div>

        <div className={styles.field}>
          <label className={styles.label} htmlFor="ndTitle">Title</label>
          <input
            className={styles.input}
            id="ndTitle"
            required
            maxLength={TASK_TITLE_MAX_LENGTH}
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            placeholder="Short, human-readable name for this defect"
          />
        </div>

        <div className={styles.field}>
          <label className={styles.label} htmlFor="ndDescription">Defect Description</label>
          <RichTextEditor
            id="ndDescription"
            value={form.description}
            onChange={(html) => setForm({ ...form, description: html })}
            placeholder="Describe the defect..."
          />
        </div>

        <div className={styles.fieldNarrow}>
          <SearchSelectField
            label="Assignee (Developer)"
            id="ndAssignee"
            required
            value={form.assignee}
            onChange={(v) => setForm({ ...form, assignee: v })}
            options={developers}
          />
        </div>

        <label className={styles.label}>Artifacts (optional)</label>
        <p className={styles.helpText} style={{ marginTop: 0 }}>
          Attach evidence of the defect - a screenshot, bug report, screen recording, etc.
        </p>
        {artifacts.map((row, index) => (
          <div key={index} className={styles.fieldGrid3} style={{ alignItems: 'end', marginBottom: 'var(--space-2)' }}>
            <div className={styles.field}>
              <label className={styles.label} htmlFor={`ndArtifactType-${index}`}>Artifact Type</label>
              <select
                className={styles.select}
                id={`ndArtifactType-${index}`}
                value={row.type}
                onChange={(e) => updateArtifactRow(index, 'type', e.target.value)}
              >
                <option value="" disabled>— Select artifact type —</option>
                {ARTIFACT_TYPES.filter(
                  (t) => t === row.type || !artifacts.some((r) => r.type === t),
                ).map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div className={styles.field}>
              <label className={styles.label} htmlFor={`ndArtifactUrl-${index}`}>Artifact URL</label>
              <input
                className={styles.input}
                id={`ndArtifactUrl-${index}`}
                type="url"
                placeholder="https://..."
                value={row.url}
                onChange={(e) => updateArtifactRow(index, 'url', e.target.value)}
              />
            </div>
            <div className={styles.field}>
              <button className={styles.buttonSecondary} type="button" onClick={() => removeArtifactRow(index)}>
                Remove
              </button>
            </div>
          </div>
        ))}
        <ScreenshotAttach screenshots={screenshots} onChange={setScreenshots} disabled={saving}>
          <button className={styles.buttonSecondary} type="button" onClick={addArtifactRow}>
            + Add Artifact
          </button>
        </ScreenshotAttach>

        {createdDefect && screenshotError && (
          <div className={styles.error} role="alert">
            Defect #{createdDefect.id} was created, but the screenshots weren&apos;t attached: {screenshotError}
            <div className={styles.actions} style={{ marginTop: 'var(--space-2)' }}>
              <button
                className={`${styles.button} ${styles.buttonAccent}`}
                type="button"
                onClick={() => finishWithScreenshots(createdDefect)}
                disabled={saving}
              >
                {saving ? 'Uploading...' : 'Retry upload'}
              </button>
              <button className={styles.buttonSecondary} type="button" onClick={() => router.push(`/tasks/${createdDefect.id}`)}>
                Go to the defect without them
              </button>
            </div>
          </div>
        )}

        <div className={styles.actions}>
          <button className={`${styles.button} ${styles.buttonAccent}`} type="submit" disabled={saving || !!createdDefect}>
            {saving ? 'Creating...' : 'Create Defect'}
          </button>
          <span className={styles.draftStatus} role="status" aria-live="polite">
            {draftStatus === 'saving' && 'Saving draft...'}
            {draftStatus === 'saved' && 'Draft saved'}
            {draftStatus === 'error' && "Draft couldn't be saved (browser storage is full or disabled)"}
          </span>
        </div>
      </form>
    </AppShell>
  );
}
