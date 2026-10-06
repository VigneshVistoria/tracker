import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  Bug,
  CalendarX,
  CheckCircle2,
  FlaskConical,
  FolderKanban,
  Inbox,
  Link2,
  Plus,
  RotateCcw,
  Ticket,
  Users,
  ListTodo,
} from 'lucide-react';
import AppShell from '../components/AppShell';
import DeveloperDashboard from '../components/DeveloperDashboard';
import Button from '../components/ui/Button';
import {
  DashboardHeader,
  AttentionTile,
  TileGrid,
  Panel,
  PanelLink,
  TaskList,
  IssuePipeline,
  StatRow,
  upNextTasks,
} from '../components/dashboard/DashboardParts';
import styles from '../styles/dashboardHome.module.css';
import { apiFetch } from '../lib/api';
import { getSocket } from '../lib/socket';
import { useToast } from '../lib/toast';
import { canCreateTickets, DEVELOPER_EQUIVALENT_ROLES } from '../lib/status';
import { isOverdueTask } from '../lib/developerTaskStats';
import { formatPercent } from '../lib/formatNumber';

// Top-level Dashboard loads `user` and picks a per-role home. Every view
// reads only endpoints that role could already reach (the backend still
// enforces each one) - a request that fails just hides its tile rather
// than breaking the page.
export default function Dashboard() {
  const [user, setUser] = useState(null);

  useEffect(() => {
    const storedUser = localStorage.getItem('user');
    if (!storedUser) return;
    setUser(JSON.parse(storedUser));
  }, []);

  if (!user) return <AppShell>{null}</AppShell>;
  if (DEVELOPER_EQUIVALENT_ROLES.includes(user.role)) return <DeveloperDashboard user={user} />;
  if (user.role === 'qa') return <QaHome user={user} />;
  if (user.role === 'client') return <ClientHome user={user} />;
  return <LeadershipHome user={user} />;
}

// Fetches a map of named endpoints in parallel. Each value is null while
// loading, the response on success, or undefined on failure (so tiles
// built from it hide themselves instead of showing a wrong 0).
function useDashboardData(endpoints) {
  const [data, setData] = useState(() => Object.fromEntries(Object.keys(endpoints).map((k) => [k, null])));
  const key = JSON.stringify(endpoints);

  const load = useCallback(() => {
    const entries = Object.entries(JSON.parse(key));
    Promise.allSettled(entries.map(([, path]) => apiFetch(path))).then((results) => {
      setData(Object.fromEntries(entries.map(([name], i) => [name, results[i].status === 'fulfilled' ? results[i].value : undefined])));
    });
  }, [key]);

  useEffect(() => {
    load();
  }, [load]);

  return [data, load];
}

// Refresh on live issue events, same as the previous dashboard did.
function useLiveIssueRefresh(reload) {
  const { showToast } = useToast();
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return undefined;
    const onCreated = (issue) => {
      showToast(`New issue opened: "${issue.title}"`, 'info');
      reload();
    };
    const onUpdated = (issue) => {
      showToast(`Issue #${issue.id} updated - now ${issue.status}`, 'success');
      reload();
    };
    socket.on('issue:created', onCreated);
    socket.on('issue:updated', onUpdated);
    return () => {
      socket.off('issue:created', onCreated);
      socket.off('issue:updated', onUpdated);
    };
  }, [reload, showToast]);
}

// "3 interventions and 2 overdue tasks need your attention." - or an
// all-clear line. Items: [{ count, one, many }].
function attentionSummary(items, loading) {
  if (loading) return 'Pulling together what needs you today…';
  const parts = items.filter((i) => i.count > 0).map((i) => `${i.count} ${i.count === 1 ? i.one : i.many}`);
  if (parts.length === 0) return 'All clear - nothing needs your attention right now.';
  const list = new Intl.ListFormat('en-US', { style: 'long', type: 'conjunction' }).format(parts);
  return `${list} need${parts.length === 1 && items.find((i) => i.count > 0).count === 1 ? 's' : ''} your attention.`;
}

const len = (v) => (Array.isArray(v) ? v.length : v);
const pick = (v, fn) => (v === null || v === undefined ? v : fn(v));

