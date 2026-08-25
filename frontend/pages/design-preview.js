import { useEffect, useMemo, useState, useCallback } from 'react';
import { useRouter } from 'next/router';
import {
  Plus,
  Inbox,
  Loader,
  Eye,
  FlaskConical,
  AlertTriangle,
  CheckCircle2,
  Search,
} from 'lucide-react';
import AppShell from '../components/AppShell';
import Breadcrumbs from '../components/ui/Breadcrumbs';
import Button from '../components/ui/Button';
import { Card, CardHeader } from '../components/ui/Card';
import StatCard from '../components/ui/StatCard';
import Badge from '../components/ui/Badge';
import Table from '../components/ui/Table';
import Input from '../components/ui/Input';
import Select from '../components/ui/Select';
import Modal from '../components/ui/Modal';
import { ToastStack } from '../components/ui/Toast';
import EmptyState from '../components/ui/EmptyState';
import { SkeletonTable } from '../components/ui/Skeleton';
import { apiFetch } from '../lib/api';

const STATUS_TONE = {
  Backlog: 'neutral',
  'In Progress': 'info',
  'In Review': 'info',
  'QA Testing': 'warning',
  'QA Failed': 'error',
  'Ready for Production': 'success',
};

const PRIORITY_TONE = {
  High: 'error',
  Medium: 'warning',
  Low: 'neutral',
};

let demoToastId = 0;

