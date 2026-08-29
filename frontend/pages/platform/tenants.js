import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import AppShell from '../../components/AppShell';
import styles from '../../styles/issues.module.css';
import { apiFetch } from '../../lib/api';
import { useToast } from '../../lib/toast';

const EMPTY_FORM = { name: '', subdomain: '', adminEmail: '', adminFullName: '' };

function formatDateTime(value) {
  if (!value) return '—';
  return new Date(value).toLocaleString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

export default function PlatformTenantsPage() {
  const router = useRouter();
  const { showToast } = useToast();
  const [authorized, setAuthorized] = useState(false);
  const [tenants, setTenants] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [form, setForm] = useState(EMPTY_FORM);
  const [creating, setCreating] = useState(false);
  const [justCreated, setJustCreated] = useState(null);

  const load = () => {
    setLoading(true);
    setError('');
    apiFetch('/platform/tenants')
      .then(setTenants)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    const storedUser = localStorage.getItem('user');
    if (!storedUser) {
      router.replace('/');
      return;
    }
    if (!JSON.parse(storedUser).isPlatformSuperadmin) {
      router.replace('/dashboard');
      return;
    }
    setAuthorized(true);
    load();
  }, [router]);

  const handleCreate = async (e) => {
    e.preventDefault();
    setError('');
    setCreating(true);
    setJustCreated(null);
    try {
      const result = await apiFetch('/platform/tenants', {
        method: 'POST',
        body: JSON.stringify(form),
      });
      showToast(`Tenant "${result.tenant.name}" created`, 'success');
      setJustCreated(result);
      setForm(EMPTY_FORM);
      setTenants((prev) => [...prev, result.tenant]);
    } catch (err) {
      setError(err.message);
    } finally {
      setCreating(false);
    }
  };

  if (!authorized) {
    return <AppShell><div className={styles.empty}>Loading...</div></AppShell>;
  }

  return (
    <AppShell>
      <div className={styles.pageHeader}>
        <div>
          <h1 className={styles.pageTitle}>Platform Tenants</h1>
          <p className={styles.pageSubtitle}>
            Staff-only. Creates a new tenant and its first admin account - there is no self-serve signup.
          </p>
        </div>
      </div>

      {error && <div className={styles.error}>{error}</div>}

      {justCreated && (
        <div className={styles.successBanner}>
          <p style={{ margin: 0, fontWeight: 600 }}>
            Tenant &quot;{justCreated.tenant.name}&quot; created - admin account {justCreated.adminUser.email}
          </p>
          <p style={{ margin: 'var(--space-2) 0 0' }}>
            Temporary password (shown once, not recoverable - copy it now and send it to the new admin out of band):
          </p>
          <p style={{ margin: 'var(--space-1) 0 0', fontFamily: 'var(--font-mono, monospace)', fontSize: '1.05rem', fontWeight: 700 }}>
            {justCreated.temporaryPassword}
          </p>
        </div>
      )}

      <div className={styles.card}>
        <h3 style={{ marginTop: 0, fontSize: '1rem' }}>Create a tenant</h3>
        <form onSubmit={handleCreate}>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="tenantName">Tenant name</label>
            <input
              className={styles.input}
              id="tenantName"
              required
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="e.g. Acme Corp"
            />
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="tenantSubdomain">Subdomain</label>
            <input
              className={styles.input}
              id="tenantSubdomain"
              required
              pattern="[a-z0-9]([a-z0-9-]*[a-z0-9])?"
              value={form.subdomain}
              onChange={(e) => setForm({ ...form, subdomain: e.target.value.toLowerCase() })}
              placeholder="e.g. acme"
            />
            <p className={styles.helpText}>
              Lowercase letters, numbers, and hyphens only. Won&apos;t resolve to anything until the wildcard DNS/cert work is live.
            </p>
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="adminEmail">First admin&apos;s email</label>
            <input
              className={styles.input}
              id="adminEmail"
              type="email"
              required
              value={form.adminEmail}
              onChange={(e) => setForm({ ...form, adminEmail: e.target.value })}
            />
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="adminFullName">First admin&apos;s full name (optional)</label>
            <input
              className={styles.input}
              id="adminFullName"
              value={form.adminFullName}
              onChange={(e) => setForm({ ...form, adminFullName: e.target.value })}
            />
          </div>

          <button className={`${styles.button} ${styles.buttonAccent}`} type="submit" disabled={creating}>
            {creating ? 'Creating...' : 'Create Tenant'}
          </button>
        </form>
      </div>

      <h3 style={{ fontSize: '1rem' }}>Existing tenants ({tenants.length})</h3>
      {loading && <div className={styles.empty}>Loading...</div>}
      {!loading && tenants.length === 0 && (
        <div className={styles.card}>
          <div className={styles.empty}>No tenants yet.</div>
        </div>
      )}
      {!loading && tenants.length > 0 && (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>ID</th>
                <th>Name</th>
                <th>Subdomain</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {tenants.map((t) => (
                <tr key={t.id}>
                  <td>{t.id}</td>
                  <td className={styles.tableTitleCell}>{t.name}</td>
                  <td>{t.subdomain}</td>
                  <td>{formatDateTime(t.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </AppShell>
  );
}
