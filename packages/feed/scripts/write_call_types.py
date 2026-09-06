"""Step 2 of 2: emit packages/feed/src/call-types.ts (DEFAULT_CALL_TYPE_RULES) and the SQL seed migration
from packages/feed/data/call-type-rules.json produced by gen_call_types.py.
Usage: python3 packages/feed/scripts/write_call_types.py [migration-file-name]
"""
import json, os, sys
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
rules = json.load(open(os.path.join(ROOT, 'packages/feed/data/call-type-rules.json')))
ts_path = os.path.join(ROOT, 'packages/feed/src/call-types.ts')
ts = open(ts_path).read()
tail = ts[ts.index('/**\n * Classify a code that has no explicit rule.'):]
head = ts[:ts.index('export const DEFAULT_CALL_TYPE_RULES')] + 'export const DEFAULT_CALL_TYPE_RULES: CallTypeRule[] = [\n'
lines = []
cur = None
for x in rules:
    key = (x['category'], x['severity'])
    if key != cur:
        lines.append(f"  // ---- {x['category']} / {x['severity']} ----")
        cur = key
    d = x['description'].replace("'", "\\'")
    lines.append(f"  r('{x['code']}', '{d}', '{x['category']}', '{x['severity']}', {'true' if x['alertable'] else 'false'}{', true' if x['upgrade'] else ''}),")
open(ts_path, 'w').write(head + '\n'.join(lines) + '\n];\n\n' + tail)
mig = sys.argv[1] if len(sys.argv) > 1 else '0002_call_types_response_plans.sql'
sql = ["-- Call-type rules regenerated from the MCFRS Response Plans (section 1) merged with sta03's observed codes.",
       "-- Upserts every default so existing branches pick up new codes and regraded severities; admin edits to",
       "-- codes not in this list are untouched.",
       "-- @@",
       "INSERT INTO call_type_rules (code, description, category, severity, alertable, is_upgrade) VALUES"]
vals = []
for x in rules:
    d = x['description'].replace("'", "''")
    vals.append(f"  ('{x['code']}','{d}','{x['category']}','{x['severity']}',{'true' if x['alertable'] else 'false'},{'true' if x['upgrade'] else 'false'})")
sql.append(',\n'.join(vals))
sql.append("ON CONFLICT (code) DO UPDATE SET description = EXCLUDED.description, category = EXCLUDED.category, severity = EXCLUDED.severity,\n  alertable = EXCLUDED.alertable, is_upgrade = EXCLUDED.is_upgrade, updated_at = now();")
open(os.path.join(ROOT, 'services/api/migrations', mig), 'w').write('\n'.join(sql) + '\n')
print('rules', len(rules), 'alertable', sum(x['alertable'] for x in rules))
