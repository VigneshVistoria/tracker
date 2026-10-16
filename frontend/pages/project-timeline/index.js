import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import { Plus, Upload } from 'lucide-react';
import AppShell from '../../components/AppShell';
import Button from '../../components/ui/Button';
import Modal from '../../components/ui/Modal';
import LoadingState from '../../components/ui/LoadingState';
import ProjectPicker from '../../components/projectTimeline/ProjectPicker';
import ImportPanel from '../../components/projectTimeline/ImportPanel';
import TimelineTable from '../../components/projectTimeline/TimelineTable';
import pageStyles from '../../styles/issues.module.css';
import styles from '../../styles/projectTimeline.module.css';
import { apiFetch } from '../../lib/api';
import { useToast } from '../../lib/toast';
import { useConfirm } from '../../lib/confirm';
import { formatDate } from '../../lib/formatDate';
import { isOverdue, matchKeyFor, nameKey, overlapsByRow, rowErrors, tidyName } from '../../lib/projectTimeline';

// Backend mirror: ProjectTimelineController's VIEW_ROLES / EDIT_ROLES.
const VIEW_ROLES = ['admin', 'program_manager', 'executive'];
const EDIT_ROLES = ['admin', 'program_manager'];
const FIELDS = ['module', 'phase', 'teamId', 'status', 'startDate', 'endDate', 'sortOrder'];
const LEAVE_MESSAGE = 'You have unsaved changes to the Project Timeline. Leave without saving?';

let tempSeq = 0;
const toDraft = (r) => ({ key: `id-${r.id}`, id: r.id, version: r.version, ...Object.fromEntries(FIELDS.map((f) => [f, r[f] ?? null])) });

