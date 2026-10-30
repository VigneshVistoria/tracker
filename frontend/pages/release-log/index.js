import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import AppShell from '../../components/AppShell';
import SearchSelectField from '../../components/SearchSelectField';
import RichTextDisplay from '../../components/ui/RichTextDisplay';
import styles from '../../styles/issues.module.css';
import { apiFetch, apiDownload } from '../../lib/api';
import { useToast } from '../../lib/toast';
import { formatDate } from '../../lib/formatDate';
import { useConfirm } from '../../lib/confirm';
import LoadingState from '../../components/ui/LoadingState';
import { redirectToSignIn } from '../../lib/session';

// Program Manager only for now (built PM-first for review, 2026-09-26) -
// widen together with ReleaseLogsController.assertIsPm and the AppShell
// nav check once the other roles' access is decided.
const VIEW_ROLES = ['program_manager'];

const EMPTY_FORM = { project: null, appName: '', version: '', releaseDate: '', artifacts: '' };

// Performance Tracking P1/P2 (backend release-path.ts): who released,
// the staging sign-off and the change ticket. Released by = Developer,
// Designer or DevOps; the sign-off is by any other staff account.
const RELEASER_ROLES = ['developer', 'designer', 'devops'];
const pathOf = (r) => ({
  releasedByUserId: r.releasedByUserId ? String(r.releasedByUserId) : '',
  stagingSignedOffOn: r.stagingSignedOffOn || '',
  stagingSignedOffByUserId: r.stagingSignedOffByUserId ? String(r.stagingSignedOffByUserId) : '',
  changeTicketRef: r.changeTicketRef || '',
});

