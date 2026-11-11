import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import AppShell from '../../components/AppShell';
import LoadingState from '../../components/ui/LoadingState';
import styles from '../../styles/issues.module.css';
import { apiFetch } from '../../lib/api';
import { useToast } from '../../lib/toast';
import { useConfirm } from '../../lib/confirm';
import { redirectToSignIn } from '../../lib/session';
import { formatDateTime } from '../../lib/formatDate';

// P1/P2 from GitHub (2026-11-02) - Admin and Program Manager (backend:
// GithubReleasesController). The switch (OFF by default), the task key
// prefix, which repository is which project, and the delivery log.
const EDIT_ROLES = ['admin', 'program_manager'];
const KIND_LABEL = { production: 'Production', staging: 'Staging', ignore: 'Ignored' };
const OUTCOME_LABEL = { received: 'Processing', processed: 'Recorded', ignored: 'Ignored', refused: 'Refused', duplicate: 'Duplicate', error: 'Error' };
const LISTS = [
  ['productionEnvironments', 'Production environments', 'GitHub Environment names, e.g. production.'],
  ['stagingEnvironments', 'Staging environments', 'e.g. staging, uat.'],
  ['deployWorkflows', 'Deploy workflows (Actions)', 'Workflow names whose successful runs are deployments. Empty = workflow runs are not used.'],
  ['productionBranches', 'Production branches (for those workflows)', 'e.g. main.'],
  ['stagingBranches', 'Staging branches (for those workflows)', 'e.g. develop.'],
];
const EMPTY_MAPPING = {
  repoFullName: '',
  projectId: '',
  appName: '',
  productionEnvironments: 'production',
  stagingEnvironments: 'staging',
  deployWorkflows: '',
  productionBranches: '',
  stagingBranches: '',
  publishedReleaseIs: 'production',
  preReleaseIs: 'staging',
};
const toText = (list) => (list || []).join(', ');
const toList = (text) => text.split(',').map((s) => s.trim()).filter(Boolean);

