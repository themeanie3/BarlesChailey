"""Generate the merged MCFRS call-type rule table (step 1 of 2; see write_call_types.py) from:
  1. the MCFRS Response Plans (section 1) PDF: IncType -> dispatch priority + response plan id
  2. the sta03-derived defaults already in the repo (codes seen on the live board that section 1 omits)
Outputs packages/feed/data/call-type-rules.json. Run write_call_types.py afterwards to emit the TS defaults and SQL seed.
Usage: python3 packages/feed/scripts/gen_call_types.py [inctypes.tsv] [out.json]
"""
import re, json, collections, sys

import os
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
TSV = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, 'packages/feed/data/mcfrs_response_plans_section1.tsv')
rows = collections.OrderedDict()
for line in open(TSV):
    code, pri, rid, n, plan = line.rstrip('\n').split('\t')
    if code not in rows:  # first row = most common determinant mapping
        rows[code] = (int(pri) if pri.isdigit() else 3, rid, plan)

# ---------------------------------------------------------------- descriptions
BASE = {
 'ABDPN':'Abdominal pain','AIRALERT':'Aircraft alert','AIRBORNR':'Aircraft, airborne emergency (routine)','AIRCRSHF':'Aircraft crash with fire',
 'AIRCRSHFW':'Aircraft crash with fire, water','AIRCRSHP':'Aircraft crash','AIRCRSHPW':'Aircraft crash in water','AIRFIREL':'Aircraft fire, large',
 'AIRFIRES':'Aircraft fire, small','AIRFULLE':'Aircraft emergency, full assignment','AIRINVSTR':'Aircraft investigation (routine)','AIRMINRE':'Aircraft minor emergency',
 'ALLERGIC':'Allergic reaction','ALRMAFA':'Automatic fire alarm','ALRMAFAR':'Automatic fire alarm (routine)','ALRMAMA':'Automatic medical alarm','ALRMCO':'Carbon monoxide alarm',
 'ALRMCOM':'Carbon monoxide alarm, multiple patients','ALRMELEVR':'Elevator alarm (routine)','ALRMHOMR':'Home alarm (routine)','ALRMSER':'Alarm service (routine)',
 'ANMLBITE':'Animal bite','APLNC':'Appliance fire','APLNCADA':'Appliance fire, adaptive','APLNCH':'Appliance fire, hazmat','APLNCSE':'Appliance fire, single engine','APPLIANCE':'Appliance fire','ASSAULT':'Assault','AUTO':'Vehicle incident','BACKCNTRY':'Backcountry search',
 'BACKPN':'Back pain','BLDGFIRE':'Building fire','BLDGFIRET':'Building fire, occupants trapped','BLDGFIRS':'Building fire, small','BLDGFIRSM':'Building fire, small, multiple patients',
 'BLDGFREX':'Building fire with explosion','BLDGFREXH':'Building fire with explosion, hazmat','BLDGFRH':'Building fire, hazmat','BLDGFRHMT':'Building fire, hazmat, occupants trapped',
 'BLDGFRHR':'High-rise building fire','BLDGFRHRT':'High-rise building fire, occupants trapped','BLDGFRSME':'Building fire, smoke, electrical','BLDGFRSMT':'Building fire, smoke showing, occupants trapped',
 'BOATFIRE':'Boat fire','BOATFROU':'Boat fire out','BOATFROUT':'Boat fire out','TANKSMH':'Tank fire, small, hazmat','BOGS':'Bog fire','BOMBT':'Bomb threat','BRUSHLG':'Brush fire, large','BRUSHS':'Brush fire, small','BRUSHSM':'Brush fire, small',
 'BTFIREWTR':'Boat fire on the water','BUILDING':'Building fire','BURN':'Burns','BURNADA2':'Burns, ALS2 with fire response','BURNFEI':'Burns, fire investigator','BURNMPD2':'Burns, multiple patients',
 'CHIMNEY':'Chimney fire','CHIMNEYS':'Chimney fire, small','CHOKING':'Choking','COLD':'Cold exposure','CP':'Chest pain','CPR2':'Cardiac arrest','CPRHEMM2':'Cardiac arrest, hemorrhage',
 'CPRHM2':'Cardiac arrest, hazmat','CPROD2':'Cardiac arrest, overdose','CTRBLRNR':'Controlled burn (routine)','CTRLBRN':'Controlled burn','DECKOVER':'Vehicle fire under deck-over',
 'DECKOVH':'Vehicle fire under deck-over, hazmat','DECLOC':'Decreased level of consciousness','DIABEPOL':'Diabetic, police on scene','DIABETIC':'Diabetic emergency','DROWN':'Drowning',
 'DSASTRDAN':'Disaster, danger','DSASTRINC':'Disaster incident','DSASTRINF':'Disaster, information','DSASTRMCI':'Disaster, mass casualty','DSASTRMED':'Disaster, medical','DSASTRREF':'Disaster, refuge',
 'DSASTRSC':'Disaster, standby','DSASTRTRP':'Disaster, people trapped','DSASTRUTL':'Disaster, utility','ELECDSTR':'Electrical distribution problem','ELECHAZ':'Electrical hazard',
 'ELECHAZSE':'Electrical hazard, single engine','ELECHZSE':'Electrical hazard, single engine','ELEVSTF':'Elevator entrapment, fire response','ELECODR':'Electrical odor','ELECSOL':'Electrical, solar','ELECTRO':'Electrocution','ELECUND':'Electrical underground',
 'ELEVSTFA':'Elevator entrapment with fire alarm','ELEVSTFR':'Elevator entrapment, fire response','ELEVTR':'Elevator entrapment','ELEVTRTRP':'Elevator entrapment with injury','ENTRAP':'Entrapment',
 'ENTRAPHM':'Entrapment with hazmat','FALL':'Fall','FALLPOL':'Fall, police on scene','FALLR':'Fall, lift assist (routine)','FIREOUT':'Fire out','FIREOUTH':'Fire out, hazmat','FUELODOR':'Fuel odor',
 'FUELSPIL':'Fuel spill','FUELSPLH':'Fuel spill, hazmat','FUELSPLLG':'Fuel spill, large','GASLEAK':'Natural gas leak','GASLEAKO':'Natural gas leak, outside','GASMAJOR':'Major natural gas leak','GASODOR':'Natural gas odor',
 'HAZE':'Haze / smoke in the area','HEART':'Heart problems','HEAT':'Heat exposure','HEMM':'Hemorrhage','HMINC':'Hazmat incident','HMINCCNMP':'Hazmat incident, contained, multiple patients','HMINCCNTD':'Hazmat incident, contained',
 'HMINCMPD':'Hazmat incident, multiple patients','HMINV':'Hazmat investigation','HMINVEST':'Hazmat investigation','HMINVSTR':'Hazmat investigation (routine)','HMSPILL':'Hazmat spill','HMSPILS':'Hazmat spill, small','HMSPLS':'Hazmat spill, small',
 'HOUSE':'House fire','HOUSET':'House fire, occupants trapped','INHALE':'Inhalation injury','INJURDMPB':'Injured person, manpower, BLS','INJURED':'Injured person','INTRF':'Interfacility transfer','INTRFMP':'Interfacility transfer, manpower',
 'INVEST':'Investigation','INVESTEXH':'Investigation, explosion, hazmat','INVESTEXP':'Investigation, explosion','LIGHNING':'Lightning strike','LIGHTNGSE':'Lightning strike, single engine','LIGHTNING':'Lightning strike','LOSTPERR':'Lost person (routine)',
 'MO':'Medical, unknown problem','MOPOL':'Medical, police on scene','OB':'Obstetric emergency','OD':'Overdose','ODINT':'Overdose, intentional','ODORSMK':'Odor of smoke','ODPOL':'Overdose, police on scene',
 'ONEDOWNB':'Person down, BLS','ONEDWN32B':'Person down, BLS (32D)','ORDNCNE':'Ordnance found','OUTFIRE':'Outside fire','OUTFIRH':'Outside fire, hazmat','OUTFRADA':'Outside fire, adaptive',
 'PANALS':'Psychiatric / behavioral','PANBLSR':'Psychiatric / behavioral, BLS (routine)','PANMIHR':'Mental health, routine','PANONLYALS':'Psychiatric, single ALS evaluation','PIC':'Collision with injuries',
 'PICCYCLE':'Cyclist struck','PICEXB':'Collision, extrication needed, BLS','PICHM':'Collision with hazmat','PICMULT':'Multi-vehicle collision','PICPED':'Pedestrian struck','PICTRAP':'Collision with entrapment',
 'PICTRAPF2':'Collision with entrapment and fire, ALS2','PICTRFHM2':'Collision, entrapment, fire and hazmat, ALS2','PICTRPHM':'Collision with entrapment, hazmat','SEIZURE':'Seizure','SHORT':'Electrical short',
 'SHORTH':'Electrical short, hazmat','SHOTPOL':'Shooting, police on scene','SICK':'Sick person','SMOKEINV':'Smoke investigation','SPKGINV':'Suspicious package investigation','STABPOL':'Stabbing, police on scene',
 'STROKE':'Stroke','SUSPKG':'Suspicious package','SVCANMLR':'Service call, animal (routine)','SVCCALL':'Service call','SVCCALR':'Service call (routine)','SVCCWELF':'Welfare check','SVCLIFT':'Lift assist',
 'SVCLOCKR':'Lockout (routine)','SVCVEHLO':'Vehicle lockout','SVCWTRR':'Water problem (routine)','TANKBLDG':'Tank fire near building','TANKLG':'Large tank fire','TANKS':'Tank fire, small','TANKSM':'Tank fire, small',
 'TB':'Trouble breathing','TBPOL':'Trouble breathing, police on scene','TNKFROUT':'Tank fire out','TRAINCRSH':'Train crash','TRAINFIRE':'Train fire','TRAININV':'Train investigation','TRAININVR':'Train investigation (routine)',
 'TRAINPED':'Train vs pedestrian','TRANSFORMR':'Transformer fire (routine)','TRANSFRMR':'Transformer fire (routine)','TRAUMPOL':'Trauma, police on scene','TRNSFRM':'Transformer fire','TRTCOLAPS':'Structural collapse',
 'TRTCOLAPW':'Collapse with water rescue','TRTCONFIN':'Confined space rescue','TRTTECH':'Technical rescue','TRTTECHW':'Technical rescue with water resources','TRTTRENCH':'Trench rescue','UNCON':'Unconscious',
 'UNEMER':'Unknown emergency','UNKODOR':'Unknown odor','UNKODR':'Unknown odor','VEHEXP':'Vehicle explosion','VEHEXPH':'Vehicle explosion, hazmat','VEHFIRE':'Vehicle fire','VEHFIRH':'Vehicle fire, hazmat','VEHFIRLG':'Vehicle fire, large',
 'VEHFIRPRK':'Vehicle fire in parking garage','VEHFRBLDG':'Vehicle fire near building','VEHFRBLD':'Vehicle fire near building','VEHFRBLH':'Vehicle fire near building, hazmat','VEHFREXP':'Vehicle fire with explosion',
 'VEHFRLGH':'Vehicle fire, large, hazmat','VEHFRTRAP':'Vehicle fire with entrapment','VEHFRTRH':'Vehicle fire, tractor-trailer, hazmat','VFIRPRKH':'Vehicle fire in parking garage, hazmat','WIRES':'Wires down',
}
SUFFIX = {'1':'ALS1','2':'ALS2','B':'BLS','M':'multiple patients','R':'routine','I':'inside','O':'outside'}

