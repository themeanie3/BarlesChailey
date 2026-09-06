import type { Env } from '../env';
import { board } from '../env';
import { hasTable } from './parse-fsas';

export { unitsDelta } from './diff';

export class IngestError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

export interface IngestResult {
  rows: number;
  created: number;
  updated: number;
  reopened: number;
  cleared: number;
  alertsQueued: number;
}

/**
 * Ingest one FSAS table snapshot. The whole diff, geocode and alert fan-out
 * happen inside the BoardState Durable Object; Postgres is not on this path.
 */
export async function ingestFsas(env: Env, html: string, feedTs: number | null): Promise<IngestResult> {
  if (!hasTable(html)) throw new IngestError('body does not contain an HTML table');
  return board(env).ingest(html, feedTs);
}
