import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import AppShell from '../../components/AppShell';
import LoadingState from '../../components/ui/LoadingState';
import Button from '../../components/ui/Button';
import ScorecardViewSwitch from '../../components/ScorecardViewSwitch';
import styles from '../../styles/weeklyFigures.module.css';
import { apiDownload, apiFetch } from '../../lib/api';
import { redirectToSignIn } from '../../lib/session';
import { useToast } from '../../lib/toast';
import { cellText, detailText, dmy, evidenceGroups, valueText, visibleItems, weekLabel } from '../../lib/weeklyFigures';

const PM = 'program_manager';
const ROLE_TEXT = { developer: 'Developer', designer: 'Designer', devops: 'DevOps' };

// Weekly figures (2026-11-24, the user's decisions): RAW values for one
// completed Monday-Sunday week in one of the PM's own tracked projects,
// the nightly definitions over 7 days; developer-type roles only (QA is
// not shown here, 2026-11-24); no 1-5 scores.
// Programme Manager ONLY - WeeklyFiguresService refuses everyone else
// (403); this page just doesn't call it for them. Every view, person view
// and export is audited by the backend.
export default function WeeklyFiguresPage() {
  const router = useRouter();
  const { showToast } = useToast();
  const [role, setRole] = useState(null);
  const [data, setData] = useState(null);
  const [person, setPerson] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const { week, projectId, user } = router.query;
  const selected = user ? Number(user) : null;
  const params = useCallback(
    (extra = {}) => {
      const q = new URLSearchParams();
      if (week) q.set('week', String(week));
      if (projectId) q.set('projectId', String(projectId));
      for (const [k, v] of Object.entries(extra)) q.set(k, String(v));
      const s = q.toString();
      return s ? `?${s}` : '';
    },
    [week, projectId],
  );

  useEffect(() => {
    if (!router.isReady) return;
    const stored = localStorage.getItem('user');
    if (!stored) {
      redirectToSignIn(router);
      return;
    }
    setRole(JSON.parse(stored).role);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router.isReady]);

  useEffect(() => {
    if (role !== PM || selected) return;
    setError('');
    setData(null);
    apiFetch(`/performance-tracking/scorecard/weekly${params()}`)
      .then(setData)
      .catch((err) => setError(err.message));
  }, [role, selected, params]);

  useEffect(() => {
    if (role !== PM || !selected) return;
    setError('');
    setPerson(null);
    apiFetch(`/performance-tracking/scorecard/weekly/people/${selected}${params()}`)
      .then(setPerson)
      .catch((err) => setError(err.message));
  }, [role, selected, params]);

  const pick = (changes) => {
    const query = { ...router.query, ...changes };
    delete query.user;
    for (const k of Object.keys(query)) if (!query[k]) delete query[k];
    router.push({ query }, undefined, { shallow: true });
  };

  const exportExcel = async () => {
    if (!data?.project) return;
    setBusy(true);
    try {
      const slug = data.project.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      await apiDownload(
        `/performance-tracking/scorecard/weekly/export${params({ week: data.week.monday, projectId: data.project.id })}`,
        `weekly-figures-${slug}-${dmy(data.week.monday)}.xlsx`,
      );
      showToast('Weekly figures exported - the export has been recorded', 'success');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const current = selected ? person : data;

  return (
    <AppShell>
      <div className={styles.wrap}>
        <ScorecardViewSwitch role={role} current="weekly" />
        <div className={styles.header}>
          <div>
            <h1 className={styles.title}>Weekly figures</h1>
            <p className={styles.subtitle}>
              Raw values for one week, Monday to Sunday, with the same definitions as the nightly figures. No 1-5 scores during the
              baseline (until 30-11-2026). Personal performance data - confidential; every view and export is recorded.
            </p>
          </div>
        </div>

        {role && role !== PM && (
          <div className={styles.panel}>
            <p className={styles.notice}>Weekly figures are for Programme Managers only.</p>
          </div>
        )}

        {role === PM && (
          <>
            {error && (
              <p className={styles.error} role="alert">
                {error}
              </p>
            )}
            {current && (
              <div className={styles.filters}>
                <label className={styles.field}>
                  Week
                  <select className={styles.select} value={current.week.monday} onChange={(e) => pick({ week: e.target.value })}>
                    {current.choices.weeks.map((w) => (
                      <option key={w} value={w}>
                        {weekLabel(w)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className={styles.field}>
                  Project
                  <select
                    className={styles.select}
                    value={current.project?.id ?? ''}
                    onChange={(e) => pick({ projectId: e.target.value })}
                    disabled={current.choices.projects.length === 0}
                  >
                    {current.choices.projects.length === 0 && <option value="">No tracked project</option>}
                    {current.choices.projects.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </label>
                {!selected && data?.project && (
                  <div className={styles.exportCell}>
                    <Button variant="secondary" onClick={exportExcel} loading={busy}>
                      Export to Excel
                    </Button>
                  </div>
                )}
              </div>
            )}
            {!current && !error && <LoadingState />}
            {!selected && data && <WeekTable data={data} />}
            {selected && person && <PersonView person={person} backHref={{ query: Object.fromEntries(Object.entries(router.query).filter(([k]) => k !== 'user')) }} />}
          </>
        )}
      </div>
    </AppShell>
  );
}

function WeekTable({ data }) {
  const router = useRouter();
  const unitOf = Object.fromEntries(data.metricInfo.map((m) => [m.metric, m.unit]));
  const labelOf = Object.fromEntries(data.metricInfo.map((m) => [m.metric, m.label]));
  const metrics = data.groups.flatMap((g) => g.metrics);
  const firstOfGroup = new Set(data.groups.map((g) => g.metrics[0]));
  const minFor = (metric) => (metric === 'C6' ? data.c6MinSample : data.minSample);
  const linkFor = (userId) => ({ query: { ...router.query, user: userId } });

  if (!data.project) {
    return (
      <div className={styles.panel}>
        <p className={styles.notice}>You are not a member of any project with Performance Tracking switched on.</p>
      </div>
    );
  }

  const cell = (c) => (
    <td key={c.metric} className={firstOfGroup.has(c.metric) ? styles.groupStart : undefined}>
      {c.state === 'na' || c.state === 'off' ? (
        <span className={styles.na}>{c.state === 'off' ? 'not on' : 'n/a'}</span>
      ) : (
        <>
          <span className={styles.value}>{valueText(c, unitOf[c.metric], { compact: true })}</span>
          {detailText(c, minFor(c.metric)) && <span className={styles.sub}>{detailText(c, minFor(c.metric))}</span>}
        </>
      )}
    </td>
  );

  return (
    <>
      <section className={styles.panel} aria-labelledby="wf-people">
        <h2 id="wf-people" className={styles.panelHead}>
          {data.project.name} · {weekLabel(data.week.monday)}
        </h2>
        <p className={styles.panelNote}>
          Developers, designers and DevOps on this project (QA is not shown here). Select a name for the evidence behind each figure. Below {data.minSample} items a figure
          shows &quot;fewer than {data.minSample} items&quot;; &quot;n/a&quot; means no data this week.
          {!data.c6On && ' C6 (stand-up attendance) is not switched on for this project.'}
        </p>
        <p className={styles.panelNote}>
          <strong>The table scrolls sideways:</strong> {data.groups.map((g) => `${g.label} (${g.metrics[0]}-${g.metrics[g.metrics.length - 1]})`).join(', ')}.
        </p>
        {data.people.length === 0 ? (
          <p className={styles.empty}>No figures for this week.</p>
        ) : (
          <div className={styles.scroll} tabIndex={0} role="region" aria-label="Weekly figures, scrolls sideways">
            <table className={styles.table}>
              <caption className="sr-only">
                Raw weekly figures per person for {data.project.name}, {weekLabel(data.week.monday)}
              </caption>
              <thead>
                <tr>
                  <th scope="col" rowSpan={2} className={styles.sticky}>
                    Person
                  </th>
                  {data.groups.map((g) => (
                    <th key={g.key} scope="colgroup" colSpan={g.metrics.length} className={styles.groupStart}>
                      {g.label}
                    </th>
                  ))}
                </tr>
                <tr>
                  {metrics.map((m) => (
                    <th key={m} scope="col" className={firstOfGroup.has(m) ? styles.groupStart : undefined}>
                      <abbr className={styles.code} title={labelOf[m]}>
                        {m}
                      </abbr>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.people.map((p) => (
                  <tr key={p.userId}>
                    <th scope="row" className={styles.sticky}>
                      <Link href={linkFor(p.userId)} shallow className={styles.personLink}>
                        {p.name}
                      </Link>
                      <span className={styles.role}>{ROLE_TEXT[p.role] || p.role}</span>
                    </th>
                    {p.cells.map(cell)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <details className={styles.legend}>
          <summary>What the codes mean</summary>
          <ul className={styles.legendList}>
            {metrics.map((m) => (
              <li key={m}>
                <strong>{m}</strong> {labelOf[m]}
              </li>
            ))}
          </ul>
        </details>
      </section>

    </>
  );
}

// First 5 items, then a "Show all (N)" / "Show fewer" text button.
function EvidenceList({ items, label }) {
  const [expanded, setExpanded] = useState(false);
  const { shown, collapsible, total } = visibleItems(items, expanded);
  return (
    <>
      <ul>
        {shown.map((t, i) => (
          <li key={i}>{t}</li>
        ))}
      </ul>
      {collapsible && (
        <button type="button" className={styles.showAll} aria-expanded={expanded} aria-label={`${expanded ? 'Show fewer' : `Show all ${total}`}: ${label}`} onClick={() => setExpanded(!expanded)}>
          {expanded ? 'Show fewer' : `Show all (${total})`}
        </button>
      )}
    </>
  );
}

function PersonView({ person, backHref }) {
  const unitOf = Object.fromEntries(person.metricInfo.map((m) => [m.metric, m.unit]));
  const labelOf = Object.fromEntries(person.metricInfo.map((m) => [m.metric, m.label]));
  const byMetric = Object.fromEntries(person.metrics.map((m) => [m.metric, m]));
  const minFor = (metric) => (metric === 'C6' ? person.c6MinSample ?? 4 : person.minSample);
  const groups = person.groups;
  return (
    <>
      <Link href={backHref} shallow className={styles.back}>
        Back to all people
      </Link>
      <section className={styles.panel} aria-labelledby="wf-person">
        <h2 id="wf-person" className={styles.panelHead}>
          {person.person.name}
        </h2>
        <p className={styles.panelNote}>
          {ROLE_TEXT[person.person.role] || person.person.role} · {person.project.name} · {weekLabel(person.week.monday)}
        </p>
      </section>
      {groups.map((g) => (
        <section key={g.key} className={styles.panel} aria-labelledby={`wf-g-${g.key}`}>
          <h3 id={`wf-g-${g.key}`} className={styles.panelHead}>
            {g.label}
          </h3>
          <ul className={styles.metricList}>
            {g.metrics.map((metric) => {
              const m = byMetric[metric];
              const ev = m ? evidenceGroups(metric, m.details, person.taskTitles) : [];
              return (
                <li key={metric} className={styles.metric}>
                  <div className={styles.metricHead}>
                    <h4 className={styles.metricName}>
                      {metric} {labelOf[metric]}
                    </h4>
                    <span className={styles.metricValue}>{m ? cellText(m, unitOf[metric], minFor(metric)) : 'n/a'}</span>
                  </div>
                  {ev.length > 0 ? (
                    <dl className={styles.evidence}>
                      {ev.map((grp) => (
                        <div key={grp.label}>
                          <dt>{grp.label}</dt>
                          <dd>
                            <EvidenceList items={grp.items} label={`${metric} ${grp.label}`} />
                          </dd>
                        </div>
                      ))}
                    </dl>
                  ) : (
                    <p className={styles.noEvidence}>{m?.state === 'off' ? 'C6 is not switched on for this project.' : 'Nothing counted this week.'}</p>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </>
  );
}