function NewIssueButton({ user }) {
  if (!canCreateTickets(user.role)) return null;
  return (
    <Button href="/issues/new" leftIcon={Plus}>
      New issue
    </Button>
  );
}

// Admin, Program Manager and Executive.
function LeadershipHome({ user }) {
  const isExec = user.role === 'executive';
  const isAdmin = user.role === 'admin';
  const endpoints = isExec
    ? { mine: '/tasks/mine', team: '/tasks/team?pageSize=1', qa: '/tasks/qa-queue', issues: '/issues', projects: '/projects' }
    : {
        mine: '/tasks/mine',
        team: '/tasks/team?pageSize=1',
        qa: '/tasks/qa-queue',
        defects: '/tasks/defect-queue',
        escalations: '/tasks/escalations',
        backlog: '/tasks/backlog',
        issues: '/issues',
        projects: '/projects',
      };
  const [data, reload] = useDashboardData(endpoints);
  useLiveIssueRefresh(reload);

  const teamStats = pick(data.team, (t) => t.statCounts);
  const overdue = pick(teamStats, (s) => s.overdue);
  const qaPending = pick(data.qa, (q) => q.statCounts.pending);
  const qaOverdue = data.qa ? data.qa.statCounts.overdue : 0;
  const interventions = len(data.escalations);
  const unassigned = len(data.backlog);
  const openDefects = pick(data.defects, (d) => d.statCounts.pending);
  const loading = Object.values(data).some((v) => v === null);

  const summary = attentionSummary(
    isExec
      ? [
          { count: overdue, one: 'overdue task', many: 'overdue tasks' },
          { count: teamStats?.rejected, one: 'rejected task', many: 'rejected tasks' },
        ]
      : [
          { count: interventions, one: 'intervention', many: 'interventions' },
          { count: overdue, one: 'overdue task', many: 'overdue tasks' },
          { count: unassigned, one: 'unassigned task', many: 'unassigned tasks' },
        ],
    loading,
  );

  return (
    <AppShell>
      <DashboardHeader user={user} summary={summary} actions={<NewIssueButton user={user} />} />

      <TileGrid label="Needs attention">
        {!isExec && (
          <AttentionTile
            href="/tasks/escalations"
            icon={AlertTriangle}
            value={interventions}
            label="Interventions"
            tone="critical"
            caption={{ active: 'Waiting on a PM decision', clear: 'Nothing escalated' }}
          />
        )}
        <AttentionTile
          href="/tasks/team"
          icon={CalendarX}
          value={overdue}
          label="Overdue tasks"
          tone="critical"
          caption={{ active: 'Past their due date', clear: 'Everything on schedule' }}
        />
        {!isExec && (
          <AttentionTile
            href="/tasks/backlog"
            icon={Inbox}
            value={unassigned}
            label="Unassigned backlog"
            tone="warning"
            caption={{ active: 'Ready to be assigned', clear: 'Backlog is empty' }}
          />
        )}
        <AttentionTile
          href="/tasks/qa-review"
          icon={FlaskConical}
          value={qaPending}
          label="Awaiting QA"
          tone={qaOverdue > 0 ? 'warning' : 'info'}
          caption={{
            active: qaOverdue > 0 ? `${qaOverdue} past review date` : 'In the QA review queue',
            clear: 'QA queue is clear',
          }}
        />
        {isExec ? (
          <AttentionTile
            href="/tasks/team"
            icon={Link2}
            value={pick(teamStats, (s) => s.openDependency)}
            label="Blocked by dependency"
            tone="warning"
            caption={{ active: 'Waiting on another team', clear: 'Nothing blocked' }}
          />
        ) : (
          <AttentionTile
            href="/tasks/my-defects"
            icon={Bug}
            value={openDefects}
            label="Open defects"
            tone="warning"
            caption={{ active: 'Pending QA review', clear: 'No open defects' }}
          />
        )}
      </TileGrid>

      <div className={styles.columns}>
        <div className={styles.stack}>
          <Panel title="Up next for you" action={<PanelLink href="/tasks/mine">My Tasks</PanelLink>}>
            <TaskList
              tasks={data.mine ? upNextTasks(data.mine) : []}
              loading={data.mine === null}
              emptyText="No open tasks assigned to you."
            />
          </Panel>
          <Panel title="Issue pipeline" action={!isExec && <PanelLink href="/issues">All issues</PanelLink>}>
            <IssuePipeline issues={data.issues || []} loading={data.issues === null} linkable={!isExec} />
          </Panel>
        </div>

        <div className={styles.stack}>
          {teamStats !== undefined && (
            <Panel title="Team at a glance" action={<PanelLink href="/tasks/team">Team Tasks</PanelLink>}>
              <StatRow
                items={[
                  { label: 'Active tasks', value: teamStats ? teamStats.total : '–' },
                  { label: 'Rejected by QA', value: teamStats ? teamStats.rejected : '–' },
                  { label: 'Blocked by dependency', value: teamStats ? teamStats.openDependency : '–' },
                  { label: 'Open defects', value: teamStats ? teamStats.defects : '–' },
                ]}
              />
            </Panel>
          )}
          <Panel title="Shortcuts">
            <div className={styles.shortcutGrid}>
              <ShortcutLink href="/admin/projects" icon={FolderKanban} label={isAdmin ? 'Manage projects' : 'Projects'} meta={pick(len(data.projects), (n) => `${n} ${n === 1 ? 'project' : 'projects'}`)} />
              <ShortcutLink href="/tasks/team" icon={ListTodo} label="Team Tasks" />
              {isAdmin && <ShortcutLink href="/admin/users" icon={Users} label="User management" />}
              {!isExec && <ShortcutLink href="/tasks/backlog" icon={Inbox} label="Task Backlog" />}
              {isExec && <ShortcutLink href="/kpi/matrix" icon={CheckCircle2} label="KPI Matrix" />}
            </div>
          </Panel>
        </div>
      </div>
    </AppShell>
  );
}

