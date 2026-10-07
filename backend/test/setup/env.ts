import * as fs from 'fs';
import * as path from 'path';
import { TEST_DB, assertTestDatabase } from './test-db-config';

// Runs before any test file loads the app. The app's ConfigModule reads
// backend/.env (production credentials and integrations). Every variable
// named in that file is blanked here first - an existing process.env
// value always wins over the .env file - so the tests can never pick up
// the production database, SendGrid, Teams, Supabase or Anthropic
// settings. Only the throwaway test database is then configured.
const envFile = path.resolve(__dirname, '../../.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/);
    if (m) process.env[m[1]] = '';
  }
}

process.env.NODE_ENV = 'test';
process.env.DB_HOST = TEST_DB.host;
process.env.DB_PORT = String(TEST_DB.port);
process.env.DB_USERNAME = TEST_DB.username;
process.env.DB_PASSWORD = TEST_DB.password;
process.env.DB_NAME = TEST_DB.database;
process.env.JWT_SECRET = 'test-only-secret';
process.env.JWT_EXPIRES_IN = '1h';

assertTestDatabase({ host: process.env.DB_HOST, port: process.env.DB_PORT, database: process.env.DB_NAME });
