import Modal from './ui/Modal';
import styles from '../styles/commandPalette.module.css';

// "g" then a letter jumps to a page - only listed (and only active, see
// AppShell) when the page is in the user's own nav.
export const GO_SHORTCUTS = [
  { key: 'd', href: '/dashboard', label: 'Dashboard' },
  { key: 't', href: '/tasks/mine', label: 'My Tasks' },
  { key: 'r', href: '/tasks/qa-review', label: 'QA Review' },
  { key: 'b', href: '/tasks/backlog', label: 'Task Backlog' },
  { key: 'i', href: '/issues', label: 'Issues' },
  { key: 'c', href: '/qa/test-cases', label: 'Test Cases' },
  { key: 'p', href: '/admin/projects', label: 'Projects' },
  { key: 'k', href: '/kpi', label: 'KPI Dashboard' },
];

export function isMacPlatform() {
  return typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
}

function Row({ keys, children }) {
  return (
    <tr>
      <td>{children}</td>
      <td className={styles.shortcutKeys}>
        {keys.map((k, i) => (
          <span key={k}>
            {i > 0 && <span className={styles.shortcutThen}>then</span>}
            <kbd className={styles.kbd}>{k}</kbd>
          </span>
        ))}
      </td>
    </tr>
  );
}

export default function ShortcutsDialog({ open, onClose, availableHrefs }) {
  const mod = isMacPlatform() ? '⌘' : 'Ctrl';
  const goShortcuts = GO_SHORTCUTS.filter((s) => availableHrefs.has(s.href));
  return (
    <Modal open={open} onClose={onClose} title="Keyboard shortcuts" size="sm">
      <table className={styles.shortcutTable}>
        <caption className="sr-only">Keyboard shortcuts</caption>
        <tbody>
          <Row keys={[`${mod} K`]}>Open command palette</Row>
          <Row keys={['/']}>Open command palette</Row>
          <Row keys={['?']}>Show this help</Row>
          {goShortcuts.map((s) => (
            <Row key={s.key} keys={['g', s.key]}>Go to {s.label}</Row>
          ))}
        </tbody>
      </table>
    </Modal>
  );
}
