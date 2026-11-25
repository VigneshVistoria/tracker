import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import AppShell from '../AppShell';
import LoadingState from '../ui/LoadingState';
import RequirementsTabs from './RequirementsTabs';
import styles from '../../styles/requirements.module.css';
import forms from '../../styles/issues.module.css';
import { apiFetch } from '../../lib/api';
import { useToast } from '../../lib/toast';
import { useRequirementsSrs } from '../../lib/useRequirementsSrs';
import { mapResultMessage } from '../../lib/requirementsTree';

// "Map existing tickets" and "Unmapped tickets" (Requirements Stage 2,
// 2026-11-25) - PM/Admin. Tickets of the SRS's project (never Junk), with
// filters; select one or many, pick an Approved story, mark Dev/QA and
// optionally the criteria they cover. Suggestions (from each ticket's
// Requirement ID) are listed for the PM to confirm - never linked by
// themselves. Mapping never changes a ticket.
export default function TicketMapper({ unmappedOnly = false }) {
  const { showToast } = useToast();
  const { list, srsId, off, error, setError } = useRequirementsSrs();
  const [filters, setFilters] = useState({ q: '', status: '', assigneeUserId: '', mapped: unmappedOnly ? 'unmapped' : 'all' });
  const [data, setData] = useState(null);
  const [stories, setStories] = useState(null);
  const [canLink, setCanLink] = useState(true);
  const [selected, setSelected] = useState([]);
  const [target, setTarget] = useState({ storyId: '', kinds: ['dev'], criterionIds: [] });
  const [suggestions, setSuggestions] = useState(null);
  const [busy, setBusy] = useState(false);

  const loadTickets = useCallback(async () => {
    if (!srsId) return;
    const params = new URLSearchParams(Object.entries(filters).filter(([, v]) => v !== '' && v !== null));
    try {
      setData(await apiFetch(`/requirements/srs/${srsId}/map/tickets?${params}`));
    } catch (err) {
      setError(err.message);
    }
  }, [srsId, filters, setError]);

  const loadStories = useCallback(async () => {
    const tree = await apiFetch(`/requirements/srs/${srsId}/tree`);
    setCanLink(!!tree.permissions.canLinkTickets);
    setStories(tree.epics.flatMap((e) => e.stories.map((s) => ({ ...s, epicCode: e.code }))).filter((s) => s.canLinkTickets));
  }, [srsId]);

  const loadSuggestions = useCallback(async () => {
    if (unmappedOnly) return;
    setSuggestions((await apiFetch(`/requirements/srs/${srsId}/map/suggestions`)).suggestions);
  }, [srsId, unmappedOnly]);

  useEffect(() => {
    if (!srsId) return;
    loadStories().catch((err) => setError(err.message));
    loadSuggestions().catch(() => setSuggestions([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [srsId]);

  useEffect(() => {
    const t = setTimeout(loadTickets, 250);
    return () => clearTimeout(t);
  }, [loadTickets]);

  const story = useMemo(() => stories?.find((s) => s.id === Number(target.storyId)), [stories, target.storyId]);
  const toggle = (list, v) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const allIds = data?.tickets.map((t) => t.taskId) ?? [];
  const allChosen = allIds.length > 0 && allIds.every((id) => selected.includes(id));

  const map = async (taskIds, storyId, kinds, criterionIds = []) => {
    setBusy(true);
    try {
      const res = await apiFetch(`/requirements/srs/${srsId}/map`, { method: 'POST', body: JSON.stringify({ taskIds, storyId: Number(storyId), kinds, criterionIds }) });
      showToast(mapResultMessage(res), 'success');
      setSelected([]);
      await Promise.all([loadTickets(), loadStories(), loadSuggestions()]);
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  if (off) {
    return (
      <AppShell>
        <h1 className={styles.title}>Requirements</h1>
        <p className={styles.subtitle}>Requirements is switched off at the moment.</p>
      </AppShell>
    );
  }

  const title = unmappedOnly ? 'Unmapped tickets' : 'Map existing tickets';
  return (
    <AppShell>
      <div className={styles.header}>
        <h1 className={styles.title}>{title}</h1>
        <p className={styles.subtitle}>
          {unmappedOnly
            ? 'Tickets of this project that are not linked to any story of this SRS yet (Junk excluded).'
            : 'Link existing tickets of this project to an Approved story. The tickets themselves do not change.'}
        </p>
      </div>
      {srsId && <RequirementsTabs srsId={srsId} canLinkTickets={canLink} />}
      {error && <div className={forms.error} role="alert">{error}</div>}
      {!error && list && list.length === 0 && <div className={`${styles.card} ${styles.empty}`}>No SRS on any project you are on yet.</div>}

      {!unmappedOnly && suggestions && suggestions.length > 0 && (
        <section className={`${styles.card} ${styles.panel}`} aria-labelledby="sugg-title">
          <h2 id="sugg-title" className={styles.panelTitle}>
            Suggested matches ({suggestions.length})
          </h2>
          <p className={forms.helpText}>From each ticket&apos;s Requirement ID. Nothing is linked until you confirm.</p>
          <ul className={styles.plainList}>
            {suggestions.map((sg) => (
              <li key={sg.taskId}>
                <a href={`/tasks/${sg.taskId}`}>{sg.trk}</a> {sg.title}
                <span className={styles.note}>
                  Requirement ID: {sg.requirementId} · {sg.status}
                  {sg.assignee ? ` · ${sg.assignee}` : ''}
                </span>
                <span className={styles.note}>
                  {sg.stories.map((s) => (
                    <span key={s.id} style={{ marginRight: 12 }}>
                      {s.code} {s.title} (via {s.via}):
                      <button type="button" className={styles.inlineLink} disabled={busy} onClick={() => map([sg.taskId], s.id, ['dev'])}>
                        Link as Dev
                      </button>
                      <button type="button" className={styles.inlineLink} disabled={busy} onClick={() => map([sg.taskId], s.id, ['qa'])}>
                        Link as QA
                      </button>
                    </span>
                  ))}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className={styles.toolbar}>
        <input
          type="search"
          className={styles.search}
          value={filters.q}
          onChange={(e) => setFilters({ ...filters, q: e.target.value })}
          placeholder="Search TRK number, title or Requirement ID"
          aria-label="Search TRK number, title or Requirement ID"
        />
        <select className={forms.select} style={{ width: 'auto' }} aria-label="Status" value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })}>
          <option value="">Any status</option>
          {data?.statuses.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <select className={forms.select} style={{ width: 'auto' }} aria-label="Assignee" value={filters.assigneeUserId} onChange={(e) => setFilters({ ...filters, assigneeUserId: e.target.value })}>
          <option value="">Any assignee</option>
          {data?.assignees.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
        {!unmappedOnly && (
          <select className={forms.select} style={{ width: 'auto' }} aria-label="Mapped" value={filters.mapped} onChange={(e) => setFilters({ ...filters, mapped: e.target.value })}>
            <option value="all">Mapped and unmapped</option>
            <option value="unmapped">Unmapped only</option>
            <option value="mapped">Mapped only</option>
          </select>
        )}
      </div>

      {!data ? (
        !error && <LoadingState />
      ) : (
        <>
          <div className={`${styles.card} ${forms.tableWrap}`}>
            <table className={forms.table}>
              <caption className="sr-only">
                {title}
              </caption>
              <thead>
                <tr>
                  <th className={styles.selectCell}>
                    <input type="checkbox" aria-label="Select all shown" checked={allChosen} onChange={() => setSelected(allChosen ? [] : allIds)} />
                  </th>
                  <th>Ticket</th>
                  <th>Status</th>
                  <th>Assignee</th>
                  <th>Requirement ID</th>
                  <th>Linked to</th>
                </tr>
              </thead>
              <tbody>
                {data.tickets.map((t) => (
                  <tr key={t.taskId}>
                    <td className={styles.selectCell}>
                      <input type="checkbox" aria-label={`Select ${t.trk}`} checked={selected.includes(t.taskId)} onChange={() => setSelected(toggle(selected, t.taskId))} />
                    </td>
                    <td>
                      <a href={`/tasks/${t.taskId}`}>{t.trk}</a> {t.title}
                      {t.isDefect && <span className={styles.note}>Defect</span>}
                    </td>
                    <td>{t.status}</td>
                    <td>{t.assignee || '—'}</td>
                    <td>{t.requirementId || '—'}</td>
                    <td>
                      {t.links.length
                        ? t.links.map((l) => (
                            <Link key={l.linkId} href={`/requirements/stories/${l.storyId}`} style={{ marginRight: 8 }}>
                              {l.code} ({l.kind.toUpperCase()})
                            </Link>
                          ))
                        : 'Not linked'}
                    </td>
                  </tr>
                ))}
                {!data.tickets.length && (
                  <tr>
                    <td colSpan={6} className={styles.muted}>
                      {unmappedOnly ? 'Every ticket is mapped.' : 'No tickets match.'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {data.truncated && <p className={styles.legend}>Showing the newest {data.limit}. Narrow the search to see others.</p>}

          <section className={`${styles.card} ${styles.panel}`} style={{ marginTop: 'var(--ds-space-4)' }} aria-labelledby="map-title">
            <h2 id="map-title" className={styles.panelTitle}>
              Map {selected.length} selected ticket{selected.length === 1 ? '' : 's'}
            </h2>
            {stories && !stories.length ? (
              <p className={styles.muted}>There is no Approved story yet - approve stories first.</p>
            ) : (
              <>
                <div className={forms.field}>
                  <label className={forms.label} htmlFor="map-story">
                    Approved story
                  </label>
                  <select id="map-story" className={forms.select} value={target.storyId} onChange={(e) => setTarget({ ...target, storyId: e.target.value, criterionIds: [] })}>
                    <option value="">Choose a story</option>
                    {stories?.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.code} {s.title} ({s.epicCode})
                      </option>
                    ))}
                  </select>
                </div>
                <fieldset style={{ border: 0, padding: 0, margin: '0 0 12px' }}>
                  <legend className={forms.label}>Link as</legend>
                  {['dev', 'qa'].map((k) => (
                    <label key={k} className={styles.checkRow}>
                      <input type="checkbox" checked={target.kinds.includes(k)} onChange={() => setTarget({ ...target, kinds: toggle(target.kinds, k) })} /> {k === 'dev' ? 'Dev' : 'QA'}
                    </label>
                  ))}
                </fieldset>
                {story && story.criteria.length > 0 && (
                  <fieldset style={{ border: 0, padding: 0, margin: '0 0 12px' }}>
                    <legend className={forms.label}>Criteria they cover (optional)</legend>
                    {story.criteria.map((c) => (
                      <label key={c.id} className={styles.checkRow} title={c.text}>
                        <input type="checkbox" checked={target.criterionIds.includes(c.id)} onChange={() => setTarget({ ...target, criterionIds: toggle(target.criterionIds, c.id) })} /> AC
                        {c.position}
                      </label>
                    ))}
                  </fieldset>
                )}
                <button
                  type="button"
                  className={forms.button}
                  disabled={busy || !selected.length || !target.storyId || !target.kinds.length}
                  onClick={() => map(selected, target.storyId, target.kinds, target.criterionIds)}
                >
                  {busy ? 'Linking...' : 'Link selected tickets'}
                </button>
              </>
            )}
          </section>
        </>
      )}
    </AppShell>
  );
}
