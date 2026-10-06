import {
  LayoutDashboard,
  Ticket,
  FolderKanban,
  ClipboardEdit,
  Users,
  GitBranch,
  FileBarChart,
  MessagesSquare,
  Radio,
  CheckSquare,
  ClipboardCheck,
  Workflow,
  Timer,
  ShieldAlert,
  TrendingUp,
  SlidersHorizontal,
  Globe,
  FileSpreadsheet,
  Layers,
  UsersRound,
  Tag,
  CalendarRange,
  Boxes,
  GitBranchPlus,
  Percent,
  Inbox,
  ListTodo,
  ListChecks,
  FlaskConical,
  RotateCcw,
  Gauge,
  LayoutGrid,
  Bug,
  AlertTriangle,
  AlertOctagon,
  BookOpen,
  PackageCheck,
} from 'lucide-react';

// Single source of truth for the sidebar and the command palette.
//
// `roles` is exactly who saw each entry before the nav was grouped -
// grouping is visual only and must never widen or narrow access. Every
// entry here is also enforced by the page itself and by the backend; the
// nav only hides entry points a role can't use. Before changing a role
// list, check the matching controller (role rules differ module to
// module - see the comments below for the ones that aren't obvious).
//
// Developer/Designer/DevOps get no sidebar at all (confirmed with the user
// 2026-10-06 - they keep their minimal header), so they don't appear here.

const ADMIN = 'admin';
const PM = 'program_manager';
const EXEC = 'executive';
const QA = 'qa';
const CLIENT = 'client';

