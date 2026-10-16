import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import { Download, GanttChart, Plus, Table2, Upload } from 'lucide-react';
import AppShell from '../../components/AppShell';
import Button from '../../components/ui/Button';
import Modal from '../../components/ui/Modal';
import LoadingState from '../../components/ui/LoadingState';
import ProjectPicker from '../../components/projectTimeline/ProjectPicker';
import ImportPanel from '../../components/projectTimeline/ImportPanel';
import TimelineTable from '../../components/projectTimeline/TimelineTable';
import TimelineSummary from '../../components/projectTimeline/TimelineSummary';
import TimelineFilters from '../../components/projectTimeline/TimelineFilters';
import BulkBar from '../../components/projectTimeline/BulkBar';
import GanttView from '../../components/projectTimeline/GanttView';
import DependencyDialog from '../../components/projectTimeline/DependencyDialog';
import TicketLinksDialog from '../../components/projectTimeline/TicketLinksDialog';
import { ticketMismatches } from '../../lib/projectTimelineTickets';
import { cascadeShifts, criticalPath, dependencyConflicts } from '../../lib/projectTimelineDeps';
import pageStyles from '../../styles/issues.module.css';
import styles from '../../styles/projectTimeline.module.css';
import { apiDownload, apiFetch } from '../../lib/api';
import { useToast } from '../../lib/toast';
import { useConfirm } from '../../lib/confirm';
import { formatDate } from '../../lib/formatDate';
import { addDaysIso, isOverdue, matchKeyFor, nameKey, overlapsByRow, rowErrors, tidyName } from '../../lib/projectTimeline';
import { EMPTY_FILTERS, computeSlip, computeSummary, isFiltering, matchesFilters, statusCheck, summaryText } from '../../lib/projectTimelineSummary';

