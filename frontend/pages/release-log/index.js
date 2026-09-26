import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import AppShell from '../../components/AppShell';
import SearchSelectField from '../../components/SearchSelectField';
import RichTextDisplay from '../../components/ui/RichTextDisplay';
import styles from '../../styles/issues.module.css';
import { apiFetch } from '../../lib/api';
import { useToast } from '../../lib/toast';
import { formatDate } from '../../lib/formatDate';

// Program Manager only for now (built PM-first for review, 2026-09-26) -
// widen together with ReleaseLogsController.assertIsPm and the AppShell
// nav check once the other roles' access is decided.
const VIEW_ROLES = ['program_manager'];

const EMPTY_FORM = { project: null, appName: '', version: '', releaseDate: '', artifacts: '' };

export default function ReleaseLogPage() {
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
        return apiFetch(`/releases/ticket-options?projectId=${release.projectId}`);
      })
      .then(setTicketOptions)
      .catch((err) => setDetailError(err.message));
  };

  useEffect(() => {
    const storedUser = localStorage.getItem('user');
    if (!storedUser) {
      router.replace('/');
      return;
    }
    const parsed = JSON.parse(storedUser);
    if (!VIEW_ROLES.includes(parsed.role)) {
      router.replace('/dashboard');
      return;
    }
    setUser(parsed);
    apiFetch('/projects').then(setProjects).catch(() => {});
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
    if (!confirm(`Remove ticket #${item.taskId} from this release?`)) return;
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

  const addedTaskIds = new Set((selected?.items || []).map((i) => i.taskId));
  const availableTickets = ticketOptions.filter((t) => !addedTaskIds.has(t.id));
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

      {loading && <div className={styles.empty}>Loading...</div>}

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

          {!selected && !detailError && <div className={styles.empty}>Loading...</div>}

          {selected && (
            <>
              <h2 id="releaseDetailTitle" style={{ marginTop: 0, fontSize: 'var(--ds-text-lg)' }}>
                {selected.appName} {selected.version}
              </h2>
              <p className={styles.helpText} style={{ marginTop: 0 }}>
                {selected.projectName} · Released {formatDate(selected.releaseDate)}
              </p>

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