def describe(code):
    if code in BASE: return BASE[code]
    for stem in sorted(BASE, key=len, reverse=True):
        if code.startswith(stem):
            rest = code[len(stem):]
            parts = []
            i = 0
            while i < len(rest):
                if rest[i:i+3]=='POL': parts.append('police on scene'); i+=3; continue
                if rest[i:i+2]=='MP': parts.append('manpower'); i+=2; continue
                ch = rest[i]
                if ch in SUFFIX: parts.append(SUFFIX[ch]); i+=1; continue
                break
            if i == len(rest):
                return BASE[stem] + (', ' + ', '.join(parts) if parts else '')
    return code.title()

# ---------------------------------------------------------------- grading
FULL_FIRE = {'FJ','FK','FJ6','HMFULL','HMFULLFEI','HMFULLWTR','DECKOVERE','DECKOVERW'}
FULL_HAZ = {'GASFULL'}
FULL_RESCUE = {'TRC','TRAT','RES','TECHWTR','PMCI','AUTOFREX'}
EMS_RIDS = {'ALS1','AL1D','ALS2','AL2D','ALS2EMSDO','HMEMSDO','ADA','MLTP','BLS','BLSU9','BLSR','BLSM','BLSNFR','BLS32D','ALS1NFR','ALS1SR','BLS32DHWY','BLSHWY','BLSNHA','BLSO9','BLSC','FALS1FEI'}
RESCUE_RIDS = {'PA1','PA2','PHM','PHMWTR','PIB','PIBWEX','LOST','TRM'}
SERVICE_RIDS = {'SCT','SCE','SCTE','SCANY','SA','EX'}
HAZ_STEMS = ('GAS','FUEL','HMIN','HMSP','INHALE','TANK','UNKOD','SPKGINV','SUSPKG','BOMBT','ORDNCNE','ALRMCO','HAZE','TNKFR','INVESTEX','ELECODR','ODORSMK')
SERVICE_STEMS = ('SVC','WIRES','ELEV','ALRM','LOSTPER','INVEST','SMOKEINV','LIGH','TRANSF','TRNSFRM','ELECHAZ','ELECDSTR','ELECUND','ELECSOL','SHORT','CTRL','CTRB','AIRALERT','AIRINV','AIRMINRE','AIRBORN','DSASTR','BACKCNTRY','UNEMER')
CRITICAL_EMS = {'UNCON2','ELECTRO2','CHOKING2','SHOTPOL2','STABPOL2','TRAUMPOL2','HEMM2','ALLERGIC2','DROWN2','BURNADA2','BURNMPD2','ELECTROM','SHOTPOLM','STABPOLM','TRAUMPOLM','DSASTRMCI'}
HIGH_ALS1 = {'PICPED1','PICCYCLE1','SHOTPOL1','STABPOL1','DROWN1','ELECTRO1','TRAUMPOL1'}
TRAPPED = ('TRAP','TRP','ENTRAP')
OVERRIDES = {  # code: (category, severity, alertable)
 'CHIMNEY':('fire','high',True), 'VEHFIRPRK':('fire','high',True), 'DECKOVER':('fire','high',True), 'VEHFRTRH':('fire','high',True), 'DECKOVH':('fire','high',True),
 'VFIRPRKH':('fire','high',True), 'ELEVSTFA':('service','normal',False), 'ELEVSTFR':('service','normal',False), 'ELEVSTFRB':('service','normal',False), 'ELEVSTFRM':('service','normal',False),
 'PIC1':('rescue','normal',False), 'PIC2':('rescue','high',True), 'PICHM2':('rescue','high',True), 'PICHM1':('rescue','normal',False), 'PICHMB':('rescue','normal',False),
 'AIRALERT':('rescue','normal',False), 'AIRMINRE':('rescue','normal',False), 'AIRCRSHP':('rescue','critical',True), 'AIRCRSHPW':('rescue','critical',True), 'AIRFIRES':('fire','high',True),
 'PICEXB':('rescue','high',True), 'COLDM':('ems','high',True), 'HEATM':('ems','high',True), 'INHALEM':('hazmat','high',True), 'DSASTRDAN':('rescue','high',True), 'DSASTRTRP':('rescue','critical',True),
 'DSASTRMCI':('ems','critical',True), 'BOMBT':('hazmat','normal',False), 'CPRHM2':('ems','critical',True), 'BLDGFRSME':('fire','high',True), 'PICTRFHM2':('rescue','critical',True), 'ELEVTRTRP':('rescue','high',True),
 'INTRF2':('ems','normal',False), 'INTRF1':('ems','normal',False), 'INTRFB':('ems','low',False), 'INTRFR':('ems','low',False), 'INTRFMP1':('ems','normal',False), 'INTRFMPB':('ems','low',False),
 'PANALS2':('ems','normal',False), 'ODORSMK':('fire','normal',False), 'ELECHZSEB':('service','normal',False), 'TANKLG':('hazmat','critical',True), 'VEHFRBLH':('fire','critical',True), 'BLDGFRH':('fire','critical',True), 'BLDGFREXH':('fire','critical',True),
}

