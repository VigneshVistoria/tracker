import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import {
  Bell,
  ChevronsLeft,
  ChevronsRight,
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
  Search,
  LogOut,
  Menu,
  X,
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
  Link2,
  FlaskConical,
  RotateCcw,
  Gauge,
} from 'lucide-react';
import styles from '../styles/appshell.module.css';
import { getSocket, disconnectSocket } from '../lib/socket';
import { roleLabel } from '../lib/status';
import ThemeToggle from './ui/ThemeToggle';

const NAV_ITEMS = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/issues', label: 'Issues', icon: Ticket },
  { href: '/dependencies', label: 'Dependency', icon: Workflow },
  { href: '/admin/projects', label: 'Projects', icon: FolderKanban },
  { href: '/performance-dashboard', label: 'Performance', icon: TrendingUp },
  { href: '/daily-update', label: 'Daily Update', icon: ClipboardEdit },
];

// Executives get read-only access to just the dashboard and weekly
// reports - no ticket list, no project management, nothing editable.
// Dependency is still included - any role can be routed a dependency to
// own, Executive included, even though Executive can't create one.
// Performance is included too - Executive is one of the wide-view roles
// on that dashboard. Projects is included too - Executive gets the same
// leadership-wide, read-only completion%/risk drill-down Program Manager
// sees (backend grants this regardless of project assignment).
const EXECUTIVE_NAV_ITEMS = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/dependencies', label: 'Dependency', icon: Workflow },
  { href: '/admin/projects', label: 'Projects', icon: FolderKanban },
  { href: '/performance-dashboard', label: 'Performance', icon: TrendingUp },
  { href: '/time-sheets', label: 'Time Sheets', icon: Timer },
  { href: '/admin/reports', label: 'Weekly Reports', icon: FileBarChart },
];

// QA and Program Manager get the Test Case catalog in addition to the
// common nav above - QA authors/runs test cases, Program Manager gets
// read-only visibility into them (enforced on the backend, same pattern
// as everywhere else in this file - the frontend just hides the entry
// point for roles that can't use it).
const TEST_CASES_NAV_ITEM = { href: '/qa/test-cases', label: 'Test Cases', icon: ClipboardCheck };

// Same visibility as Test Cases (QA + Program Manager + Admin) - the
// queue of showstopper tickets the heuristic flagged as questionable,
// waiting for one of them to confirm or downgrade.
const SHOWSTOPPER_REVIEW_NAV_ITEM = { href: '/admin/showstopper-review', label: 'Showstopper Review', icon: ShieldAlert };

// Developer + Program Manager + Admin only - QA has no involvement in
// Time Sheets today (doesn't log time, doesn't view the report), so it's
// kept out of the shared NAV_ITEMS array rather than shown as a dead end.
// Executive gets its own entry in EXECUTIVE_NAV_ITEMS below (report-only,
// no log-time form - the page itself handles that distinction).
const TIME_SHEETS_NAV_ITEM = { href: '/time-sheets', label: 'Time Sheets', icon: Timer };

// Admin + Program Manager only, same authorization boundary the backend
// enforces on the bulk-export/bulk-import endpoints
// (IssuesBulkService.isAllowedToBulkImportExport) - deliberately not QA/
// Executive/Client, unlike ticket creation's own (wider) role list.
const BULK_IMPORT_EXPORT_NAV_ITEM = { href: '/admin/issues-bulk', label: 'Bulk Import/Export', icon: FileSpreadsheet };

// Admin + Program Manager only, same authorization boundary as the
// backend guards on these 3 lookup-table modules (issue-categories,
// teams, labels controllers). Standalone catalogs for now - not yet
// referenced by Issues/Users (see backend/migrations/2026-09-issue-
// categories-teams-labels.sql).
const ISSUE_CATEGORIES_NAV_ITEM = { href: '/admin/issue-categories', label: 'Issue Categories', icon: Layers };
const TEAMS_NAV_ITEM = { href: '/admin/teams', label: 'Teams', icon: UsersRound };
const LABELS_NAV_ITEM = { href: '/admin/labels', label: 'Labels', icon: Tag };

