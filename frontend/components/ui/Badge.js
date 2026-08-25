import styles from './Badge.module.css';

const TONE_CLASS = {
  success: styles.success,
  warning: styles.warning,
  error: styles.error,
  info: styles.info,
  neutral: styles.neutral,
};

export default function Badge({ tone = 'neutral', dot = false, children, className = '' }) {
  return (
    <span className={`${styles.badge} ${TONE_CLASS[tone] || styles.neutral} ${className}`}>
      {dot && <span className={styles.dot} aria-hidden="true" />}
      {children}
    </span>
  );
}
