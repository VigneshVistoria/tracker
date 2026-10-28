import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Download, FileSpreadsheet, FileText } from 'lucide-react';
import { apiDownload } from '../lib/api';
import { useToast } from '../lib/toast';
import styles from '../styles/issues.module.css';
import appShellStyles from '../styles/appshell.module.css';

const CHOICES = [
  { format: 'pdf', label: 'PDF', icon: FileText },
  { format: 'xlsx', label: 'Excel (.xlsx)', icon: FileSpreadsheet },
];

// Team Tasks "Export" menu button (2026-10-28) - same WAI-ARIA menu
// button pattern and menu styles as UserMenu: arrow keys move between the
// two choices, Esc/Tab/outside-click close it. `params` is the page's
// current filters + sort (URLSearchParams); the server re-checks the role
// and fetches every matching row itself.
export default function TeamTasksExportMenu({ params }) {
  const { showToast } = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(null);
  const buttonRef = useRef(null);
  const menuRef = useRef(null);

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

  const runExport = async (format) => {
    close();
    setBusy(format);
    try {
      const query = new URLSearchParams(params);
      query.set('format', format);
      const today = new Date().toISOString().slice(0, 10);
      await apiDownload(`/tasks/team/export?${query.toString()}`, `team-tasks-${today}.${format}`);
      showToast(format === 'pdf' ? 'PDF downloaded' : 'Excel file downloaded', 'success');
    } catch (err) {
      showToast(err.message || 'Export failed', 'error');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div style={{ position: 'relative', alignSelf: 'flex-end' }}>
      <button
        ref={buttonRef}
        type="button"
        className={`${styles.button} ${styles.buttonSecondary}`}
        disabled={Boolean(busy)}
        aria-busy={Boolean(busy)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls="team-tasks-export-menu"
        onClick={() => setOpen((v) => !v)}
      >
        <Download size={16} aria-hidden="true" />
        {busy ? 'Preparing export…' : 'Export'}
        {!busy && <ChevronDown size={14} aria-hidden="true" />}
      </button>
      {open && (
        <div
          ref={menuRef}
          id="team-tasks-export-menu"
          role="menu"
          aria-label="Export Team Tasks"
          className={appShellStyles.userMenu}
          onKeyDown={handleMenuKeyDown}
        >
          {CHOICES.map((c) => (
            <button
              key={c.format}
              type="button"
              role="menuitem"
              tabIndex={-1}
              className={appShellStyles.userMenuItem}
              onClick={() => runExport(c.format)}
            >
              <c.icon size={16} aria-hidden="true" />
              <span>{c.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
