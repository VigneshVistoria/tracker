import { execFileSync } from 'child_process';
import * as path from 'path';

// Stops the throwaway database after the run (KEEP_TEST_DB=1 leaves it
// running for debugging).
export default async function globalTeardown() {
  if (process.env.KEEP_TEST_DB === '1') return;
  execFileSync(path.resolve(__dirname, '../../scripts/test-db.sh'), ['stop'], { stdio: 'inherit' });
}
