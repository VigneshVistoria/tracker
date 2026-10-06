import { createContext, useCallback, useContext, useEffect, useState } from 'react';

const ThemeContext = createContext(null);
const STORAGE_KEY = 'theme';
const DEFAULT_THEME = 'warm';
export const THEMES = ['warm', 'dark'];

// Older saved values ('light', 'terminal') are retired themes - treat any
// unrecognized value as the default rather than leaving the page unthemed.
function normalizeTheme(value) {
  return THEMES.includes(value) ? value : DEFAULT_THEME;
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
}

export function ThemeProvider({ children }) {
  // Starts at the default to match the server-rendered markup; the inline
  // script in _document.js already set the real attribute on <html> before
  // paint, so this only has to catch up in state without causing a flash.
  const [theme, setTheme] = useState(DEFAULT_THEME);

  useEffect(() => {
    setTheme(normalizeTheme(localStorage.getItem(STORAGE_KEY)));
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
// set on <html> before first paint - without this, the page flashes the
// default theme first because localStorage isn't readable during SSR.
// Mirrors normalizeTheme() above (can't import into an inlined string).
export const THEME_INIT_SCRIPT = `
(function () {
  try {
    var theme = localStorage.getItem('${STORAGE_KEY}');
    if (${JSON.stringify(THEMES)}.indexOf(theme) === -1) theme = '${DEFAULT_THEME}';
    document.documentElement.setAttribute('data-theme', theme);
  } catch (e) {
    document.documentElement.setAttribute('data-theme', '${DEFAULT_THEME}');
  }
})();
`;
