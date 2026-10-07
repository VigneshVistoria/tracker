import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import {
  Bell,
  BellOff,
  CheckCheck,
  ClipboardCheck,
  CheckCircle2,
  XCircle,
  UserPlus,
  Users,
  AlertTriangle,
  Link2,
  Clock,
  Bug,
  LifeBuoy,
  MessageSquare,
} from 'lucide-react';
import { apiFetch } from '../lib/api';
import { getSocket } from '../lib/socket';
import { formatRelativeTime } from '../lib/formatDate';
import Avatar from './ui/Avatar';
import styles from '../styles/notificationBell.module.css';

const TYPE_ICON = {
  'task.assigned': UserPlus,
  'defect.assigned': Bug,
  'task.reviewApproved': CheckCircle2,
  'task.reviewRejected': XCircle,
  'task.peerReviewRequested': Users,
  'task.escalated': AlertTriangle,
  'dependency.assigned': Link2,
  'dependency.resolved': CheckCircle2,
  'issue.assigned': UserPlus,
  'issue.approved': CheckCircle2,
  'issue.qaApproved': CheckCircle2,
  'issue.rejected': XCircle,
  'issue.qaRejected': XCircle,
  'issue.slaDueSoon': Clock,
  'testCase.approved': ClipboardCheck,
  'testCase.rejected': XCircle,
  'clientTicket.created': LifeBuoy,
  'clientTicket.clientReplied': MessageSquare,
  'clientTicket.teamReplied': MessageSquare,
  'clientTicket.internalNote': MessageSquare,
  'clientTicket.assigned': UserPlus,
  'clientTicket.statusChanged': CheckCircle2,
};

const TYPE_TONE = {
  'task.reviewRejected': 'error',
  'issue.rejected': 'error',
  'issue.qaRejected': 'error',
  'testCase.rejected': 'error',
  'task.escalated': 'warning',
  'issue.slaDueSoon': 'warning',
  'task.reviewApproved': 'success',
  'issue.approved': 'success',
  'issue.qaApproved': 'success',
  'dependency.resolved': 'success',
  'testCase.approved': 'success',
};

// Header bell: unread badge, dropdown list, live arrival over the
// user's personal socket room. Only ever shows the caller's own
// notifications (the API scopes every route to the JWT's user).
export default function NotificationBell() {
  const router = useRouter();
  const [count, setCount] = useState(null); // null = unavailable, hide badge
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState(null); // null = not loaded yet
  const [loadError, setLoadError] = useState(false);
  const buttonRef = useRef(null);
  const panelRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    apiFetch('/notifications/unread-count')
      .then((res) => !cancelled && setCount(res.count))
      .catch(() => {});
    const socket = getSocket();
    if (!socket) return () => { cancelled = true; };
    const onNew = (notification) => {
      setCount((c) => (c == null ? 1 : c + 1));
      setItems((prev) => (prev ? [notification, ...prev] : prev));
    };
    socket.on('notification:new', onNew);
    return () => {
      cancelled = true;
      socket.off('notification:new', onNew);
    };
  }, []);

  const load = useCallback(() => {
    setLoadError(false);
    apiFetch('/notifications?limit=30')
      .then(setItems)
      .catch(() => setLoadError(true));
  }, []);

  const close = useCallback((restoreFocus = true) => {
    setOpen(false);
    if (restoreFocus) buttonRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    load();
    const onPointerDown = (e) => {
      if (!panelRef.current?.contains(e.target) && !buttonRef.current?.contains(e.target)) setOpen(false);
    };
    const onKeyDown = (e) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, load, close]);

  const openItem = async (item) => {
    close(false);
    if (!item.readAt) {
      setItems((prev) => prev?.map((n) => (n.id === item.id ? { ...n, readAt: new Date().toISOString() } : n)));
      setCount((c) => (c ? c - 1 : c));
      apiFetch(`/notifications/${item.id}/read`, { method: 'PATCH' }).catch(() => {});
    }
    if (item.link) router.push(item.link);
  };

  const markAllRead = async () => {
    setItems((prev) => prev?.map((n) => (n.readAt ? n : { ...n, readAt: new Date().toISOString() })));
    setCount(0);
    apiFetch('/notifications/read-all', { method: 'POST' }).catch(() => {});
  };

  const unread = count || 0;
  const label = unread > 0 ? `Notifications, ${unread} unread` : 'Notifications';

  return (
    <div className={styles.wrap}>
      <button
        ref={buttonRef}
        type="button"
        className={styles.bellButton}
        aria-label={label}
        aria-expanded={open}
        aria-controls="notification-panel"
        aria-haspopup="dialog"
        onClick={() => setOpen((v) => !v)}
      >
        <Bell size={18} aria-hidden="true" />
        {unread > 0 && (
          <span className={styles.badge} aria-hidden="true">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div ref={panelRef} id="notification-panel" role="dialog" aria-label="Notifications" className={styles.panel}>
          <div className={styles.panelHeader}>
            <h2 className={styles.panelTitle}>Notifications</h2>
            {unread > 0 && (
              <button type="button" className={styles.markAll} onClick={markAllRead}>
                <CheckCheck size={14} aria-hidden="true" />
                Mark all read
              </button>
            )}
          </div>

          <div className={styles.list} aria-live="polite">
            {items === null && !loadError && <p className={styles.state}>Loading…</p>}
            {loadError && <p className={styles.state}>Couldn’t load notifications. Try again in a moment.</p>}
            {items && items.length === 0 && (
              <div className={styles.emptyState}>
                <BellOff size={24} aria-hidden="true" />
                <p>You’re all caught up.</p>
                <span>Assignments, review results and anything waiting on you will show up here.</span>
              </div>
            )}
            {items && items.length > 0 && (
              <ul className={styles.items}>
                {items.map((item) => {
                  const Icon = TYPE_ICON[item.type] || Bell;
                  const tone = TYPE_TONE[item.type] || 'info';
                  return (
                    <li key={item.id}>
                      <button
                        type="button"
                        className={`${styles.item} ${item.readAt ? '' : styles.unread}`}
                        onClick={() => openItem(item)}
                      >
                        <span className={`${styles.itemIcon} ${styles[`tone_${tone}`]}`} aria-hidden="true">
                          <Icon size={16} />
                        </span>
                        <span className={styles.itemText}>
                          <span className={styles.itemTitle}>{item.title}</span>
                          {item.body && <span className={styles.itemBody}>{item.body}</span>}
                          <span className={styles.itemMeta}>
                            {item.actorName && <Avatar name={item.actorName} size="xs" />}
                            {item.actorName ? `${item.actorName} · ` : ''}
                            {formatRelativeTime(item.createdAt)}
                          </span>
                        </span>
                        {!item.readAt && (
                          <span className={styles.unreadDot}>
                            <span className="sr-only">Unread</span>
                          </span>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