function ShortcutLink({ href, icon: Icon, label, meta }) {
  return (
    <Link href={href} className={styles.shortcut}>
      <span className={styles.shortcutIcon} aria-hidden="true">
        <Icon size={18} />
      </span>
      <span className={styles.shortcutText}>
        <span className={styles.shortcutLabel}>{label}</span>
        {meta && <span className={styles.shortcutMeta}>{meta}</span>}
      </span>
    </Link>
  );
}

function QaHome({ user }) {
  const [data, reload] = useDashboardData({
    mine: '/tasks/mine',
    qa: '/tasks/qa-queue',
    defects: '/tasks/defect-queue',
    execution: '/test-cases/execution-summary',
    issues: '/issues',
  });
  useLiveIssueRefresh(reload);

  const qaStats = pick(data.qa, (q) => q.statCounts);
  const myOverdue = pick(data.mine, (tasks) => tasks.filter((t) => isOverdueTask(t)).length);
  const loading = Object.values(data).some((v) => v === null);
  const exec = data.execution?.overall;
  const executable = exec ? exec.total - exec.na : 0;

  const summary = attentionSummary(
    [
      { count: qaStats?.pending, one: 'task awaiting review', many: 'tasks awaiting review' },
      { count: myOverdue, one: 'overdue task', many: 'overdue tasks' },
    ],
    loading,
  );

  return (
    <AppShell>
      <DashboardHeader
        user={user}
        summary={summary}
        actions={
          <>
            <Button href="/tasks/new-defect" variant="secondary" leftIcon={Bug}>
              Create defect
            </Button>
            <NewIssueButton user={user} />
          </>
        }
      />

      <TileGrid label="Needs attention">
        <AttentionTile
          href="/tasks/qa-review"
          icon={FlaskConical}
          value={pick(qaStats, (s) => s.pending)}
          label="Review queue"
          tone={qaStats?.overdue > 0 ? 'warning' : 'info'}
          caption={{
            active: qaStats?.overdue > 0 ? `${qaStats.overdue} past review date` : 'Waiting for your review',
            clear: 'Queue is clear',
          }}
        />
        <AttentionTile
          href="/tasks/qa-review"
          icon={RotateCcw}
          value={pick(qaStats, (s) => s.resubmissions)}
          label="Resubmissions"
          tone="info"
          caption={{ active: 'Fixed and sent back', clear: 'None waiting' }}
        />
        <AttentionTile
          href="/tasks/my-defects"
          icon={Bug}
          value={pick(data.defects, (d) => d.statCounts.pending)}
          label="My open defects"
          tone="warning"
          caption={{ active: 'Still being worked on', clear: 'No open defects' }}
        />
        <AttentionTile
          href="/tasks/mine"
          icon={CalendarX}
          value={myOverdue}
          label="My overdue tasks"
          tone="critical"
          caption={{ active: 'Past their due date', clear: 'Everything on schedule' }}
        />
      </TileGrid>

      <div className={styles.columns}>
        <div className={styles.stack}>
          <Panel title="Up next for you" action={<PanelLink href="/tasks/mine">My Tasks</PanelLink>}>
            <TaskList
              tasks={data.mine ? upNextTasks(data.mine) : []}
              loading={data.mine === null}
              emptyText="No open tasks assigned to you."
            />
          </Panel>
          <Panel title="Issue pipeline" action={<PanelLink href="/issues">All issues</PanelLink>}>
            <IssuePipeline issues={data.issues || []} loading={data.issues === null} />
          </Panel>
        </div>
        <div className={styles.stack}>
          {data.execution !== undefined && (
            <Panel title="Test execution" action={<PanelLink href="/qa/test-cases">Test Cases</PanelLink>}>
              <StatRow
                items={[
                  { label: 'Pass rate', value: exec ? formatPercent(exec.passed, executable) : '–' },
                  { label: 'Failed', value: exec ? exec.failed : '–' },
                  { label: 'Blocked', value: exec ? exec.blocked : '–' },
                  { label: 'Not executed', value: exec ? exec.notExecuted : '–' },
                ]}
              />
            </Panel>
          )}
        </div>
      </div>
    </AppShell>
  );
}

