import Link from 'next/link';
import { useRouter } from 'next/router';
import styles from '../../styles/issues.module.css';

// Tabs across the Requirements pages. Map / Unmapped tickets are PM/Admin
// only (the backend refuses everyone else anyway).
export default function RequirementsTabs({ srsId, canLinkTickets }) {
  const { pathname } = useRouter();
  const q = srsId ? `?srs=${srsId}` : '';
  const tabs = [
    { href: '/requirements', label: 'Tree view' },
    ...(canLinkTickets
      ? [
          { href: '/requirements/map', label: 'Map tickets' },
          { href: '/requirements/unmapped', label: 'Unmapped tickets' },
        ]
      : []),
    { href: '/requirements/client-items', label: 'Client items' },
  ];
  return (
    <nav className={styles.tabs} aria-label="Requirements">
      {tabs.map((t) => (
        <Link key={t.href} href={`${t.href}${q}`} className={`${styles.tab} ${pathname === t.href ? styles.tabActive : ''}`} aria-current={pathname === t.href ? 'page' : undefined}>
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