// Backend mirror: ProjectTimelineController's VIEW_ROLES / EDIT_ROLES.
const VIEW_ROLES = ['admin', 'program_manager', 'executive'];
const EDIT_ROLES = ['admin', 'program_manager'];
// Resetting the slip baseline: ProjectTimelineController BASELINE_ROLES.
const BASELINE_ROLES = ['program_manager'];
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
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [revealKey, setRevealKey] = useState(null);
  const canEdit = !!user && EDIT_ROLES.includes(user.role);
  const canResetBaseline = !!user && BASELINE_ROLES.includes(user.role);
  const [slipData, setSlipData] = useState(null);
  // Stage B: dependency links (saved straight away by DependencyDialog).
  const [deps, setDeps] = useState([]);
  const [depsError, setDepsError] = useState('');
  const [depRowKey, setDepRowKey] = useState(null);
  // Stage C: ticket links + progress (saved straight away by TicketLinksDialog).
  const [ticketData, setTicketData] = useState(null);
  const [ticketError, setTicketError] = useState('');
  const [ticketRowKey, setTicketRowKey] = useState(null);
  const [slipError, setSlipError] = useState('');
  const [resetOpen, setResetOpen] = useState(false);
  const [resetReason, setResetReason] = useState('');
  const [resetting, setResetting] = useState(false);
  const [selected, setSelected] = useState(() => new Set());
  const [exportOpen, setExportOpen] = useState(false);
  const [exportFormat, setExportFormat] = useState('xlsx');
  const [exporting, setExporting] = useState(false);
  // Table or Gantt (Stage A) - kept in ?view= so a link opens the same view.
  const view = router.query.view === 'gantt' ? 'gantt' : 'table';
  const setView = (next) => {
    const { view: _old, ...rest } = router.query;
    router.replace({ pathname: '/project-timeline', query: next === 'gantt' ? { ...rest, view: 'gantt' } : rest }, undefined, { shallow: true });
  };

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
    setSelected(new Set());
    setPlan(next);
    setDraft(next.rows.map(toDraft));
    setProjects((prev) => prev.map((p) => (p.id === next.project.id ? { ...p, rowCount: next.rows.length } : p)));
  }, []);

  useEffect(() => {
    if (!projectId) return;
    setPlan(null);
    setImporting(false);
    setFilters(EMPTY_FILTERS);
    apiFetch(`/project-timeline/projects/${projectId}`)
      .then(applyPlan)
      .catch((err) => setError(err.message));
  }, [projectId, applyPlan]);

  // Slip baselines (from the audit log) - reloaded whenever the saved plan
  // changes (load, Save changes, import).
  useEffect(() => {
    if (!plan?.project?.id) return undefined;
    let cancelled = false;
    setSlipError('');
    apiFetch(`/project-timeline/projects/${plan.project.id}/slip`)
      .then((d) => !cancelled && setSlipData(d))
      .catch((err) => !cancelled && setSlipError(err.message));
    return () => {
      cancelled = true;
    };
  }, [plan?.rows, plan?.project?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Dependency links - reloaded with the saved plan (a deleted phase takes
  // its links with it).
  useEffect(() => {
    if (!plan?.project?.id) return undefined;
    let cancelled = false;
    setDepsError('');
    apiFetch(`/project-timeline/projects/${plan.project.id}/dependencies`)
      .then((d) => !cancelled && setDeps(d))
      .catch((err) => !cancelled && setDepsError(err.message));
    return () => {
      cancelled = true;
    };
  }, [plan?.rows, plan?.project?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Ticket links + progress - reloaded with the saved plan.
  useEffect(() => {
    if (!plan?.project?.id) return undefined;
    let cancelled = false;
    setTicketError('');
    apiFetch(`/project-timeline/projects/${plan.project.id}/ticket-progress`)
      .then((d) => !cancelled && setTicketData(d))
      .catch((err) => !cancelled && setTicketError(err.message));
    return () => {
      cancelled = true;
    };
  }, [plan?.rows, plan?.project?.id]); // eslint-disable-line react-hooks/exhaustive-deps

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
    router.replace({ pathname: '/project-timeline', query: { project: id, ...(view === 'gantt' ? { view } : {}) } }, undefined, { shallow: true });
  };

  const nextOrder = () => draft.reduce((max, r) => Math.max(max, r.sortOrder || 0), 0) + 1;
  const update = (key, patch) => setDraft((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  const addRow = (module) => {
    const row = { key: `new-${++tempSeq}`, id: null, version: null, module, phase: '', teamId: null, status: 'To Do', startDate: null, endDate: null, sortOrder: nextOrder() };
    setDraft((prev) => [...prev, row]);
    reveal(row);
  };

  // The copy goes directly under the original: the rows after it in the
  // same module move down one place (other modules are left alone).
  const duplicate = (key) => {
    const src = draft.find((r) => r.key === key);
    const sameModule = (r) => !r.deleted && nameKey(r.module) === nameKey(src.module);
    const copy = { ...src, key: `new-${++tempSeq}`, id: null, version: null, phase: `${src.phase} (copy)`, sortOrder: src.sortOrder + 1 };
    setDraft((prev) => [
      ...prev.map((r) => (r.key !== src.key && sameModule(r) && r.sortOrder > src.sortOrder ? { ...r, sortOrder: r.sortOrder + 1 } : r)),
      copy,
    ]);
    reveal(copy);
  };

  // Scroll to a row (Summary "Go to row", or a row just added). If the
  // filters hide it, they are cleared first - with a note saying so.
  const reveal = (row) => {
    if (isFiltering(filters) && !matchesFilters(row, filters, new Map((plan?.teams || []).map((t) => [t.id, t.name])), plan?.today)) {
      setFilters(EMPTY_FILTERS);
      showToast('Filters cleared to show the row.', 'info');
    }
    setRevealKey(row.key);
  };

  const applyFilters = (next) => {
    setFilters(next);
    setTimeout(() => document.getElementById('timeline-table')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0);
  };

  // Status check fixes: page only, like an inline edit.
  const fixRow = (key, patch) => update(key, patch);
  const fixAll = async (keys, patch, label) => {
    const ok = await confirmAction({
      title: `${label}?`,
      message: `${keys.length} phases change on this page only. Nothing is saved until you click Save changes.`,
      confirmLabel: label,
    });
    if (ok) setDraft((prev) => prev.map((r) => (keys.includes(r.key) ? { ...r, ...patch } : r)));
  };

  // ---------------------------------------------------------- bulk edit

  // Ticked rows, for the bulk bar. Only rows the table shows can be ticked
  // (see the pruning effect below), so a bulk change never touches a row
  // hidden by the filters.
  const select = (keys, checked) =>
    setSelected((prev) => {
      const next = new Set(prev);
      for (const k of keys) {
        if (checked) next.add(k);
        else next.delete(k);
      }
      return next;
    });
  const bulkUpdate = (makePatch) => setDraft((prev) => prev.map((r) => (selected.has(r.key) && !r.deleted ? { ...r, ...makePatch(r) } : r)));
  const pendingNote = 'on this page - click Save changes to keep them';
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

  const bulkTeam = (teamId) => {
    bulkUpdate(() => ({ teamId }));
    showToast(`Team set to ${teamId == null ? 'No team' : teamNameById.get(teamId)} for ${plural(selected.size, 'phase')} ${pendingNote}.`, 'success');
  };
  const bulkStatus = (status) => {
    bulkUpdate(() => ({ status }));
    showToast(`Status set to ${status} for ${plural(selected.size, 'phase')} ${pendingNote}.`, 'success');
  };
  // Start and end move together; an empty date stays empty.
  const bulkShift = (days) => {
    const rows = live.filter((r) => selected.has(r.key));
    const undated = rows.filter((r) => !r.startDate && !r.endDate).length;
    bulkUpdate((r) => ({ startDate: r.startDate && addDaysIso(r.startDate, days), endDate: r.endDate && addDaysIso(r.endDate, days) }));
    const moved = rows.length - undated;
    showToast(
      `${plural(moved, 'phase')} moved ${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'} ${days > 0 ? 'later' : 'earlier'} ${pendingNote}.` +
        (undated ? ` ${plural(undated, 'phase')} without dates left as they are.` : ''),
      'success',
      7000,
    );
  };

  // ---------------------------------------------------------- export

  const runExport = async () => {
    setExporting(true);
    try {
      const safeName = project.name.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'project';
      await apiDownload(`/project-timeline/projects/${projectId}/export`, `${safeName}-timeline-${today}.${exportFormat}`, {
        format: exportFormat,
        ...(filtering ? { rowIds: shownRows.map((r) => r.id) } : {}),
      });
      setExportOpen(false);
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setExporting(false);
    }
  };

  const resetBaseline = async () => {
    setResetting(true);
    try {
      const next = await apiFetch(`/project-timeline/projects/${projectId}/baseline/reset`, { method: 'POST', body: JSON.stringify({ reason: resetReason }) });
      setSlipData(next);
      setResetOpen(false);
      setResetReason('');
      showToast('Baseline reset. Slip now counts from today’s saved dates.', 'success');
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setResetting(false);
    }
  };

  const copySummary = async () => {
    const text = summaryText(summary, project.name);
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Older browsers / no clipboard permission: the hidden-textarea fallback.
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      if (!ok) {
        showToast('Could not copy - your browser blocked the clipboard.', 'error');
        return;
      }
    }
    showToast('Summary copied - paste it into Teams.', 'success');
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
  const summary = useMemo(() => (plan ? computeSummary(sortedLive, plan.teams, plan.today) : null), [sortedLive, plan]);
  const check = useMemo(() => (plan ? statusCheck(sortedLive, plan.today) : null), [sortedLive, plan]);
  const slip = useMemo(() => (slipData ? computeSlip(sortedLive, slipData) : null), [sortedLive, slipData]);
  const teamNameById = useMemo(() => new Map((plan?.teams || []).map((t) => [t.id, t.name])), [plan]);
  const filtering = isFiltering(filters);
  const shownRows = useMemo(() => {
    if (!plan || !filtering) return sortedLive;
    const names = new Map(plan.teams.map((t) => [t.id, t.name]));
    return sortedLive.filter((r) => matchesFilters(r, filters, names, plan.today));
  }, [sortedLive, filters, filtering, plan]);
  // Stage B, on the page's dates (unsaved edits included).
  const conflicts = useMemo(() => dependencyConflicts(sortedLive, deps), [sortedLive, deps]);
  const shifts = useMemo(() => cascadeShifts(sortedLive, deps), [sortedLive, deps]);
  const critical = useMemo(() => criticalPath(sortedLive, deps), [sortedLive, deps]);
  const depCountById = useMemo(() => {
    const m = new Map();
    for (const d of deps) for (const id of [d.predecessorRowId, d.successorRowId]) m.set(id, (m.get(id) || 0) + 1);
    return m;
  }, [deps]);
  const depRow = depRowKey ? live.find((r) => r.key === depRowKey) : null;

  // Stage C: per saved row - links, tickets, progress, and mismatches
  // against the phase's current (maybe unsaved) status.
  const ticketInfoById = useMemo(() => {
    const m = new Map();
    if (!ticketData) return m;
    const progressByRow = new Map(ticketData.rows.map((r) => [r.rowId, r]));
    for (const r of sortedLive) {
      if (r.id == null) continue;
      const links = ticketData.links.filter((l) => l.rowId === r.id);
      if (!links.length) continue;
      const p = progressByRow.get(r.id);
      const progress = p?.progress || null;
      m.set(r.id, { links, tickets: p?.tickets || [], progress, mismatches: ticketMismatches(r.status, progress, links.length) });
    }
    return m;
  }, [ticketData, sortedLive]);
  const ticketIssues = sortedLive.filter((r) => r.id != null && ticketInfoById.get(r.id)?.mismatches.length);
  const ticketRow = ticketRowKey ? live.find((r) => r.key === ticketRowKey) : null;

  // "Shift them too": every phase that starts too early moves later by just
  // enough (length kept), and so on down the chain - page only, like any edit.
  const applyShifts = async () => {
    const ok = await confirmAction({
      title: `Move ${plural(shifts.length, 'phase')} later?`,
      message: `${shifts
        .slice(0, 6)
        .map((s) => {
          const r = live.find((x) => x.id === s.id);
          return `${r?.phase} +${s.days}d`;
        })
        .join(', ')}${shifts.length > 6 ? ', …' : ''}. Nothing is saved until you click Save changes.`,
      confirmLabel: 'Move them',
    });
    if (!ok) return;
    const byId = new Map(shifts.map((s) => [s.id, s]));
    setDraft((prev) => prev.map((r) => (r.id != null && byId.has(r.id) && !r.deleted ? { ...r, startDate: byId.get(r.id).startDate, endDate: byId.get(r.id).endDate } : r)));
    showToast(`${plural(shifts.length, 'phase')} moved later ${pendingNote}.`, 'success', 7000);
  };

  const hiddenChanges = filtering ? [...changes.dirtyKeys].filter((k) => !shownRows.some((r) => r.key === k)).length : 0;

  // Rows that leave the table (filtered out, deleted, discarded) are unticked.
  useEffect(() => {
    setSelected((prev) => {
      if (!prev.size) return prev;
      const shown = new Set(shownRows.map((r) => r.key));
      const next = new Set([...prev].filter((k) => shown.has(k)));
      return next.size === prev.size ? prev : next;
    });
  }, [shownRows]);

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
                <Button variant="secondary" leftIcon={Download} onClick={() => setExportOpen(true)} disabled={!plan || live.length === 0}>
                  Export
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

              {summary && live.length > 0 && (
                <TimelineSummary
                  summary={summary}
                  projectName={project.name}
                  unsaved={dirty}
                  onFilter={applyFilters}
                  onJump={(key) => reveal(sortedLive.find((r) => r.key === key))}
                  onCopy={copySummary}
                  check={check}
                  teamName={teamNameById}
                  canEdit={canEdit}
                  onFix={fixRow}
                  onFixAll={fixAll}
                  slip={slip}
                  slipLoading={!slipData && !slipError}
                  slipError={slipError}
                  canResetBaseline={canResetBaseline}
                  onResetBaseline={() => {
                    setResetReason('');
                    setResetOpen(true);
                  }}
                />
              )}

              {depsError && (
                <div className={`${styles.notice} ${styles.noticeError}`} role="alert">
                  Couldn’t load dependencies: {depsError}
                </div>
              )}
              {conflicts.length > 0 && (
                <div className={styles.conflictBanner} role="status">
                  <div className={styles.conflictText}>
                    <strong>
                      {plural(conflicts.length, 'phase')} start{conflicts.length === 1 ? 's' : ''} before the phase{conflicts.length === 1 ? '' : 's'} they
                      depend on allow{conflicts.length === 1 ? 's' : ''}.
                    </strong>
                    <ul>
                      {conflicts.slice(0, 5).map((c) => (
                        <li key={`${c.dep.predecessorRowId}-${c.dep.successorRowId}`}>
                          {c.successor.phase} ({c.successor.module}) starts {formatDate(c.successor.startDate)}, {c.daysEarly} day
                          {c.daysEarly === 1 ? '' : 's'} before “{c.predecessor.phase}” allows ({formatDate(c.earliest)}).
                        </li>
                      ))}
                      {conflicts.length > 5 && <li>…and {conflicts.length - 5} more.</li>}
                    </ul>
                  </div>
                  {canEdit && shifts.length > 0 && (
                    <Button variant="secondary" onClick={applyShifts}>
                      Shift {plural(shifts.length, 'phase')} to fit
                    </Button>
                  )}
                </div>
              )}

              {ticketError && (
                <div className={`${styles.notice} ${styles.noticeError}`} role="alert">
                  Couldn’t load ticket progress: {ticketError}
                </div>
              )}
              {ticketIssues.length > 0 && (
                <div className={styles.ticketCheck} role="status">
                  <strong>
                    Ticket check: {plural(ticketIssues.length, 'phase')} {ticketIssues.length === 1 ? 'doesn’t' : 'don’t'} match {ticketIssues.length === 1 ? 'its' : 'their'} tickets.
                  </strong>
                  <ul>
                    {ticketIssues.slice(0, 6).map((r) => (
                      <li key={r.key}>
                        <button type="button" onClick={() => setTicketRowKey(r.key)}>
                          {r.module} – {r.phase}
                        </button>
                        : {ticketInfoById.get(r.id).mismatches.map((m) => m.text).join('; ')}
                      </li>
                    ))}
                    {ticketIssues.length > 6 && <li>…and {ticketIssues.length - 6} more.</li>}
                  </ul>
                </div>
              )}

              <div id="timeline-table">
                {live.length > 0 && (
                  <div className={styles.viewSwitch} role="group" aria-label="View">
                    <button type="button" className={`${styles.viewButton} ${view === 'table' ? styles.viewActive : ''}`} aria-pressed={view === 'table'} onClick={() => setView('table')}>
                      <Table2 size={16} aria-hidden="true" /> Table
                    </button>
                    <button type="button" className={`${styles.viewButton} ${view === 'gantt' ? styles.viewActive : ''}`} aria-pressed={view === 'gantt'} onClick={() => setView('gantt')}>
                      <GanttChart size={16} aria-hidden="true" /> Gantt
                    </button>
                  </div>
                )}
                {live.length > 0 && (
                  <TimelineFilters
                    filters={filters}
                    onChange={setFilters}
                    modules={summary.modules}
                    teams={plan.teams}
                    hasNoTeam={live.some((r) => r.teamId == null)}
                    shown={shownRows.length}
                    total={live.length}
                  />
                )}
              </div>

              {view === 'gantt' ? (
                <GanttView
                  rows={shownRows}
                  today={today}
                  teams={plan.teams}
                  canEdit={canEdit}
                  overlaps={overlaps}
                  slipByKey={slip?.perRow}
                  dirtyKeys={changes.dirtyKeys}
                  onChange={update}
                  onEditInTable={(row) => {
                    setView('table');
                    reveal(row);
                  }}
                  deps={deps}
                  conflicts={conflicts}
                  critical={critical}
                  onDependencies={(row) => setDepRowKey(row.key)}
                  ticketInfoById={ticketInfoById}
                  onTickets={(row) => setTicketRowKey(row.key)}
                />
              ) : (
              <TimelineTable
                rows={shownRows}
                canReorder={!filtering}
                revealKey={revealKey}
                onRevealed={() => setRevealKey(null)}
                emptyText={filtering ? 'No phases match these filters.' : undefined}
                slipByKey={slip?.perRow}
                selected={selected}
                onSelect={select}
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
                onDependencies={(key) => setDepRowKey(key)}
                depCountById={depCountById}
                ticketInfoById={ticketInfoById}
                onTickets={(key) => setTicketRowKey(key)}
              />
              )}

              {canEdit && (selected.size > 0 || dirty) && (
                <div className={styles.bottomBars}>
                  {selected.size > 0 && view === 'table' && (
                    <BulkBar count={selected.size} teams={plan.teams} onSetTeam={bulkTeam} onSetStatus={bulkStatus} onShift={bulkShift} onClear={() => setSelected(new Set())} />
                  )}
                  {dirty && (
                    <div className={styles.saveBar} role="region" aria-label="Unsaved changes">
                      <span className={styles.saveBarText}>
                        <strong>
                          {changes.count} unsaved change{changes.count === 1 ? '' : 's'}
                        </strong>{' '}
                        ({changes.creates.length} added, {changes.updates.length} edited, {changes.deletes.length} deleted)
                        {hiddenChanges > 0 && <span> – {hiddenChanges} of them in rows hidden by the filters</span>}
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
                </div>
              )}
            </>
          )}
        </>
      )}

      {ticketRow && ticketRow.id != null && (
        <TicketLinksDialog
          row={ticketRow}
          info={ticketInfoById.get(ticketRow.id)}
          projectId={projectId}
          canEdit={canEdit}
          onClose={() => setTicketRowKey(null)}
          onChanged={setTicketData}
        />
      )}

      {depRow && depRow.id != null && (
        <DependencyDialog row={depRow} rows={sortedLive} deps={deps} projectId={projectId} canEdit={canEdit} onClose={() => setDepRowKey(null)} onDepsChanged={setDeps} />
      )}

      <Modal
        open={resetOpen}
        onClose={() => !resetting && setResetOpen(false)}
        title="Reset the slip baseline?"
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setResetOpen(false)} disabled={resetting}>
              Cancel
            </Button>
            <Button onClick={resetBaseline} loading={resetting} disabled={resetting || !tidyName(resetReason)}>
              Reset baseline
            </Button>
          </>
        }
      >
        <p className={styles.muted} style={{ marginTop: 0 }}>
          Every phase’s current saved start and end dates become the new plan, and slip counts from them. The plan itself doesn’t change, and the
          old baseline stays in the audit log with your name, the time and this reason.
        </p>
        <label className={styles.label} htmlFor="timeline-reset-reason">
          Reason (required)
        </label>
        <textarea
          id="timeline-reset-reason"
          className={styles.input}
          rows={3}
          maxLength={1000}
          value={resetReason}
          onChange={(e) => setResetReason(e.target.value)}
          placeholder="e.g. Steering committee approved the new dates on Oct 20"
        />
      </Modal>

      <Modal
        open={exportOpen}
        onClose={() => !exporting && setExportOpen(false)}
        title="Export the timeline"
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setExportOpen(false)} disabled={exporting}>
              Cancel
            </Button>
            <Button leftIcon={Download} onClick={runExport} loading={exporting} disabled={exporting || dirty || shownRows.length === 0}>
              Download
            </Button>
          </>
        }
      >
        {dirty ? (
          <div className={`${styles.notice} ${styles.noticeError}`} role="alert">
            Save or discard your {plural(changes.count, 'unsaved change')} first - the export is the saved plan.
          </div>
        ) : (
          <p className={styles.muted} style={{ marginTop: 0 }}>
            {filtering ? `The ${plural(shownRows.length, 'phase')} the filters show (of ${live.length}).` : `The whole plan: ${plural(live.length, 'phase')}.`}
          </p>
        )}
        <fieldset className={styles.formatChoice}>
          <legend className={styles.label}>Format</legend>
          <label>
            <input type="radio" name="timeline-export-format" value="xlsx" checked={exportFormat === 'xlsx'} onChange={() => setExportFormat('xlsx')} />
            Excel (.xlsx)
          </label>
          <label>
            <input type="radio" name="timeline-export-format" value="csv" checked={exportFormat === 'csv'} onChange={() => setExportFormat('csv')} />
            CSV
          </label>
        </fieldset>
        <p className={styles.muted}>
          Columns: Module, Phase, Team, Status, Start Date, End Date - the import layout, so the file can be imported again - then Overdue, Overlaps
          with and Slip (days), which import ignores.
        </p>
      </Modal>

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