def grade(code, pri, rid):
    if code in OVERRIDES:
        c, s, a = OVERRIDES[code]; return c, s, a
    # category
    if rid in EMS_RIDS: cat = 'ems'
    elif rid in FULL_RESCUE or rid in RESCUE_RIDS: cat = 'rescue'
    elif rid in FULL_HAZ or rid.startswith('HM') or code.startswith(HAZ_STEMS): cat = 'hazmat'
    elif rid in SERVICE_RIDS or code.startswith(SERVICE_STEMS): cat = 'service'
    else: cat = 'fire'
    if code.startswith(('BRUSH','BOAT','BTFIRE','OUTFIRE','OUTFR','FIREOUT','VEH','APLNC','APPLIANCE','TANK','TNKFR','BLDG','HOUSE','CHIMNEY','DECKOVER','BUILDING','AIRFIRE','AIRCRSHF','AIRFULLE','TRAINFIRE')):
        cat = 'hazmat' if code.startswith(('TANK','TNKFR')) else ('rescue' if code=='TRAINFIRE' else 'fire')
    if code.startswith(('TRT','ENTRAP','PIC','TRAIN','ELEVTRTRP')): cat = 'rescue'
    if code.startswith(('DROWN','ELECTRO','SHOT','STAB','TRAUM','BURN','CPR','UNCON','CHOKING','ALLERGIC','HEMM','INJURED','INJURD','FALL','OD','TB','CP','HEART','SICK','SEIZURE','STROKE','MO','OB','ABDPN','BACKPN','DIAB','DECLOC','ANML','ASSAULT','PAN','INTRF','ONEDOWN','ONEDWN','COLD','HEAT','UNEMER')) and not code.startswith('FALLR'):
        cat = 'ems'
    if code.startswith(('PICPED','PICCYCLE')): cat = 'ems'
    # severity
    if any(t in code for t in TRAPPED) and not code.startswith('ELEVTR'): return cat, 'critical', True
    if rid in FULL_FIRE or rid in FULL_HAZ or rid in FULL_RESCUE: return cat, 'critical', True
    if rid in {'ALS2EMSDO','HMEMSDO','ADA'}: return cat, 'critical', True
    if code in CRITICAL_EMS: return cat, 'critical', True
    if rid in {'ALS2','AL2D','PA2','MLTP'} and pri <= 2: return cat, 'high', True
    if rid == 'PHM' and pri <= 2: return cat, 'high', True
    if rid in {'FH','FHW','BRUSHLG','BRUSHLG1'}: return cat, 'high', True
    if rid == 'FDMULTP' and pri <= 3: return cat, 'high', True
    if code in HIGH_ALS1: return cat, 'high', True
    if rid in {'SCT','SCE','SCTE','SCANY','BLSR','BLSNFR'} or rid.startswith('BLS') or pri >= 6: return cat, 'low', False
    return cat, 'normal', False

