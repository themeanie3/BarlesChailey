/**
 * Apply services/api/migrations/*.sql to the database in DATABASE_URL.
 *
 *   DATABASE_URL=postgresql://... npm run migrate -w @barleschailey/api
 *
 * Statements are separated by lines containing only "-- @@". Applied files are
 * recorded in schema_migrations so re-running is safe.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { neon } from '@neondatabase/serverless';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}
const sql = neon(url);
const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

export function splitStatements(text: string): string[] {
  return text
    .split(/^\s*-- @@\s*$/m)
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk.split('\n').some((line) => line.trim() && !line.trim().startsWith('--')));
}

await sql`CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`;
const applied = new Set(((await sql`SELECT name FROM schema_migrations`) as Array<{ name: string }>).map((r) => r.name));

for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
  if (applied.has(file)) {
    console.log(`skip  ${file}`);
    continue;
  }
  const statements = splitStatements(readFileSync(join(dir, file), 'utf8'));
  console.log(`apply ${file} (${statements.length} statements)`);
  for (const stmt of statements) await sql.query(stmt);
  await sql`INSERT INTO schema_migrations (name) VALUES (${file})`;
}
console.log('done');
