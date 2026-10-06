import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Keyboard, LogOut, Moon, Sun, UserRoundX } from 'lucide-react';
import { roleLabel } from '../lib/status';
import Avatar from './ui/Avatar';
import styles from '../styles/appshell.module.css';

// Avatar button + menu (WAI-ARIA menu button pattern): arrow keys move
// between items, Esc/Tab/outside-click close it and return focus.
export default function UserMenu({ user, theme, onToggleTheme, onShowShortcuts, onLogout, impersonator, onExitImpersonation, exiting }) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef(null);
  const menuRef = useRef(null);

  const items = [
    { id: 'theme', label: theme === 'dark' ? 'Light theme' : 'Dark theme', icon: theme === 'dark' ? Sun : Moon, run: onToggleTheme },
    { id: 'shortcuts', label: 'Keyboard shortcuts', icon: Keyboard, run: onShowShortcuts },
    impersonator
      ? { id: 'exit', label: exiting ? 'Exiting…' : 'Exit impersonation', icon: UserRoundX, run: onExitImpersonation, disabled: exiting }
      : { id: 'logout', label: 'Log out', icon: LogOut, run: onLogout },
  ];

  const focusItem = (index) => {
    const nodes = menuRef.current?.querySelectorAll('[role="menuitem"]');
    if (!nodes || nodes.length === 0) return;
    nodes[(index + nodes.length) % nodes.length].focus();
  };

  useEffect(() => {
    if (!open) return undefined;
    focusItem(0);
    const onPointerDown = (e) => {
      if (!menuRef.current?.contains(e.target) && !buttonRef.current?.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open]);

  const close = (restoreFocus = true) => {
    setOpen(false);
    if (restoreFocus) buttonRef.current?.focus();
  };

  const handleMenuKeyDown = (e) => {
    const nodes = Array.from(menuRef.current?.querySelectorAll('[role="menuitem"]') || []);
    const current = nodes.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      focusItem(current + 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      focusItem(current - 1);
    } else if (e.key === 'Home') {
      e.preventDefault();
      focusItem(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      focusItem(nodes.length - 1);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      close();
    } else if (e.key === 'Tab') {
      close(false);
    }
  };

  return (
    <div className={styles.userMenuWrap}>
      <button
        ref={buttonRef}
        type="button"
        className={styles.userBadge}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls="user-menu"
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' && !open) {
            e.preventDefault();
            setOpen(true);
          }
        }}
      >
        <Avatar name={user.fullName || user.email} />
        <span className={styles.userBadgeText}>
          <span className={styles.userName}>{user.fullName || user.email}</span>
          <span className={styles.userRole}>{roleLabel(user.role)}</span>
        </span>
        <ChevronDown size={14} className={styles.userChevron} aria-hidden="true" />
        <span className="sr-only">Account menu</span>
      </button>

      {open && (
        <div ref={menuRef} id="user-menu" role="menu" aria-label="Account" className={styles.userMenu} onKeyDown={handleMenuKeyDown}>
          <div className={styles.userMenuHeader} role="presentation">
            <span className={styles.userMenuName}>{user.fullName || user.email}</span>
            {user.fullName && <span className={styles.userMenuEmail}>{user.email}</span>}
            <span className={styles.userMenuRole}>{roleLabel(user.role)}</span>
          </div>
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              role="menuitem"
              tabIndex={-1}
              className={styles.userMenuItem}
              disabled={item.disabled}
              onClick={() => {
                close(item.id !== 'logout' && item.id !== 'exit');
                item.run();
              }}
            >
              <item.icon size={16} aria-hidden="true" />
              <span>{item.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
