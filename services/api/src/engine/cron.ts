import type { Env } from '../env';
import { db } from '../lib/db';
import { getExpoReceipts } from '../lib/push';

/** Check Expo push receipts for alerts sent 15 minutes to 24 hours ago. */
export async function checkReceipts(env: Env): Promise<{ checked: number; ok: number; errors: number }> {
  const sql = db(env);
  const pending = (await sql`
    SELECT id, expo_ticket_id, device_id FROM alerts
    WHERE receipt_status = 'pending' AND expo_ticket_id IS NOT NULL
      AND sent_at BETWEEN now() - interval '24 hours' AND now() - interval '15 minutes'
    ORDER BY sent_at LIMIT 1000`) as Array<{ id: string; expo_ticket_id: string; device_id: string }>;
  const out = { checked: pending.length, ok: 0, errors: 0 };
  if (!pending.length) return out;
  const receipts = await getExpoReceipts(env, pending.map((p) => p.expo_ticket_id));
  for (const p of pending) {
    const r = receipts[p.expo_ticket_id];
    if (!r) continue;
    if (r.status === 'ok') {
      await sql`UPDATE alerts SET receipt_status = 'ok' WHERE id = ${p.id}`;
      out.ok++;
    } else {
      const code = r.details?.error ?? 'error';
      await sql`UPDATE alerts SET receipt_status = 'error', receipt_error = ${`${code}: ${r.message ?? ''}`} WHERE id = ${p.id}`;
      if (code === 'DeviceNotRegistered') {
        await sql`UPDATE devices SET push_enabled = false, disabled_reason = 'DeviceNotRegistered' WHERE id = ${p.device_id}`;
      }
      out.errors++;
    }
  }
  return out;
}

/** Safety net: an incident that has not been seen for 6 hours is closed even if the feed died mid-incident. */
export async function closeStaleIncidents(env: Env): Promise<number> {
  const sql = db(env);
  const rows = (await sql`
    UPDATE incidents SET status = 'cleared', cleared_at = now()
    WHERE status = 'active' AND last_seen_at < now() - interval '6 hours'
    RETURNING id`) as Array<{ id: string }>;
  for (const r of rows) {
    await sql`INSERT INTO incident_events (incident_id, kind, data) VALUES (${r.id}, 'cleared', '{"reason":"stale"}'::jsonb)`;
  }
  return rows.length;
}

/** Drop precise location history for devices that have been silent for 30 days (privacy hygiene). */
export async function pruneLocations(env: Env): Promise<number> {
  const sql = db(env);
  const rows = (await sql`DELETE FROM device_locations WHERE recorded_at < now() - interval '30 days' RETURNING device_id`) as unknown[];
  return rows.length;
}

export async function runCron(env: Env): Promise<void> {
  const [receipts, stale, pruned] = await Promise.all([
    checkReceipts(env).catch((e) => ({ error: (e as Error).message })),
    closeStaleIncidents(env).catch((e) => ({ error: (e as Error).message })),
    pruneLocations(env).catch((e) => ({ error: (e as Error).message })),
  ]);
  console.log('cron', JSON.stringify({ receipts, stale, pruned }));
}
