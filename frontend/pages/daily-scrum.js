import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { Copy, Presentation, RefreshCw } from 'lucide-react';
import AppShell from '../components/AppShell';
import ScrumPersonView from '../components/dailyScrum/ScrumPersonView';
import TeamView from '../components/dailyScrum/TeamView';
import PresentMode from '../components/dailyScrum/PresentMode';
import LoadingState from '../components/ui/LoadingState';
import Select from '../components/ui/Select';
import { apiFetch } from '../lib/api';
import { DEVELOPER_EQUIVALENT_ROLES } from '../lib/status';
import { formatDateTime, formatWeekdayDate } from '../lib/formatDate';
import { copyText, personText, teamText } from '../lib/dailyScrumText';
import { useToast } from '../lib/toast';
import styles from '../styles/issues.module.css';
import scrumStyles from '../styles/dailyScrum.module.css';

// Daily Scrum. Read-only for tickets: nothing here edits one.
// - Developer/Designer/DevOps/QA: their own summary (Stage 2).
// - PM/Executive/Admin: Team and Individual tabs, Present mode (Stage 3).
// Copy as text for everyone. Backend mirror: DailyScrumController's
// ROLES_ALLOWED_TO_VIEW_OWN_SCRUM / _TEAM_SCRUM / _EDIT_EXTERNAL_WAITS.
const OWN_ROLES = [...DEVELOPER_EQUIVALENT_ROLES, 'qa'];
const TEAM_ROLES = ['program_manager', 'executive', 'admin'];
const EDIT_WAITS_ROLES = ['program_manager', 'admin'];
const TABS = [
  { key: 'team', label: 'Team' },
  { key: 'individual', label: 'Individual' },
];

// The scrum window on one quiet line: since -> today, zone and hours,
// last refresh. Each active ticket sits in exactly one of the three groups.
function WindowLine({ meta }) {
  const w = meta.window;
  return (
    <p className={scrumStyles.window}>
      <span>
        Since <strong>{formatWeekdayDate(w.lastWorkingDay)}</strong> 00:00 to Today <strong>{formatWeekdayDate(w.today)}</strong>
      </span>
      <span>
        {w.timeZone.replace(/_/g, ' ')}
        {meta.settings ? ` · ${meta.settings.workdayStart}–${meta.settings.workdayEnd}` : ''}
      </span>
      <span>Updated {formatDateTime(w.generatedAt, w.timeZone)}</span>
    </p>
  );
}