# ---------------------------------------------------------------- codes seen live by sta03 that section 1 omits
LEGACY = {  # code: (category, description, severity, upgrade)
 'BLDGFRHM':('fire','Building fire, hazmat','critical',False),
 'MAFULL':('fire','Mutual aid full assignment','critical',True),
 'UBOX':('fire','Box alarm upgrade (working fire)','critical',True),
 'UBOXHR':('fire','High-rise box upgrade','critical',True),
 'UBOXW':('fire','Box upgrade, working fire','critical',True),
 'FLDVEHT':('rescue','Vehicle in flood water, occupants trapped','critical',False),
 'METRO':('rescue','Metro rail incident','critical',False),
 'METRORESQP':('rescue','Metro rescue, person','critical',False),
 'METCRSH':('rescue','Metro crash','critical',False),
 'PIC1TRAP':('rescue','Collision with entrapment','critical',False),
 'PICTRAP2':('rescue','Collision with entrapment, ALS2','critical',False),
 'PICTRFM2':('rescue','Collision with entrapment and fire, ALS2','critical',False),
 'PICTRPHM2':('rescue','Collision with entrapment, hazmat, ALS2','critical',False),
 'CPRDROWN2':('ems','Cardiac arrest, drowning','critical',False),
 'CPRSHOT2':('ems','Cardiac arrest, gunshot','critical',False),
 'CPRSTAB2':('ems','Cardiac arrest, stabbing','critical',False),
 'CPRTRAUM2':('ems','Cardiac arrest, trauma','critical',False),
 'SHOOTA2':('ems','Shooting, ALS2','critical',False),
 'STAB2':('ems','Stabbing, ALS2','critical',False),
 'UCODE':('ems','Unconscious, possible code','critical',False),
 'SHOOTA1':('ems','Shooting','high',False),
 'STAB1':('ems','Stabbing','high',False),
}
existing = {code: (cat, desc, sev, True, upg) for code, (cat, desc, sev, upg) in LEGACY.items()}

