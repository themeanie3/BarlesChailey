# Call types: how calls are graded

Every incident on the board carries a **category** (fire, rescue, ems, hazmat, service, other)
and a **severity** (critical, high, normal, low). Only `alertable` codes can page anyone; a
member's preferences then decide (radius, categories, minimum severity, quiet hours).

## Where the list comes from

1. **MCFRS Response Plans, section 1** (`packages/feed/data/mcfrs_response_plans_section1.tsv`,
   extracted from the PDF). Each CAD `IncType` maps to a dispatch priority (1 = most urgent) and
   a response plan id. The plan is what tells you how serious the county thinks the call is:

   | Response plan | Meaning | Grade |
   |---|---|---|
   | `FJ`, `FK`, `FJ6`, `HMFULL*`, `DECKOVER*` | full assignment (5 engines, 2 trucks, squad) | fire · critical |
   | `GASFULL` | natural-gas full assignment with hazmat | hazmat · critical |
   | `TRC`, `TRAT`, `RES`, `TECHWTR`, `PMCI`, `AUTOFREX` | train, technical rescue, multi-patient collision, vehicle fire with entrapment | rescue · critical |
   | any code containing `TRAP`/`TRP`/`ENTRAP` | someone is pinned | critical |
   | `ALS2EMSDO`, `HMEMSDO`, `ADA` | cardiac arrests, burns with fire response | ems · critical |
   | `ALS2`, `AL2D`, `PA2`, `MLTP` at priority ≤ 2 | two-paramedic dispatch | ems/rescue · high (life-threat codes: critical) |
   | `FH`, `FHW`, `BRUSHLG*` | 3-engine building fire, large brush fire | fire · high |
   | `FDMULTP` at priority ≤ 3 | fire response with multiple patients | high |
   | `ALS1`, `AL1D`, `PA1`, `PHM` at priority 3 | single paramedic | normal (pedestrian/cyclist struck, shootings, stabbings, drownings, electrocutions: high) |
   | adaptive fires `FE/FF/FG/FC/FX/FADA`, hazmat adaptive/local/investigation, single engine `SE` | routine fire/hazmat | normal |
   | `BLS*`, service calls `SC*`, priority ≥ 6 | BLS and routine | low |

2. **Codes the sta03 monitor has seen on the live board** that section 1 does not list
   (Metro incidents, `UBOX*`/`MAFULL` upgrades, `UCODE`, `SHOOTA*`, `STAB*`, `PICTRAP2`, …) keep
   the grading from the original `boxset` / `squadset` / `als2_set`.

3. **Hand overrides** in `packages/feed/scripts/gen_call_types.py` (`OVERRIDES`, `CRITICAL_EMS`,
   `HIGH_ALS1`): e.g. `CHIMNEY` receives a full assignment but is graded high; interfacility
   transfers and psychiatric ALS2 never page; `PICTRFHM2` is critical even though its plan is `PHM`.

## Changing a grade

* **Live, no deploy:** admins `PUT /v1/admin/call-types/HOUSE {"severity":"high"}`; the Worker
  updates Postgres and the Durable Object's copy immediately.
* **Permanently:** edit the override tables in `gen_call_types.py`, then

  ```bash
  python3 packages/feed/scripts/gen_call_types.py        # -> packages/feed/data/call-type-rules.json
  python3 packages/feed/scripts/write_call_types.py 0003_call_types_<reason>.sql
  npm run api:test                                       # rules-parity.test.ts keeps TS and SQL identical
  DATABASE_URL=… npm run migrate -w @barleschailey/api   # each Neon branch
  ```

  A new response-plan PDF: extract the `IncType | priority | response id` rows into the TSV
  (see the parser in git history of this file) and rerun both scripts.

## Current numbers

390 codes, 148 alertable: 46 fire, 34 rescue, 54 ems, 10 hazmat, 7 multi-patient service calls
(wires down / transformer / electrical with several patients). Unknown codes that appear on the
board are categorised by keyword (`classifyUnknownCode`) and never page.