export default function DailyScrumPage() {
  const router = useRouter();
  const { showToast } = useToast();
  const [user, setUser] = useState(null);
  const isTeamRole = user ? TEAM_ROLES.includes(user.role) : false;

  // Own summary (Developer/QA) or the Individual tab's person.
  const [mine, setMine] = useState(null);
  const [team, setTeam] = useState(null);
  const [waits, setWaits] = useState(null);
  const [showResolved, setShowResolved] = useState(false);
  const [personId, setPersonId] = useState('');
  const [person, setPerson] = useState(null);
  const [loading, setLoading] = useState(true);
  const [personLoading, setPersonLoading] = useState(false);
  const [error, setError] = useState('');
  const [presenting, setPresenting] = useState(false);

  const tab = router.query.tab === 'individual' ? 'individual' : 'team';

  const loadWaits = useCallback((resolved) => {
    return apiFetch(`/daily-scrum/external-waits?status=${resolved ? 'all' : 'open'}`)
      .then(setWaits)
      .catch(() => setWaits(null));
  }, []);

  const loadTeam = useCallback(() => {
    setLoading(true);
    setError('');
    return Promise.all([apiFetch('/daily-scrum/team').then(setTeam), loadWaits(showResolved)])
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [loadWaits, showResolved]);

  const loadMine = useCallback(() => {
    setLoading(true);
    setError('');
    apiFetch('/daily-scrum/me')
      .then(setMine)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  const loadPerson = useCallback((id) => {
    if (!id) {
      setPerson(null);
      return;
    }
    setPersonLoading(true);
    setError('');
    apiFetch(`/daily-scrum/people/${id}`)
      .then(setPerson)
      .catch((err) => setError(err.message))
      .finally(() => setPersonLoading(false));
  }, []);

  useEffect(() => {
    const storedUser = localStorage.getItem('user');
    if (!storedUser) {
      router.replace('/');
      return;
    }
    const parsed = JSON.parse(storedUser);
    if (!OWN_ROLES.includes(parsed.role) && !TEAM_ROLES.includes(parsed.role)) {
      router.replace('/dashboard');
      return;
    }
    setUser(parsed);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!user) return;
    if (isTeamRole) loadTeam();
    else loadMine();
    // Load once per user; Refresh reloads. loadTeam changes with showResolved.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  // Individual tab: the person comes from ?person=, so the view can be linked.
  useEffect(() => {
    if (!isTeamRole || !router.isReady) return;
    const id = router.query.person ? String(router.query.person) : '';
    setPersonId(id);
    if (tab === 'individual') loadPerson(id);
  }, [isTeamRole, router.isReady, router.query.person, tab, loadPerson]);

  const setQuery = (next) => {
    const query = { ...router.query, ...next };
    Object.keys(query).forEach((k) => (query[k] === '' || query[k] == null) && delete query[k]);
    router.replace({ pathname: router.pathname, query }, undefined, { shallow: true });
  };

  const openPerson = (id) => setQuery({ tab: 'individual', person: String(id) });

  const refresh = () => {
    if (!isTeamRole) return loadMine();
    loadTeam();
    if (tab === 'individual') loadPerson(personId);
    return undefined;
  };

  const toggleResolved = () => {
    const next = !showResolved;
    setShowResolved(next);
    loadWaits(next);
  };

  const copy = async () => {
    let text = '';
    if (!isTeamRole) text = mine && personText(mine.person, mine, { self: true });
    else if (tab === 'team') text = team && teamText(team, waits && waits.filter((w) => w.status === 'open'));
    else text = person && personText(person.person, person, { self: false });
    if (!text) return;
    try {
      await copyText(text);
      showToast('Copied as text.', 'success');
    } catch {
      showToast('Could not copy - your browser blocked it.', 'error');
    }
  };

  if (!user) return null;

  const meta = isTeamRole ? (tab === 'individual' && person ? person : team) : mine;
  const busy = loading || personLoading;
  const canCopy = isTeamRole ? (tab === 'team' ? !!team : !!person) : !!mine;

  const onTabKey = (e) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const next = tab === 'team' ? 'individual' : 'team';
    setQuery({ tab: next === 'team' ? '' : next });
    document.getElementById(`scrum-tab-${next}`)?.focus();
  };

  return (
    <AppShell>
      <div className={scrumStyles.header}>
        <div className={scrumStyles.headerText}>
          <h1 className={styles.pageTitle}>Daily Scrum</h1>
          {meta && <WindowLine meta={meta} />}
        </div>
        <div className={scrumStyles.headerActions}>
          <button type="button" className={`${styles.button} ${styles.buttonSecondary}`} onClick={refresh} disabled={busy}>
            <RefreshCw size={16} aria-hidden="true" /> {busy ? 'Refreshing...' : 'Refresh'}
          </button>
          <button type="button" className={`${styles.button} ${styles.buttonSecondary}`} onClick={copy} disabled={!canCopy}>
            <Copy size={16} aria-hidden="true" /> Copy as text
          </button>
          {isTeamRole && (
            <button type="button" className={styles.button} onClick={() => setPresenting(true)} disabled={!team || team.people.length === 0}>
              <Presentation size={16} aria-hidden="true" /> Present
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className={styles.error} role="alert">
          {error}
        </div>
      )}

      {!isTeamRole && (
        <>
          {loading && !mine && <LoadingState rows={4} />}
          {mine && <ScrumPersonView person={mine.person} timeZone={mine.window.timeZone} />}
        </>
      )}

      {isTeamRole && (
        <>
          <div className={styles.tabs} role="tablist" aria-label="Daily Scrum views">
            {TABS.map((t) => (
              <button
                key={t.key}
                type="button"
                role="tab"
                id={`scrum-tab-${t.key}`}
                aria-selected={tab === t.key}
                aria-controls={`scrum-panel-${t.key}`}
                tabIndex={tab === t.key ? 0 : -1}
                className={`${styles.tab} ${tab === t.key ? styles.tabActive : ''}`}
                onClick={() => setQuery({ tab: t.key === 'team' ? '' : t.key })}
                onKeyDown={onTabKey}
              >
                {t.label}
              </button>
            ))}
          </div>

          {tab === 'team' && (
            <div role="tabpanel" id="scrum-panel-team" aria-labelledby="scrum-tab-team" className={scrumStyles.tabPanel}>
              {loading && !team && <LoadingState rows={4} />}
              {team && (
                <TeamView
                  team={team}
                  waits={waits}
                  canEditWaits={EDIT_WAITS_ROLES.includes(user.role)}
                  showResolved={showResolved}
                  onToggleResolved={toggleResolved}
                  onWaitsChanged={() => loadWaits(showResolved)}
                  onOpenPerson={openPerson}
                />
              )}
            </div>
          )}

          {tab === 'individual' && (
            <div role="tabpanel" id="scrum-panel-individual" aria-labelledby="scrum-tab-individual" className={scrumStyles.tabPanel}>
              <div className={scrumStyles.personPicker}>
                <Select label="Person" value={personId} onChange={(e) => setQuery({ tab: 'individual', person: e.target.value })} disabled={!team}>
                  <option value="">Choose a person</option>
                  {(team?.people || []).map((p) => (
                    <option key={p.userId} value={p.userId}>
                      {p.name}
                    </option>
                  ))}
                </Select>
              </div>
              {!personId && <p className={scrumStyles.empty}>Choose a person to see their Daily Scrum.</p>}
              {personId && personLoading && !person && <LoadingState rows={4} />}
              {personId && person && String(person.person.userId) === personId && (
                <ScrumPersonView person={person.person} timeZone={person.window.timeZone} self={false} />
              )}
            </div>
          )}
        </>
      )}

      {presenting && team && <PresentMode team={team} waits={waits} onClose={() => setPresenting(false)} />}
    </AppShell>
  );
}
