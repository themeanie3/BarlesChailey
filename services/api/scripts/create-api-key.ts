/**
 * Mint an API key for a server-side consumer (e.g. the station dashboard).
 *
 *   DATABASE_URL=... API_KEY_PEPPER=... npm run create-api-key -w @barleschailey/api -- "sta03 dashboard" read:feed,ingest
 *
 * Prints the plaintext key once. Only its hash is stored.
 */
import { neon } from '@neondatabase/serverless';
import { hashApiKey, randomToken } from '../src/lib/crypto.ts';

const [name, scopesArg] = process.argv.slice(2);
const url = process.env.DATABASE_URL;
const pepper = process.env.API_KEY_PEPPER;
if (!name || !scopesArg || !url || !pepper) {
  console.error('usage: DATABASE_URL=... API_KEY_PEPPER=... create-api-key <name> <scope,scope>');
  process.exit(1);
}
const scopes = scopesArg.split(',').map((s) => s.trim()).filter(Boolean);
for (const s of scopes) if (!['read:feed', 'ingest'].includes(s)) throw new Error(`unknown scope ${s}`);
const key = `bck_${randomToken(24)}`;
const sql = neon(url);
const [row] = (await sql`INSERT INTO api_keys (name, key_hash, scopes) VALUES (${name}, ${await hashApiKey(pepper, key)}, ${scopes}::text[]) RETURNING id`) as Array<{ id: string }>;
console.log(`id:  ${row!.id}\nkey: ${key}\n\nStore it now; it cannot be recovered.`);
