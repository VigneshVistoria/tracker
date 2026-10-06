import { Moon, Sun } from 'lucide-react';
import { useTheme } from '../../lib/theme';
import styles from './ThemeToggle.module.css';

export default function ThemeToggle({ variant = 'default', className = '' }) {
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === 'dark';
  const Icon = isDark ? Sun : Moon;
  const label = isDark ? 'Switch to light theme' : 'Switch to dark theme';

  return (
    <button
      type="button"
      className={`${styles.button} ${variant === 'ghost' ? styles.ghost : ''} ${className}`}
      onClick={toggleTheme}
      aria-label={label}
      aria-pressed={isDark}
      title={label}
    >
      <Icon size={17} aria-hidden="true" />
    </button>
  );
}
