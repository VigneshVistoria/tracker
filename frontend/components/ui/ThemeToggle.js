import { Moon, Sun, Terminal } from 'lucide-react';
import { useTheme, THEMES } from '../../lib/theme';
import { isNewDesignRole } from '../../lib/newDesignRoles';
import styles from './ThemeToggle.module.css';

const ICON = { light: Sun, dark: Moon, terminal: Terminal };
const NEXT_LABEL = { light: 'dark', dark: 'terminal', terminal: 'light' };

export default function ThemeToggle({ variant = 'default', className = '', role = null }) {
  const { theme, toggleTheme } = useTheme();
  // Phase 1 redesign gate (lib/newDesignRoles.js) - these roles are forced
  // onto the new "warm" design for now, so there's nothing to toggle.
  // Developer/QA/Designer/DevOps/Client are unaffected.
  if (isNewDesignRole(role)) return null;
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
