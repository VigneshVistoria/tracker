import styles from './StatCard.module.css';

const TREND_CLASS = {
  up: styles.trendUp,
  down: styles.trendDown,
  flat: styles.trendFlat,
};

export default function StatCard({ label, value, icon: Icon, trend, trendLabel, accent = 'primary' }) {
  return (
    <div className={`${styles.card} ${styles[accent] || styles.primary}`}>
      <div className={styles.top}>
        <span className={styles.label}>{label}</span>
        {Icon && (
          <span className={styles.iconWrap}>
            <Icon size={16} aria-hidden="true" />
          </span>
        )}
      </div>
      <div className={styles.value}>{value}</div>
      {trendLabel && (
        <div className={`${styles.trend} ${TREND_CLASS[trend] || styles.trendFlat}`}>{trendLabel}</div>
      )}
    </div>
  );
}
