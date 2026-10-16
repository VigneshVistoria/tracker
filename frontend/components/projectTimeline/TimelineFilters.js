import { X } from 'lucide-react';
import Button from '../ui/Button';
import styles from '../../styles/projectTimeline.module.css';
import { TIMELINE_STATUSES } from '../../lib/projectTimeline';
import { EMPTY_FILTERS, FLAG_FILTERS, NO_TEAM, isFiltering } from '../../lib/projectTimelineSummary';

// Team, Status (plus the Summary's flags: Overdue, Running now, ...),
// Module, date range and search for the Project Timeline table. The
// Summary's cards set these same filters when clicked.
export default function TimelineFilters({ filters, onChange, modules, teams, hasNoTeam, shown, total }) {
  const set = (patch) => onChange({ ...filters, ...patch });
  return (
    <div className={styles.filtersPanel} role="search" aria-label="Filter the timeline">
      <div className={styles.filterGrid}>
        <div>
          <label className={styles.label} htmlFor="tl-filter-search">
            Search
          </label>
          <input
            id="tl-filter-search"
            type="search"
            className={styles.input}
            placeholder="Module, phase, team…"
            value={filters.search}
            onChange={(e) => set({ search: e.target.value })}
          />
        </div>
        <div>
          <label className={styles.label} htmlFor="tl-filter-module">
            Module
          </label>
          <select id="tl-filter-module" className={styles.select} value={filters.module} onChange={(e) => set({ module: e.target.value })}>
            <option value="">All modules</option>
            {modules.map((m) => (
              <option key={m.key} value={m.key}>
                {m.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={styles.label} htmlFor="tl-filter-team">
            Team
          </label>
          <select id="tl-filter-team" className={styles.select} value={filters.team} onChange={(e) => set({ team: e.target.value })}>
            <option value="">All teams</option>
            {teams.map((t) => (
              <option key={t.id} value={String(t.id)}>
                {t.name}
              </option>
            ))}
            {hasNoTeam && <option value={NO_TEAM}>No team</option>}
          </select>
        </div>
        <div>
          <label className={styles.label} htmlFor="tl-filter-status">
            Status
          </label>
          <select id="tl-filter-status" className={styles.select} value={filters.status} onChange={(e) => set({ status: e.target.value })}>
            <option value="">All statuses</option>
            <optgroup label="Status">
              {TIMELINE_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </optgroup>
            <optgroup label="Flags">
              {FLAG_FILTERS.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </optgroup>
          </select>
        </div>
        <div>
          <label className={styles.label} htmlFor="tl-filter-from">
            From
          </label>
          <input id="tl-filter-from" type="date" className={styles.input} value={filters.from} onChange={(e) => set({ from: e.target.value })} />
        </div>
        <div>
          <label className={styles.label} htmlFor="tl-filter-to">
            To
          </label>
          <input id="tl-filter-to" type="date" className={styles.input} value={filters.to} onChange={(e) => set({ to: e.target.value })} />
        </div>
      </div>
      <div className={styles.filterFooter}>
        <span className={styles.muted} aria-live="polite">
          Showing {shown} of {total} phases{filters.from || filters.to ? ' (date range: phases that overlap it)' : ''}
        </span>
        {isFiltering(filters) && (
          <Button size="sm" variant="ghost" leftIcon={X} onClick={() => onChange(EMPTY_FILTERS)}>
            Clear filters
          </Button>
        )}
      </div>
    </div>
  );
}
