import type { Env } from '../env';
import { board } from '../env';

/**
 * Watchdog. The Durable Object's alarm normally drives flushes, receipt checks
 * and pruning; this cron only makes sure the alarm is still armed (for example
 * after a deploy that reset the object) and reports the board status to logs.
 */
export async function runCron(env: Env): Promise<void> {
  try {
    const status = await board(env).ensureAlarm();
    console.log('cron watchdog', JSON.stringify(status));
  } catch (err) {
    console.error('cron watchdog failed', (err as Error).message);
  }
}
