/**
 * Call-type rules: CAD call code -> category / severity / alertable.
 *
 * Ported from the sta03 dispatch monitor's `boxset`, `squadset`, `als2_set` and
 * upgrade sets, then graded for "would an off-duty firefighter/paramedic with a
 * full ALS kit in their car make a difference here?".
 *
 * These are the DEFAULTS. The live source of truth is the `call_type_rules`
 * table (seeded from this list by migrations and editable by admins through the
 * API), so the station can retune without a redeploy. Keep this file and
 * services/api/migrations/0001_init.sql in sync (there is a test for that).
 */
import type { IncidentCategory, Severity } from './index';

export interface CallTypeRule {
  code: string;
  description: string;
  category: IncidentCategory;
  severity: Severity;
  alertable: boolean;
  /** True for codes that represent an upgrade of an existing incident (2nd alarm etc.). */
  upgrade?: boolean;
}

const fire = (code: string, description: string, severity: Severity = 'critical', upgrade = false): CallTypeRule => ({
  code, description, category: 'fire', severity, alertable: true, upgrade,
});
const rescue = (code: string, description: string, severity: Severity = 'critical'): CallTypeRule => ({
  code, description, category: 'rescue', severity, alertable: true,
});
const ems = (code: string, description: string, severity: Severity = 'critical'): CallTypeRule => ({
  code, description, category: 'ems', severity, alertable: true,
});

