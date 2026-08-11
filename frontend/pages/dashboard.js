import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import styles from '../styles/auth.module.css';

export default function Dashboard() {
  const router = useRouter();
  const [user, setUser] = useState(null);

  useEffect(() => {
    const token = localStorage.getItem('accessToken');
    const storedUser = localStorage.getItem('user');

    if (!token || !storedUser) {
      router.replace('/');
      return;
    }

    setUser(JSON.parse(storedUser));
  }, [router]);

  const handleLogout = () => {
    localStorage.removeItem('accessToken');
    localStorage.removeItem('user');
    router.push('/');
  };

  if (!user) return null;

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <h1 className={styles.title}>Welcome{user.fullName ? `, ${user.fullName}` : ''}!</h1>
        <p style={{ textAlign: 'center', color: '#555' }}>Logged in as {user.email}</p>
        <button className={styles.button} onClick={handleLogout}>
          Log out
        </button>
      </div>
    </div>
  );
}
