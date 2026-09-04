import { useState } from 'react';
import { useRouter } from 'next/router';
import { Mail, Lock, ArrowRight, Loader2 } from 'lucide-react';
import Input from '../components/ui/Input';
import styles from '../styles/login.module.css';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

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
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/vistoria-logo.png" alt="Vistoria Systems" className={styles.logo} />

      <form className={`${styles.form} ${error ? styles.formError : ''}`} onSubmit={handleSubmit}>
        <Input
          leftIcon={Mail}
          id="email"
          name="email"
          type="email"
          required
          value={form.email}
          onChange={handleChange}
          autoComplete="email"
          aria-label="Email"
          className={styles.field}
        />
        <Input
          leftIcon={Lock}
          id="password"
          name="password"
          type="password"
          required
          value={form.password}
          onChange={handleChange}
          autoComplete="current-password"
          aria-label="Password"
          className={styles.field}
        />
        <button
          type="submit"
          className={styles.submit}
          disabled={loading}
          aria-label={loading ? 'Signing in' : 'Sign in'}
        >
          {loading ? (
            <Loader2 size={20} className={styles.spinner} aria-hidden="true" />
          ) : (
            <ArrowRight size={20} aria-hidden="true" />
          )}
        </button>
      </form>

      <div className={styles.srOnly} role="alert" aria-live="assertive">
        {error}
      </div>
    </div>
  );
}
