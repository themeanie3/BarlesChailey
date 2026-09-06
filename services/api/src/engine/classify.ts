import {
  classifyUnknownCode,
  DEFAULT_CALL_TYPE_RULES,
  STATION_BATTALION,
  cityForBox,
  type IncidentCategory,
  type Severity,
} from '@barleschailey/feed';
import type { Sql } from '../lib/db';

export interface Rule {
  code: string;
  description: string;
  category: IncidentCategory;
  severity: Severity;
  alertable: boolean;
  isUpgrade: boolean;
}

export type RuleMap = ReadonlyMap<string, Rule>;

export const DEFAULT_RULES: RuleMap = new Map(
  DEFAULT_CALL_TYPE_RULES.map((r) => [r.code, { ...r, isUpgrade: r.upgrade ?? false }]),
);

let cache: { at: number; rules: RuleMap } | null = null;
const CACHE_MS = 60_000;

/** Rules from the database, cached per isolate for a minute; defaults if the table is empty. */
export async function loadRules(sql: Sql): Promise<RuleMap> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.rules;
  const rows = (await sql`SELECT code, description, category, severity, alertable, is_upgrade FROM call_type_rules`) as Array<{
    code: string; description: string; category: IncidentCategory; severity: Severity; alertable: boolean; is_upgrade: boolean;
  }>;
  const rules: RuleMap = rows.length
    ? new Map(rows.map((r) => [r.code, { ...r, isUpgrade: r.is_upgrade }]))
    : DEFAULT_RULES;
  cache = { at: Date.now(), rules };
  return rules;
}

export function invalidateRuleCache(): void {
  cache = null;
}

export interface Classification {
  category: IncidentCategory;
  severity: Severity;
  alertable: boolean;
  isUpgrade: boolean;
}

export function classify(code: string, rules: RuleMap = DEFAULT_RULES): Classification {
  const rule = rules.get(code.toUpperCase());
  if (rule) return { category: rule.category, severity: rule.severity, alertable: rule.alertable, isUpgrade: rule.isUpgrade };
  return { ...classifyUnknownCode(code), isUpgrade: false };
}

export function stationForBox(box: string | null): string | null {
  return box && /^\d{4}$/.test(box) ? box.slice(0, 2) : null;
}

export function battalionForStation(station: string | null): string | null {
  return station ? STATION_BATTALION[station] ?? null : null;
}

export { cityForBox };