export const NAV_SECTIONS = [
  {
    id: 'work',
    title: 'My Work',
    items: [
      { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, roles: [ADMIN, PM, EXEC, QA, CLIENT] },
      // Client sees only their own tasks - /tasks/mine self-scopes for everyone.
      { href: '/tasks/mine', label: 'My Tasks', icon: ListTodo, roles: [ADMIN, PM, EXEC, QA, CLIENT], countKey: 'myTasks' },
      // QA sees their own defects; Admin/PM see every QA person's
      // (TasksService.findDefectQueue()).
      { href: '/tasks/my-defects', label: 'My Defects', icon: Bug, roles: [ADMIN, PM, QA], countKey: 'myDefects' },
      { href: '/daily-update', label: 'Daily Update', icon: ClipboardEdit, roles: [ADMIN, PM, QA] },
      // QA has no involvement in Time Sheets; Executive gets the report-only view.
      { href: '/time-sheets', label: 'Time Sheets', icon: Timer, roles: [ADMIN, PM, EXEC] },
    ],
  },
  {
    id: 'team',
    title: 'Team',
    items: [
      { href: '/tasks/team', label: 'Team Tasks', icon: ListChecks, roles: [ADMIN, PM, EXEC] },
      // Admin is view-only on the backlog and interventions; PM acts.
      { href: '/tasks/backlog', label: 'Task Backlog', icon: Inbox, roles: [ADMIN, PM] },
      { href: '/tasks/escalations', label: 'Interventions', icon: AlertTriangle, roles: [ADMIN, PM] },
      // Matches TasksController.ROLES_ALLOWED_TO_VIEW_QA_QUEUE.
      { href: '/tasks/qa-review', label: 'QA Review', icon: FlaskConical, roles: [ADMIN, PM, EXEC, QA], countKey: 'qaReview' },
      { href: '/issues', label: 'Issues', icon: Ticket, roles: [ADMIN, PM, QA] },
      { href: '/issues', label: 'My Tickets', icon: Ticket, roles: [CLIENT] },
      { href: '/dependencies', label: 'Dependency', icon: Workflow, roles: [ADMIN, PM, EXEC, QA] },
    ],
  },
  {
    id: 'quality',
    title: 'Quality',
    items: [
      { href: '/qa/test-cases', label: 'Test Cases', icon: ClipboardCheck, roles: [ADMIN, PM, QA] },
      { href: '/admin/showstopper-review', label: 'Showstopper Review', icon: ShieldAlert, roles: [ADMIN, PM, QA] },
      // PM only for now - same check as pages/release-log and
      // ReleaseLogsController.assertIsPm; widen all three together.
      { href: '/release-log', label: 'Release Log', icon: PackageCheck, roles: [PM] },
    ],
  },
  {
    id: 'projects',
    title: 'Projects',
    items: [
      { href: '/admin/projects', label: 'Projects', icon: FolderKanban, roles: [ADMIN, PM, EXEC, QA] },
      // View for Admin/Executive/PM; create/edit is narrower inside each page.
      { href: '/project-planning', label: 'Project Planning', icon: CalendarRange, roles: [ADMIN, PM, EXEC] },
      { href: '/project-modules', label: 'Project Modules', icon: Boxes, roles: [ADMIN, PM, EXEC] },
      { href: '/project-phases', label: 'Project Phases', icon: GitBranchPlus, roles: [ADMIN, PM, EXEC] },
      { href: '/project-teams', label: 'Project Teams', icon: UsersRound, roles: [ADMIN, PM, EXEC] },
    ],
  },
  {
    id: 'insights',
    title: 'Insights',
    items: [
      { href: '/performance-dashboard', label: 'Performance', icon: TrendingUp, roles: [ADMIN, PM, EXEC, QA] },
      // /kpi/me vs /kpi/report decides what each role sees behind this.
      { href: '/kpi', label: 'KPI Dashboard', icon: Gauge, roles: [ADMIN, PM, EXEC, QA] },
      { href: '/kpi/matrix', label: 'KPI Matrix', icon: LayoutGrid, roles: [ADMIN, PM, EXEC] },
      { href: '/reports/non-compliance', label: 'Non-Compliance Report', icon: AlertOctagon, roles: [ADMIN, PM, EXEC] },
      { href: '/admin/reports', label: 'Weekly Reports', icon: FileBarChart, roles: [ADMIN, EXEC] },
    ],
  },
  {
    id: 'setup',
    title: 'Setup',
    items: [
      // Same boundary as IssuesBulkService.isAllowedToBulkImportExport.
      { href: '/admin/issues-bulk', label: 'Bulk Import/Export', icon: FileSpreadsheet, roles: [ADMIN, PM] },
      { href: '/admin/issue-categories', label: 'Issue Categories', icon: Layers, roles: [ADMIN, PM] },
      { href: '/admin/teams', label: 'Teams', icon: UsersRound, roles: [ADMIN, PM] },
      { href: '/admin/labels', label: 'Labels', icon: Tag, roles: [ADMIN, PM] },
      // Admin/Executive/PM while it's being reviewed - same VIEW_ROLES as pages/sop.js.
      { href: '/sop', label: 'Tracker SOP', icon: BookOpen, roles: [ADMIN, PM, EXEC] },
    ],
  },
  {
    id: 'admin',
    title: 'Admin',
    items: [
      { href: '/admin/users', label: 'Users', icon: Users, roles: [ADMIN] },
      { href: '/admin/sprints', label: 'Sprints', icon: GitBranch, roles: [ADMIN] },
      { href: '/admin/sla-config', label: 'SLA Configuration', icon: Timer, roles: [ADMIN] },
      { href: '/admin/performance-scoring-config', label: 'Performance Scoring', icon: SlidersHorizontal, roles: [ADMIN] },
      { href: '/admin/team-updates', label: 'Team Updates', icon: MessagesSquare, roles: [ADMIN] },
      { href: '/admin/teams-integration', label: 'Teams Integration', icon: Radio, roles: [ADMIN] },
      { href: '/admin/regression-testing', label: 'Regression Testing', icon: CheckSquare, roles: [ADMIN] },
      { href: '/admin/task-status-config', label: 'Task Status Config', icon: Percent, roles: [ADMIN] },
      { href: '/admin/rollback', label: 'Rollback', icon: RotateCcw, roles: [ADMIN] },
    ],
  },
];

// Gated by isPlatformSuperadmin, which is orthogonal to role.
const PLATFORM_SECTION = {
  id: 'platform',
  title: 'Platform',
  items: [{ href: '/platform/tenants', label: 'Platform Tenants', icon: Globe }],
};

// Sections (with their items filtered) visible to this user, empty
// sections dropped.
export function navSectionsFor(user) {
  if (!user) return [];
  const sections = NAV_SECTIONS.map((section) => ({
    ...section,
    items: section.items.filter((item) => item.roles.includes(user.role)),
  })).filter((section) => section.items.length > 0);
  if (user.isPlatformSuperadmin) sections.push(PLATFORM_SECTION);
  return sections;
}

export function isNavItemActive(pathname, href) {
  return pathname === href || pathname.startsWith(href + '/');
}