// Project Timeline (2026-10-16): pick a project, import its plan file
// through a checked preview, then edit every column inline. Edits stay on
// this page (marked, with a Save changes / Discard bar) until "Save
// changes" sends them all in one request - the server saves all or none.
export default function ProjectTimelinePage() {
  const router = useRouter();
  const { showToast } = useToast();
  const confirmAction = useConfirm();
  const [user, setUser] = useState(null);
  const [projects, setProjects] = useState([]);
  const [projectId, setProjectId] = useState(null);
  const [plan, setPlan] = useState(null);
  const [draft, setDraft] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [importing, setImporting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [teamModal, setTeamModal] = useState(null); // { rowKey } while adding a team
  const [teamName, setTeamName] = useState('');
  const canEdit = !!user && EDIT_ROLES.includes(user.role);

  useEffect(() => {
    const stored = localStorage.getItem('user');
    if (!stored) {
      router.replace('/');
      return;
    }
    const parsed = JSON.parse(stored);
    if (!VIEW_ROLES.includes(parsed.role)) {
      router.replace('/dashboard');
      return;
    }
    setUser(parsed);
    apiFetch('/project-timeline/projects')
      .then(setProjects)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [router]);

  // ?project=<id> keeps the chosen project across reloads and links.
  useEffect(() => {
    if (!router.isReady || !projects.length || projectId) return;
    const fromQuery = Number(router.query.project);
    if (projects.some((p) => p.id === fromQuery)) setProjectId(fromQuery);
  }, [router.isReady, router.query.project, projects, projectId]);

  const applyPlan = useCallback((next) => {
    setPlan(next);
    setDraft(next.rows.map(toDraft));
    setProjects((prev) => prev.map((p) => (p.id === next.project.id ? { ...p, rowCount: next.rows.length } : p)));
  }, []);

  useEffect(() => {
    if (!projectId) return;
    setPlan(null);
    setImporting(false);
    apiFetch(`/project-timeline/projects/${projectId}`)
      .then(applyPlan)
      .catch((err) => setError(err.message));
  }, [projectId, applyPlan]);

  // ---------------------------------------------------------- changes

  const saved = useMemo(() => new Map((plan?.rows || []).map((r) => [r.id, r])), [plan]);
  const live = draft.filter((r) => !r.deleted);
  const changes = useMemo(() => {
    const creates = [];
    const updates = [];
    const deletes = [];
    const dirtyKeys = new Set();
    for (const r of draft) {
      if (r.id == null) {
        if (!r.deleted) {
          creates.push(r);
          dirtyKeys.add(r.key);
        }
        continue;
      }
      if (r.deleted) {
        deletes.push({ id: r.id, version: r.version });
        continue;
      }
      const s = saved.get(r.id);
      const patch = {};
      for (const f of FIELDS) if ((s?.[f] ?? null) !== (r[f] ?? null)) patch[f] = r[f];
      if (Object.keys(patch).length) {
        updates.push({ id: r.id, version: r.version, ...patch });
        dirtyKeys.add(r.key);
      }
    }
    return { creates, updates, deletes, dirtyKeys, count: creates.length + updates.length + deletes.length };
  }, [draft, saved]);
  const dirty = changes.count > 0;

  const problems = useMemo(() => {
    const list = [];
    const seen = new Set();
    for (const r of live) {
      const errs = rowErrors(r);
      if (errs.length) list.push(`${r.module || 'New row'} – ${r.phase || 'new phase'}: ${errs.join(', ')}`);
      const key = matchKeyFor(r.module, r.phase);
      if (tidyName(r.module) && tidyName(r.phase)) {
        if (seen.has(key)) list.push(`${tidyName(r.module)} – ${tidyName(r.phase)} appears twice`);
        seen.add(key);
      }
    }
    return list;
  }, [live]);

  // Unsaved-changes warning: browser close/reload, and in-app navigation.
  const dirtyRef = useRef(false);
  dirtyRef.current = dirty;
  useEffect(() => {
    const onBeforeUnload = (e) => {
      if (!dirtyRef.current) return;
      e.preventDefault();
      e.returnValue = LEAVE_MESSAGE;
    };
    const onRouteChange = (url) => {
      if (!dirtyRef.current || url.startsWith('/project-timeline')) return;
      if (!window.confirm(LEAVE_MESSAGE)) {
        router.events.emit('routeChangeError');
        // Aborts the navigation - Next.js documents throwing here.
        throw 'Navigation cancelled: unsaved Project Timeline changes';
      }
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    router.events.on('routeChangeStart', onRouteChange);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      router.events.off('routeChangeStart', onRouteChange);
    };
  }, [router]);

  const pickProject = async (id) => {
    if (dirty && !(await confirmAction({ title: 'Discard unsaved changes?', message: LEAVE_MESSAGE, confirmLabel: 'Discard and switch', danger: true }))) return;
    setProjectId(id);
    router.replace({ pathname: '/project-timeline', query: { project: id } }, undefined, { shallow: true });
  };

  const nextOrder = () => draft.reduce((max, r) => Math.max(max, r.sortOrder || 0), 0) + 1;
  const update = (key, patch) => setDraft((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  const addRow = (module) => {
    setDraft((prev) => [
      ...prev,
      { key: `new-${++tempSeq}`, id: null, version: null, module, phase: '', teamId: null, status: 'To Do', startDate: null, endDate: null, sortOrder: nextOrder() },
    ]);
  };

  // The copy goes directly under the original: the rows after it in the
  // same module move down one place (other modules are left alone).
  const duplicate = (key) => {
    const src = draft.find((r) => r.key === key);
    const sameModule = (r) => !r.deleted && nameKey(r.module) === nameKey(src.module);
    setDraft((prev) => [
      ...prev.map((r) => (r.key !== src.key && sameModule(r) && r.sortOrder > src.sortOrder ? { ...r, sortOrder: r.sortOrder + 1 } : r)),
      { ...src, key: `new-${++tempSeq}`, id: null, version: null, phase: `${src.phase} (copy)`, sortOrder: src.sortOrder + 1 },
    ]);
  };

  const remove = async (key) => {
    const r = draft.find((x) => x.key === key);
    const ok = await confirmAction({
      title: 'Delete this row?',
      message: `“${r.module} – ${r.phase || 'new phase'}” will be removed from the plan when you click Save changes.`,
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    setDraft((prev) => (r.id == null ? prev.filter((x) => x.key !== key) : prev.map((x) => (x.key === key ? { ...x, deleted: true } : x))));
  };

  // Swap places with the neighbour in the same module (by sortOrder).
  const move = (key, delta) => {
    const sorted = [...live].sort((a, b) => a.sortOrder - b.sortOrder);
    const row = sorted.find((r) => r.key === key);
    const group = sorted.filter((r) => tidyName(r.module).toLowerCase() === tidyName(row.module).toLowerCase());
    const other = group[group.indexOf(row) + delta];
    if (!other) return;
    const [a, b] = row.sortOrder === other.sortOrder ? [other.sortOrder + (delta > 0 ? 1 : -1), row.sortOrder] : [other.sortOrder, row.sortOrder];
    setDraft((prev) => prev.map((r) => (r.key === row.key ? { ...r, sortOrder: a } : r.key === other.key ? { ...r, sortOrder: b } : r)));
  };

  const addModule = () => addRow(`New module ${new Set(live.map((r) => tidyName(r.module).toLowerCase())).size + 1}`);

  const discard = async () => {
    if (!(await confirmAction({ title: 'Discard all unsaved changes?', message: `${changes.count} change${changes.count === 1 ? '' : 's'} will be lost.`, confirmLabel: 'Discard', danger: true }))) return;
    setDraft(plan.rows.map(toDraft));
  };

  const save = async () => {
    setSaving(true);
    try {
      const body = {
        creates: changes.creates.map((r) => ({
          tempId: r.key,
          module: r.module,
          phase: r.phase,
          teamId: r.teamId,
          status: r.status,
          startDate: r.startDate,
          endDate: r.endDate,
          sortOrder: r.sortOrder,
        })),
        updates: changes.updates,
        deletes: changes.deletes,
      };
      const next = await apiFetch(`/project-timeline/projects/${projectId}/changes`, { method: 'POST', body: JSON.stringify(body) });
      applyPlan(next);
      showToast(`Saved ${changes.count} change${changes.count === 1 ? '' : 's'}.`, 'success');
    } catch (err) {
      showToast(err.message, 'error', 9000);
    } finally {
      setSaving(false);
    }
  };

  const addTeam = async () => {
    try {
      const team = await apiFetch('/project-timeline/teams', { method: 'POST', body: JSON.stringify({ name: teamName }) });
      setPlan((prev) => ({ ...prev, teams: [...prev.teams, team].sort((a, b) => a.name.localeCompare(b.name)) }));
      if (teamModal?.rowKey) update(teamModal.rowKey, { teamId: team.id });
      showToast(`Team “${team.name}” added to the Team list.`, 'success');
      setTeamModal(null);
      setTeamName('');
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  // ---------------------------------------------------------- render

  const project = projects.find((p) => p.id === projectId) || null;
  const today = plan?.today;
  const { byRow: overlaps, pairs: overlapPairs } = useMemo(() => overlapsByRow(live), [live]);
  const sortedLive = useMemo(() => [...live].sort((a, b) => a.sortOrder - b.sortOrder || (a.id ?? Infinity) - (b.id ?? Infinity)), [live]);
  const moduleCount = new Set(live.map((r) => tidyName(r.module).toLowerCase())).size;

  if (!user) return null;

  return (
    <AppShell>
      <div className={pageStyles.pageHeader}>
        <div>
          <h1 className={pageStyles.pageTitle}>Project Timeline</h1>
          <p className={pageStyles.pageSubtitle}>
            The plan for a project, module by module: phase, team, status and dates.{' '}
            {canEdit ? 'Import it from a CSV or Excel file, then edit any cell and click Save changes.' : 'View only.'}
          </p>
        </div>
      </div>

      {loading ? (
        <LoadingState />
      ) : (
        <>
          <div className={styles.toolbar}>
            <ProjectPicker projects={projects} value={projectId} onChange={pickProject} />
            {project && canEdit && !importing && (
              <div className={styles.actions}>
                <Button variant="secondary" leftIcon={Plus} onClick={addModule} disabled={!plan}>
                  Add module
                </Button>
                <Button
                  leftIcon={Upload}
                  disabled={!plan}
                  onClick={async () => {
                    if (dirty && !(await confirmAction({ title: 'Save or discard first', message: 'Importing reloads the plan, so unsaved changes would be lost. Discard them and import?', confirmLabel: 'Discard and import', danger: true }))) return;
                    if (dirty) setDraft(plan.rows.map(toDraft));
                    setImporting(true);
                  }}
                >
                  Import file
                </Button>
              </div>
            )}
          </div>

          {error && (
            <div className={`${styles.notice} ${styles.noticeError}`} role="alert">
              {error}
            </div>
          )}

          {!project && <p className={styles.muted}>Choose a project to see its timeline.</p>}

          {project && importing && plan && (
            <ImportPanel
              project={project}
              onCancel={() => setImporting(false)}
              onImported={(next) => {
                applyPlan(next);
                setImporting(false);
              }}
            />
          )}

          {project && !plan && !error && <LoadingState />}

          {project && plan && !importing && (
            <>
              <div className={styles.stats} aria-live="polite">
                <div className={styles.stat}>
                  <div className={styles.statValue}>{live.length}</div>
                  <div className={styles.statLabel}>Rows</div>
                </div>
                <div className={styles.stat}>
                  <div className={styles.statValue}>{moduleCount}</div>
                  <div className={styles.statLabel}>Modules</div>
                </div>
                <div className={`${styles.stat} ${styles.statError}`}>
                  <div className={styles.statValue}>{live.filter((r) => isOverdue(r, today)).length}</div>
                  <div className={styles.statLabel}>Overdue (To Do, end date passed)</div>
                </div>
                <div className={`${styles.stat} ${styles.statError}`}>
                  <div className={styles.statValue}>{live.filter((r) => r.status === 'Delayed').length}</div>
                  <div className={styles.statLabel}>Delayed</div>
                </div>
                <div className={`${styles.stat} ${styles.statWarning}`}>
                  <div className={styles.statValue}>{overlapPairs}</div>
                  <div className={styles.statLabel}>Overlapping pairs</div>
                </div>
              </div>
              <p className={styles.muted}>Today in the team time zone ({plan.timeZone}): {formatDate(today)}.</p>

              <TimelineTable
                rows={sortedLive}
                teams={plan.teams}
                today={today}
                canEdit={canEdit}
                overlaps={overlaps}
                dirtyKeys={changes.dirtyKeys}
                onChange={update}
                onAddRow={addRow}
                onDuplicate={duplicate}
                onDelete={remove}
                onMove={move}
                onAddTeam={(rowKey) => {
                  setTeamName('');
                  setTeamModal({ rowKey });
                }}
              />

              {canEdit && dirty && (
                <div className={styles.saveBar} role="region" aria-label="Unsaved changes">
                  <span className={styles.saveBarText}>
                    <strong>
                      {changes.count} unsaved change{changes.count === 1 ? '' : 's'}
                    </strong>{' '}
                    ({changes.creates.length} added, {changes.updates.length} edited, {changes.deletes.length} deleted)
                    {problems.length > 0 && (
                      <span className={styles.issueError} role="alert">
                        {' '}
                        – fix before saving: {problems.join('; ')}
                      </span>
                    )}
                  </span>
                  <Button variant="secondary" onClick={discard} disabled={saving}>
                    Discard
                  </Button>
                  <Button onClick={save} loading={saving} disabled={saving || problems.length > 0}>
                    Save changes
                  </Button>
                </div>
              )}
            </>
          )}
        </>
      )}

      <Modal
        open={!!teamModal}
        onClose={() => setTeamModal(null)}
        title="Add a team"
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setTeamModal(null)}>
              Cancel
            </Button>
            <Button onClick={addTeam} disabled={!tidyName(teamName)}>
              Add team
            </Button>
          </>
        }
      >
        <label className={styles.label} htmlFor="timeline-new-team">
          Team name
        </label>
        <input
          id="timeline-new-team"
          className={styles.input}
          value={teamName}
          maxLength={100}
          onChange={(e) => setTeamName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && tidyName(teamName) && addTeam()}
        />
        <p className={styles.muted}>The team is added to the Team list straight away, for every project.</p>
      </Modal>
    </AppShell>
  );
}
