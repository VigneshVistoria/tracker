import styles from './Avatar.module.css';

// Stable soft colour per person: the same name always gets the same hue,
// so people become recognisable at a glance. Text/background lightness is
// fixed per theme in Avatar.module.css (AA-checked), only the hue varies.
function hueFor(seed) {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) hash = (hash * 31 + seed.charCodeAt(i)) % 360;
  return hash;
}

export function initialsOf(name) {
  if (!name) return '?';
  const clean = name.includes('@') ? name.split('@')[0] : name;
  const parts = clean.split(/[\s._-]+/).filter(Boolean);
  return (parts.length > 1 ? parts[0][0] + parts[1][0] : clean.slice(0, 2)).toUpperCase();
}

// Decorative by default (aria-hidden) - the person's name is always shown
// as text next to it. Pass `label` when the avatar stands alone.
export default function Avatar({ name, size = 'md', label, className = '' }) {
  const seed = (name || '?').toLowerCase();
  return (
    <span
      className={`${styles.avatar} ${styles[size] || styles.md} ${className}`}
      style={{ '--avatar-h': hueFor(seed) }}
      aria-hidden={label ? undefined : 'true'}
      role={label ? 'img' : undefined}
      aria-label={label}
      title={label}
    >
      {initialsOf(name)}
    </span>
  );
}
