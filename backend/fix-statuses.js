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

  const newValues = ['Backlog', 'In Review', 'Completed'];
  for (const value of newValues) {
    try {
      await client.query(`ALTER TYPE issues_status_enum ADD VALUE IF NOT EXISTS '${value}'`);
      console.log(`Added enum value: ${value}`);
    } catch (err) {
      console.log(`Skipping ${value}: ${err.message}`);
    }
  }

  const mapping = [
    "UPDATE issues SET status = 'Backlog' WHERE status = 'Open'",
    "UPDATE issues SET status = 'In Review' WHERE status = 'Client Review'",
    "UPDATE issues SET status = 'Completed' WHERE status = 'Closed'",
  ];

  for (const sql of mapping) {
    const result = await client.query(sql);
    console.log(sql, '->', result.rowCount, 'row(s) updated');
  }

  await client.end();
  console.log('Done.');
}

main().catch((err) => {
  console.error('Failed:', err.message);
  process.exit(1);
});