// Admin + Executive + Program Manager only (view), create/edit is further
// restricted to Program Manager alone within the page itself - QA/Developer
// don't get this entry at all, matching the backend's assertCanView on
// every route including reads (unlike the 3 items above, which are
// readable by anyone authenticated).
const PROJECT_PLANNING_NAV_ITEM = { href: '/project-planning', label: 'Project Planning', icon: CalendarRange };

// Same visibility rule as Project Planning - Admin/Executive/PM view,
// create/deactivate further restricted to Admin/PM within the page.
const PROJECT_MODULES_NAV_ITEM = { href: '/project-modules', label: 'Project Modules', icon: Boxes };

// Same visibility rule as Project Modules/Planning - Admin/Executive/PM
// view, create/deactivate is Program Manager only within the page (no
// legacy Admin capability to preserve here, unlike Modules).
const PROJECT_PHASES_NAV_ITEM = { href: '/project-phases', label: 'Project Phases', icon: GitBranchPlus };

// Same visibility rule as Project Modules/Phases/Planning - Admin/
// Executive/PM view, create/edit/status-change is Program Manager only
// within the page (no legacy Admin capability to preserve here, same as
// Phases).
const PROJECT_TEAMS_NAV_ITEM = { href: '/project-teams', label: 'Project Teams', icon: UsersRound };

// Task lifecycle nav (replaces the old single Tasks entry): Task Backlog
// is viewable by Admin/Program Manager (who creates/assigns tasks - Admin
// is view-only there, TasksController's own role checks handle that); My
// Tasks is visible to everyone who can be assigned or view their own tasks
// (Admin/Executive/Program Manager/QA/Developer - Client excluded, same
// as TasksService.findAllForUser never returning anything client-
// relevant); Dependency Clearance is Developer only, since Dependency
// Owner is restricted to Developer role (TaskDependencyTicketsService); QA
// Review matches TasksController.ROLES_ALLOWED_TO_VIEW_QA_QUEUE
// (Admin/Executive/Program Manager/QA) - previously QA-only here despite
// the backend and the page itself already allowing the other three roles.
const TASK_BACKLOG_NAV_ITEM = { href: '/tasks/backlog', label: 'Task Backlog', icon: Inbox };
const MY_TASKS_NAV_ITEM = { href: '/tasks/mine', label: 'My Tasks', icon: ListTodo };
const DEPENDENCY_CLEARANCE_NAV_ITEM = { href: '/dependency-clearance', label: 'Dependency Clearance', icon: Link2 };
const QA_REVIEW_NAV_ITEM = { href: '/tasks/qa-review', label: 'QA Review', icon: FlaskConical };

// Same visibility as My Tasks (Admin/Executive/Program Manager/QA/
// Developer, Client excluded - Clients have no tasks assigned, so there's
// nothing for this page to show them). Server-side, /kpi/me vs /kpi/report
// is what actually restricts a non-leadership user to only their own
// score - this nav entry point is available to everyone in that role set,
// but what each of them sees behind it differs per role.
const KPI_NAV_ITEM = { href: '/kpi', label: 'KPI Dashboard', icon: Gauge };

// Multi-tenant conversion Phase E - gated by isPlatformSuperadmin, which
// is orthogonal to `role` (a tenant's own admin doesn't get this just by
// being role === 'admin').
const PLATFORM_TENANTS_NAV_ITEM = { href: '/platform/tenants', label: 'Platform Tenants', icon: Globe };

// Clients only ever see their own tickets - a minimal nav with nothing
// internal (no Issues list, Projects, Dependency, Test Cases, etc.).
const CLIENT_NAV_ITEMS = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/issues', label: 'My Tickets', icon: Ticket },
];

