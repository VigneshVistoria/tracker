import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { isNewDesignRole } from './newDesignRoles';

const ThemeContext = createContext(null);
const STORAGE_KEY = 'theme';
const DEFAULT_THEME = 'terminal';
export const THEMES = ['light', 'dark', 'terminal'];

// Phase 1 redesign gate (see lib/newDesignRoles.js) - reads the same
// localStorage 'user' key AppShell reads, independently, so this stays
// correct even though ThemeProvider mounts above AppShell in the tree.
// Any failure (missing/stale/corrupt value) falls through to `null`,
// meaning "use the normal per-user theme preference" - never forces the
// new design on an unconfirmed role.
function currentDesignRole() {
  try {
    const stored = localStorage.getItem('user');
    if (!stored) return null;
    return JSON.parse(stored)?.role ?? null;
  } catch (e) {
    return null;
  }
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', isNewDesignRole(currentDesignRole()) ? 'warm' : theme);
}

export function ThemeProvider({ children }) {
  // Starts 'light' to match the server-rendered markup; the inline script in
  // _document.js already set the real attribute on <html> before paint, so
  // this only has to catch up in state without causing a flash.
  const [theme, setTheme] = useState('light');

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    setTheme(stored || DEFAULT_THEME);
  }, []);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  const toggleTheme = useCallback(() => {
    setTheme((prev) => {
      const next = THEMES[(THEMES.indexOf(prev) + 1) % THEMES.length];
      localStorage.setItem(STORAGE_KEY, next);
      return next;
    });
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within a ThemeProvider');
  return ctx;
}

// Inlined into _document.js as a blocking <script> so the correct theme is
// set on <html> before first paint - without this, the page always flashes
// light mode first because localStorage isn't readable during SSR.
//
// Mirrors lib/newDesignRoles.js's NEW_DESIGN_ROLES (can't import a module
// into an inlined script string, so the role list is duplicated here - keep
// the two in sync). Any missing/unparsable 'user' value falls through to
// the normal stored theme, same fail-safe-to-old-design behavior as
// applyTheme() above.
export const THEME_INIT_SCRIPT = `
(function () {
  try {
    var theme = localStorage.getItem('${STORAGE_KEY}') || '${DEFAULT_THEME}';
    var newDesignRoles = ['admin', 'executive', 'program_manager'];
    try {
      var user = JSON.parse(localStorage.getItem('user') || 'null');
      if (user && newDesignRoles.indexOf(user.role) !== -1) theme = 'warm';
    } catch (e) {}
    document.documentElement.setAttribute('data-theme', theme);
  } catch (e) {}
})();
`;