rules = {}
for code, (pri, rid, plan) in rows.items():
    cat, sev, alertable = grade(code, pri, rid)
    rules[code] = dict(code=code, description=describe(code), category=cat, severity=sev, alertable=alertable, upgrade=False, source=f'p{pri} {rid}')
for code, (cat, desc, sev, al, upg) in existing.items():
    if code in rules:
        r = rules[code]
        r['upgrade'] = upg
        if code in {'PICTRAP1','ENTRAP1'}: pass
    else:
        rules[code] = dict(code=code, description=desc, category=cat, severity=sev, alertable=al, upgrade=upg, source='sta03')
for code, desc in {'2ND':'Second alarm','3RD':'Third alarm','4TH':'Fourth alarm'}.items():
    rules[code] = dict(code=code, description=desc, category='fire', severity='critical', alertable=True, upgrade=True, source='response plans')

order = {'fire':0,'rescue':1,'ems':2,'hazmat':3,'service':4,'other':5}
sevo = {'critical':0,'high':1,'normal':2,'low':3}
sorted_rules = sorted(rules.values(), key=lambda r:(order[r['category']], sevo[r['severity']], r['code']))
OUT = sys.argv[2] if len(sys.argv) > 2 else os.path.join(ROOT, 'packages/feed/data/call-type-rules.json')
json.dump(sorted_rules, open(OUT,'w'), indent=1)
c = collections.Counter((r['category'], r['severity'], r['alertable']) for r in sorted_rules)
print('total', len(sorted_rules), 'alertable', sum(r['alertable'] for r in sorted_rules))

