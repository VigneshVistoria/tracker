import styles from '../styles/dailyupdate.module.css';

const CONFIG = {
  on_track: { label: 'On Track', emoji: '\u{1F7E2}', className: 'statusOnTrack' },
  at_risk: { label: 'At Risk', emoji: '\u{1F7E0}', className: 'statusAtRisk' },
  blocked: { label: 'Blocked', emoji: '\u{1F534}', className: 'statusBlocked' },
};

export default function StatusLight({ status }) {
  const cfg = CONFIG[status] || CONFIG.on_track;
  return (
    <span className={`${styles.statusLight} ${styles[cfg.className]}`}>
      {cfg.emoji} {cfg.label}
    </span>
  );
}