export default function GithubReleasesPage() {
  const router = useRouter();
  const { showToast } = useToast();
  const confirmAction = useConfirm();
  const [page, setPage] = useState(null);
  const [projects, setProjects] = useState([]);
  const [deliveries, setDeliveries] = useState([]);
  const [prefix, setPrefix] = useState('TRK');
  // PR helpers (2026-11-11): own switch, project list, branch prefix.
  const [helpers, setHelpers] = useState(null);
  const [mapping, setMapping] = useState(EMPTY_MAPPING);
  const [editingId, setEditingId] = useState(null);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState('');
  const [settingsError, setSettingsError] = useState('');
  const [mappingError, setMappingError] = useState('');

  const loadDeliveries = () =>
    apiFetch('/github-releases/deliveries?limit=100')
      .then(setDeliveries)
      .catch(() => setDeliveries([]));
  const load = () =>
    Promise.all([apiFetch('/github-releases/settings'), apiFetch('/projects')])
      .then(([p, allProjects]) => {
        setPage(p);
        setPrefix(p.settings.taskKeyPrefix);
        setHelpers({ prHelpersEnabled: p.settings.prHelpersEnabled, prHelperProjectIds: p.settings.prHelperProjectIds, branchPrefix: p.settings.branchPrefix });
        setProjects(allProjects);
        loadDeliveries();
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

  const saveSettings = async (body, message) => {
    setBusy('settings');
    setSettingsError('');
    try {
      const next = await apiFetch('/github-releases/settings', { method: 'PATCH', body: JSON.stringify(body) });
      setPage(next);
      setHelpers({ prHelpersEnabled: next.settings.prHelpersEnabled, prHelperProjectIds: next.settings.prHelperProjectIds, branchPrefix: next.settings.branchPrefix });
      showToast(message, 'success');
    } catch (err) {
      setSettingsError(err.message);
    } finally {
      setBusy(null);
    }
  };

  const toggle = async () => {
    const enabled = !page.settings.enabled;
    const ok = await confirmAction(
      enabled
        ? {
            title: 'Switch GitHub releases on?',
            message: 'Signed deliveries from mapped repositories will create or fill in Release Log entries and add the tasks they name. Nothing the PM entered is ever overwritten.',
            confirmLabel: 'Switch on',
          }
        : {
            title: 'Switch GitHub releases off?',
            message: 'Deliveries are still checked and logged, but nothing is recorded. Releases already recorded stay.',
            confirmLabel: 'Switch off',
          },
    );
    if (ok) await saveSettings({ enabled }, enabled ? 'GitHub releases switched on' : 'GitHub releases switched off');
  };

  const set = (key, value) => setMapping((m) => ({ ...m, [key]: value }));
  const edit = (m) => {
    setEditingId(m.id);
    setMappingError('');
    setMapping({
      repoFullName: m.repoFullName,
      projectId: String(m.projectId),
      appName: m.appName,
      ...Object.fromEntries(LISTS.map(([key]) => [key, toText(m[key])])),
      publishedReleaseIs: m.publishedReleaseIs,
      preReleaseIs: m.preReleaseIs,
    });
  };
  const cancelEdit = () => {
    setEditingId(null);
    setMapping(EMPTY_MAPPING);
    setMappingError('');
  };

  const saveMapping = async (e) => {
    e.preventDefault();
    setMappingError('');
    if (!mapping.repoFullName.trim() || !mapping.projectId || !mapping.appName.trim()) {
      setMappingError('Repository, project and app name are required.');
      return;
    }
    const body = {
      repoFullName: mapping.repoFullName,
      projectId: Number(mapping.projectId),
      appName: mapping.appName,
      ...Object.fromEntries(LISTS.map(([key]) => [key, toList(mapping[key])])),
      publishedReleaseIs: mapping.publishedReleaseIs,
      preReleaseIs: mapping.preReleaseIs,
    };
    setBusy('mapping');
    try {
      if (editingId) await apiFetch(`/github-releases/mappings/${editingId}`, { method: 'PATCH', body: JSON.stringify(body) });
      else await apiFetch('/github-releases/mappings', { method: 'POST', body: JSON.stringify(body) });
      showToast(editingId ? 'Repository updated' : 'Repository added', 'success');
      cancelEdit();
      await load();
    } catch (err) {
      setMappingError(err.message);
    } finally {
      setBusy(null);
    }
  };

  const setActive = async (m, active) => {
    setBusy(`m${m.id}`);
    try {
      await apiFetch(`/github-releases/mappings/${m.id}`, { method: 'PATCH', body: JSON.stringify({ active }) });
      showToast(active ? `${m.repoFullName} active` : `${m.repoFullName} paused`, 'success');
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  };

  const projectName = (id) => projects.find((p) => p.id === id)?.name || `#${id}`;
  const webhookUrl = typeof window !== 'undefined' && page ? `${window.location.origin}${page.webhookPath}` : '';

  return (
    <AppShell>
      <div className={styles.pageHeader}>
        <div>
          <h1 className={styles.pageTitle}>GitHub Releases</h1>
          <p className={styles.pageSubtitle}>
            Record releases from GitHub on the Release Log (P1 release path): who released, the staging deployment date and the tasks named
            in pull request titles. The PM still records who signed off on staging and the change ticket. Every change here is recorded.
          </p>
        </div>
      </div>

      {error && <div className={styles.error} role="alert">{error}</div>}
      {!page && !error && <LoadingState />}

      {page && (
        <>
          <div className={styles.card} style={{ marginBottom: 'var(--space-4)' }}>
            <h2 className={styles.cardTitle}>Switch and connection</h2>
            {settingsError && <div className={styles.error} role="alert">{settingsError}</div>}
            <dl style={{ display: 'grid', gridTemplateColumns: 'max-content 1fr', gap: 'var(--ds-space-2) var(--ds-space-4)', margin: '0 0 var(--ds-space-4)' }}>
              <dt className={styles.label}>Status</dt>
              <dd style={{ margin: 0 }}>
                <strong>{page.settings.enabled ? 'On' : 'Off'}</strong>
                {!page.settings.enabled && ' - deliveries are checked and logged, nothing is recorded.'}
              </dd>
              <dt className={styles.label}>Webhook URL</dt>
              <dd style={{ margin: 0 }}>
                <code>{webhookUrl}</code>
              </dd>
              <dt className={styles.label}>Webhook secret on the server</dt>
              <dd style={{ margin: 0 }}>{page.server.webhookSecret ? `Set${page.server.rotatingSecret ? ' (two secrets - rotating)' : ''}` : 'Not set - every delivery is refused'}</dd>
              <dt className={styles.label}>GitHub App read access</dt>
              <dd style={{ margin: 0 }}>
                {page.server.appReadAccess ? 'Set up - commits and pull requests are read for task numbers' : "Not set up - only the event's own text is searched for task numbers"}
              </dd>
            </dl>
            <button
              className={page.settings.enabled ? styles.buttonSecondary : `${styles.button} ${styles.buttonAccent}`}
              type="button"
              disabled={busy !== null}
              onClick={toggle}
            >
              {busy === 'settings' ? 'Saving...' : page.settings.enabled ? 'Switch off' : 'Switch on'}
            </button>

            <form
              style={{ marginTop: 'var(--ds-space-4)' }}
              onSubmit={(e) => {
                e.preventDefault();
                saveSettings({ taskKeyPrefix: prefix }, 'Task key prefix saved');
              }}
            >
              <div className={styles.field} style={{ maxWidth: 560 }}>
                <label className={styles.label} htmlFor="ghPrefix">Task key prefix</label>
                <div style={{ display: 'flex', gap: 'var(--ds-space-2)', alignItems: 'center' }}>
                  <input id="ghPrefix" className={styles.input} style={{ width: '8rem' }} maxLength={10} value={prefix} onChange={(e) => setPrefix(e.target.value)} aria-describedby="ghPrefixHelp" />
                  <button className={styles.buttonSecondary} type="submit" disabled={busy !== null}>Save</button>
                </div>
                <p id="ghPrefixHelp" className={styles.helpText}>
                  Developers put {page.settings.taskKeyPrefix}-&lt;task number&gt; in every pull request title, e.g. &quot;{page.settings.taskKeyPrefix}-255 Fix
                  login timeout&quot;. Branch names and commit messages are read too. A bare &quot;#255&quot; is never used - that is GitHub&apos;s own numbering.
                </p>
              </div>
            </form>
          </div>

          {helpers && (
            <form
              className={styles.card}
              style={{ marginBottom: 'var(--space-4)' }}
              onSubmit={(e) => {
                e.preventDefault();
                saveSettings(helpers, 'Pull request helpers saved');
              }}
            >
              <h2 className={styles.cardTitle}>Pull request helpers</h2>
              <p className={styles.helpText} style={{ marginTop: 0 }}>
                On each task of the projects below: &quot;Copy branch name&quot;, &quot;Copy PR title&quot; and &quot;Open pull request&quot; (GitHub&apos;s own new
                pull request page, title filled in - the developer still presses Create). Tracker never writes to GitHub. Separate from the releases switch
                above. {helpers.prHelpersEnabled ? 'Currently ON.' : 'Currently OFF.'}
              </p>
              <label style={{ display: 'flex', gap: 'var(--ds-space-2)', alignItems: 'center' }}>
                <input type="checkbox" checked={helpers.prHelpersEnabled} onChange={(e) => setHelpers({ ...helpers, prHelpersEnabled: e.target.checked })} />
                Show the pull request helpers (default: off)
              </label>
              <fieldset style={{ border: 0, padding: 0, margin: 'var(--ds-space-3) 0' }}>
                <legend className={styles.label}>Projects</legend>
                {projects.map((p) => (
                  <label key={p.id} style={{ display: 'flex', gap: 'var(--ds-space-2)', alignItems: 'center' }}>
                    <input
                      type="checkbox"
                      checked={helpers.prHelperProjectIds.includes(p.id)}
                      onChange={() =>
                        setHelpers({
                          ...helpers,
                          prHelperProjectIds: helpers.prHelperProjectIds.includes(p.id) ? helpers.prHelperProjectIds.filter((x) => x !== p.id) : [...helpers.prHelperProjectIds, p.id],
                        })
                      }
                    />
                    {p.name}
                    {!page.mappings.some((m) => m.projectId === p.id && m.active) && <span className={styles.helpText}>(no repository yet - copy buttons only)</span>}
                  </label>
                ))}
              </fieldset>
              <div className={styles.field} style={{ maxWidth: 560 }}>
                <label className={styles.label} htmlFor="ghBranchPrefix">Branch name starts with</label>
                <input
                  id="ghBranchPrefix"
                  className={styles.input}
                  style={{ width: '12rem' }}
                  maxLength={30}
                  value={helpers.branchPrefix}
                  onChange={(e) => setHelpers({ ...helpers, branchPrefix: e.target.value })}
                  aria-describedby="ghBranchPrefixHelp"
                />
                <p id="ghBranchPrefixHelp" className={styles.helpText}>
                  e.g. &quot;{helpers.branchPrefix}{page.settings.taskKeyPrefix}-255-fix-login-timeout&quot;. Lower case, ending in &quot;/&quot;.
                </p>
              </div>
              <div className={styles.actions}>
                <button className={styles.button} type="submit" disabled={busy !== null}>
                  {busy === 'settings' ? 'Saving...' : 'Save'}
                </button>
              </div>
            </form>
          )}

          <div className={styles.card} style={{ marginBottom: 'var(--space-4)' }}>
            <h2 className={styles.cardTitle}>Repositories</h2>
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Repository</th>
                    <th>Project / app</th>
                    <th>Production</th>
                    <th>Staging</th>
                    <th>Status</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {page.mappings.length === 0 && (
                    <tr>
                      <td colSpan={6} className={styles.empty}>No repositories yet - deliveries are ignored until a repository is added.</td>
                    </tr>
                  )}
                  {page.mappings.map((m) => (
                    <tr key={m.id}>
                      <td><code>{m.repoFullName}</code></td>
                      <td>{projectName(m.projectId)} / {m.appName}</td>
                      <td>
                        {[toText(m.productionEnvironments) && `Environments: ${toText(m.productionEnvironments)}`, m.deployWorkflows.length > 0 && toText(m.productionBranches) && `Branches: ${toText(m.productionBranches)}`, `Releases: ${KIND_LABEL[m.publishedReleaseIs]}`]
                          .filter(Boolean)
                          .join('; ')}
                      </td>
                      <td>
                        {[toText(m.stagingEnvironments) && `Environments: ${toText(m.stagingEnvironments)}`, m.deployWorkflows.length > 0 && toText(m.stagingBranches) && `Branches: ${toText(m.stagingBranches)}`, `Pre-releases: ${KIND_LABEL[m.preReleaseIs]}`]
                          .filter(Boolean)
                          .join('; ')}
                      </td>
                      <td>{m.active ? 'Active' : 'Paused'}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        <button className={styles.buttonSecondary} type="button" disabled={busy !== null} onClick={() => edit(m)} aria-label={`Edit ${m.repoFullName}`}>
                          Edit
                        </button>{' '}
                        <button className={styles.buttonSecondary} type="button" disabled={busy !== null} onClick={() => setActive(m, !m.active)} aria-label={`${m.active ? 'Pause' : 'Activate'} ${m.repoFullName}`}>
                          {busy === `m${m.id}` ? 'Saving...' : m.active ? 'Pause' : 'Activate'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <form onSubmit={saveMapping} style={{ marginTop: 'var(--ds-space-4)' }}>
              <h3 className={styles.cardTitle}>{editingId ? `Edit ${mapping.repoFullName}` : 'Add a repository'}</h3>
              {mappingError && <div className={styles.error} role="alert">{mappingError}</div>}
              <div className={styles.field} style={{ maxWidth: 560 }}>
                <label className={styles.label} htmlFor="ghRepo">Repository (owner/name)</label>
                <input id="ghRepo" className={styles.input} placeholder="vistoria/claims-app" value={mapping.repoFullName} onChange={(e) => set('repoFullName', e.target.value)} />
              </div>
              <div className={styles.field} style={{ maxWidth: 560 }}>
                <label className={styles.label} htmlFor="ghProject">Tracker project</label>
                <select id="ghProject" className={styles.select} value={mapping.projectId} onChange={(e) => set('projectId', e.target.value)}>
                  <option value="">Choose a project</option>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>
              <div className={styles.field} style={{ maxWidth: 560 }}>
                <label className={styles.label} htmlFor="ghApp">App name (as on the Release Log)</label>
                <input id="ghApp" className={styles.input} maxLength={255} value={mapping.appName} onChange={(e) => set('appName', e.target.value)} />
              </div>
              {LISTS.map(([key, label, help]) => (
                <div key={key} className={styles.field} style={{ maxWidth: 560 }}>
                  <label className={styles.label} htmlFor={`gh-${key}`}>{label}</label>
                  <input id={`gh-${key}`} className={styles.input} value={mapping[key]} onChange={(e) => set(key, e.target.value)} aria-describedby={`gh-${key}-help`} />
                  <p id={`gh-${key}-help`} className={styles.helpText}>Separate names with commas. {help}</p>
                </div>
              ))}
              <div className={styles.field} style={{ maxWidth: 560 }}>
                <label className={styles.label} htmlFor="ghPublished">A published GitHub Release is</label>
                <select id="ghPublished" className={styles.select} value={mapping.publishedReleaseIs} onChange={(e) => set('publishedReleaseIs', e.target.value)}>
                  {page.releaseKinds.map((k) => (
                    <option key={k} value={k}>{KIND_LABEL[k]}</option>
                  ))}
                </select>
              </div>
              <div className={styles.field} style={{ maxWidth: 560 }}>
                <label className={styles.label} htmlFor="ghPre">A GitHub pre-release is</label>
                <select id="ghPre" className={styles.select} value={mapping.preReleaseIs} onChange={(e) => set('preReleaseIs', e.target.value)}>
                  {page.releaseKinds.map((k) => (
                    <option key={k} value={k}>{KIND_LABEL[k]}</option>
                  ))}
                </select>
              </div>
              <div className={styles.actions}>
                <button className={`${styles.button} ${styles.buttonAccent}`} type="submit" disabled={busy !== null}>
                  {busy === 'mapping' ? 'Saving...' : editingId ? 'Save repository' : 'Add repository'}
                </button>
                {editingId && (
                  <button className={styles.buttonSecondary} type="button" onClick={cancelEdit}>
                    Cancel
                  </button>
                )}
              </div>
            </form>
          </div>

          <div className={styles.card}>
            <h2 className={styles.cardTitle}>Delivery log (newest 100, kept 90 days)</h2>
            <button className={styles.buttonSecondary} type="button" onClick={loadDeliveries} style={{ marginBottom: 'var(--ds-space-2)' }}>
              Refresh
            </button>
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Received</th>
                    <th>Event</th>
                    <th>Repository</th>
                    <th>Signature</th>
                    <th>Outcome</th>
                    <th>Details</th>
                  </tr>
                </thead>
                <tbody>
                  {deliveries.length === 0 && (
                    <tr>
                      <td colSpan={6} className={styles.empty}>Nothing received yet.</td>
                    </tr>
                  )}
                  {deliveries.map((d) => (
                    <tr key={d.id}>
                      <td>{formatDateTime(d.receivedAt)}</td>
                      <td>{[d.event, d.action].filter(Boolean).join(' / ') || '-'}</td>
                      <td>{d.repoFullName || '-'}</td>
                      <td>{d.signatureValid ? 'Valid' : 'Invalid or missing'}</td>
                      <td>{OUTCOME_LABEL[d.outcome] || d.outcome}{d.environment ? ` (${d.environment})` : ''}</td>
                      <td>
                        {d.reason || ''}
                        {d.releaseId ? ` Release #${d.releaseId}.` : ''}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </AppShell>
  );
}
