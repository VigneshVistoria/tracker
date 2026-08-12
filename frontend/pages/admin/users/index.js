import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import AppShell from '../../../components/AppShell';
import styles from '../../../styles/issues.module.css';
import { apiFetch } from '../../../lib/api';
import { getSocket } from '../../../lib/socket';
import { useToast } from '../../../lib/toast';

export default function UsersList() {
  const router = useRouter();
  const { showToast } = useToast();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const storedUser = localStorage.getItem('user');
    if (!storedUser) {
      router.replace('/');
      return;
    }
    const currentUser = JSON.parse(storedUser);
    if (currentUser.role !== 'admin') {
      router.replace('/dashboard');
      return;
    }

    apiFetch('/users')
      .then(setUsers)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [router]);

  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;
    const onCreated = (user) => {
      showToast(`New user added: ${user.email}`, 'info');
      setUsers((prev) => (prev.some((u) => u.id === user.id) ? prev : [user, ...prev]));
    };
    socket.on('user:created', onCreated);
    return () => socket.off('user:created', onCreated);
  }, [showToast]);

  return (
    <AppShell>
      <div className={styles.pageHeader}>
        <div>
          <h1 className={styles.pageTitle}>User Management</h1>
          <p className={styles.pageSubtitle}>Create accounts and control project access.</p>
        </div>
        <Link href="/admin/users/new" className={`${styles.button} ${styles.buttonAccent}`}>
          + New User
        </Link>
      </div>

      {error && <div className={styles.error}>{error}</div>}

      <div className={styles.card}>
        {loading && <div className={styles.empty}>Loading...</div>}
        {!loading && users.length === 0 && <div className={styles.empty}>No users yet.</div>}

        {users.map((u) => (
          <Link key={u.id} href={`/admin/users/${u.id}`} className={styles.issueRow}>
            <div className={styles.issueMain}>
              <p className={styles.issueTitle}>{u.fullName || u.email}</p>
              <p className={styles.issueMeta}>
                {u.email} · {(u.projects || []).length} project(s)
              </p>
            </div>
            <span className={`${styles.badge} ${u.role === 'admin' ? styles.badgeClientReview : styles.badgeOpen}`}>
              {u.role}
            </span>
          </Link>
        ))}
      </div>
    </AppShell>
  );
}