// Developer gets the Task-lifecycle-focused Dashboard (see
// components/DeveloperDashboard.js) plus My Tasks/Dependency Clearance/
// Time Sheets (added below via the conditional SingleNavLink blocks,
// unchanged by this). Issues, Dependency (the old Issue-linked module),
// Projects, Performance, and Daily Update are deliberately dropped from
// Developer's nav - confirmed with the user 2026-09 after flagging that
// Issues/Dependency/Performance/Daily Update each lose the Developer's
// only way to see or do something (Daily Update is a submit action, not
// just a view) - the user chose to hide all five anyway.
const DEVELOPER_NAV_ITEMS = [{ href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard }];

const ADMIN_NAV_ITEMS = [
  { href: '/admin/users', label: 'Users', icon: Users },
  { href: '/admin/sprints', label: 'Sprints', icon: GitBranch },
  { href: '/qa/test-cases', label: 'Test Cases', icon: ClipboardCheck },
  { href: '/admin/showstopper-review', label: 'Showstopper Review', icon: ShieldAlert },
  { href: '/admin/sla-config', label: 'SLA Configuration', icon: Timer },
  { href: '/admin/performance-scoring-config', label: 'Performance Scoring', icon: SlidersHorizontal },
  { href: '/admin/reports', label: 'Weekly Reports', icon: FileBarChart },
  { href: '/admin/team-updates', label: 'Team Updates', icon: MessagesSquare },
  { href: '/admin/teams-integration', label: 'Teams Integration', icon: Radio },
  { href: '/admin/regression-testing', label: 'Regression Testing', icon: CheckSquare },
  { href: '/admin/task-status-config', label: 'Task Status Config', icon: Percent },
  { href: '/admin/rollback', label: 'Rollback', icon: RotateCcw },
];

// A single conditionally-shown nav entry outside the main NAV_ITEMS/
// ADMIN_NAV_ITEMS arrays (e.g. Test Cases, Showstopper Review) - visible
// to a specific set of roles that doesn't match either of those groups.
function SingleNavLink({ item, isActive, collapsed }) {
  return (
    <Link
      href={item.href}
      className={`${styles.navLink} ${isActive(item.href) ? styles.active : ''}`}
      title={collapsed ? item.label : undefined}
    >
      <item.icon size={18} className={styles.navIcon} aria-hidden="true" />
      {!collapsed && <span>{item.label}</span>}
    </Link>
  );
}

function initialsFor(user) {
  if (!user) return '?';
  if (user.fullName) {
    return user.fullName.split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase();
  }
  return user.email[0].toUpperCase();
}

