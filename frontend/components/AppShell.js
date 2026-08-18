import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import styles from '../styles/appshell.module.css';
import { getSocket } from '../lib/socket';

const NAV_ITEMS = [
  { href: '/dashboard', label: 'Dashboard', icon: '\u25A6' },
  { href: '/issues', label: 'Issues', icon: '\u2691' },
  { href: '/admin/projects', label: 'Projects', icon: '\u25A2' },
  { href: '/daily-update', label: 'Daily Update', icon: '\u270E' },
];

// Executives get read-only access to just the dashboard and weekly
// reports - no ticket list, no project management, nothing editable.
const EXECUTIVE_NAV_ITEMS = [
  { href: '/dashboard', label: 'Dashboard', icon: '\u25A6' },
  { href: '/admin/reports', label: 'Weekly Reports', icon: '\u25A6' },
];

const ADMIN_NAV_ITEMS = [
  { href: '/admin/users', label: 'Users', icon: '\u25CE' },
  { href: '/admin/sprints', label: 'Sprints', icon: '\u25C9' },
  { href: '/admin/reports', label: 'Weekly Reports', icon: '\u25A6' },
  { href: '/admin/team-updates', label: 'Team Updates', icon: '\u25A4' },
  { href: '/admin/teams-integration', label: 'Teams Integration', icon: '\u2388' },
  { href: '/admin/regression-testing', label: 'Regression Testing', icon: '\u2713' },
];

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
    localStorage.removeItem('accessToken');
    localStorage.removeItem('user');
    router.push('/');
  };

  useEffect(() => {
    setDrawerOpen(false);
  }, [router.pathname]);

  if (!user) return null;

  const isActive = (href) => router.pathname === href || router.pathname.startsWith(href + '/');

  return (
    <div className={styles.shell}>
      <header className={styles.topbar}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
          <button
            className={styles.menuButton}
            onClick={() => setDrawerOpen((v) => !v)}
            aria-label={drawerOpen ? 'Close navigation menu' : 'Open navigation menu'}
            aria-expanded={drawerOpen}
          >
            {drawerOpen ? '\u2715' : '\u2630'}
          </button>
          <Link href="/dashboard" className={styles.brand}>
            <span className={styles.brandMark}>IT</span>
            IssueTrack
          </Link>
        </div>

        <div className={styles.topbarRight}>
          <span
            className={`${styles.connectionDot} ${connected ? styles.live : ''}`}
            title={connected ? 'Live updates connected' : 'Live updates disconnected'}
            aria-label={connected ? 'Live updates connected' : 'Live updates disconnected'}
          />
          <div className={styles.userBadge}>
            <span className={styles.avatar}>{initialsFor(user)}</span>
            <span>{user.fullName || user.email}</span>
          </div>
          <button className={styles.logoutButton} onClick={handleLogout}>
            Log out
          </button>
        </div>
      </header>

      <div className={styles.body}>
        <div
          className={`${styles.overlay} ${drawerOpen ? styles.open : ''}`}
          onClick={() => setDrawerOpen(false)}
        />
        <nav className={`${styles.sidebar} ${drawerOpen ? styles.open : ''}`} aria-label="Main navigation">
          {(user.role === 'executive' ? EXECUTIVE_NAV_ITEMS : NAV_ITEMS).map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`${styles.navLink} ${isActive(item.href) ? styles.active : ''}`}
            >
              <span className={styles.navIcon}>{item.icon}</span>
              {item.label}
            </Link>
          ))}

          {user.role === 'admin' && (
            <>
              <div className={styles.navSection}>Admin</div>
              {ADMIN_NAV_ITEMS.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`${styles.navLink} ${isActive(item.href) ? styles.active : ''}`}
                >
                  <span className={styles.navIcon}>{item.icon}</span>
                  {item.label}
                </Link>
              ))}
            </>
          )}
        </nav>

        <main className={styles.content}>
          <div className={styles.contentInner}>{children}</div>
        </main>
      </div>
    </div>
  );
}
