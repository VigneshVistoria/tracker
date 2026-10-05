import { useEffect, useState } from 'react';
import { ChevronDown, ChevronUp, Download } from 'lucide-react';
import { apiFetch, apiDownload } from '../lib/api';
import { formatPercent } from '../lib/formatNumber';
import ResultByPriorityChart from './ResultByPriorityChart';
import pageStyles from '../styles/issues.module.css';
import styles from './TestCaseExecutionSummary.module.css';

const COLLAPSED_STORAGE_KEY = 'testCaseSummaryCollapsed';
// Typing in Search refetches after a short pause, not on every keystroke.
const FETCH_DELAY_MS = 300;

// Counts come from GET /test-cases/execution-summary - one grouped query
// for both tables, with the list's own filters, so the overall row and
// the per-priority rows always agree (TestCasesService.executionSummary()).
function summaryQuery(filters) {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => {
    if (value !== '' && value !== undefined && value !== null) params.set(key, value);
  });
  return params.toString();
}

function Tile({ label, value, detail, dotClassName }) {
  return (
    <div className={styles.tile}>
      <div className={styles.tileLabel}>
        {dotClassName && <span className={`${styles.swatch} ${dotClassName}`} aria-hidden="true" />}
        {label}
      </div>
      <div className={styles.tileValue}>{value}</div>
      {detail && <div className={styles.tileDetail}>{detail}</div>}
    </div>
  );
}

// Executed = has a Pass/Fail/Blocked result. % executed leaves N/A
// (Deprecated) out of the denominator - retired cases aren't expected to
// run. Pass rate is passed / executed, "—" until something has run.
function Tiles({ overall }) {
  const executed = overall.passed + overall.failed + overall.blocked;
  const runnable = overall.total - overall.na;
  return (
    <div className={styles.tiles}>
      <Tile label="Total" value={overall.total} detail={overall.na > 0 ? `incl. ${overall.na} N/A` : null} />
      <Tile label="Passed" value={overall.passed} dotClassName={styles.segPass} />
      <Tile label="Failed" value={overall.failed} dotClassName={styles.segFail} />
      <Tile label="Blocked" value={overall.blocked} dotClassName={styles.segBlocked} />
      <Tile label="Not Executed" value={overall.notExecuted} dotClassName={styles.segNone} />
      <Tile label="% Executed" value={formatPercent(executed, runnable)} detail={`${executed} of ${runnable}`} />
      <Tile
        label="Pass Rate"
        value={formatPercent(overall.passed, executed)}
        detail={executed > 0 ? `${overall.passed} of ${executed} run` : 'Nothing run yet'}
      />
    </div>
  );
}

function CountsRow({ label, counts, className }) {
  return (
    <tr className={className}>
      <th scope="row">{label}</th>
      <td className={styles.num}>{counts.total}</td>
      <td className={styles.num}>{counts.passed}</td>
      <td className={styles.num}>{counts.failed}</td>
      <td className={styles.num}>{counts.blocked}</td>
      <td className={styles.num}>{counts.notExecuted}</td>
      <td className={styles.num}>{counts.na}</td>
    </tr>
  );
}

