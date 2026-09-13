#!/usr/bin/env node
// One-time backfill for project_tasks.title (2026-09-task-title.sql adds
// the column nullable; this fills every existing row; 2026-09-task-title-
// not-null.sql then locks it to NOT NULL). Safe to re-run - only ever
// touches rows where title IS NULL.
//
// Mirrors the exact rule documented in
// src/tasks/generate-title-from-description.ts (kept here as a plain
// standalone script, not imported from the compiled app, since this
// repo's other one-time data scripts are plain SQL/JS run directly
// against the DB rather than through the Nest app - see backend/scripts/).
'use strict';

const { Client } = require('pg');

const TASK_TITLE_MAX_LENGTH = 150;

function generateTitleFromDescription(description) {
  const headingMatch = description.match(/<h2[^>]*>(.*?)<\/h2>/is);
  const source = headingMatch ? headingMatch[1] : description;

  const plain = source
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');

  const firstLine = plain
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.length > 0);

  if (!firstLine) return 'Untitled task';

  if (firstLine.length <= TASK_TITLE_MAX_LENGTH) return firstLine;
  const cut = firstLine.slice(0, TASK_TITLE_MAX_LENGTH);
  const lastSpace = cut.lastIndexOf(' ');
  const trimmed = lastSpace > 0 ? cut.slice(0, lastSpace) : cut;
  return `${trimmed}…`;
}

async function main() {
  const client = new Client({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 5432),
    user: process.env.DB_USERNAME,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  const { rows } = await client.query('SELECT id, description FROM project_tasks WHERE title IS NULL');
  console.log(`Backfilling title for ${rows.length} task(s)...`);

  for (const row of rows) {
    const title = generateTitleFromDescription(row.description || '');
    await client.query('UPDATE project_tasks SET title = $1 WHERE id = $2', [title, row.id]);
    console.log(`  #${row.id}: ${title}`);
  }

  const { rows: remaining } = await client.query('SELECT count(*)::int AS count FROM project_tasks WHERE title IS NULL');
  console.log(`Done. Remaining NULL titles: ${remaining[0].count}`);

  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
