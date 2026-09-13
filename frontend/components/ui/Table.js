import { Fragment, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import styles from './Table.module.css';

// Dense, sortable data table for ERP-heavy screens. Uncontrolled sort by
// default (pass sortKey/onSortChange to control it from the parent
// instead, e.g. when sorting needs to hit the server).
export default function Table({
  columns,
  rows,
  getRowId = (row) => row.id,
  onRowClick,
  rowClassName,
  sortKey: controlledSortKey,
  sortDir: controlledSortDir,
  onSortChange,
  emptyState,
  dense = true,
  bodyVerticalAlign,
  // Optional, additive - undefined for every existing caller (My Tasks,
  // QA Review, Task Detail, design-preview), so their rendering is
  // unchanged. When given, called per row; a non-null/false return value
  // renders as a full-width row directly underneath (Team Tasks' own
  // dependency-tree expansion - the toggle affordance itself lives in
  // that caller's own column render(), not here, so Table doesn't need to
  // know anything about expand/collapse state).
  expandedContent,
}) {
  const [internalSort, setInternalSort] = useState({ key: null, dir: 'asc' });
  const sortKey = controlledSortKey !== undefined ? controlledSortKey : internalSort.key;
  const sortDir = controlledSortDir !== undefined ? controlledSortDir : internalSort.dir;

  const handleSort = (col) => {
    if (!col.sortable) return;
    const nextDir = sortKey === col.key && sortDir === 'asc' ? 'desc' : 'asc';
    if (onSortChange) {
      onSortChange(col.key, nextDir);
    } else {
      setInternalSort({ key: col.key, dir: nextDir });
    }
  };

  const sortedRows = useMemo(() => {
    if (onSortChange || !sortKey) return rows;
    const col = columns.find((c) => c.key === sortKey);
    if (!col) return rows;
    const accessor = col.sortAccessor || ((row) => row[col.key]);
    const sorted = [...rows].sort((a, b) => {
      const av = accessor(a);
      const bv = accessor(b);
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === 'number' && typeof bv === 'number') return av - bv;
      return String(av).localeCompare(String(bv));
    });
    return sortDir === 'desc' ? sorted.reverse() : sorted;
  }, [rows, sortKey, sortDir, columns, onSortChange]);

  return (
    <div className={styles.wrap}>
      <table className={`${styles.table} ${dense ? styles.dense : ''}`}>
        <thead>
          <tr>
            {columns.map((col) => (
              <th
                key={col.key}
                style={{ width: col.width, textAlign: col.align || 'left' }}
                className={col.sortable ? styles.sortableHeader : ''}
                aria-sort={sortKey === col.key ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
              >
                {col.sortable ? (
                  <button type="button" className={styles.sortButton} onClick={() => handleSort(col)}>
                    {col.header}
                    {sortKey === col.key ? (
                      sortDir === 'asc' ? <ArrowUp size={13} aria-hidden="true" /> : <ArrowDown size={13} aria-hidden="true" />
                    ) : (
                      <ArrowUpDown size={13} className={styles.sortIdle} aria-hidden="true" />
                    )}
                  </button>
                ) : (
                  col.header
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sortedRows.length === 0 && (
            <tr>
              <td colSpan={columns.length} className={styles.emptyCell}>
                {emptyState || 'No records found.'}
              </td>
            </tr>
          )}
          {sortedRows.map((row) => {
            const expanded = expandedContent ? expandedContent(row) : null;
            return (
              <Fragment key={getRowId(row)}>
                <tr
                  className={[onRowClick ? styles.clickableRow : '', rowClassName ? rowClassName(row) : '']
                    .filter(Boolean)
                    .join(' ')}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                >
                  {columns.map((col) => (
                    <td key={col.key} style={{ textAlign: col.align || 'left', verticalAlign: bodyVerticalAlign }}>
                      {col.render ? col.render(row) : row[col.key]}
                    </td>
                  ))}
                </tr>
                {expanded && (
                  <tr className={styles.expandedRow}>
                    <td colSpan={columns.length} className={styles.expandedCell}>
                      {expanded}
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