const CLIENT_IN_FLIGHT = ['In Progress', 'In Review', 'QA Testing', 'QA Failed'];

function ClientHome({ user }) {
  const [data, reload] = useDashboardData({ issues: '/issues', mine: '/tasks/mine' });
  useLiveIssueRefresh(reload);
  const issues = data.issues;
  const count = (fn) => pick(issues, (list) => list.filter(fn).length);
  const openTasks = pick(data.mine, (tasks) => upNextTasks(tasks, 100).length);

  return (
    <AppShell>
      <DashboardHeader
        user={user}
        summary={
          data.mine === null
            ? 'Pulling together your tickets…'
            : openTasks > 0
              ? `${openTasks} ${openTasks === 1 ? 'task is' : 'tasks are'} waiting on you.`
              : 'Here’s where your tickets stand.'
        }
        actions={<NewIssueButton user={user} />}
      />

      <TileGrid label="Your tickets">
        <AttentionTile
          href="/issues"
          icon={Ticket}
          value={count((i) => i.status === 'Backlog')}
          label="Not started"
          tone="info"
          caption={{ active: 'Queued for the team', clear: 'Nothing queued' }}
        />
        <AttentionTile
          href="/issues"
          icon={RotateCcw}
          value={count((i) => CLIENT_IN_FLIGHT.includes(i.status))}
          label="In progress"
          tone="info"
          caption={{ active: 'Being worked on', clear: 'Nothing in progress' }}
        />
        <AttentionTile
          href="/issues"
          icon={CheckCircle2}
          value={count((i) => i.status === 'Ready for Production')}
          label="Ready"
          caption={{ active: 'Ready for production', clear: 'None yet' }}
        />
        <AttentionTile
          href="/tasks/mine"
          icon={ListTodo}
          value={openTasks}
          label="Tasks for you"
          tone="warning"
          caption={{ active: 'Need something from you', clear: 'Nothing needed from you' }}
        />
      </TileGrid>

      <div className={styles.columns}>
        <Panel title="Tasks waiting on you" action={<PanelLink href="/tasks/mine">My Tasks</PanelLink>}>
          <TaskList
            tasks={data.mine ? upNextTasks(data.mine) : []}
            loading={data.mine === null}
            emptyText="Nothing needed from you right now."
          />
        </Panel>
        <Panel title="Ticket pipeline" action={<PanelLink href="/issues">My Tickets</PanelLink>}>
          <IssuePipeline issues={issues || []} loading={issues === null} />
        </Panel>
      </div>
    </AppShell>
  );
}
