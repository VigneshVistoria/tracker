import styles from '../styles/issues.module.css';

// Column header icon with a tooltip carrying the full name - shared by
// DeveloperTaskWorkboard (My Tasks), QaReviewWorkboard and
// TeamTaskWorkboard (Team Tasks). Icon-only by default; `showLabel`
// (Team Tasks) adds a short text label next to the icon. `tooltip`
// overrides the hover text, e.g. to explain what a column measures.
export default function ColHeader({ icon: Icon, label, showLabel = false, tooltip }) {
  if (showLabel) {
    return (
      <span className={styles.colHeaderLabeled} title={tooltip || label}>
        {Icon && <Icon size={14} aria-hidden="true" />}
        <span>{label}</span>
      </span>
    );
  }
  return (
    <span className={styles.colHeaderIcon} title={tooltip || label} aria-label={label}>
      <Icon size={15} aria-hidden="true" />
    </span>
  );
}
