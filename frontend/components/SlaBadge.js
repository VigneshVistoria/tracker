import styles from '../styles/issues.module.css';

// Text disambiguates the exact state; color only needs to broadly convey
// good / approaching / bad - Near Due and At Risk share the amber family,
// Breached and (a late) Met's sibling states share red vs. teal.
const SLA_STYLE = {
  'On Track': { background: 'var(--color-teal-tint)', color: 'var(--color-teal-dark)' },
  'Near Due': { background: 'var(--color-amber-tint)', color: 'var(--color-amber-dark)' },
  'At Risk': { background: 'var(--color-red-tint)', color: 'var(--color-red-dark)' },
  Breached: { background: 'var(--color-red-tint)', color: 'var(--color-red-dark)' },
  Met: { background: 'var(--color-teal-tint)', color: 'var(--color-teal-dark)' },
};

export default function SlaBadge({ state }) {
  if (!state) return null;
  return (
    <span className={styles.badge} style={SLA_STYLE[state]}>
      {state}
    </span>
  );
}
