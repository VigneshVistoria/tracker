import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import { Download, FlaskConical, GanttChart, History, LayoutDashboard, Plus, SlidersHorizontal, Table2, Upload } from 'lucide-react';
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
import TimelineHero from '../../components/projectTimeline/TimelineHero';
import AttentionStrip from '../../components/projectTimeline/AttentionStrip';
import WhatIfPanel from '../../components/projectTimeline/WhatIfPanel';
import TimeTravelPanel from '../../components/projectTimeline/TimeTravelPanel';
import PresentationMode from '../../components/projectTimeline/PresentationMode';
import { ticketMismatches } from '../../lib/projectTimelineTickets';
import { cascadeShifts, criticalPath, dependencyConflicts } from '../../lib/projectTimelineDeps';
import { forecastPlan } from '../../lib/projectTimelineForecast';
import { riskByKey, riskCounts, teamLoad, topRisks } from '../../lib/projectTimelineRisk';
import { changeDays, historyDays, planAt } from '../../lib/projectTimelineHistory';
import styles from '../../styles/projectTimeline.module.css';
import ov from '../../styles/timelineOverview.module.css';
import { apiDownload, apiFetch } from '../../lib/api';
import { useToast } from '../../lib/toast';
import { useConfirm } from '../../lib/confirm';
import { formatDate } from '../../lib/formatDate';
import { addDaysIso, isOverdue, matchKeyFor, nameKey, overlapsByRow, rowErrors, tidyName } from '../../lib/projectTimeline';
import { EMPTY_FILTERS, computeSlip, computeSummary, daysBetween, formatSlip, isFiltering, matchesFilters, statusCheck, summaryText } from '../../lib/projectTimelineSummary';

