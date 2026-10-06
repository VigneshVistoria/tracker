import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/router';
import { Search, History, CornerDownLeft, Plus, Bug, ClipboardPlus, Moon, Sun, Keyboard, LogOut, Ticket, ListTodo, ClipboardCheck, UserRound } from 'lucide-react';
import { apiFetch } from '../lib/api';
import { navSectionsFor } from '../lib/navigation';
import { canCreateTickets } from '../lib/status';
import styles from '../styles/commandPalette.module.css';

const RECENT_KEY = 'recentPages';
const RECENT_LIMIT = 5;

export function readRecentPages() {
  try {
    const parsed = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    return [];
  }
}

// Called by AppShell on every route change with the nav item the user
// just landed on (if any) - most recent first, de-duplicated.
export function recordRecentPage(item) {
  const next = [{ href: item.href, label: item.label }, ...readRecentPages().filter((p) => p.href !== item.href)];
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(next.slice(0, RECENT_LIMIT)));
  } catch (e) {
    // Storage full/blocked - recents are a nicety, never an error.
  }
}

// Lower is better; null means no match. Prefix > word-start > substring >
// in-order letters ("tsk bkl" finds "Task Backlog").
function matchScore(text, query) {
  const t = text.toLowerCase();
  const q = query.toLowerCase().trim();
  if (!q) return 0;
  if (t.startsWith(q)) return 0;
  if (t.split(/[\s/-]+/).some((word) => word.startsWith(q))) return 1;
  if (t.includes(q)) return 2;
  const letters = q.replace(/\s+/g, '');
  let i = 0;
  for (const ch of t) if (ch === letters[i]) i += 1;
  return i === letters.length ? 3 : null;
}

