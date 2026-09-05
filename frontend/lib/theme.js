import { createContext, useCallback, useContext, useEffect, useState } from 'react';

const ThemeContext = createContext(null);
const STORAGE_KEY = 'theme';
const DEFAULT_THEME = 'terminal';
export const THEMES = ['light', 'dark', 'terminal'];

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
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
export const THEME_INIT_SCRIPT = `
(function () {
  try {
    var stored = localStorage.getItem('${STORAGE_KEY}');
    var theme = stored || '${DEFAULT_THEME}';
    document.documentElement.setAttribute('data-theme', theme);
  } catch (e) {}
})();
`;