export default function ReleaseLogPage() {
  const confirmAction = useConfirm();
  const router = useRouter();
  const { showToast } = useToast();

  const [user, setUser] = useState(null);
  const [projects, setProjects] = useState([]);
  const [releases, setReleases] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const [selected, setSelected] = useState(null);
  const [detailError, setDetailError] = useState('');
  const [ticketOptions, setTicketOptions] = useState([]);
  const [ticket, setTicket] = useState(null);
  const [addingTicket, setAddingTicket] = useState(false);
  const [removingId, setRemovingId] = useState(null);
  const [artifactsDraft, setArtifactsDraft] = useState('');
  const [savingArtifacts, setSavingArtifacts] = useState(false);
  const [staff, setStaff] = useState([]);
  const [pathDraft, setPathDraft] = useState(pathOf({}));
  const [savingPath, setSavingPath] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [emailTo, setEmailTo] = useState('');
  const [emailing, setEmailing] = useState(false);

  const selectedId = router.query.id ? Number(router.query.id) : null;

  const loadReleases = () => {
    setLoading(true);
    setError('');
    apiFetch('/releases')
      .then(setReleases)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  };

  const loadRelease = (id) => {
    setDetailError('');
    apiFetch(`/releases/${id}`)
      .then((release) => {
        setSelected(release);
        setArtifactsDraft(release.artifacts || '');
        setPathDraft(pathOf(release));
        return apiFetch(`/releases/ticket-options?projectId=${release.projectId}`);
      })
      .then(setTicketOptions)
      .catch((err) => setDetailError(err.message));
  };

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
    setEmailTo(parsed.email || '');
    apiFetch('/projects').then(setProjects).catch(() => {});
    apiFetch('/users/assignable').then((rows) => setStaff(rows.filter((u) => u.role !== 'client'))).catch(() => {});
    loadReleases();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  useEffect(() => {
    if (!user) return;
    setTicket(null);
    if (selectedId) {
      loadRelease(selectedId);
    } else {
      setSelected(null);
      setTicketOptions([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, selectedId]);

  const openRelease = (id) => {
    router.push({ pathname: '/release-log', query: id ? { id } : {} }, undefined, { shallow: true });
  };

  const setField = (key, value) => setForm((f) => ({ ...f, [key]: value }));

  const resetForm = () => {
    setForm(EMPTY_FORM);
    setShowForm(false);
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    setError('');
    if (!form.project) {
      setError('Project is required - pick one from the search results.');
      return;
    }
    setSaving(true);
    try {
      const created = await apiFetch('/releases', {
        method: 'POST',
        body: JSON.stringify({
          projectId: form.project.id,
          appName: form.appName,
          version: form.version,
          releaseDate: form.releaseDate,
          artifacts: form.artifacts,
        }),
      });
      showToast('Release created', 'success');
      resetForm();
      loadReleases();
      openRelease(created.id);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  // Picking a ticket adds its row straight away - the backend copies that
  // ticket's latest Resolution into the row, so there's nothing else to
  // fill in.
  const handlePickTicket = async (option) => {
    setTicket(option);
    if (!option || !selected) return;
    setAddingTicket(true);
    setDetailError('');
    try {
      await apiFetch(`/releases/${selected.id}/items`, {
        method: 'POST',
        body: JSON.stringify({ taskId: option.id }),
      });
      showToast(`Ticket #${option.id} added`, 'success');
      setTicket(null);
      loadRelease(selected.id);
      loadReleases();
    } catch (err) {
      setDetailError(err.message);
      setTicket(null);
    } finally {
      setAddingTicket(false);
    }
  };

  const handleRemoveItem = async (item) => {
    if (!await confirmAction({ title: 'Remove from release?', message: `Remove ticket #${item.taskId} from this release?`, confirmLabel: 'Remove', danger: true })) return;
    setRemovingId(item.id);
    setDetailError('');
    try {
      await apiFetch(`/releases/${selected.id}/items/${item.id}`, { method: 'DELETE' });
      showToast(`Ticket #${item.taskId} removed`, 'info');
      loadRelease(selected.id);
      loadReleases();
    } catch (err) {
      setDetailError(err.message);
    } finally {
      setRemovingId(null);
    }
  };

  const handleSaveArtifacts = async () => {
    setSavingArtifacts(true);
    setDetailError('');
    try {
      await apiFetch(`/releases/${selected.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ artifacts: artifactsDraft }),
      });
      showToast('Artifacts saved', 'success');
      loadRelease(selected.id);
    } catch (err) {
      setDetailError(err.message);
    } finally {
      setSavingArtifacts(false);
    }
  };

  const handleSavePath = async () => {
    setSavingPath(true);
    setDetailError('');
    const id = (v) => (v ? Number(v) : null);
    try {
      await apiFetch(`/releases/${selected.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          releasedByUserId: id(pathDraft.releasedByUserId),
          stagingSignedOffOn: pathDraft.stagingSignedOffOn || null,
          stagingSignedOffByUserId: id(pathDraft.stagingSignedOffByUserId),
          changeTicketRef: pathDraft.changeTicketRef.trim() || null,
        }),
      });
      showToast('Release path saved', 'success');
      loadRelease(selected.id);
    } catch (err) {
      setDetailError(err.message);
    } finally {
      setSavingPath(false);
    }
  };

  const pdfFilename = (release) =>
    `release-${`${release.appName}-${release.version}`.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'log'}.pdf`;

  const handleDownloadPdf = async () => {
    setDownloading(true);
    setDetailError('');
    try {
      await apiDownload(`/releases/${selected.id}/pdf`, pdfFilename(selected));
      showToast('PDF downloaded', 'success');
    } catch (err) {
      setDetailError(err.message);
    } finally {
      setDownloading(false);
    }
  };

  const handleEmailPdf = async (e) => {
    e.preventDefault();
    const recipients = emailTo.split(/[,;\s]+/).map((r) => r.trim()).filter(Boolean);
    if (recipients.length === 0) {
      setDetailError('Add at least one recipient email.');
      return;
    }
    setEmailing(true);
    setDetailError('');
    try {
      await apiFetch(`/releases/${selected.id}/email`, {
        method: 'POST',
        body: JSON.stringify({ recipients }),
      });
      showToast(`PDF emailed to ${recipients.join(', ')}`, 'success');
    } catch (err) {
      setDetailError(err.message);
    } finally {
      setEmailing(false);
    }
  };

  const addedTaskIds = new Set((selected?.items || []).map((i) => i.taskId));
  const availableTickets = ticketOptions.filter((t) => !addedTaskIds.has(t.id));
  const pathDirty = selected && JSON.stringify(pathDraft) !== JSON.stringify(pathOf(selected));
  const signedOffLate = pathDraft.stagingSignedOffOn && selected && pathDraft.stagingSignedOffOn > selected.releaseDate;
  const staffName = (u) => u.fullName || u.email;
  const artifactsDirty = selected && artifactsDraft !== (selected.artifacts || '');

  return (
    <AppShell>
      <div className={styles.pageHeader}>
        <div>
          <h1 className={styles.pageTitle}>Release Log</h1>
          <p className={styles.pageSubtitle}>
            Record what shipped in each release. Pick a ticket and its Resolution is filled in from the ticket&apos;s
            latest review submission.
          </p>
        </div>
        <button
          className={`${styles.button} ${styles.buttonAccent}`}
          type="button"
          onClick={() => (showForm ? resetForm() : setShowForm(true))}
        >
          {showForm ? 'Cancel' : 'New Release'}
        </button>
      </div>

      {error && <div className={styles.error} role="alert">{error}</div>}

      {showForm && (
        <form onSubmit={handleCreate} className={styles.card} style={{ marginBottom: 'var(--space-4)' }}>
          <div className={styles.fieldGrid2}>
            <SearchSelectField
              label="Project"
              id="relProject"
              required
              value={form.project}
              onChange={(p) => setField('project', p)}
              options={projects}
            />
            <div className={styles.field}>
              <label className={styles.label} htmlFor="relAppName">App Name</label>
              <input
                className={styles.input}
                id="relAppName"
                required
                maxLength={200}
                value={form.appName}
                onChange={(e) => setField('appName', e.target.value)}
                placeholder="e.g. Tracker Android"
              />
            </div>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="relVersion">Version</label>
              <input
                className={styles.input}
                id="relVersion"
                required
                maxLength={100}
                value={form.version}
                onChange={(e) => setField('version', e.target.value)}
                placeholder="e.g. 1.4.0"
              />
            </div>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="relDate">Release Date</label>
              <input
                className={styles.input}
                id="relDate"
                type="date"
                required
                value={form.releaseDate}
                onChange={(e) => setField('releaseDate', e.target.value)}
              />
            </div>
          </div>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="relArtifacts">Artifacts</label>
            <textarea
              className={styles.textarea}
              id="relArtifacts"
              rows={3}
              maxLength={5000}
              value={form.artifacts}
              onChange={(e) => setField('artifacts', e.target.value)}
              placeholder="Build links, store listings, release package - one field for the whole release"
            />
          </div>
          <div className={styles.actions}>
            <button className={`${styles.button} ${styles.buttonAccent}`} type="submit" disabled={saving}>
              {saving ? 'Creating...' : 'Create Release'}
            </button>
          </div>
        </form>
      )}

      {loading && <LoadingState />}

      {!loading && (
        <div className={styles.tableWrap} style={{ marginBottom: 'var(--space-4)' }}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Project</th>
                <th>App Name</th>
                <th>Version</th>
                <th>Release Date</th>
                <th>Tickets</th>
                <th aria-label="Actions"></th>
              </tr>
            </thead>
            <tbody>
              {releases.length === 0 && (
                <tr>
                  <td colSpan={6} className={styles.empty}>No releases yet.</td>
                </tr>
              )}
              {releases.map((r) => (
                <tr key={r.id} aria-current={r.id === selectedId ? 'true' : undefined}
                  style={r.id === selectedId ? { background: 'var(--color-teal-tint)' } : undefined}>
                  <td>{r.projectName}</td>
                  <td>{r.appName}</td>
                  <td>{r.version}</td>
                  <td>{formatDate(r.releaseDate)}</td>
                  <td>{r.itemCount}</td>
                  <td>
                    <button
                      className={styles.buttonSecondary}
                      type="button"
                      onClick={() => openRelease(r.id === selectedId ? null : r.id)}
                      aria-label={`${r.id === selectedId ? 'Close' : 'Open'} ${r.appName} ${r.version}`}
                    >
                      {r.id === selectedId ? 'Close' : 'Open'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selectedId && (
        <section className={styles.card} aria-labelledby="releaseDetailTitle">
          {detailError && <div className={styles.error} role="alert">{detailError}</div>}

          {!selected && !detailError && <LoadingState />}

          {selected && (
            <>
              <h2 id="releaseDetailTitle" style={{ marginTop: 0, fontSize: 'var(--ds-text-lg)' }}>
                {selected.appName} {selected.version}
              </h2>
              <p className={styles.helpText} style={{ marginTop: 0 }}>
                {selected.projectName} · Released {formatDate(selected.releaseDate)}
              </p>

              <form onSubmit={handleEmailPdf} className={styles.actions} style={{ justifyContent: 'flex-start', flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 'var(--space-4)' }}>
                <button className={styles.buttonSecondary} type="button" disabled={downloading} onClick={handleDownloadPdf}>
                  {downloading ? 'Preparing PDF...' : 'Download PDF'}
                </button>
                <div className={styles.field} style={{ flex: '1 1 280px', marginBottom: 0 }}>
                  <label className={styles.label} htmlFor="relEmailTo">Email PDF to</label>
                  <input
                    className={styles.input}
                    id="relEmailTo"
                    value={emailTo}
                    onChange={(e) => setEmailTo(e.target.value)}
                    placeholder="name@example.com, another@example.com"
                    aria-describedby="relEmailToHelp"
                  />
                  <span id="relEmailToHelp" className={styles.helpText}>Separate multiple addresses with commas.</span>
                </div>
                <button className={`${styles.button} ${styles.buttonAccent}`} type="submit" disabled={emailing}>
                  {emailing ? 'Sending...' : 'Email PDF'}
                </button>
              </form>

              <div className={styles.field}>
                <label className={styles.label} htmlFor="relDetailArtifacts">Artifacts</label>
                <textarea
                  className={styles.textarea}
                  id="relDetailArtifacts"
                  rows={3}
                  maxLength={5000}
                  value={artifactsDraft}
                  onChange={(e) => setArtifactsDraft(e.target.value)}
                  placeholder="Build links, store listings, release package - one field for the whole release"
                />
              </div>
              <div className={styles.actions} style={{ marginBottom: 'var(--space-4)' }}>
                <button
                  className={`${styles.button} ${styles.buttonAccent}`}
                  type="button"
                  disabled={!artifactsDirty || savingArtifacts}
                  onClick={handleSaveArtifacts}
                >
                  {savingArtifacts ? 'Saving...' : 'Save Artifacts'}
                </button>
              </div>

              <fieldset className={styles.card} style={{ marginBottom: 'var(--space-4)' }}>
                <legend className={styles.label}>Release path (Performance Tracking P1, P2)</legend>
                <div className={styles.actions} style={{ justifyContent: 'flex-start', flexWrap: 'wrap', alignItems: 'flex-end' }}>
                  <div className={styles.field} style={{ marginBottom: 0 }}>
                    <label className={styles.label} htmlFor="relReleasedBy">Released by</label>
                    <select
                      className={styles.input}
                      id="relReleasedBy"
                      value={pathDraft.releasedByUserId}
                      onChange={(e) => setPathDraft((d) => ({ ...d, releasedByUserId: e.target.value }))}
                    >
                      <option value="">Not set</option>
                      {staff.filter((u) => RELEASER_ROLES.includes(u.role)).map((u) => (
                        <option key={u.id} value={u.id}>{staffName(u)}</option>
                      ))}
                    </select>
                  </div>
                  <div className={styles.field} style={{ marginBottom: 0 }}>
                    <label className={styles.label} htmlFor="relSignedOffOn">Staging sign-off date</label>
                    <input
                      className={styles.input}
                      id="relSignedOffOn"
                      type="date"
                      value={pathDraft.stagingSignedOffOn}
                      onChange={(e) => setPathDraft((d) => ({ ...d, stagingSignedOffOn: e.target.value }))}
                    />
                  </div>
                  <div className={styles.field} style={{ marginBottom: 0 }}>
                    <label className={styles.label} htmlFor="relSignedOffBy">Signed off by</label>
                    <select
                      className={styles.input}
                      id="relSignedOffBy"
                      value={pathDraft.stagingSignedOffByUserId}
                      onChange={(e) => setPathDraft((d) => ({ ...d, stagingSignedOffByUserId: e.target.value }))}
                    >
                      <option value="">Not set</option>
                      {staff.filter((u) => String(u.id) !== pathDraft.releasedByUserId).map((u) => (
                        <option key={u.id} value={u.id}>{staffName(u)}</option>
                      ))}
                    </select>
                  </div>
                  <div className={styles.field} style={{ flex: '1 1 220px', marginBottom: 0 }}>
                    <label className={styles.label} htmlFor="relChangeTicket">Change ticket</label>
                    <input
                      className={styles.input}
                      id="relChangeTicket"
                      maxLength={200}
                      value={pathDraft.changeTicketRef}
                      onChange={(e) => setPathDraft((d) => ({ ...d, changeTicketRef: e.target.value }))}
                      placeholder="Ticket number or link"
                    />
                  </div>
                  <button className={`${styles.button} ${styles.buttonAccent}`} type="button" disabled={!pathDirty || savingPath} onClick={handleSavePath}>
                    {savingPath ? 'Saving...' : 'Save release path'}
                  </button>
                </div>
                <p className={styles.helpText} style={{ marginBottom: 0 }}>
                  On the path when staging was signed off on or before the release date, by someone other than the person who released.
                  {signedOffLate && <strong> This sign-off is after the release date, so it does not count.</strong>}
                </p>
              </fieldset>

              <div style={{ maxWidth: 480 }}>
                <SearchSelectField
                  label="Add Ticket"
                  id="relTicket"
                  value={ticket}
                  onChange={handlePickTicket}
                  options={availableTickets}
                  disabled={addingTicket}
                  placeholder="Adding..."
                />
              </div>
              {ticketOptions.length === 0 && (
                <p className={styles.helpText}>
                  No tickets in {selected.projectName} have been submitted for review yet, so there&apos;s no
                  Resolution to pull in.
                </p>
              )}

              <div className={styles.tableWrap} style={{ marginTop: 'var(--space-3)' }}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>Ticket</th>
                      <th>Title</th>
                      <th>Resolution</th>
                      <th aria-label="Actions"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {selected.items.length === 0 && (
                      <tr>
                        <td colSpan={4} className={styles.empty}>No tickets in this release yet.</td>
                      </tr>
                    )}
                    {selected.items.map((item) => (
                      <tr key={item.id}>
                        <td>
                          <Link href={`/tasks/${item.taskId}`}>#{item.taskId}</Link>
                        </td>
                        <td>{item.taskTitle}</td>
                        <td>
                          {item.resolution ? <RichTextDisplay value={item.resolution} /> : '—'}
                        </td>
                        <td>
                          <button
                            className={styles.buttonSecondary}
                            type="button"
                            disabled={removingId === item.id}
                            onClick={() => handleRemoveItem(item)}
                            aria-label={`Remove ticket #${item.taskId}`}
                          >
                            Remove
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </section>
      )}
    </AppShell>
  );
}
