import styles from '../styles/issues.module.css';

// Icon-only column header with a tooltip/aria-label carrying the full
// name - shared by DeveloperTaskWorkboard (My Tasks) and TeamTaskWorkboard
// (Team Tasks).
export default function ColHeader({ icon: Icon, label }) {
  return (
    <span className={styles.colHeaderIcon} title={label} aria-label={label}>
      <Icon size={15} aria-hidden="true" />
    </span>
  );
}
