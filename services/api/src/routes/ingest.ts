import { Hono, type Context } from 'hono';
import { requireIngestAuth, type AppEnv } from '../lib/auth';
import { IngestError, ingestFsas } from '../engine/ingest';

export const ingestRoutes = new Hono<AppEnv>();

async function handle(c: Context<AppEnv>, plain: boolean) {
  const tsHeader = c.req.header('x-feed-ts');
  const ts = tsHeader == null ? null : Number(tsHeader);
  if (tsHeader != null && !Number.isFinite(ts)) return c.text('bad X-Feed-Ts', 400);
  const html = await c.req.text();
  if (!html.trim()) return c.text('empty body', 400);
  try {
    const result = await ingestFsas(c.env, html, ts);
    return plain ? c.text('ok') : c.json(result);
  } catch (err) {
    if (err instanceof IngestError) return plain ? c.text(err.message, err.status as 400) : c.json({ error: err.message }, err.status as 400);
    console.error('ingest failed', err);
    return plain ? c.text('ingest failed', 500) : c.json({ error: 'ingest failed' }, 500);
  }
}

/** Drop-in for the station Pi: identical contract to sta03-dashboard's /push. */
ingestRoutes.post('/push', requireIngestAuth, (c) => handle(c, true));
/** Same thing, JSON response, versioned path. */
ingestRoutes.post('/v1/ingest/fsas', requireIngestAuth, (c) => handle(c, false));
