import { execFileSync } from 'child_process';
import * as path from 'path';
import { buildTestSchema } from './schema';
import './env';

export default async function globalSetup() {
  execFileSync(path.resolve(__dirname, '../../scripts/test-db.sh'), ['start'], { stdio: 'inherit' });
  await buildTestSchema();
}
