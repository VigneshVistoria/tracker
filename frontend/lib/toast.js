import { createContext, useCallback, useContext, useRef, useState } from 'react';
import styles from '../styles/toast.module.css';

const ToastContext = createContext(null);

let idCounter = 0;

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const timers = useRef({});

  const dismiss = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    clearTimeout(timers.current[id]);
    delete timers.current[id];
  }, []);

  const showToast = useCallback((message, type = 'info', duration = 4500) => {
    const id = ++idCounter;
    setToasts((prev) => [...prev, { id, message, type }]);
    timers.current[id] = setTimeout(() => dismiss(id), duration);
  }, [dismiss]);

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <div className={styles.stack} aria-live="polite" aria-atomic="true">
        {toasts.map((t) => (
          <div key={t.id} className={`${styles.toast} ${styles[t.type] || ''}`} role="status">
            <span>{t.message}</span>
            <button
              className={styles.dismiss}
              onClick={() => dismiss(t.id)}
              aria-label="Dismiss notification"
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within a ToastProvider');
  return ctx;
}
