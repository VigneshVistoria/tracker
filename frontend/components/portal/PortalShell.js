import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { LogOut } from 'lucide-react';
import NotificationBell from '../NotificationBell';
import ThemeToggle from '../ui/ThemeToggle';
import LoadingState from '../ui/LoadingState';
import { disconnectSocket } from '../../lib/socket';
import { apiFetch } from '../../lib/api';
import { resetPortalMe, usePortalMe } from '../../lib/clientTickets';
import styles from '../../styles/portal.module.css';
import shellStyles from '../../styles/appshell.module.css';

const TABS = [
  { href: '/portal', label: 'Home', exact: true },
  { href: '/portal/tickets', label: 'My Tickets' },
  { href: '/portal/tickets/new', label: 'New ticket', exact: true },
];

function isActive(pathname, tab) {
  if (tab.exact) return pathname === tab.href;
  // "My Tickets" covers ticket pages, but not New ticket.
  return pathname.startsWith(tab.href) && pathname !== '/portal/tickets/new';
}

// Layout for client users of a switched-on client (client portal Stage 2).
// Anyone else who lands on /portal goes to the normal app. Children get
// `{ me, user }` through the render prop once both are known.
export default function PortalShell({ children }) {
  const router = useRouter();
  const me = usePortalMe();
  const [user, setUser] = useState(null);
  const [impersonating, setImpersonating] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem('user');
    if (!stored) {
      router.replace('/');
      return;
    }
    setUser(JSON.parse(stored));
    setImpersonating(Boolean(localStorage.getItem('impersonator')));
  }, [router]);

  useEffect(() => {
    if (me && !me.portalClient) router.replace('/dashboard');
  }, [me, router]);

  const logout = () => {
    disconnectSocket();
    resetPortalMe();
    localStorage.removeItem('accessToken');
    localStorage.removeItem('user');
    localStorage.removeItem('impersonator');
    router.push('/');
  };

  // An admin impersonating a portal user returns to their own account.
  const exitImpersonation = async () => {
    try {
      const res = await apiFetch('/auth/exit-impersonation', { method: 'POST' });
      localStorage.setItem('accessToken', res.accessToken);
      localStorage.setItem('user', JSON.stringify(res.user));
      localStorage.removeItem('impersonator');
      disconnectSocket();
      router.push('/admin/users');
    } catch {
      logout();
    }
  };

  const ready = user && me?.portalClient;

  return (
    <div className={styles.shell}>
      <a href="#main-content" className={shellStyles.skipLink}>Skip to main content</a>
      <header className={styles.topbar}>
        <Link href="/portal" className={styles.brand}>
          <span className={styles.brandMark} aria-hidden="true">
            {(me?.portalClient?.ticketPrefix || '').slice(0, 2) || 'CP'}
          </span>
          <span>{me?.portalClient?.name || 'Client portal'}</span>
        </Link>
        <nav aria-label="Client portal">
          <ul className={styles.tabs} role="list">
            {TABS.map((tab) => {
              const active = isActive(router.pathname, tab);
              return (
                <li key={tab.href}>
                  <Link href={tab.href} className={`${styles.tab} ${active ? styles.tabActive : ''}`} aria-current={active ? 'page' : undefined}>
                    {tab.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
        <div className={styles.topbarRight}>
          <NotificationBell />
          <ThemeToggle variant="ghost" />
          <button type="button" className={styles.tab} onClick={impersonating ? exitImpersonation : logout}>
            <LogOut size={16} aria-hidden="true" />
            {impersonating ? 'Exit impersonation' : 'Log out'}
          </button>
        </div>
      </header>
      <main id="main-content" className={styles.main} tabIndex={-1}>
        {ready ? children({ me, user }) : <LoadingState label="Loading your portal…" />}
      </main>
    </div>
  );
}
