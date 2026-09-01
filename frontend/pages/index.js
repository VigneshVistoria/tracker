import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { CheckCircle2 } from 'lucide-react';
import Input from '../components/ui/Input';
import Button from '../components/ui/Button';
import ThemeToggle from '../components/ui/ThemeToggle';
import styles from '../styles/login.module.css';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

const FEATURES = [
  'Real-time ticket tracking across every team',
  'SLA alerts before deadlines are missed',
  'One dashboard for sprints, QA, and releases',
];

export default function LoginPage() {
  const router = useRouter();
  const [form, setForm] = useState({ email: '', password: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleChange = (e) => {
    setForm({ ...form, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const res = await fetch(`${API_URL}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.message || 'Login failed');
      }

      // Store the token. For production, prefer an httpOnly cookie set by
      // the backend over localStorage to reduce XSS risk.
      localStorage.setItem('accessToken', data.accessToken);
      localStorage.setItem('user', JSON.stringify(data.user));

      router.push('/dashboard');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={styles.page}>
      <div className={styles.brandPanel}>
        <div>
          <span className={styles.brandMark}>IT</span>
          <div className={styles.brandName}>IssueTrack</div>
          <p className={styles.brandTagline}>
            The issue tracker built for teams who ship on a deadline.
          </p>
          <ul className={styles.featureList}>
            {FEATURES.map((feature) => (
              <li key={feature} className={styles.featureItem}>
                <CheckCircle2 size={18} className={styles.featureIcon} aria-hidden="true" />
                <span>{feature}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className={styles.brandFooter}>Vistoria Systems</div>
      </div>

      <div className={styles.formPanel}>
        <ThemeToggle className={styles.themeToggle} />
        <div className={styles.formInner}>
          <div className={styles.mobileBrand}>
            <span className={styles.mobileBrandMark}>IT</span>
            IssueTrack
          </div>

          <h1 className={styles.title}>Sign in</h1>
          <p className={styles.subtitle}>Welcome back. Enter your details to continue.</p>

          {error && <div className={styles.error}>{error}</div>}

          <form className={styles.form} onSubmit={handleSubmit}>
            <Input
              label="Email"
              id="email"
              name="email"
              type="email"
              required
              value={form.email}
              onChange={handleChange}
              autoComplete="email"
            />
            <Input
              label="Password"
              id="password"
              name="password"
              type="password"
              required
              value={form.password}
              onChange={handleChange}
              autoComplete="current-password"
            />
            <Button type="submit" fullWidth loading={loading}>
              {loading ? 'Signing in...' : 'Sign in'}
            </Button>
          </form>

          <div className={styles.footer}>
            Don&apos;t have an account? <Link href="/register">Create one</Link>
          </div>
        </div>
      </div>
    </div>
  );
}
