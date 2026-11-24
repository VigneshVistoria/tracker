import Link from 'next/link';
import styles from '../styles/weeklyFigures.module.css';

// Scorecard | Weekly figures (2026-11-24). Weekly figures is for a
// Programme Manager ONLY - the backend refuses everyone else (403), this
// only keeps the switch out of their way. Two pages, so each is a link.
export default function ScorecardViewSwitch({ role, current }) {
  if (role !== 'program_manager') return null;
  const links = [
    { key: 'scorecard', href: '/performance-tracking/scorecard', label: 'Scorecard' },
    { key: 'weekly', href: '/performance-tracking/weekly-figures', label: 'Weekly figures' },
  ];
  return (
    <nav className={styles.switch} aria-label="Scorecard views">
      {links.map((l) => (
        <Link key={l.key} href={l.href} className={styles.switchLink} aria-current={current === l.key ? 'page' : undefined}>
          {l.label}
        </Link>
      ))}
    </nav>
  );
}