export default function AppShell({ children }) {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const storedUser = localStorage.getItem('user');
    if (!storedUser) {
      router.replace('/');
      return;
    }
    setUser(JSON.parse(storedUser));

    const socket = getSocket();
    if (socket) {
      const onConnect = () => setConnected(true);
      const onDisconnect = () => setConnected(false);
      socket.on('connect', onConnect);
      socket.on('disconnect', onDisconnect);
      setConnected(socket.connected);
      return () => {
        socket.off('connect', onConnect);
        socket.off('disconnect', onDisconnect);
      };
    }
  }, [router]);

  const handleLogout = () => {
    disconnectSocket();
    localStorage.removeItem('accessToken');
    localStorage.removeItem('user');
    router.push('/');
  };

  useEffect(() => {
    setDrawerOpen(false);
  }, [router.pathname]);

  if (!user) return null;

  const isActive = (href) => router.pathname === href || router.pathname.startsWith(href + '/');
  // Developer gets no sidebar at all (confirmed with the user - a
  // follow-up to the icon-only redesign, which is now moot since there's
  // no nav left to render icon-only). Time Sheets/KPI Dashboard access
  // for Developer without a sidebar is a known, deliberately deferred
  // gap - the user asked to come back to it separately.
  const hideSidebar = user.role === 'developer';
  const navItems =
    user.role === 'client'
      ? CLIENT_NAV_ITEMS
      : user.role === 'executive'
        ? EXECUTIVE_NAV_ITEMS
        : user.role === 'developer'
          ? DEVELOPER_NAV_ITEMS
          : NAV_ITEMS;

  return (
    <div className={styles.shell}>
      <header className={styles.topbar}>
        {!hideSidebar && (
          <div className={styles.topbarLeft}>
            <button
              className={styles.menuButton}
              onClick={() => setDrawerOpen((v) => !v)}
              aria-label={drawerOpen ? 'Close navigation menu' : 'Open navigation menu'}
              aria-expanded={drawerOpen}
            >
              {drawerOpen ? <X size={18} aria-hidden="true" /> : <Menu size={18} aria-hidden="true" />}
            </button>
            <Link href="/dashboard" className={styles.brand}>
              <span className={styles.brandMark}>IT</span>
              <span className={styles.brandName}>IssueTrack</span>
            </Link>
          </div>
        )}

        {!hideSidebar && (
          <div className={styles.searchWrap}>
            <Search size={16} className={styles.searchIcon} aria-hidden="true" />
            <input
              type="search"
              className={styles.searchInput}
              placeholder="Search issues, projects, people…"
              aria-label="Search"
            />
          </div>
        )}

        <div className={styles.topbarRight}>
          {!hideSidebar && (
            <>
              <span
                className={`${styles.connectionStatus} ${connected ? styles.live : ''}`}
                title={connected ? 'Live updates connected' : 'Live updates disconnected'}
              >
                <span className={styles.connectionDot} aria-hidden="true" />
                <span className={styles.connectionLabel}>{connected ? 'Live' : 'Offline'}</span>
              </span>
              <button type="button" className={styles.iconButton} aria-label="Notifications">
                <Bell size={18} aria-hidden="true" />
              </button>
            </>
          )}
          <ThemeToggle variant="ghost" />
          {!hideSidebar && (
            <div className={styles.userBadge}>
              <span className={styles.avatar}>{initialsFor(user)}</span>
              <span className={styles.userBadgeText}>
                <span className={styles.userName}>{user.fullName || user.email}</span>
                <span className={styles.userRole}>{roleLabel(user.role)}</span>
              </span>
            </div>
          )}
          <button type="button" className={styles.iconButton} onClick={handleLogout} aria-label="Log out">
            <LogOut size={17} aria-hidden="true" />
          </button>
        </div>
      </header>

      <div className={styles.body}>
        {!hideSidebar && (
          <>
        <div
          className={`${styles.overlay} ${drawerOpen ? styles.open : ''}`}
          onClick={() => setDrawerOpen(false)}
        />
        <nav
          className={`${styles.sidebar} ${drawerOpen ? styles.open : ''} ${collapsed ? styles.collapsed : ''}`}
          aria-label="Main navigation"
        >
          <div className={styles.navScroll}>
            {navItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={`${styles.navLink} ${isActive(item.href) ? styles.active : ''}`}
                title={collapsed ? item.label : undefined}
              >
                <item.icon size={18} className={styles.navIcon} aria-hidden="true" />
                {!collapsed && <span>{item.label}</span>}
              </Link>
            ))}

            {(user.role === 'admin' || user.role === 'program_manager') && (
              <SingleNavLink item={TASK_BACKLOG_NAV_ITEM} isActive={isActive} collapsed={collapsed} />
            )}

            {(user.role === 'admin' ||
              user.role === 'executive' ||
              user.role === 'program_manager' ||
              user.role === 'qa' ||
              user.role === 'developer') && (
              <SingleNavLink item={MY_TASKS_NAV_ITEM} isActive={isActive} collapsed={collapsed} />
            )}

            {user.role === 'developer' && (
              <SingleNavLink item={DEPENDENCY_CLEARANCE_NAV_ITEM} isActive={isActive} collapsed={collapsed} />
            )}

            {(user.role === 'admin' ||
              user.role === 'executive' ||
              user.role === 'program_manager' ||
              user.role === 'qa') && (
              <SingleNavLink item={QA_REVIEW_NAV_ITEM} isActive={isActive} collapsed={collapsed} />
            )}

            {(user.role === 'admin' ||
              user.role === 'executive' ||
              user.role === 'program_manager' ||
              user.role === 'qa' ||
              user.role === 'developer') && (
              <SingleNavLink item={KPI_NAV_ITEM} isActive={isActive} collapsed={collapsed} />
            )}

            {(user.role === 'qa' || user.role === 'program_manager') && (
              <>
                <SingleNavLink item={TEST_CASES_NAV_ITEM} isActive={isActive} collapsed={collapsed} />
                <SingleNavLink item={SHOWSTOPPER_REVIEW_NAV_ITEM} isActive={isActive} collapsed={collapsed} />
              </>
            )}

            {(user.role === 'developer' || user.role === 'program_manager' || user.role === 'admin') && (
              <SingleNavLink item={TIME_SHEETS_NAV_ITEM} isActive={isActive} collapsed={collapsed} />
            )}

            {(user.role === 'program_manager' || user.role === 'admin') && (
              <>
                <SingleNavLink item={BULK_IMPORT_EXPORT_NAV_ITEM} isActive={isActive} collapsed={collapsed} />
                <SingleNavLink item={ISSUE_CATEGORIES_NAV_ITEM} isActive={isActive} collapsed={collapsed} />
                <SingleNavLink item={TEAMS_NAV_ITEM} isActive={isActive} collapsed={collapsed} />
                <SingleNavLink item={LABELS_NAV_ITEM} isActive={isActive} collapsed={collapsed} />
              </>
            )}

            {(user.role === 'admin' || user.role === 'executive' || user.role === 'program_manager') && (
              <SingleNavLink item={PROJECT_PLANNING_NAV_ITEM} isActive={isActive} collapsed={collapsed} />
            )}

            {(user.role === 'admin' || user.role === 'executive' || user.role === 'program_manager') && (
              <SingleNavLink item={PROJECT_MODULES_NAV_ITEM} isActive={isActive} collapsed={collapsed} />
            )}

            {(user.role === 'admin' || user.role === 'executive' || user.role === 'program_manager') && (
              <SingleNavLink item={PROJECT_PHASES_NAV_ITEM} isActive={isActive} collapsed={collapsed} />
            )}

            {(user.role === 'admin' || user.role === 'executive' || user.role === 'program_manager') && (
              <SingleNavLink item={PROJECT_TEAMS_NAV_ITEM} isActive={isActive} collapsed={collapsed} />
            )}

            {user.role === 'admin' && (
              <>
                <div className={styles.navSection}>{!collapsed && 'Admin'}</div>
                {ADMIN_NAV_ITEMS.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`${styles.navLink} ${isActive(item.href) ? styles.active : ''}`}
                    title={collapsed ? item.label : undefined}
                  >
                    <item.icon size={18} className={styles.navIcon} aria-hidden="true" />
                    {!collapsed && <span>{item.label}</span>}
                  </Link>
                ))}
              </>
            )}

            {user.isPlatformSuperadmin && (
              <>
                <div className={styles.navSection}>{!collapsed && 'Platform'}</div>
                <SingleNavLink item={PLATFORM_TENANTS_NAV_ITEM} isActive={isActive} collapsed={collapsed} />
              </>
            )}
          </div>

          <button
            type="button"
            className={styles.collapseButton}
            onClick={() => setCollapsed((v) => !v)}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {collapsed ? <ChevronsRight size={16} aria-hidden="true" /> : <ChevronsLeft size={16} aria-hidden="true" />}
            {!collapsed && <span>Collapse</span>}
          </button>
        </nav>
          </>
        )}

        <main className={styles.content}>
          <div className={styles.contentInner}>{children}</div>
        </main>
      </div>
    </div>
  );
}
