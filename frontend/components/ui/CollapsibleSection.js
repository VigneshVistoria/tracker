import { useEffect, useId, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { REVEAL_EVENT } from '../../lib/useHashTarget';
import styles from './CollapsibleSection.module.css';

// "3 resolved dependencies · Show" (task page, 2026-11-04). Closed by
// default; the user's choice is remembered per browser under
// `storageKey` (include the user id in it). The content stays in the DOM
// (hidden), so a notification deep link to something inside opens it.
export default function CollapsibleSection({ id, label, count, storageKey, defaultOpen = false, children }) {
  const [open, setOpen] = useState(defaultOpen);
  const contentRef = useRef(null);
  const contentId = useId();

  useEffect(() => {
    if (!storageKey) return;
    const saved = localStorage.getItem(storageKey);
    if (saved === 'open' || saved === 'closed') setOpen(saved === 'open');
  }, [storageKey]);

  useEffect(() => {
    const onReveal = (e) => {
      // A deep link to the section itself (id) or to something inside it.
      if (id && e.detail?.id === id) return setOpen(true);
      const el = e.detail?.id && document.getElementById(e.detail.id);
      if (el && contentRef.current?.contains(el)) setOpen(true);
    };
    window.addEventListener(REVEAL_EVENT, onReveal);
    return () => window.removeEventListener(REVEAL_EVENT, onReveal);
  }, [id]);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (storageKey) localStorage.setItem(storageKey, next ? 'open' : 'closed');
  };

  return (
    <div id={id} className={styles.section}>
      <button type="button" className={styles.toggle} aria-expanded={open} aria-controls={contentId} onClick={toggle}>
        <ChevronDown size={16} aria-hidden="true" className={`${styles.chevron} ${open ? styles.chevronOpen : ''}`} />
        <span>
          {count !== undefined && <strong>{count}</strong>} {label}
        </span>
        <span className={styles.action}>{open ? 'Hide' : 'Show'}</span>
      </button>
      <div id={contentId} ref={contentRef} hidden={!open} className={styles.content}>
        {children}
      </div>
    </div>
  );
}