// Backend mirror: ProjectTimelineController's VIEW_ROLES / EDIT_ROLES.
const VIEW_ROLES = ['admin', 'program_manager', 'executive'];
const EDIT_ROLES = ['admin', 'program_manager'];
// Resetting the slip baseline: ProjectTimelineController BASELINE_ROLES.
const BASELINE_ROLES = ['program_manager'];
const FIELDS = ['module', 'phase', 'teamId', 'status', 'startDate', 'endDate', 'sortOrder'];
const LEAVE_MESSAGE = 'You have unsaved changes to the Project Timeline. Leave without saving?';
const VIEWS = ['overview', 'gantt', 'table'];
const DEFAULT_VIEW = 'gantt';

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
  const [changesDays, setChangesDays] = useState(7);
  const [changesData, setChangesData] = useState(null);
  const [changesError, setChangesError] = useState('');
  const [resetOpen, setResetOpen] = useState(false);
  const [resetReason, setResetReason] = useState('');
  const [resetting, setResetting] = useState(false);
  const [selected, setSelected] = useState(() => new Set());
  const [exportOpen, setExportOpen] = useState(false);
  const [exportFormat, setExportFormat] = useState('xlsx');
  const [exporting, setExporting] = useState(false);
  // Overview, Gantt or Table - kept in ?view= so a link opens the same
  // view. Gantt is the default (2026-10-17: the page is mostly opened full
  // screen to present the plan).
  const view = VIEWS.includes(router.query.view) ? router.query.view : DEFAULT_VIEW;
  const setView = (next) => {
    const { view: _old, ...rest } = router.query;
    router.replace({ pathname: '/project-timeline', query: next === DEFAULT_VIEW ? rest : { ...rest, view: next } }, undefined, { shallow: true });
  };
  // Where Overview's cards send the filters: the last of Gantt/Table used.
  const lastListView = useRef(DEFAULT_VIEW);
  if (view !== 'overview') lastListView.current = view;
  // Full screen (AppShell without sidebar/top bar) by default, like Team
  // Tasks - per visit, not remembered; "Exit full screen" brings them back.
  const [fullScreen, setFullScreen] = useState(true);
  const [filtersOpen, setFiltersOpen] = useState(false);
  // What-if sandbox: a scratch copy of the rows (null when off). Never saved.
  const [whatIf, setWhatIf] = useState(null);
  // Time travel: the past day shown (null when off) + the change history.
  const [travelDay, setTravelDay] = useState(null);
  const [history, setHistory] = useState(null); // { events, error }
  const [presenting, setPresenting] = useState(false);
  // Stable, so the deck's open/close effect doesn't re-run on re-renders.
  const closePresent = useCallback(() => setPresenting(false), []);

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

  // "What changed" (from the audit log) - reloaded with the saved plan and
  // when the period changes.
  useEffect(() => {
    if (!plan?.project?.id) return undefined;
    let cancelled = false;
    setChangesError('');
    setChangesData(null);
    apiFetch(`/project-timeline/projects/${plan.project.id}/recent-changes?days=${changesDays}`)
      .then((d) => !cancelled && setChangesData(d))
      .catch((err) => !cancelled && setChangesError(err.message));
    return () => {
      cancelled = true;
    };
  }, [plan?.rows, plan?.project?.id, changesDays]); // eslint-disable-line react-hooks/exhaustive-deps

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
    router.replace({ pathname: '/project-timeline', query: { project: id, ...(view !== DEFAULT_VIEW ? { view } : {}) } }, undefined, { shallow: true });
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

  // Scroll to a row (Summary "Go to row", or a row just added) - in the
  // Table, switching to it if needed. If the filters hide it, they are
  // cleared first - with a note saying so.
  const reveal = (row) => {
    if (!row) return;
    if (view !== 'table') setView('table');
    if (isFiltering(filters) && !matchesFilters(row, filters, new Map((plan?.teams || []).map((t) => [t.id, t.name])), plan?.today)) {
      setFilters(EMPTY_FILTERS);
      showToast('Filters cleared to show the row.', 'info');
    }
    setRevealKey(row.key);
  };

  const applyFilters = (next) => {
    setFilters(next);
    setFiltersOpen(true);
    if (view === 'overview') setView(lastListView.current);
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
  // Stage D forecast, on the page's dates and statuses (unsaved rows get a
  // stand-in id so they count too).
  const forecastIds = useMemo(() => new Map(sortedLive.map((r) => [r.key, r.id ?? `new:${r.key}`])), [sortedLive]);
  const forecastRowById = useMemo(() => new Map(sortedLive.map((r) => [forecastIds.get(r.key), r])), [sortedLive, forecastIds]);
  const forecast = useMemo(() => {
    if (!plan) return null;
    const pace = new Map((ticketData?.rows || []).map((r) => [r.rowId, r.progress]));
    return forecastPlan(
      sortedLive.map((r) => ({ id: forecastIds.get(r.key), status: r.status, startDate: r.startDate || null, endDate: r.endDate || null, sortOrder: r.sortOrder })),
      deps,
      plan.today,
      pace,
    );
  }, [sortedLive, forecastIds, deps, ticketData, plan]);
  const rowKeyById = useMemo(() => new Map(sortedLive.filter((r) => r.id != null).map((r) => [r.id, r.key])), [sortedLive]);
  // Gantt forecast ghosts, by row key.
  const forecastByKey = useMemo(() => {
    const m = new Map();
    if (!forecast) return m;
    const byId = new Map(forecast.rows.map((f) => [f.id, f]));
    for (const r of sortedLive) if (byId.has(forecastIds.get(r.key))) m.set(r.key, byId.get(forecastIds.get(r.key)));
    return m;
  }, [forecast, sortedLive, forecastIds]);
  // Risk score per phase + team load per week (on the page's rows).
  const risks = useMemo(() => {
    const earlyById = new Map();
    for (const c of conflicts) earlyById.set(c.successor.id, Math.max(earlyById.get(c.successor.id) || 0, c.daysEarly));
    return riskByKey(sortedLive, {
      today: plan?.today,
      forecastByKey,
      slipByKey: slip?.perRow,
      ticketInfoById,
      earlyById,
      criticalIds: new Set(critical?.chain || []),
    });
  }, [sortedLive, plan, forecastByKey, slip, ticketInfoById, conflicts, critical]);
  const risk = useMemo(() => ({ top: topRisks(sortedLive, risks), counts: riskCounts(sortedLive, risks) }), [sortedLive, risks]);
  const load = useMemo(() => (plan ? teamLoad(sortedLive, plan.teams, plan.today) : null), [sortedLive, plan]);

  // ---------------------------------------------------------- what-if

  // The same numbers as the plan's, worked out on the what-if copy.
  const wi = useMemo(() => {
    if (!whatIf || !plan) return null;
    const ids = new Map(whatIf.map((r) => [r.key, r.id ?? `new:${r.key}`]));
    const pace = new Map((ticketData?.rows || []).map((r) => [r.rowId, r.progress]));
    const fc = forecastPlan(
      whatIf.map((r) => ({ id: ids.get(r.key), status: r.status, startDate: r.startDate || null, endDate: r.endDate || null, sortOrder: r.sortOrder })),
      deps,
      plan.today,
      pace,
    );
    const fById = new Map(fc.rows.map((f) => [f.id, f]));
    const fByKey = new Map(whatIf.filter((r) => fById.has(ids.get(r.key))).map((r) => [r.key, fById.get(ids.get(r.key))]));
    const wConflicts = dependencyConflicts(whatIf, deps);
    const wCritical = criticalPath(whatIf, deps);
    const wTickets = new Map();
    for (const r of whatIf) {
      const info = r.id != null ? ticketInfoById.get(r.id) : null;
      if (info) wTickets.set(r.id, { ...info, mismatches: ticketMismatches(r.status, info.progress, info.links.length) });
    }
    const earlyById = new Map();
    for (const c of wConflicts) earlyById.set(c.successor.id, Math.max(earlyById.get(c.successor.id) || 0, c.daysEarly));
    const wSlip = slipData ? computeSlip(whatIf, slipData) : null;
    const wRisks = riskByKey(whatIf, { today: plan.today, forecastByKey: fByKey, slipByKey: wSlip?.perRow, ticketInfoById: wTickets, earlyById, criticalIds: new Set(wCritical?.chain || []) });
    // The plan's dates as the "baseline" ghost, so every move shows.
    const liveByKey = new Map(sortedLive.map((r) => [r.key, r]));
    const ghost = new Map();
    const changed = [];
    for (const r of whatIf) {
      const o = liveByKey.get(r.key);
      if (!o) continue;
      ghost.set(r.key, { baselineStart: o.startDate, baselineEnd: o.endDate, slip: o.endDate && r.endDate ? daysBetween(o.endDate, r.endDate) : null });
      const parts = [];
      if (o.startDate !== r.startDate) parts.push(o.startDate && r.startDate ? `start ${formatSlip(daysBetween(o.startDate, r.startDate))}` : `start ${r.startDate ? formatDate(r.startDate) : 'cleared'}`);
      if (o.endDate !== r.endDate) parts.push(o.endDate && r.endDate ? `end ${formatSlip(daysBetween(o.endDate, r.endDate))}` : `end ${r.endDate ? formatDate(r.endDate) : 'cleared'}`);
      if (o.status !== r.status) parts.push(`${o.status} to ${r.status}`);
      if (parts.length) changed.push({ key: r.key, row: r, parts });
    }
    const risky = (rs, rows) => rows.filter((r) => ['high', 'critical'].includes(rs.get(r.key)?.level.key)).length;
    return {
      forecastByKey: fByKey,
      conflicts: wConflicts,
      critical: wCritical,
      tickets: wTickets,
      risks: wRisks,
      ghost,
      changed,
      dirtyKeys: new Set(changed.map((c) => c.key)),
      overlaps: overlapsByRow(whatIf).byRow,
      metrics: {
        likelyEnd: fc.likelyEnd,
        projectEnd: wCritical?.projectEnd || null,
        overdue: whatIf.filter((r) => isOverdue(r, plan.today)).length,
        conflicts: wConflicts.length,
        risky: risky(wRisks, whatIf),
      },
      planMetrics: {
        likelyEnd: forecast?.likelyEnd || null,
        projectEnd: critical?.projectEnd || null,
        overdue: sortedLive.filter((r) => isOverdue(r, plan.today)).length,
        conflicts: conflicts.length,
        risky: risky(risks, sortedLive),
      },
    };
  }, [whatIf, plan, deps, ticketData, ticketInfoById, slipData, sortedLive, forecast, critical, conflicts, risks]);
  const wiShown = useMemo(() => {
    if (!whatIf || !plan || !filtering) return whatIf;
    return whatIf.filter((r) => matchesFilters(r, filters, teamNameById, plan.today));
  }, [whatIf, plan, filters, filtering, teamNameById]);

  // ---------------------------------------------------------- time travel

  // History reloads with the saved plan (a save adds events).
  useEffect(() => {
    setHistory(null);
  }, [plan?.rows, plan?.project?.id]);
  useEffect(() => {
    if (travelDay == null || history || !plan?.project?.id) return undefined;
    let cancelled = false;
    apiFetch(`/project-timeline/projects/${plan.project.id}/history`)
      .then((d) => !cancelled && setHistory({ events: d.events, error: '' }))
      .catch((err) => !cancelled && setHistory({ events: [], error: err.message }));
    return () => {
      cancelled = true;
    };
  }, [travelDay, history, plan?.project?.id]);
  const travel = useMemo(() => {
    if (travelDay == null || !plan || !history || history.error) return null;
    const events = history.events;
    const days = historyDays(events, plan.today);
    const rows = planAt(plan.rows, plan.teams, events, travelDay);
    const analyse = (list, day, pace) => {
      const fc = forecastPlan(
        list.map((r) => ({ id: r.id, status: r.status, startDate: r.startDate || null, endDate: r.endDate || null, sortOrder: r.sortOrder })),
        deps,
        day,
        pace,
      );
      return {
        phases: list.length,
        completed: list.filter((r) => r.status === 'Completed').length,
        overdue: list.filter((r) => isOverdue(r, day)).length,
        projectEnd: criticalPath(list, deps)?.projectEnd || null,
        likelyEnd: fc.likelyEnd || null,
      };
    };
    const savedNow = planAt(plan.rows, plan.teams, [], plan.today);
    const nowById = new Map(savedNow.map((r) => [r.id, r]));
    const ghost = new Map(rows.filter((r) => nowById.has(r.id)).map((r) => [r.key, { baselineStart: nowById.get(r.id).startDate, baselineEnd: nowById.get(r.id).endDate, slip: null }]));
    const names = new Map();
    for (const e of events) if (e.values?.phase) names.set(e.rowId, `${e.values.phase} (${e.values.module})`);
    for (const r of savedNow) names.set(r.id, `${r.phase} (${r.module})`);
    return {
      days,
      changeDays: changeDays(events),
      events,
      rows,
      ghost,
      conflicts: dependencyConflicts(rows, deps),
      critical: criticalPath(rows, deps),
      overlaps: overlapsByRow(rows).byRow,
      then: analyse(rows, travelDay, new Map()),
      now: analyse(savedNow, plan.today, new Map((ticketData?.rows || []).map((r) => [r.rowId, r.progress]))),
      nameOf: (e) => names.get(e.rowId) || `Phase #${e.rowId}`,
    };
  }, [travelDay, plan, history, deps, ticketData]);
  const travelShown = useMemo(() => {
    if (!travel || !filtering) return travel?.rows;
    return travel.rows.filter((r) => matchesFilters(r, filters, teamNameById, travelDay));
  }, [travel, filtering, filters, teamNameById, travelDay]);
  const startTravel = () => {
    setWhatIf(null);
    // Opens a week back (moved up to the first change by the effect below).
    setTravelDay(addDaysIso(plan.today, -7));
    if (view !== 'gantt') setView('gantt');
  };
  // Never before the first change, never after today.
  const pickTravelDay = useCallback(
    (d) => {
      if (!plan) return;
      setTravelDay(d > plan.today ? plan.today : d);
    },
    [plan],
  );
  useEffect(() => {
    if (travel && travelDay < travel.days[0]) setTravelDay(travel.days[0]);
  }, [travel, travelDay]);
  const sandbox = !!whatIf || travelDay != null;

  const startWhatIf = () => {
    setTravelDay(null);
    setWhatIf(sortedLive.map((r) => ({ ...r })));
    if (view !== 'gantt') setView('gantt');
  };
  const updateWhatIf = (key, patch) => setWhatIf((prev) => prev && prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const shiftWhatIf = (moduleKey, days) => {
    const moves = (r) => r.status !== 'Completed' && (!moduleKey || nameKey(r.module) === moduleKey) && (r.startDate || r.endDate);
    const n = whatIf.filter(moves).length;
    setWhatIf((prev) => prev.map((r) => (moves(r) ? { ...r, startDate: r.startDate && addDaysIso(r.startDate, days), endDate: r.endDate && addDaysIso(r.endDate, days) } : r)));
    showToast(`What-if: ${plural(n, 'phase')} moved ${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'} ${days > 0 ? 'later' : 'earlier'}.`, 'info');
  };
  const applyWhatIf = async () => {
    const byKey = new Map(whatIf.map((r) => [r.key, r]));
    const keys = new Set(wi.changed.map((c) => c.key));
    const ok = await confirmAction({
      title: `Apply ${plural(keys.size, 'change')} to the plan?`,
      message: 'They become unsaved changes on this page, like any edit. Nothing is saved until you click Save changes.',
      confirmLabel: 'Apply to plan',
    });
    if (!ok) return;
    setDraft((prev) => prev.map((r) => (keys.has(r.key) ? { ...r, startDate: byKey.get(r.key).startDate, endDate: byKey.get(r.key).endDate, status: byKey.get(r.key).status } : r)));
    setWhatIf(null);
    showToast(`${plural(keys.size, 'phase')} changed ${pendingNote}.`, 'success', 7000);
  };
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

  const statusCheckCount = check ? check.groups.reduce((n, g) => n + g.rows.length, 0) : 0;
  const activeFilters = Object.values(filters).filter((v) => v !== '').length;
  const showStatusCheck = () => {
    setView('overview');
    setTimeout(() => document.getElementById('tl-status-check')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  };

  const actions = project && canEdit && !importing && (
    <>
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
    </>
  );

  return (
    <AppShell fullScreen={fullScreen}>
      {loading ? (
        <LoadingState />
      ) : (
        <>
          <TimelineHero
            projectName={project?.name}
            picker={<ProjectPicker projects={projects} value={projectId} onChange={pickProject} />}
            actions={sandbox ? null : actions}
            fullScreen={fullScreen}
            onToggleFullScreen={() => setFullScreen((v) => !v)}
            onPresent={plan && live.length > 0 && !sandbox ? () => setPresenting(true) : null}
            summary={plan && live.length > 0 ? summary : null}
            forecast={forecast}
            slip={slip}
            critical={critical}
            unsaved={dirty}
            viewOnly={!canEdit}
            meta={
              plan ? (
                <>
                  <span>
                    {plural(live.length, 'phase')} · {plural(moduleCount, 'module')}
                  </span>
                  <span>
                    Today {formatDate(today)} ({plan.timeZone})
                  </span>
                </>
              ) : (
                <span>The plan for a project, module by module: phase, team, status and dates.</span>
              )
            }
          />

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
              {depsError && (
                <div className={`${styles.notice} ${styles.noticeError}`} role="alert">
                  Couldn’t load dependencies: {depsError}
                </div>
              )}
              {ticketError && (
                <div className={`${styles.notice} ${styles.noticeError}`} role="alert">
                  Couldn’t load ticket progress: {ticketError}
                </div>
              )}
              {live.length > 0 && !sandbox && (
                <AttentionStrip
                  conflicts={conflicts}
                  shiftsCount={shifts.length}
                  canEdit={canEdit}
                  onShift={applyShifts}
                  ticketIssues={ticketIssues}
                  ticketInfoById={ticketInfoById}
                  onTicketRow={setTicketRowKey}
                  overdue={live.filter((r) => isOverdue(r, today)).length}
                  onOverdue={() => applyFilters({ ...EMPTY_FILTERS, status: 'overdue' })}
                  statusChecks={statusCheckCount}
                  onStatusChecks={showStatusCheck}
                  overlapPairs={overlapPairs}
                />
              )}

              <div id="timeline-table" className={ov.tabBar} style={{ '--tab-top': fullScreen ? '0px' : 'var(--ds-topbar-height)' }}>
                <div className={ov.tabs} role="group" aria-label="View">
                  {[
                    ['overview', 'Overview', LayoutDashboard],
                    ['gantt', 'Gantt', GanttChart],
                    ['table', 'Table', Table2],
                  ].map(([key, label, Icon]) => (
                    <button
                      key={key}
                      type="button"
                      className={`${ov.tab} ${view === key ? ov.tabActive : ''}`}
                      aria-pressed={view === key}
                      disabled={sandbox && key !== 'gantt'}
                      title={sandbox && key !== 'gantt' ? 'Leave what-if / time travel to switch views' : undefined}
                      onClick={() => setView(key)}
                    >
                      <Icon size={16} aria-hidden="true" /> {label}
                    </button>
                  ))}
                </div>
                {live.length > 0 && (
                  <button
                    type="button"
                    className={`${ov.filterToggle} ${ov.whatIfButton} ${whatIf ? ov.whatIfOn : ''}`}
                    aria-pressed={!!whatIf}
                    onClick={whatIf ? () => setWhatIf(null) : startWhatIf}
                    title="Try changes on a scratch copy of the plan - nothing is saved"
                  >
                    <FlaskConical size={16} aria-hidden="true" /> {whatIf ? 'Exit what-if' : 'What-if'}
                  </button>
                )}
                {live.length > 0 && (
                  <button
                    type="button"
                    className={`${ov.filterToggle} ${ov.whatIfButton} ${travelDay != null ? ov.whatIfOn : ''}`}
                    aria-pressed={travelDay != null}
                    onClick={travelDay != null ? () => setTravelDay(null) : startTravel}
                    title="See the plan as it stood on any past day"
                  >
                    <History size={16} aria-hidden="true" /> {travelDay != null ? 'Back to today' : 'Time travel'}
                  </button>
                )}
                <span className={ov.tabSpacer} />
                {view !== 'overview' && live.length > 0 && (
                  <>
                    {/* The filter panel has its own "Showing n of m" line. */}
                    <span className={ov.shownText} aria-live={filtersOpen ? undefined : 'polite'} hidden={filtersOpen}>
                      {filtering ? `Showing ${shownRows.length} of ${live.length} phases` : `${plural(live.length, 'phase')}`}
                    </span>
                    <button type="button" className={ov.filterToggle} aria-expanded={filtersOpen} aria-controls="tl-filters" onClick={() => setFiltersOpen((v) => !v)}>
                      <SlidersHorizontal size={16} aria-hidden="true" /> Filters
                      {activeFilters > 0 && (
                        <span className={ov.filterCount} aria-label={`${activeFilters} active`}>
                          {activeFilters}
                        </span>
                      )}
                    </button>
                  </>
                )}
              </div>

              {view !== 'overview' && live.length > 0 && filtersOpen && (
                <div id="tl-filters">
                  <TimelineFilters
                    filters={filters}
                    onChange={setFilters}
                    modules={summary.modules}
                    teams={plan.teams}
                    hasNoTeam={live.some((r) => r.teamId == null)}
                    shown={shownRows.length}
                    total={live.length}
                  />
                </div>
              )}

              {view === 'overview' &&
                (summary && live.length > 0 ? (
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
                    forecast={forecast}
                    forecastRowById={forecastRowById}
                    changes={changesData}
                    changesLoading={!changesData && !changesError}
                    changesError={changesError}
                    changesDays={changesDays}
                    onChangesDays={setChangesDays}
                    rowKeyById={rowKeyById}
                    risk={risk}
                    load={load}
                  />
                ) : (
                  <p className={styles.muted}>No phases yet - {canEdit ? 'import a plan file or add a module.' : 'nothing to summarise.'}</p>
                ))}

              {whatIf && wi && (
                <WhatIfPanel
                  plan={wi.planMetrics}
                  what={wi.metrics}
                  changes={wi.changed}
                  modules={summary?.modules || []}
                  rows={whatIf}
                  onShift={shiftWhatIf}
                  onStatus={(key, status) => updateWhatIf(key, { status })}
                  onReset={() => setWhatIf(sortedLive.map((r) => ({ ...r })))}
                  onApply={canEdit ? applyWhatIf : null}
                  onExit={() => setWhatIf(null)}
                />
              )}
              {view === 'gantt' && whatIf && wi && (
                <GanttView
                  rows={wiShown}
                  today={today}
                  teams={plan.teams}
                  canEdit
                  overlaps={wi.overlaps}
                  slipByKey={wi.ghost}
                  dirtyKeys={wi.dirtyKeys}
                  onChange={updateWhatIf}
                  deps={deps}
                  conflicts={wi.conflicts}
                  critical={wi.critical}
                  ticketInfoById={wi.tickets}
                  forecastByKey={wi.forecastByKey}
                  risks={wi.risks}
                  fullScreen={fullScreen}
                  whatIf
                />
              )}
              {travelDay != null && (
                <TimeTravelPanel
                  days={travel?.days || [travelDay]}
                  changeDays={travel?.changeDays || []}
                  day={travelDay}
                  onDay={pickTravelDay}
                  events={travel?.events || []}
                  loading={!history}
                  error={history?.error || ''}
                  then={travel?.then || {}}
                  now={travel?.now || {}}
                  nameOf={travel?.nameOf || (() => '')}
                  onExit={() => setTravelDay(null)}
                />
              )}
              {view === 'gantt' && travel && (
                travelShown.length ? (
                  <GanttView
                    rows={travelShown}
                    today={travelDay}
                    teams={plan.teams}
                    canEdit={false}
                    overlaps={travel.overlaps}
                    slipByKey={travel.ghost}
                    dirtyKeys={new Set()}
                    onChange={() => {}}
                    deps={deps}
                    conflicts={travel.conflicts}
                    critical={travel.critical}
                    fullScreen={fullScreen}
                    baselineLabel="Today’s plan (grey outline)"
                    todayLabel="As of"
                  />
                ) : (
                  <p className={styles.muted}>No phases in the plan on {formatDate(travelDay)}.</p>
                )
              )}
              {view === 'gantt' && !whatIf && travelDay == null && (
                <GanttView
                  rows={shownRows}
                  today={today}
                  teams={plan.teams}
                  canEdit={canEdit}
                  overlaps={overlaps}
                  slipByKey={slip?.perRow}
                  dirtyKeys={changes.dirtyKeys}
                  onChange={update}
                  onEditInTable={(row) => reveal(row)}
                  deps={deps}
                  conflicts={conflicts}
                  critical={critical}
                  onDependencies={(row) => setDepRowKey(row.key)}
                  ticketInfoById={ticketInfoById}
                  onTickets={(row) => setTicketRowKey(row.key)}
                  forecastByKey={forecastByKey}
                  risks={risks}
                  fullScreen={fullScreen}
                />
              )}
              {view === 'table' && (
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

              {canEdit && !sandbox && (selected.size > 0 || dirty) && (
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

      {presenting && plan && summary && live.length > 0 && (
        <PresentationMode
          projectName={project?.name || ''}
          today={plan.today}
          timeZone={plan.timeZone}
          summary={summary}
          forecast={forecast}
          forecastRowById={forecastRowById}
          slip={slip}
          critical={critical}
          risk={risk}
          load={load}
          changes={changesData}
          rows={sortedLive}
          teamName={teamNameById}
          unsaved={dirty}
          onClose={closePresent}
        />
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
