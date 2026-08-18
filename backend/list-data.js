require('dotenv').config();
const { Client } = require('pg');

async function main() {
  const client = new Client({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT || 5432,
    user: process.env.DB_USERNAME,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  console.log('--- PROJECTS ---');
  const projects = await client.query('SELECT id, name FROM projects ORDER BY id');
  projects.rows.forEach((p) => console.log(`#${p.id}  ${p.name}`));

  console.log('');
  console.log('--- ISSUES ---');
  const issues = await client.query('SELECT id, title, status, "projectId", "assigneeEmail" FROM issues ORDER BY id');
  issues.rows.forEach((i) => console.log(`#${i.id}  [${i.status}]  ${i.title}  (project ${i.projectId}, assignee ${i.assigneeEmail || 'none'})`));

  await client.end();
}

main().catch((err) => {
  console.error('Failed:', err.message);
  process.exit(1);
});
