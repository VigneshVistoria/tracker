import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import AppShell from './AppShell';
import { DashboardHeader } from './dashboard/DashboardParts';
import LoadingState from './ui/LoadingState';
import styles from '../styles/myWork.module.css';
import { apiFetch } from '../lib/api';
import { todayISO } from '../lib/developerTaskStats';
import { buildMyWork, needsDueDateCommit, statusInfo, fixReason, formatDmy } from '../lib/developerWorkGroups';

// Developer home "My work" (NEW_UI only, 2026-11-17): one Working /
// Submitted toggle over one list. Grouping, labels, sorting and counts
// all live in lib/developerWorkGroups.js. Text only, no icons.

const TABS = [
  { key: 'working', label: 'Working', empty: 'Nothing to work on right now.' },
  { key: 'submitted', label: 'Submitted', empty: 'Nothing submitted.' },
];

const settled = (r, fallback) => (r.status === 'fulfilled' ? r.value : fallback);

export default function DeveloperMyWork({ user }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [partial, setPartial] = useState([]);
  const [tab, setTab] = useState('working');
  const tabRefs = useRef({});
  const today = todayISO();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [tasks, ownedTickets, inboundTickets] = await Promise.all([
          apiFetch('/tasks/mine'),
          apiFetch('/task-dependency-tickets/mine'),
          apiFetch('/task-dependency-tickets/created-by-me'),
        ]);
        const missing = [];

        // Performance Tracking is per project: ask once per project that
        // has a date waiting for this person's confirmation.
        const commitByProject = new Map();
        for (const t of tasks) {
          if (statusInfo(t.status) && needsDueDateCommit(t, user.id) && !commitByProject.has(t.projectId)) commitByProject.set(t.projectId, t.id);
        }
        const fixTasks = tasks.filter((t) => statusInfo(t.status)?.fix);

        const [peer, handovers, tracking, reviews] = await Promise.all([
          Promise.allSettled([apiFetch('/tasks/peer-review-queue')]).then(([r]) => r),
          Promise.allSettled([apiFetch('/design-handovers/mine')]).then(([r]) => r),
          Promise.allSettled([...commitByProject.entries()].map(([projectId, taskId]) => apiFetch(`/tasks/${taskId}/due-date`).then((s) => [projectId, s.trackingOn]))),
          Promise.allSettled(fixTasks.map((t) => apiFetch(`/tasks/${t.id}/qa-reviews`).then((r) => [t, r]))),
        ]);
        if (peer.status !== 'fulfilled') missing.push('peer reviews to do');
        if (handovers.status !== 'fulfilled') missing.push('design handovers');
        if (tracking.some((r) => r.status !== 'fulfilled')) missing.push('due dates to confirm');

        const trackingProjects = new Set(tracking.filter((r) => r.status === 'fulfilled' && r.value[1]).map((r) => r.value[0]));
        const reasons = new Map();
        reviews.forEach((r, i) => {
          const task = fixTasks[i];
          reasons.set(task.id, r.status === 'fulfilled' ? fixReason(task, r.value[1]) : fixReason(task, []));
        });

        if (cancelled) return;
        setPartial(missing);
        setData({
          tasks,
          ownedTickets,
          inboundTickets,
          peerReviews: settled(peer, []),
          handovers: settled(handovers, []),
          trackingProjects,
          reasons,
        });
      } catch (err) {
        if (!cancelled) setError(err.message);
      }
    })();
    return () => { cancelled = true; };
  }, [user.id]);

  const work = useMemo(() => (data ? buildMyWork({ ...data, userId: user.id, today }) : null), [data, user.id, today]);
  const rows = work ? work[tab] : [];

  const onKeyDown = (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight' && e.key !== 'Home' && e.key !== 'End') return;
    e.preventDefault();
    const next = e.key === 'Home' ? 'working' : e.key === 'End' ? 'submitted' : tab === 'working' ? 'submitted' : 'working';
    setTab(next);
    tabRefs.current[next]?.focus();
  };

  return (
    <AppShell>
      <DashboardHeader user={user} summary="Here’s what’s on your plate right now." />

      <section className={styles.wrap} aria-labelledby="my-work-heading">
        <h2 id="my-work-heading" className={styles.heading}>My work</h2>

        {error && <p className={styles.error} role="alert">{error}</p>}
        {!error && !work && <LoadingState label="Loading your work" />}

        {work && (
          <>
            <div className={styles.toggle} role="tablist" aria-label="My work" data-active={tab}>
              <span className={styles.thumb} aria-hidden="true" />
              {TABS.map((t) => (
                <button
                  key={t.key}
                  ref={(el) => { tabRefs.current[t.key] = el; }}
                  type="button"
                  role="tab"
                  id={`my-work-tab-${t.key}`}
                  aria-selected={tab === t.key}
                  aria-controls="my-work-panel"
                  tabIndex={tab === t.key ? 0 : -1}
                  className={styles.tab}
                  onClick={() => setTab(t.key)}
                  onKeyDown={onKeyDown}
                >
                  {t.label} ({work[t.key].length})
                </button>
              ))}
            </div>

            {partial.length > 0 && (
              <p className={styles.notice} role="status">
                Couldn’t load {partial.join(', ')} - reload to try again.
              </p>
            )}

            <div id="my-work-panel" role="tabpanel" aria-labelledby={`my-work-tab-${tab}`} className={styles.panel}>
              {rows.length === 0 ? (
                <p className={styles.empty}>{TABS.find((t) => t.key === tab).empty}</p>
              ) : (
                <ul className={styles.list}>
                  {rows.map((r) => (
                    <li key={r.key} className={styles.row}>
                      <div className={styles.main}>
                        <Link href={r.href} className={styles.title}>{r.title}</Link>
                        <p className={styles.meta}>
                          <span>{r.ref}</span>
                          {work.multiProject && r.projectName && <span>{r.projectName}</span>}
                          <span className={r.fix ? styles.statusFix : styles.status}>{r.status}</span>
                          {r.confirmDueDate && <span className={styles.status}>Confirm due date</span>}
                          {r.showstopper && <span className={styles.showstopper}>Showstopper</span>}
                        </p>
                        {r.reason && <p className={styles.reason}>{r.reason}</p>}
                        {r.blocked.map((b) => <p key={b} className={styles.blocked}>{b}</p>)}
                      </div>
                      <div className={styles.date}>
                        {r.date ? (
                          <>
                            <span className={r.late > 0 ? styles.dateLate : undefined}>{formatDmy(r.date)}</span>
                            {r.late > 0 && <span className={styles.lateText}>{r.late} {r.late === 1 ? 'day' : 'days'} late</span>}
                          </>
                        ) : (
                          <span className={styles.noDate}>No due date</span>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        )}
      </section>
    </AppShell>
  );
}
