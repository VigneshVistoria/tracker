import { CheckCircle2, Info, TriangleAlert, XCircle, X } from 'lucide-react';
import styles from './Toast.module.css';

const TONE = {
  success: { icon: CheckCircle2, className: 'success' },
  error: { icon: XCircle, className: 'error' },
  warning: { icon: TriangleAlert, className: 'warning' },
  info: { icon: Info, className: 'info' },
};

export function Toast({ type = 'info', message, onDismiss }) {
  const { icon: Icon, className } = TONE[type] || TONE.info;
  return (
    <div className={`${styles.toast} ${styles[className]}`} role="status">
      <Icon size={18} className={styles.icon} aria-hidden="true" />
      <span className={styles.message}>{message}</span>
      {onDismiss && (
        <button type="button" className={styles.dismiss} onClick={onDismiss} aria-label="Dismiss notification">
          <X size={14} aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

export function ToastStack({ toasts, onDismiss }) {
  return (
    <div className={styles.stack} aria-live="polite" aria-atomic="true">
      {toasts.map((t) => (
        <Toast key={t.id} type={t.type} message={t.message} onDismiss={() => onDismiss(t.id)} />
      ))}
    </div>
  );
}

export default Toast;