export default function CommandPalette({ open, onClose, user, theme, onToggleTheme, onShowShortcuts, onLogout }) {
  const router = useRouter();
  const inputRef = useRef(null);
  const listRef = useRef(null);
  const previouslyFocused = useRef(null);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const [recent, setRecent] = useState([]);
  // Server-side search (/search) - tickets, tasks, test cases, people,
  // already scoped by the API to what this user can see.
  const [remote, setRemote] = useState(null);
  const [searching, setSearching] = useState(false);
  const searchSeq = useRef(0);

  useEffect(() => {
    if (!open) return undefined;
    previouslyFocused.current = document.activeElement;
    setQuery('');
    setActiveIndex(0);
    setRemote(null);
    setRecent(readRecentPages());
    // Next tick so the portal is mounted before focusing.
    const id = requestAnimationFrame(() => inputRef.current?.focus());
    document.body.style.overflow = 'hidden';
    return () => {
      cancelAnimationFrame(id);
      document.body.style.overflow = '';
      previouslyFocused.current?.focus?.();
    };
  }, [open]);

  const allEntries = useMemo(() => {
    if (!user) return [];
    const actions = [];
    if (canCreateTickets(user.role)) {
      actions.push({ id: 'new-ticket', label: 'New ticket', icon: Plus, run: () => router.push('/issues/new') });
    }
    if (user.role === 'qa') {
      actions.push({ id: 'new-defect', label: 'Create defect', icon: Bug, run: () => router.push('/tasks/new-defect') });
    }
    if (['admin', 'qa', 'program_manager'].includes(user.role)) {
      actions.push({ id: 'new-test-case', label: 'New test case', icon: ClipboardPlus, run: () => router.push('/qa/test-cases/new') });
    }
    actions.push(
      {
        id: 'theme',
        label: theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme',
        icon: theme === 'dark' ? Sun : Moon,
        run: onToggleTheme,
      },
      { id: 'shortcuts', label: 'Keyboard shortcuts', icon: Keyboard, run: onShowShortcuts },
      { id: 'logout', label: 'Log out', icon: LogOut, run: onLogout },
    );

    const pages = navSectionsFor(user).flatMap((section) =>
      section.items.map((item) => ({
        id: `nav:${item.href}:${item.label}`,
        label: item.label,
        hint: section.title,
        icon: item.icon,
        run: () => router.push(item.href),
        href: item.href,
      })),
    );
    return { actions, pages };
  }, [user, theme, router, onToggleTheme, onShowShortcuts, onLogout]);

  useEffect(() => {
    if (!open) return undefined;
    const q = query.trim();
    const seq = ++searchSeq.current;
    if (q.length < 2) {
      setRemote(null);
      setSearching(false);
      return undefined;
    }
    setSearching(true);
    const timer = setTimeout(() => {
      apiFetch(`/search?q=${encodeURIComponent(q)}`)
        .then((res) => seq === searchSeq.current && setRemote(res))
        .catch(() => seq === searchSeq.current && setRemote(null))
        .finally(() => seq === searchSeq.current && setSearching(false));
    }, 220);
    return () => clearTimeout(timer);
  }, [query, open]);

  const remoteGroups = useMemo(() => {
    if (!remote) return [];
    const toEntries = (hits, kind, icon) =>
      hits.map((hit) => ({
        id: `${kind}:${hit.id}`,
        label: hit.title,
        hint: hit.subtitle,
        hintLong: true,
        icon,
        run: () => {
          if (hit.href) router.push(hit.href);
          else if (kind === 'person') window.location.href = `mailto:${(hit.subtitle || '').split(' · ')[0]}`;
        },
      }));
    return [
      { title: 'Tasks', entries: toEntries(remote.tasks || [], 'task', ListTodo) },
      { title: 'Tickets', entries: toEntries(remote.issues || [], 'issue', Ticket) },
      { title: 'Test cases', entries: toEntries(remote.testCases || [], 'testCase', ClipboardCheck) },
      { title: 'People', entries: toEntries(remote.people || [], 'person', UserRound) },
    ].filter((g) => g.entries.length > 0);
  }, [remote, router]);

  // Grouped, filtered results. With no query: Recent, Actions, then every
  // page. With a query: one ranked list across pages and actions.
  const groups = useMemo(() => {
    if (!allEntries.pages) return [];
    const q = query.trim();
    if (!q) {
      const recentEntries = recent
        .map((r) => allEntries.pages.find((p) => p.href === r.href))
        .filter(Boolean)
        .map((p) => ({ ...p, id: `recent:${p.id}`, icon: History }));
      return [
        { title: 'Recent', entries: recentEntries },
        { title: 'Actions', entries: allEntries.actions },
        { title: 'Go to', entries: allEntries.pages },
      ].filter((g) => g.entries.length > 0);
    }
    const ranked = [...allEntries.pages, ...allEntries.actions]
      .map((entry) => {
        const own = matchScore(entry.label, q);
        const viaSection = entry.hint ? matchScore(`${entry.hint} ${entry.label}`, q) : null;
        const score = own ?? (viaSection != null ? viaSection + 4 : null);
        return { entry, score };
      })
      .filter((r) => r.score != null)
      .sort((a, b) => a.score - b.score || a.entry.label.localeCompare(b.entry.label))
      .map((r) => r.entry);
    return [...(ranked.length ? [{ title: 'Pages & actions', entries: ranked }] : []), ...remoteGroups];
  }, [allEntries, recent, query, remoteGroups]);

  const flat = useMemo(() => groups.flatMap((g) => g.entries), [groups]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-index="${activeIndex}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  if (!open || typeof document === 'undefined') return null;

  const runEntry = (entry) => {
    onClose();
    entry.run();
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => (flat.length ? (i + 1) % flat.length : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => (flat.length ? (i - 1 + flat.length) % flat.length : 0));
    } else if (e.key === 'Home') {
      e.preventDefault();
      setActiveIndex(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      setActiveIndex(Math.max(flat.length - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (flat[activeIndex]) runEntry(flat[activeIndex]);
    } else if (e.key === 'Tab') {
      // The input is the only tab stop - options are driven by arrows.
      e.preventDefault();
    }
  };

  let index = -1;
  const activeId = flat[activeIndex] ? `cmdk-option-${activeIndex}` : undefined;

  return createPortal(
    <div className={styles.overlay} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={styles.panel} role="dialog" aria-modal="true" aria-label="Command palette">
        <div className={styles.searchRow}>
          <Search size={18} className={styles.searchIcon} aria-hidden="true" />
          <input
            ref={inputRef}
            className={styles.input}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search pages, tasks, tickets…"
            role="combobox"
            aria-expanded="true"
            aria-controls="cmdk-list"
            aria-activedescendant={activeId}
            aria-autocomplete="list"
            autoComplete="off"
            spellCheck={false}
          />
        </div>

        <div ref={listRef} id="cmdk-list" role="listbox" aria-label="Results" className={styles.list}>
          {groups.length === 0 && !searching && (
            <p className={styles.empty} role="status">
              Nothing matches “{query.trim()}”.
            </p>
          )}
          {groups.map((group) => (
            <div key={group.title} role="group" aria-labelledby={`cmdk-group-${group.title}`}>
              <div id={`cmdk-group-${group.title}`} className={styles.groupTitle}>
                {group.title}
              </div>
              {group.entries.map((entry) => {
                index += 1;
                const i = index;
                const selected = i === activeIndex;
                return (
                  <div
                    key={entry.id}
                    id={`cmdk-option-${i}`}
                    data-index={i}
                    role="option"
                    aria-selected={selected}
                    className={`${styles.option} ${selected ? styles.optionActive : ''}`}
                    onMouseMove={() => !selected && setActiveIndex(i)}
                    onClick={() => runEntry(entry)}
                  >
                    <entry.icon size={16} className={styles.optionIcon} aria-hidden="true" />
                    <span className={styles.optionLabel}>{entry.label}</span>
                    {entry.hint && (
                      <span className={`${styles.optionHint} ${entry.hintLong ? styles.optionHintLong : ''}`}>{entry.hint}</span>
                    )}
                    {selected && <CornerDownLeft size={14} className={styles.enterIcon} aria-hidden="true" />}
                  </div>
                );
              })}
            </div>
          ))}
        </div>

        {searching && (
          <p className={styles.searching} role="status">
            Searching tickets, tasks{user && ['admin', 'program_manager', 'executive'].includes(user.role) ? ', people' : ''}…
          </p>
        )}

        <div className={styles.footer} aria-hidden="true">
          <span><kbd>↑</kbd><kbd>↓</kbd> to move</span>
          <span><kbd>Enter</kbd> to open</span>
          <span><kbd>Esc</kbd> to close</span>
        </div>
      </div>
    </div>,
    document.body,
  );
}