export default function DesignPreviewPage() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [issues, setIssues] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [toasts, setToasts] = useState([]);

  useEffect(() => {
    const storedUser = localStorage.getItem('user');
    if (!storedUser) {
      router.replace('/');
      return;
    }
    setUser(JSON.parse(storedUser));
    apiFetch('/issues')
      .then(setIssues)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [router]);

  const pushToast = useCallback((message, type) => {
    const id = ++demoToastId;
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 4000);
  }, []);

  const counts = useMemo(
    () => ({
      Backlog: issues.filter((i) => i.status === 'Backlog').length,
      'In Progress': issues.filter((i) => i.status === 'In Progress').length,
      'In Review': issues.filter((i) => i.status === 'In Review').length,
      'QA Testing': issues.filter((i) => i.status === 'QA Testing').length,
      'QA Failed': issues.filter((i) => i.status === 'QA Failed').length,
      'Ready for Production': issues.filter((i) => i.status === 'Ready for Production').length,
    }),
    [issues],
  );

  const filteredIssues = useMemo(() => {
    return issues.filter((issue) => {
      if (statusFilter && issue.status !== statusFilter) return false;
      if (search && !issue.title.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
  }, [issues, search, statusFilter]);

  const columns = [
    {
      key: 'id',
      header: 'ID',
      width: 72,
      sortable: true,
      render: (row) => <span className="mono">#{row.id}</span>,
    },
    {
      key: 'title',
      header: 'Title',
      sortable: true,
      render: (row) => (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={{ fontWeight: 500 }}>{row.title}</span>
          {row.projectName && <span style={{ fontSize: 12, color: 'var(--ds-text-muted)' }}>{row.projectName}</span>}
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      sortable: true,
      render: (row) => <Badge tone={STATUS_TONE[row.status] || 'neutral'} dot>{row.status}</Badge>,
    },
    {
      key: 'priority',
      header: 'Priority',
      sortable: true,
      render: (row) => (row.priority ? <Badge tone={PRIORITY_TONE[row.priority] || 'neutral'}>{row.priority}</Badge> : <span style={{ color: 'var(--ds-text-muted)' }}>—</span>),
    },
    {
      key: 'assigneeEmail',
      header: 'Assignee',
      render: (row) => row.assigneeEmail || <span style={{ color: 'var(--ds-text-muted)' }}>Unassigned</span>,
    },
    {
      key: 'updatedAt',
      header: 'Updated',
      align: 'right',
      sortable: true,
      render: (row) => new Date(row.updatedAt).toLocaleDateString(),
    },
  ];

  if (!user) return null;

  return (
    <AppShell>
      <Breadcrumbs items={[{ label: 'Home', href: '/dashboard' }, { label: 'Design Preview' }]} />

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 'var(--ds-text-2xl)', fontWeight: 700, margin: 0, letterSpacing: '-0.02em' }}>Dashboard</h1>
          <p style={{ fontSize: 'var(--ds-text-sm)', color: 'var(--ds-text-secondary)', margin: '4px 0 0' }}>
            Blue SaaS/ERP theme preview — built with the new design-tokens + component library.
          </p>
        </div>
        <Button leftIcon={Plus} onClick={() => setModalOpen(true)}>New Issue</Button>
      </div>

      {error && (
        <Card className="ds-mb-6" padded>
          <span style={{ color: 'var(--ds-color-error)' }}>{error}</span>
        </Card>
      )}

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: 16,
          marginBottom: 24,
        }}
      >
        <StatCard label="Backlog" value={loading ? '—' : counts.Backlog} icon={Inbox} accent="neutral" />
        <StatCard label="In Progress" value={loading ? '—' : counts['In Progress']} icon={Loader} accent="primary" />
        <StatCard label="In Review" value={loading ? '—' : counts['In Review']} icon={Eye} accent="primary" />
        <StatCard label="QA Testing" value={loading ? '—' : counts['QA Testing']} icon={FlaskConical} accent="warning" />
        <StatCard label="QA Failed" value={loading ? '—' : counts['QA Failed']} icon={AlertTriangle} accent="error" />
        <StatCard label="Ready for Production" value={loading ? '—' : counts['Ready for Production']} icon={CheckCircle2} accent="success" />
      </div>

      <Card padded={false}>
        <div style={{ padding: '20px 20px 0' }}>
          <CardHeader
            title="Issues"
            subtitle={`${filteredIssues.length} of ${issues.length} shown`}
          />
          <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 240px', marginBottom: 0 }}>
              <Input
                leftIcon={Search}
                placeholder="Search issues…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                aria-label="Search issues"
                style={{ marginBottom: 0 }}
              />
            </div>
            <div style={{ width: 200 }}>
              <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Filter by status">
                <option value="">All statuses</option>
                {Object.keys(STATUS_TONE).map((s) => <option key={s} value={s}>{s}</option>)}
              </Select>
            </div>
          </div>
        </div>

        {loading ? (
          <div style={{ padding: '0 20px 20px' }}>
            <SkeletonTable rows={6} columns={6} />
          </div>
        ) : filteredIssues.length === 0 ? (
          <EmptyState
            icon={Inbox}
            title="No issues match your filters"
            description="Try clearing the search or status filter to see more results."
          />
        ) : (
          <Table columns={columns} rows={filteredIssues} />
        )}
      </Card>

      <Card padded style={{ marginTop: 24 }}>
        <CardHeader title="Component preview" subtitle="Buttons, toasts, and modal — for review, not wired to real actions." />
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <Button variant="primary">Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="danger">Danger</Button>
          <Button variant="secondary" onClick={() => pushToast('Issue #128 saved successfully.', 'success')}>Show success toast</Button>
          <Button variant="secondary" onClick={() => pushToast('Could not reach the server.', 'error')}>Show error toast</Button>
          <Button variant="secondary" onClick={() => pushToast('This subscription is about to expire.', 'warning')}>Show warning toast</Button>
          <Button variant="secondary" onClick={() => setModalOpen(true)}>Open modal</Button>
        </div>
      </Card>

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title="New Issue"
        footer={(
          <>
            <Button variant="secondary" onClick={() => setModalOpen(false)}>Cancel</Button>
            <Button onClick={() => { setModalOpen(false); pushToast('Issue created.', 'success'); }}>Create Issue</Button>
          </>
        )}
      >
        <Input label="Title" placeholder="e.g. Checkout button unresponsive on Safari" required />
        <Select label="Priority" defaultValue="Medium">
          <option>Low</option>
          <option>Medium</option>
          <option>High</option>
        </Select>
        <Input label="Description" placeholder="Steps to reproduce, expected vs actual…" hint="Markdown is supported." />
      </Modal>

      <ToastStack toasts={toasts} onDismiss={(id) => setToasts((prev) => prev.filter((t) => t.id !== id))} />
    </AppShell>
  );
}
