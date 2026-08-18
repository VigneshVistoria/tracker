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

  const newValues = ['developer', 'qa', 'executive'];
  for (const value of newValues) {
    try {
      await client.query(`ALTER TYPE users_role_enum ADD VALUE IF NOT EXISTS '${value}'`);
      console.log(`Added enum value: ${value}`);
    } catch (err) {
      console.log(`Skipping ${value}: ${err.message}`);
    }
  }

  const result = await client.query("UPDATE users SET role = 'developer' WHERE role = 'user'");
  console.log(`Migrated ${result.rowCount} user(s) from 'user' to 'developer'.`);

  await client.end();
}

main().catch((err) => {
  console.error('Failed:', err.message);
  process.exit(1);
});