export const DEFAULT_CALL_TYPE_RULES: CallTypeRule[] = [
  // ---- Structure fires / box alarms (sta03 boxset) --------------------------
  fire('HOUSE', 'House fire'),
  fire('HOUSET', 'House fire, occupants trapped'),
  fire('BLDGFIRE', 'Building fire'),
  fire('BLDGFIRET', 'Building fire, occupants trapped'),
  fire('BLDGFREX', 'Building fire with explosion'),
  fire('BLDGFREXH', 'Building fire with explosion, hazmat'),
  fire('BLDGFRHR', 'High-rise building fire'),
  fire('BLDGFRHRT', 'High-rise building fire, occupants trapped'),
  fire('BLDGFRH', 'Building fire, hazmat'),
  fire('BLDGFRHM', 'Building fire, hazmat'),
  fire('BLDGFRHMT', 'Building fire, hazmat, occupants trapped'),
  fire('BLDGFRSMT', 'Building fire, smoke showing, trapped'),
  fire('BUILDING', 'Building fire'),
  fire('CHIMNEY', 'Chimney fire', 'high'),
  fire('VEHFIRPRK', 'Vehicle fire in parking garage', 'high'),
  fire('VEHFRTRH', 'Vehicle fire, hazmat', 'high'),
  fire('DECKOVER', 'Deck / outside fire threatening structure', 'high'),
  // ---- Upgrades (sta03 upgrade_set / uset) ----------------------------------
  fire('UBOX', 'Box alarm upgrade (working fire)', 'critical', true),
  fire('UBOXHR', 'High-rise box upgrade', 'critical', true),
  fire('UBOXW', 'Box upgrade, working fire', 'critical', true),
  fire('MAFULL', 'Mutual aid full assignment', 'critical', true),
  // ---- Technical rescue / squad (sta03 squadset) ----------------------------
  rescue('PICEXB', 'Collision on expressway / beltway', 'high'),
  rescue('VEHFRTRAP', 'Vehicle fire with entrapment'),
  rescue('FLDVEHT', 'Vehicle in flood water, occupants trapped'),
  rescue('PIC2', 'Collision, ALS-2', 'high'),
  rescue('PICTRAP1', 'Collision with entrapment'),
  rescue('PIC1TRAP', 'Collision with entrapment'),
  rescue('PICTRAP2', 'Collision with entrapment, ALS-2'),
  rescue('PICTRAPF2', 'Collision with entrapment and fire, ALS-2'),
  rescue('PICTRPHM1', 'Collision with entrapment, hazmat'),
  rescue('PICTRPHM2', 'Collision with entrapment, hazmat, ALS-2'),
  rescue('PICTRFHM2', 'Collision, entrapment, fire and hazmat, ALS-2'),
  rescue('PICTRFM2', 'Collision with entrapment and fire, ALS-2'),
  rescue('PICHM2', 'Collision with hazmat, ALS-2', 'high'),
  rescue('PICMULT1', 'Multi-vehicle collision'),
  rescue('PICMULT2', 'Multi-vehicle collision, ALS-2'),
  rescue('METRO', 'Metro rail incident'),
  rescue('METRORESQP', 'Metro rescue, person'),
  rescue('METCRSH', 'Metro crash'),
  rescue('TRAINPED', 'Train vs pedestrian'),
  rescue('TRAINCRSH', 'Train crash'),
  rescue('TRAINFIRE', 'Train fire'),
  rescue('ENTRAP1', 'Entrapment'),
  rescue('ENTRAP2', 'Entrapment, ALS-2'),
  rescue('ENTRAPHM2', 'Entrapment with hazmat, ALS-2'),
  rescue('TRTCOLAPS', 'Structural collapse'),
  rescue('TRTCOLAPW', 'Structural collapse with victims'),
  rescue('TRTCONFIN', 'Confined space rescue'),
  rescue('TRTTECH', 'Technical rescue'),
  rescue('TRTTRENCH', 'Trench rescue'),
  rescue('AIRFULLE', 'Aircraft emergency, full assignment'),
  rescue('AIRCRSHF', 'Aircraft crash with fire'),
  rescue('AIRCRSHFW', 'Aircraft crash with fire, water'),
  rescue('AIRCRSHP', 'Aircraft crash'),
  rescue('AIRFIREL', 'Aircraft fire on landing'),
  // ---- ALS-2 medical (sta03 als2_set) ---------------------------------------
  ems('CPR2', 'Cardiac arrest'),
  ems('CPROD2', 'Cardiac arrest, overdose'),
  ems('CPRSHOT2', 'Cardiac arrest, gunshot'),
  ems('CPRSTAB2', 'Cardiac arrest, stabbing'),
  ems('CPRTRAUM2', 'Cardiac arrest, trauma'),
  ems('CPRDROWN2', 'Cardiac arrest, drowning'),
  ems('CPRHEMM2', 'Cardiac arrest, hemorrhage'),
  ems('CPRHM2', 'Cardiac arrest, hazmat'),
  ems('UCODE', 'Unconscious, possible code'),
  ems('UNCON2', 'Unconscious, ALS-2'),
  ems('DROWN2', 'Drowning'),
  ems('ELECTRO2', 'Electrocution'),
  ems('ELECTROM', 'Electrocution, multiple patients'),
  ems('CHOKING2', 'Choking, ALS-2'),
  ems('ALLERGIC2', 'Allergic reaction, ALS-2', 'high'),
  ems('SHOOTA1', 'Shooting', 'high'),
  ems('SHOOTA2', 'Shooting, ALS-2'),
  ems('SHOTPOL2', 'Shooting, police on scene, ALS-2'),
  ems('SHOTPOLM', 'Shooting, multiple patients'),
  ems('STAB1', 'Stabbing', 'high'),
  ems('STAB2', 'Stabbing, ALS-2'),
  ems('STABPOL2', 'Stabbing, police on scene, ALS-2'),
  ems('STABPOLM', 'Stabbing, multiple patients'),
  ems('TRAUMPOL2', 'Trauma, police on scene, ALS-2'),
  ems('TRAUMPOLM', 'Trauma, multiple patients'),
  ems('BURN2', 'Burns, ALS-2', 'high'),
  ems('BURNADA2', 'Burns, ALS-2', 'high'),
  ems('BURNMPD2', 'Burns, multiple patients', 'high'),
  ems('FALL2', 'Fall, ALS-2', 'high'),
  ems('FALLPOL2', 'Fall, police on scene, ALS-2', 'high'),
  ems('OD2', 'Overdose, ALS-2', 'high'),
  ems('ODINT2', 'Overdose, intentional, ALS-2', 'high'),
  ems('ODPOL2', 'Overdose, police on scene, ALS-2', 'high'),
  ems('TB2', 'Trouble breathing, ALS-2', 'high'),
  ems('TBPOL2', 'Trouble breathing, police on scene, ALS-2', 'high'),
  ems('INJURED2', 'Injured person, ALS-2', 'high'),
  ems('PICPED1', 'Pedestrian struck', 'high'),
  ems('PICCYCLE1', 'Cyclist struck', 'high'),
];

