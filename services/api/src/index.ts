import { Hono } from 'hono';
import { cors } from 'hono/cors';
import openapi from '../../../packages/feed/openapi.yaml';
import type { Env } from './env';
import { listVar } from './env';
import { withDb, type AppEnv } from './lib/auth';
import { runCron } from './engine/cron';
import { adminRoutes } from './routes/admin';
import { deviceRoutes } from './routes/devices';
import { feedRoutes } from './routes/feed';
import { ingestRoutes } from './routes/ingest';
import { meRoutes } from './routes/me';

export const app = new Hono<AppEnv>();

app.use('*', async (c, next) => {
  const allowed = listVar(c.env.CORS_ORIGINS);
  return cors({
    origin: (origin) => (allowed.includes(origin) ? origin : ''),
    allowHeaders: ['authorization', 'content-type', 'x-api-key'],
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    maxAge: 600,
  })(c, next);
});
app.use('*', async (c, next) => {
  await next();
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('Cache-Control', c.res.headers.get('Cache-Control') ?? 'no-store');
});
app.use('*', withDb);

app.get('/healthz', (c) => c.json({ ok: true, env: c.env.APP_ENV, time: new Date().toISOString() }));
app.get('/v1/openapi.yaml', (c) => c.text(openapi, 200, { 'content-type': 'application/yaml; charset=utf-8', 'cache-control': 'public, max-age=300' }));

app.route('/', ingestRoutes);
app.route('/v1', feedRoutes);
app.route('/v1', meRoutes);
app.route('/v1', deviceRoutes);
app.route('/v1/admin', adminRoutes);

app.notFound((c) => c.json({ error: 'not found' }, 404));
app.onError((err, c) => {
  console.error('unhandled', err);
  return c.json({ error: 'internal error' }, 500);
});

export default {
  fetch: app.fetch,
  scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(runCron(env));
  },
};
