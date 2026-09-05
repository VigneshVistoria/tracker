import { Moon, Sun, Terminal } from 'lucide-react';
import { useTheme, THEMES } from '../../lib/theme';
import styles from './ThemeToggle.module.css';

const ICON = { light: Sun, dark: Moon, terminal: Terminal };
const NEXT_LABEL = { light: 'dark', dark: 'terminal', terminal: 'light' };

export default function ThemeToggle({ variant = 'default', className = '' }) {
  const { theme, toggleTheme } = useTheme();
  const next = NEXT_LABEL[theme] || THEMES[0];
  const Icon = ICON[next] || Sun;
  const label = `Switch to ${next} theme`;

  return (
    <button
      type="button"
      className={`${styles.button} ${variant === 'ghost' ? styles.ghost : ''} ${className}`}
      onClick={toggleTheme}
      aria-label={label}
      title={label}
    >
      <Icon size={17} aria-hidden="true" />
    </button>
  );
}
