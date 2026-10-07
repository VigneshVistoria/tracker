import * as fs from 'fs';
import * as path from 'path';
import { DataSource } from 'typeorm';
import { TEST_DB, assertTestDatabase } from './test-db-config';

const SRC = path.resolve(__dirname, '../../src');
const MIGRATION = path.resolve(__dirname, '../../migrations/2026-10-client-portal-foundation.sql');
const PORTAL_DIR = path.join(SRC, 'client-portal');

function entityFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = path.join(dir, d.name);
    if (d.isDirectory()) return entityFiles(p);
    return d.name.endsWith('.entity.ts') ? [p] : [];
  });
}

function dataSource(entities: string[]) {
  const options = { type: 'postgres' as const, ...TEST_DB, ssl: { rejectUnauthorized: false }, entities };
  assertTestDatabase(options);
  return new DataSource(options);
}

// Builds the test schema the way production got it: every existing table
// from its entity, then the client portal tables from THE REAL MIGRATION
// FILE (not from the entities), then checks the migration matches the
// portal entities column for column - so the migration itself is tested.
export async function buildTestSchema() {
  const all = entityFiles(SRC);
  const existing = all.filter((f) => !f.startsWith(PORTAL_DIR));
  const portal = all.filter((f) => f.startsWith(PORTAL_DIR));

  const base = dataSource(existing);
  await base.initialize();
  await base.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await base.synchronize();
  await base.query(fs.readFileSync(MIGRATION, 'utf8'));
  await base.destroy();

  const check = dataSource(all);
  await check.initialize();
  const problems: string[] = [];
  const portalTables = ['clients', 'client_users', 'client_team_members', 'client_tickets', 'client_requests'];
  const portalMetas = check.entityMetadatas.filter((m) => portalTables.includes(m.tableName));
  if (portalMetas.length !== portalTables.length || portal.length !== portalTables.length) {
    problems.push(`expected ${portalTables.length} portal entities, found ${portalMetas.length} (${portal.length} files)`);
  }
  for (const meta of portalMetas) {
    const cols: Array<{ column_name: string; is_nullable: string; data_type: string; character_maximum_length: number | null }> =
      await check.query(
        `select column_name, is_nullable, data_type, character_maximum_length from information_schema.columns
         where table_schema = 'public' and table_name = $1`,
        [meta.tableName],
      );
    if (cols.length === 0) {
      problems.push(`${meta.tableName}: table missing`);
      continue;
    }
    const byName = new Map(cols.map((c) => [c.column_name, c]));
    for (const col of meta.columns) {
      const db = byName.get(col.databaseName);
      if (!db) {
        problems.push(`${meta.tableName}.${col.databaseName}: in entity, missing from migration`);
        continue;
      }
      byName.delete(col.databaseName);
      if ((db.is_nullable === 'YES') !== col.isNullable) {
        problems.push(`${meta.tableName}.${col.databaseName}: nullable mismatch (entity ${col.isNullable}, db ${db.is_nullable})`);
      }
      const expected = check.driver.normalizeType(col);
      const dbType = db.data_type;
      if (expected !== dbType) problems.push(`${meta.tableName}.${col.databaseName}: type mismatch (entity ${expected}, db ${dbType})`);
      if (col.length && Number(col.length) !== Number(db.character_maximum_length)) {
        problems.push(`${meta.tableName}.${col.databaseName}: length mismatch (entity ${col.length}, db ${db.character_maximum_length})`);
      }
    }
    for (const extra of byName.keys()) problems.push(`${meta.tableName}.${extra}: in migration, missing from entity`);
  }
  await check.destroy();
  if (problems.length) throw new Error(`Client portal migration does not match the entities:\n  ${problems.join('\n  ')}`);
}
