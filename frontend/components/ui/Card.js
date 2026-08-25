import styles from './Card.module.css';

export function Card({ className = '', padded = true, children, ...rest }) {
  return (
    <div className={`${styles.card} ${padded ? styles.padded : ''} ${className}`} {...rest}>
      {children}
    </div>
  );
}

export function CardHeader({ title, subtitle, actions, className = '' }) {
  return (
    <div className={`${styles.header} ${className}`}>
      <div>
        {title && <h3 className={styles.title}>{title}</h3>}
        {subtitle && <p className={styles.subtitle}>{subtitle}</p>}
      </div>
      {actions && <div className={styles.actions}>{actions}</div>}
    </div>
  );
}

export default Card;