// filters: { search, projectId, moduleId, status, reviewStatus, labelId }
// - the list page's current filter values. refreshKey changes whenever the
// list reloads (e.g. after a review action), so the summary follows it.
// hasTestCases picks the empty-state wording (none at all vs. none match).
// Tiles, chart and tables all render from the one summary response, so
// they can't disagree.
export default function TestCaseExecutionSummary({ filters, refreshKey, hasTestCases }) {
  const [summary, setSummary] = useState(null);
  const [error, setError] = useState('');
  const [collapsed, setCollapsed] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const query = summaryQuery(filters);

  useEffect(() => {
    setCollapsed(localStorage.getItem(COLLAPSED_STORAGE_KEY) === 'true');
  }, []);

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      apiFetch(`/test-cases/execution-summary${query ? `?${query}` : ''}`)
        .then((data) => {
          if (!cancelled) {
            setSummary(data);
            setError('');
          }
        })
        .catch((err) => !cancelled && setError(err.message));
    }, FETCH_DELAY_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, refreshKey]);

  const toggleCollapsed = () => {
    setCollapsed((value) => {
      localStorage.setItem(COLLAPSED_STORAGE_KEY, String(!value));
      return !value;
    });
  };

  const handleDownload = async () => {
    setDownloading(true);
    setError('');
    try {
      await apiDownload(
        `/test-cases/execution-summary/export${query ? `?${query}` : ''}`,
        `test-case-execution-summary-${new Date().toISOString().slice(0, 10)}.xlsx`,
      );
    } catch (err) {
      setError(err.message);
    } finally {
      setDownloading(false);
    }
  };

  const overall = summary?.overall;
  const isEmpty = overall && overall.total === 0;

  return (
    <section className={`${pageStyles.card} ${styles.dashboard}`} aria-labelledby="tcSummaryTitle">
      <div className={styles.header}>
        <h2 className={styles.title} id="tcSummaryTitle">Execution Summary</h2>
        <div className={styles.actions}>
          <button className={pageStyles.buttonSecondary} type="button" onClick={handleDownload} disabled={downloading || !summary || isEmpty}>
            <Download size={14} aria-hidden="true" /> {downloading ? 'Downloading...' : 'Download Excel'}
          </button>
          <button
            className={pageStyles.buttonSecondary}
            type="button"
            onClick={toggleCollapsed}
            aria-expanded={!collapsed}
            aria-controls="tcSummaryBody"
          >
            {collapsed ? <ChevronDown size={14} aria-hidden="true" /> : <ChevronUp size={14} aria-hidden="true" />}{' '}
            {collapsed ? 'Show' : 'Hide'}
          </button>
        </div>
      </div>

      {error && <div className={pageStyles.error} role="alert">{error}</div>}

      <div id="tcSummaryBody" className={styles.body} hidden={collapsed}>
        {!overall && !error && <div className={styles.status}>Loading summary...</div>}
        {isEmpty && (
          <div className={styles.status}>
            {hasTestCases ? 'No test cases match these filters.' : 'No test cases yet - nothing to summarise.'}
          </div>
        )}
        {overall && !isEmpty && (
          <>
            <Tiles overall={overall} />
            <ResultByPriorityChart rows={summary.byPriority} />
            <div className={styles.tables}>
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <caption className={styles.caption}>Overall Progress</caption>
                  <thead>
                    <tr>
                      <th scope="col">Metric</th>
                      <th scope="col" className={styles.num}>Count</th>
                      <th scope="col" className={styles.num}>% of Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <th scope="row">Total Test Cases</th>
                      <td className={styles.num}>{overall.total}</td>
                      <td className={styles.num}>{formatPercent(overall.total, overall.total)}</td>
                    </tr>
                    <tr>
                      <th scope="row">Passed</th>
                      <td className={styles.num}>{overall.passed}</td>
                      <td className={styles.num}>{formatPercent(overall.passed, overall.total)}</td>
                    </tr>
                    <tr>
                      <th scope="row">Failed</th>
                      <td className={styles.num}>{overall.failed}</td>
                      <td className={styles.num}>{formatPercent(overall.failed, overall.total)}</td>
                    </tr>
                    <tr>
                      <th scope="row">Blocked</th>
                      <td className={styles.num}>{overall.blocked}</td>
                      <td className={styles.num}>{formatPercent(overall.blocked, overall.total)}</td>
                    </tr>
                    <tr>
                      <th scope="row">Not Executed (incl. blank)</th>
                      <td className={styles.num}>{overall.notExecuted}</td>
                      <td className={styles.num}>{formatPercent(overall.notExecuted, overall.total)}</td>
                    </tr>
                    <tr>
                      <th scope="row">N/A</th>
                      <td className={styles.num}>{overall.na}</td>
                      <td className={styles.num}>{formatPercent(overall.na, overall.total)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <caption className={styles.caption}>By Priority</caption>
                  <thead>
                    <tr>
                      <th scope="col">Priority</th>
                      <th scope="col" className={styles.num}>Total</th>
                      <th scope="col" className={styles.num}>Pass</th>
                      <th scope="col" className={styles.num}>Fail</th>
                      <th scope="col" className={styles.num}>Blocked</th>
                      <th scope="col" className={styles.num}>Not Executed</th>
                      <th scope="col" className={styles.num}>N/A</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.byPriority.map((row) => (
                      <CountsRow key={row.priority ?? 'none'} label={row.priority ?? 'Not set'} counts={row} />
                    ))}
                    <CountsRow label="Total" counts={overall} className={styles.totalRow} />
                  </tbody>
                </table>
              </div>
            </div>
            <p className={styles.note}>
              Counts follow the filters above and use each test case&apos;s latest run. N/A = Deprecated test cases.
            </p>
          </>
        )}
      </div>
    </section>
  );
}