/**
 * Classify a code that has no explicit rule. Conservative: unknown codes are
 * shown on the board but never page anyone.
 */
export function classifyUnknownCode(code: string): Omit<CallTypeRule, 'code' | 'description'> {
  const c = code.toUpperCase();
  let category: IncidentCategory = 'other';
  if (/HAZ|GAS|CO\b|CARBON|SPILL|CHEM/.test(c)) category = 'hazmat';
  else if (/FIRE|BLDG|HOUSE|SMOKE|ALARM|BRUSH|VEHF|APT/.test(c)) category = 'fire';
  else if (/PIC|TRAP|RESQ|COLAP|WATER|TRT|TRAIN|METRO|AIR|ELEV/.test(c)) category = 'rescue';
  else if (/\d$|CPR|MED|SICK|CHEST|STROKE|SEIZ|DIAB|OB\b|PREG|PSYCH|UNCON|BLEED|TB\b|ABD|BACK|HEAD/.test(c)) category = 'ems';
  else if (/SERV|ASSIST|LOCK|INVEST|PUBLIC|WIRES|TREE/.test(c)) category = 'service';
  return { category, severity: 'normal', alertable: false };
}

export const CALL_TYPE_RULES_BY_CODE: ReadonlyMap<string, CallTypeRule> = new Map(
  DEFAULT_CALL_TYPE_RULES.map((r) => [r.code, r]),
);

/** MCFRS box prefix (first-due station) -> city used for geocoding/display. From sta03 runcard_config. */
export const STATION_CITY: Record<string, string> = {
  '01': 'SILVER SPRING', '02': 'TAKOMA PARK', '03': 'ROCKVILLE', '04': 'SANDY SPRING', '05': 'KENSINGTON',
  '06': 'BETHESDA', '07': 'CHEVY CHASE', '08': 'GAITHERSBURG', '09': 'CLARKSBURG', '10': 'BETHESDA',
  '11': 'BETHESDA', '12': 'SILVER SPRING', '13': 'DAMASCUS', '14': 'BEALLSVILLE', '15': 'BURTONSVILLE',
  '16': 'SILVER SPRING', '17': 'LAYTONSVILLE', '18': 'SILVER SPRING', '19': 'SILVER SPRING', '20': 'BETHESDA',
  '21': 'SILVER SPRING', '22': 'GERMANTOWN', '23': 'ROCKVILLE', '24': 'SILVER SPRING', '25': 'SILVER SPRING',
  '26': 'BETHESDA', '27': 'GAITHERSBURG', '28': 'DERWOOD', '29': 'GERMANTOWN', '30': 'POTOMAC',
  '31': 'DARNESTOWN', '32': 'ROCKVILLE', '33': 'POTOMAC', '34': 'GERMANTOWN', '35': 'CLARKSBURG',
  '40': 'OLNEY', '50': 'BETHESDA', '51': 'BETHESDA', '52': 'POTOMAC', '53': 'GAITHERSBURG',
};

/** Box-specific overrides where the station prefix is misleading (from sta03). */
export const BOX_CITY_OVERRIDES: Record<string, string> = {
  '2514': 'ROCKVILLE',
  '2520': 'ASPEN HILL',
  '0807': 'WASHINGTON GROVE',
};

/** MCFRS battalion groupings (from sta03 funcs.is_same_battalion). */
export const STATION_BATTALION: Record<string, string> = Object.fromEntries(
  Object.entries({
    '1': ['01', '02', '12', '15', '16', '19', '24'],
    '2': ['06', '07', '10', '11', '20', '26', '30'],
    '3': ['03', '08', '23', '31', '33', '28', '32'],
    '4': ['04', '05', '18', '21', '25', '40'],
    '5': ['09', '13', '14', '17', '22', '29', '34', '35'],
  }).flatMap(([batt, stations]) => stations.map((s) => [s, batt] as const)),
);

export function cityForBox(box: string | null): string | null {
  if (!box) return null;
  return BOX_CITY_OVERRIDES[box] ?? STATION_CITY[box.slice(0, 2)] ?? null;
}
