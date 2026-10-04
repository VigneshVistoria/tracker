#!/usr/bin/env node
// One-time backfill for task_dependency_tickets.title (2026-10-task-
// dependency-ticket-title.sql adds the column nullable; this fills every
// existing row; 2026-10-task-dependency-ticket-title-not-null.sql then
// locks it to NOT NULL). Same shape as backfill-task-titles.js.
//
// Dry run by default - prints the title it would generate for every
// ticket and writes nothing (works even before the column exists, so the
// titles can be reviewed first). Pass --apply to actually write. Safe to
// re-run - --apply only ever touches rows where title IS NULL.
//
// Rule: first meaningful line of the description (ticket descriptions are
// plain text, not rich text like task descriptions) - see
// BARE_LIST_MARKER/SALUTATION below. Over
// TASK_DEPENDENCY_TICKET_TITLE_MAX_LENGTH, cut at the end of the first
// sentence if one fits, otherwise at the last word boundary, plus "…".
'use strict';

const { Client } = require('pg');

// Mirrors src/task-dependency-tickets/task-dependency-ticket-title.constants.ts.
const TASK_DEPENDENCY_TICKET_TITLE_MAX_LENGTH = 100;

// Lines that carry no meaning on their own as a title - a bare list
// number ("1.") or a salutation ("AOA Hamza,", "Hi Salman,") - are
// skipped in favor of the next line.
const BARE_LIST_MARKER = /^\d+[.,)]?$/;
const SALUTATION = /^(hi|hello|hey|dear|aoa|salam|assalam\w*)\b[^.?!]{0,30}[,!]?$/i;

function generateTitleFromDescription(description) {
  const firstLine = description
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter((line) => line.length > 0 && !BARE_LIST_MARKER.test(line) && !SALUTATION.test(line))
    .map((line) => line.replace(/^\d+[.)]\s+/, ''))
    .find((line) => line.length > 0);

  if (!firstLine) return 'Untitled dependency';
  if (firstLine.length <= TASK_DEPENDENCY_TICKET_TITLE_MAX_LENGTH) return firstLine;

  const cut = firstLine.slice(0, TASK_DEPENDENCY_TICKET_TITLE_MAX_LENGTH);
  const sentenceEnd = cut.search(/[.?!](\s|$)/);
  if (sentenceEnd > 0) return cut.slice(0, sentenceEnd + 1);
  const lastSpace = cut.lastIndexOf(' ');
  const trimmed = (lastSpace > 0 ? cut.slice(0, lastSpace) : cut.slice(0, -1)).replace(/[\s,;:–-]+$/, '');
  return `${trimmed}…`;
}

async function main() {
  const apply = process.argv.includes('--apply');
  const client = new Client({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 5432),
    user: process.env.DB_USERNAME,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  const { rows: cols } = await client.query(
    "SELECT 1 FROM information_schema.columns WHERE table_name = 'task_dependency_tickets' AND column_name = 'title'",
  );
  const hasColumn = cols.length > 0;
  if (apply && !hasColumn) {
    throw new Error('task_dependency_tickets.title does not exist yet - run 2026-10-task-dependency-ticket-title.sql first.');
  }

  const { rows } = await client.query(
    hasColumn
      ? 'SELECT id, description FROM task_dependency_tickets WHERE title IS NULL ORDER BY id'
      : 'SELECT id, description FROM task_dependency_tickets ORDER BY id',
  );
  console.log(`${apply ? 'Backfilling' : 'DRY RUN - would backfill'} title for ${rows.length} ticket(s)...`);

  for (const row of rows) {
    const title = generateTitleFromDescription(row.description || '');
    if (apply) {
      await client.query('UPDATE task_dependency_tickets SET title = $1 WHERE id = $2 AND title IS NULL', [title, row.id]);
    }
    console.log(`  #${row.id} (${title.length}): ${title}`);
  }

  if (apply) {
    const { rows: remaining } = await client.query('SELECT count(*)::int AS count FROM task_dependency_tickets WHERE title IS NULL');
    console.log(`Done. Remaining NULL titles: ${remaining[0].count}`);
  } else {
    console.log('Dry run only - nothing written. Re-run with --apply to write.');
  }

  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
