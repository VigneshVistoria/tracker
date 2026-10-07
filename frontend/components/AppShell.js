import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { ChevronDown, ChevronsLeft, ChevronsRight, LayoutDashboard, LifeBuoy, Search, LogOut, Menu, X, SquarePlus } from 'lucide-react';
import styles from '../styles/appshell.module.css';
import SelfCreateTaskModal from './SelfCreateTaskModal';
import CommandPalette, { recordRecentPage } from './CommandPalette';
import ShortcutsDialog, { GO_SHORTCUTS, isMacPlatform } from './ShortcutsDialog';
import UserMenu from './UserMenu';
import NotificationBell from './NotificationBell';
import { getSocket, disconnectSocket } from '../lib/socket';
import { apiFetch } from '../lib/api';
import { DEVELOPER_EQUIVALENT_ROLES } from '../lib/status';
import { navSectionsFor, isNavItemActive } from '../lib/navigation';
import { loadPortalMe, resetPortalMe } from '../lib/clientTickets';
import { useTheme } from '../lib/theme';
import ThemeToggle from './ui/ThemeToggle';

const COLLAPSED_SECTIONS_KEY = 'navCollapsedSections';

function readCollapsedSections() {
  try {
    const parsed = JSON.parse(localStorage.getItem(COLLAPSED_SECTIONS_KEY) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    return [];
  }
}

function isTypingTarget(el) {
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

function NavLink({ item, active, collapsed, count }) {
  return (
    <Link
      href={item.href}
      className={`${styles.navLink} ${active ? styles.active : ''}`}
      title={collapsed ? item.label : undefined}
      aria-current={active ? 'page' : undefined}
    >
      <item.icon size={18} className={styles.navIcon} aria-hidden="true" />
      {collapsed ? <span className="sr-only">{item.label}</span> : <span className={styles.navLabel}>{item.label}</span>}
      {!collapsed && count != null && count > 0 && (
        <span className={styles.navCount} aria-label={`${count} items`}>
          {count}
        </span>
      )}
    </Link>
  );
}

export default function AppShell({ children, fullScreen = false }) {
  const router = useRouter();
  const { theme, toggleTheme } = useTheme();
  const [user, setUser] = useState(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [collapsedSections, setCollapsedSections] = useState([]);
  const [connected, setConnected] = useState(false);
  const [impersonator, setImpersonator] = useState(null);
  const [exiting, setExiting] = useState(false);
  const [selfTaskOpen, setSelfTaskOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [isMac, setIsMac] = useState(false);
  // Sidebar count badges (e.g. "My Tasks 6"); null = not loaded, no badge.
  const [navCounts, setNavCounts] = useState({ myTasks: null, qaReview: null, myDefects: null });
  // Client portal (Stage 2): whether to show Client tickets.
  const [canSeeClientTickets, setCanSeeClientTickets] = useState(false);
  const pendingGo = useRef(null);
  // Stable so Modal's focus-trap effect (keyed on onClose) doesn't re-run
  // and steal focus on every AppShell re-render.
  const closeSelfTask = useCallback(() => setSelfTaskOpen(false), []);
  const closePalette = useCallback(() => setPaletteOpen(false), []);
  const closeShortcuts = useCallback(() => setShortcutsOpen(false), []);
  const openShortcuts = useCallback(() => setShortcutsOpen(true), []);

  useEffect(() => {
    const storedUser = localStorage.getItem('user');
    if (!storedUser) {
      router.replace('/');
      return;
    }
    setUser(JSON.parse(storedUser));
    // Users of a switched-on client portal never use the internal app -
    // send them to /portal. Everyone else stays; staff on a client team
    // get the Client tickets link.
    loadPortalMe()
      .then((me) => {
        if (me.portalClient) router.replace('/portal');
        else setCanSeeClientTickets(me.canSeeClientTickets);
      })
      .catch(() => {});
    const storedImpersonator = localStorage.getItem('impersonator');
    setImpersonator(storedImpersonator ? JSON.parse(storedImpersonator) : null);
    setCollapsedSections(readCollapsedSections());
    setIsMac(isMacPlatform());

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

  const handleLogout = useCallback(() => {
    disconnectSocket();
    resetPortalMe();
    localStorage.removeItem('accessToken');
    localStorage.removeItem('user');
    localStorage.removeItem('impersonator');
    router.push('/');
  }, [router]);

  const handleExitImpersonation = async () => {
    setExiting(true);
    try {
      const res = await apiFetch('/auth/exit-impersonation', { method: 'POST' });
      localStorage.setItem('accessToken', res.accessToken);
      localStorage.setItem('user', JSON.stringify(res.user));
      localStorage.removeItem('impersonator');
      disconnectSocket();
      resetPortalMe();
      router.push('/admin/users');
    } catch (err) {
      // Session's stale or invalid either way - safest is to drop back to
      // a clean logged-out state rather than leave the banner stuck on.
      handleLogout();
    } finally {
      setExiting(false);
    }
  };

  const hideSidebar = !!user && DEVELOPER_EQUIVALENT_ROLES.includes(user.role);
  const sections = useMemo(
    () => (hideSidebar ? [] : navSectionsFor(user, { clientTickets: canSeeClientTickets })),
    [user, hideSidebar, canSeeClientTickets],
  );
  const visibleItems = useMemo(() => sections.flatMap((s) => s.items), [sections]);
  const availableHrefs = useMemo(() => new Set(visibleItems.map((i) => i.href)), [visibleItems]);
  const visibleCountKeys = useMemo(() => new Set(visibleItems.map((i) => i.countKey).filter(Boolean)), [visibleItems]);

  useEffect(() => {
    setDrawerOpen(false);
  }, [router.pathname]);

  // Remember the nav page just visited, for the palette's "Recent" group.
  // Longest matching href wins so /kpi/matrix isn't recorded as /kpi.
  useEffect(() => {
    const match = visibleItems
      .filter((item) => isNavItemActive(router.pathname, item.href))
      .sort((a, b) => b.href.length - a.href.length)[0];
    if (match) recordRecentPage(match);
  }, [router.pathname, visibleItems]);

  // Refetch badge counts on every navigation so they never go stale as
  // the user works through tasks - only for badges this role can see.
  useEffect(() => {
    if (!user || visibleCountKeys.size === 0) return undefined;
    let cancelled = false;
    if (visibleCountKeys.has('myTasks')) {
      apiFetch('/tasks/mine')
        .then((mine) => !cancelled && setNavCounts((prev) => ({ ...prev, myTasks: mine.length })))
        .catch(() => {});
    }
    if (visibleCountKeys.has('qaReview')) {
      apiFetch('/tasks/qa-queue')
        .then((queue) => !cancelled && setNavCounts((prev) => ({ ...prev, qaReview: queue.statCounts.pending })))
        .catch(() => {});
    }
    // statCounts.pending is the same "open" definition QaReviewWorkboard's
    // Pending card uses - self-scoped for QA, tenant-wide for Admin/PM.
    if (visibleCountKeys.has('myDefects')) {
      apiFetch('/tasks/defect-queue')
        .then((res) => !cancelled && setNavCounts((prev) => ({ ...prev, myDefects: res.statCounts.pending })))
        .catch(() => {});
    }
    return () => {
      cancelled = true;
    };
  }, [user, visibleCountKeys, router.pathname]);

  // Global shortcuts (sidebar roles only - Developer/Designer/DevOps keep
  // their minimal header): Ctrl/⌘+K and "/" open the palette, "?" opens
  // the help sheet, "g" then a letter jumps to a page in the user's nav.
  useEffect(() => {
    if (!user || hideSidebar) return undefined;
    const onKeyDown = (e) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setShortcutsOpen(false);
        setPaletteOpen((v) => !v);
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented) return;
      if (isTypingTarget(e.target) || document.querySelector('[aria-modal="true"]')) return;

      if (pendingGo.current) {
        const target = GO_SHORTCUTS.find((s) => s.key === e.key.toLowerCase() && availableHrefs.has(s.href));
        clearTimeout(pendingGo.current);
        pendingGo.current = null;
        if (target) {
          e.preventDefault();
          router.push(target.href);
        }
        return;
      }
      if (e.key === '/') {
        e.preventDefault();
        setPaletteOpen(true);
      } else if (e.key === '?') {
        e.preventDefault();
        setShortcutsOpen(true);
      } else if (e.key === 'g') {
        pendingGo.current = setTimeout(() => {
          pendingGo.current = null;
        }, 1200);
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      clearTimeout(pendingGo.current);
      pendingGo.current = null;
    };
  }, [user, hideSidebar, availableHrefs, router]);

  const toggleSection = (id) => {
    setCollapsedSections((prev) => {
      const next = prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id];
      try {
        localStorage.setItem(COLLAPSED_SECTIONS_KEY, JSON.stringify(next));
      } catch (e) {
        // Non-critical preference.
      }
      return next;
    });
  };

  if (!user) return null;

  // Longest match wins, so only one item is ever highlighted
  // (e.g. KPI Matrix, not KPI Dashboard as well).
  const activeHref = visibleItems
    .filter((item) => isNavItemActive(router.pathname, item.href))
    .sort((a, b) => b.href.length - a.href.length)[0]?.href;
  const shortcutLabel = isMac ? '⌘K' : 'Ctrl K';

  return (
    <div className={styles.shell}>
      <a href="#main-content" className={styles.skipLink}>
        Skip to main content
      </a>

      {!fullScreen && (
        <header className={styles.topbar}>
          <div className={styles.topbarLeft}>
            {!hideSidebar && (
              <button
                type="button"
                className={styles.menuButton}
                onClick={() => setDrawerOpen((v) => !v)}
                aria-label={drawerOpen ? 'Close navigation menu' : 'Open navigation menu'}
                aria-expanded={drawerOpen}
                aria-controls="main-navigation"
              >
                {drawerOpen ? <X size={18} aria-hidden="true" /> : <Menu size={18} aria-hidden="true" />}
              </button>
            )}
            {hideSidebar ? (
              <Link href="/dashboard" className={styles.iconButton} aria-label="Dashboard">
                <LayoutDashboard size={18} aria-hidden="true" />
              </Link>
            ) : (
              <Link href="/dashboard" className={styles.brand} aria-label="Tracker home">
                <span className={styles.brandMark} aria-hidden="true">T</span>
                <span className={styles.brandName}>Tracker</span>
              </Link>
            )}
            {/* Developer/Designer/DevOps shortcut to create a task for
                themselves - opens the same Create Task form as Task Backlog,
                assignee locked to them (SelfCreateTaskModal). */}
            {hideSidebar && (
              <button
                type="button"
                className={styles.iconButton}
                onClick={() => setSelfTaskOpen(true)}
                aria-label="New task"
                aria-haspopup="dialog"
                title="New task"
              >
                <SquarePlus size={18} aria-hidden="true" />
              </button>
            )}
            {/* Client portal tickets for client-team members (Stage 2). */}
            {hideSidebar && canSeeClientTickets && (
              <Link href="/client-tickets" className={styles.iconButton} aria-label="Client tickets" title="Client tickets">
                <LifeBuoy size={18} aria-hidden="true" />
              </Link>
            )}
          </div>

          {!hideSidebar && (
            <button
              type="button"
              className={styles.searchTrigger}
              onClick={() => setPaletteOpen(true)}
              aria-haspopup="dialog"
              aria-keyshortcuts={isMac ? 'Meta+K' : 'Control+K'}
            >
              <Search size={16} className={styles.searchTriggerIcon} aria-hidden="true" />
              <span className={styles.searchTriggerText}>Search or jump to…</span>
              <kbd className={styles.searchTriggerKbd}>{shortcutLabel}</kbd>
            </button>
          )}

          <div className={styles.topbarRight}>
            {!hideSidebar && (
              <>
                <button
                  type="button"
                  className={`${styles.iconButton} ${styles.searchIconButton}`}
                  onClick={() => setPaletteOpen(true)}
                  aria-label="Search or jump to"
                  aria-haspopup="dialog"
                >
                  <Search size={18} aria-hidden="true" />
                </button>
                <span
                  className={`${styles.connectionStatus} ${connected ? styles.live : ''}`}
                  title={connected ? 'Live updates connected' : 'Live updates disconnected'}
                >
                  <span className={styles.connectionDot} aria-hidden="true" />
                  <span className={styles.connectionLabel}>{connected ? 'Live' : 'Offline'}</span>
                </span>
              </>
            )}
            {/* Every role, including Developer/Designer/DevOps (confirmed
                2026-10-06) - the only addition to their minimal header. */}
            <NotificationBell />
            <ThemeToggle variant="ghost" />
            {hideSidebar ? (
              <button
                type="button"
                className={styles.iconButton}
                onClick={impersonator ? handleExitImpersonation : handleLogout}
                disabled={impersonator ? exiting : false}
                aria-label={impersonator ? 'Exit impersonation' : 'Log out'}
                title={impersonator ? 'Exit impersonation' : undefined}
              >
                <LogOut size={17} aria-hidden="true" />
              </button>
            ) : (
              <UserMenu
                user={user}
                theme={theme}
                onToggleTheme={toggleTheme}
                onShowShortcuts={openShortcuts}
                onLogout={handleLogout}
                impersonator={impersonator}
                onExitImpersonation={handleExitImpersonation}
                exiting={exiting}
              />
            )}
          </div>
        </header>
      )}

      {impersonator && (
        <div className={styles.impersonationBanner} role="status">
          <span>
            Viewing as <strong>{user.fullName || user.email}</strong> - impersonated by {impersonator.fullName || impersonator.email}
          </span>
          <button type="button" onClick={handleExitImpersonation} disabled={exiting}>
            {exiting ? 'Exiting...' : 'Exit impersonation'}
          </button>
        </div>
      )}

      <div className={styles.body}>
        {!hideSidebar && !fullScreen && (
          <>
            <div
              className={`${styles.overlay} ${drawerOpen ? styles.open : ''}`}
              onClick={() => setDrawerOpen(false)}
              aria-hidden="true"
            />
            <nav
              id="main-navigation"
              className={`${styles.sidebar} ${drawerOpen ? styles.open : ''} ${collapsed ? styles.collapsed : ''}`}
              aria-label="Main navigation"
            >
              <div className={styles.navScroll}>
                {sections.map((section, sectionIndex) => {
                  const containsActive = section.items.some((item) => item.href === activeHref);
                  // The section holding the current page is always open, so
                  // the highlighted item can never be hidden.
                  const sectionOpen = collapsed || containsActive || !collapsedSections.includes(section.id);
                  // A one-item section (e.g. Platform) needs no toggle.
                  const showHeader = !collapsed && sections.length > 1;
                  return (
                    <div key={section.id} className={styles.navGroup}>
                      {collapsed && sectionIndex > 0 && <hr className={styles.navDivider} aria-hidden="true" />}
                      {showHeader && (
                        <button
                          type="button"
                          className={styles.navSection}
                          onClick={() => toggleSection(section.id)}
                          aria-expanded={sectionOpen}
                          aria-controls={`nav-section-${section.id}`}
                          disabled={containsActive}
                        >
                          <span>{section.title}</span>
                          {!containsActive && (
                            <ChevronDown
                              size={14}
                              className={`${styles.navSectionChevron} ${sectionOpen ? '' : styles.navSectionChevronClosed}`}
                              aria-hidden="true"
                            />
                          )}
                        </button>
                      )}
                      {sectionOpen && (
                        <div id={`nav-section-${section.id}`}>
                          {section.items.map((item) => (
                            <NavLink
                              key={`${item.href}:${item.label}`}
                              item={item}
                              active={item.href === activeHref}
                              collapsed={collapsed}
                              count={item.countKey ? navCounts[item.countKey] : null}
                            />
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              <button
                type="button"
                className={styles.collapseButton}
                onClick={() => setCollapsed((v) => !v)}
                aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
                aria-expanded={!collapsed}
              >
                {collapsed ? <ChevronsRight size={16} aria-hidden="true" /> : <ChevronsLeft size={16} aria-hidden="true" />}
                {!collapsed && <span>Collapse</span>}
              </button>
            </nav>
          </>
        )}

        <main id="main-content" className={styles.content} tabIndex={-1}>
          <div className={`${styles.contentInner} ${fullScreen ? styles.contentInnerFullScreen : ''}`}>{children}</div>
        </main>
      </div>

      {hideSidebar && <SelfCreateTaskModal open={selfTaskOpen} onClose={closeSelfTask} user={user} />}
      {!hideSidebar && (
        <>
          <CommandPalette
            open={paletteOpen}
            onClose={closePalette}
            user={user}
            theme={theme}
            onToggleTheme={toggleTheme}
            onShowShortcuts={openShortcuts}
            onLogout={handleLogout}
          />
          <ShortcutsDialog open={shortcutsOpen} onClose={closeShortcuts} availableHrefs={availableHrefs} />
        </>
      )}
    </div>
  );
}
