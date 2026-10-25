"""Reproduce reviewed numeric facts from a pinned DBM checkout (no DBM code copied).

Run: python scripts/prepare-dungeon-catalog.py <DBM-Dungeons checkout>
Targets and level bands are Guilded design estimates, NOT measured benchmarks.
"""
import json
import pathlib
import re
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
SOURCE = pathlib.Path(sys.argv[1])
REV = 'd989f711bfb99eb002a51e32aebcdcebefc207f3'
assert subprocess.check_output(['git', '-C', str(SOURCE), 'rev-parse', 'HEAD'], text=True).strip() == REV

def boss(path, classic=False):
    text = (SOURCE / (path + '.lua')).read_text(encoding='utf-8-sig')
    match = re.search(r'^mod:SetEncounterID\((.*)\)', text, re.M)
    ids = []
    if match:
        expr = match[1]
        if 'and' in expr:
            ids = [int(re.findall(r'\b\d+\b', expr)[0 if classic else -1])]
        elif re.fullmatch(r'[\d, ]+', expr):
            ids = [int(n) for n in expr.split(',')]
    npc = re.search(r'^mod:SetMainBossID\((\d+)\)', text, re.M) or re.search(r'^mod:SetCreatureID\((\d+)\)', text, re.M)
    # NPC death evidence is a separate namespace; never treat an NPC ID as an encounter ID.
    assert ids or npc, path
    return {'ids': ids, 'names': [], **({'npcIds': [int(npc[1])]} if npc else {})}

rows = []
def add(edition, key, name, folder, files, levels, minutes, difficulty=1):
    paths = [folder + '/' + f for f in files.split('|')]
    identities = [boss(p, edition == 'classic-era') for p in paths]
    rows.append(dict(edition=edition, dungeonKey=key, instanceId=int(key.split(':')[0]), name=name,
        difficultyId=difficulty, min=levels[0], max=levels[1], targetSec=minutes*60,
        completion=identities[-1], requiredEncounters=identities[:-1], sourceFiles=[p+'.lua' for p in paths]))

# Explicit route checkpoints. Optional bosses are deliberately not required.
# Shared-map wings have disjoint evidence and distinct keys.
vanilla = [
 ('389','Ragefire Chasm','Classic/RagefireChasm','Taragaman|Bazzalan',(15,21),25),
 ('43','Wailing Caverns','Shared/WailingCaverns','LordCobrahn|LadyAnacondra|LordPythas|LordSerpentis|MutanustheDevourer',(17,25),40),
 ('36','Deadmines','Shared/Deadmines','RhahkZor|SneedsShredder|Gilnid|MrSmite|CaptainGreenskin|EdwinVanCleef',(17,26),40),
 ('33','Shadowfang Keep','Classic/Shadowfangkeep','Rethilgore|CommanderSpringvale|ArchmageArugal',(20,29),35),
 ('34','Stockade','Classic/StormwindStockaid','DextrenWard|BazilThredd',(24,29),25),
 ('48','Blackfathom Deeps','Classic/BlackfathomDeeps','TwilightLordKelris|Akumai',(24,29),40),
 ('189:graveyard','Scarlet Graveyard','Shared/ScarletMonastery_Old','InterrogatorVishas|BloodmageThalnos',(26,29),20),
 ('90','Gnomeregan','Shared/Gnomeregan','Electrocutioner6000|MekgineerThermaplugg',(30,38),45),
 ('47','Razorfen Kraul','Classic/RazorfenKraul','OverlordRamtusk|CharlgaRazorflank',(30,38),35),
 ('189:library','Scarlet Library','Shared/ScarletMonastery_Old','HoundmasterLoksey|ArcanistDoan',(30,38),25),
 ('189:armory','Scarlet Armory','Shared/ScarletMonastery_Old','Herod',(35,42),25),
 ('189:cathedral','Scarlet Cathedral','Shared/ScarletMonastery_Old','Mograine_and_Whitemane',(38,44),30),
 ('129','Razorfen Downs','Classic/RazorfenDowns','Tutenkash|MordreshFireEye|AmnennartheColdbringer',(38,44),40),
 ('70','Uldaman','Shared/Uldaman','GalgannFirehammer|Grimlok|Archaedas',(40,44),45),
 ('209','Zul\'Farrak','Shared/ZulFarrak','WitchDoctorZumrah|ChiefUkorzSandscalp',(45,52),40),
 ('349','Maraudon','Shared/Maraudon','CelebrastheCursed|Landslide|PrincessTheradras',(45,54),50),
 ('109','Sunken Temple','Shared/SunkenTemple','JammalantheProphet|ShadeofEranikus',(50,59),50),
 ('230','Blackrock Depths','Shared/BlackrockDepths','TheSeven|Magmus|EmperorDagranThaurissan',(60,60),60),
 ('229:lower','Lower Blackrock Spire','Shared/LowerBlackrockSpire','HighlordOmokk|WarMasterVoone|OverlordWyrmthalak',(60,60),50),
 ('229:upper','Upper Blackrock Spire','Classic/UpperBlackrockSpire','PyroguardEmberseer|WarchiefRendBlackhand|GeneralDrakkisath',(60,60),45),
 ('429:east','Dire Maul East','Shared/DireMaul','ZevrimThornhoof|Alzzin',(60,60),35),
 ('429:west','Dire Maul West','Shared/DireMaul','Immolthar|PrinceTortheldrin',(60,60),45),
 ('429:north','Dire Maul North','Shared/DireMaul','KingGordok',(60,60),35),
 ('289','Scholomance','Shared/Scholomance_Old','Rattlegore|RasFrostwhisper|DarkmasterGandling',(60,60),50),
 ('329:living','Stratholme Living','Shared/Stratholme','WilleyHopebreaker|InstructorGalford|Balnazzar',(60,60),45),
 ('329:undead','Stratholme Undead','Shared/Stratholme','BaronessAnastari|Narubenkan|MalekithePallid|RamsteintheGorger|LordAuriusRivendare',(60,60),45),
]
for edition in ['classic-era','classic-tbc']:
    for key,name,folder,files,levels,minutes in vanilla:
        add(edition,key,name,'DBM-Party-Vanilla/'+folder,files,levels,minutes)

bc = [
 (543,'Hellfire Ramparts','Hellfire_Ramp','Gargolmar|Omor|Vazruden',25),
 (542,'Blood Furnace','Hellfire_BloodFurnace',"Maker|Broggok|Keli'dan",30),
 (540,'Shattered Halls','Hellfire_ShatteredHalls',"Nethekurse|O'mrogg|Kargath",40),
 (547,'Slave Pens','Coil_Slavepens','Mennu|Rokmar|Quagmirran',30),
 (546,'Underbog','Coil_Underbog','Hungarfen|Ghazan|Muselek|Stalker',35),
 (545,'Steamvault','Coil_Steamvault','Thespia|Steamrigger|Kalithresh',35),
 (558,'Auchenai Crypts','Auct_Crypts','Shirrak|Maladaar',30),
 (557,'Mana-Tombs','Auct_Tombs','Pandemonius|Tavarok|Shaffar',30),
 (556,'Sethekk Halls','Auct_SethekkHalls','Syth|Ikiss',30),
 (555,'Shadow Labyrinth','Auct_ShadowLabyrinth','Hellmaw|Inciter|Vorpil|Murmur',45),
 (560,'Old Hillsbrad','CoT_OldHillsbrad','Drake|Skarloc|EpochHunter',40),
 (269,'Black Morass','CoT_BlackMorass','Deja|Temporus|Aeonus',35),
 (554,'Mechanar','TK_Mechanar','Capacitus|Sepethrea|Pathaleon',30),
 (553,'Botanica','TK_Botanica','Sarannis|Freywinn|Thorngrin|Laj|WarpSplinter',35),
 (552,'Arcatraz','TK_Arcatraz','Zereketh|Dalliah|Soccothrates|Skyriss',40),
 (585,'Magisters\' Terrace','MagistersTerrace',"Selin|Vexallus|Delrissa|Kael'thas",35),
]
for mapid,name,folder,files,minutes in bc:
    for difficulty,mode,levels in [(1,'Normal',(60,70)),(2,'Heroic',(70,70))]:
        add('classic-tbc',f'{mapid}:{mode.lower()}',f'{name} ({mode})','DBM-Party-BC/'+folder,files,levels,minutes+(5 if difficulty==2 else 0),difficulty)

mop = [(960,'Temple of the Jade Serpent','JadeSerpentTemple','WiseMari|LibraryEvent|LiuFlameheart|ShaofDoubt'),
 (961,'Stormstout Brewery','StormstoutBrewery','OokOok|Hoptallus|YanZhu'),
 (959,'Shado-Pan Monastery','ShadoPanMonastery','GuCloudstrike|Snowdrift|ShaofViolence|TaranZhu'),
 (962,'Gate of the Setting Sun','GateSettingSun','Kiptilak|Gadok|Rimok|Raigonn'),
 (994,'Mogu\'shan Palace','MogushanPalace','TrialoftheKing|Gekkan|WeaponmasterXin'),
 (1011,'Siege of Niuzao Temple','NiuzaoTemple','Jinbak|Vojak|Pavalak|Neronok'),
 (1007,'Scholomance','Scholomance','Chillheart|JandiceBarov|Rattlegore|LillianVoss|DarkmasterGandling'),
 (1001,'Scarlet Halls','ScarletHalls','Braun|Harlan|FlameweaverKoegler'),
 (1004,'Scarlet Monastery','ScarletCathedral','ThalnosSoulrender|Korlof|Durand')]
for mapid,name,folder,files in mop:
    for difficulty,mode,levels in [(1,'Normal',(85,89)),(2,'Heroic',(90,90))]:
        # The three old-world remakes have their own leveling brackets.
        if difficulty == 1 and mapid in [1007,1001,1004]: levels = (40,59) if mapid==1007 else (30,39)
        add('classic-mists',f'{mapid}:{mode.lower()}',f'{name} ({mode})','DBM-Party-MoP/'+folder,files,levels,30 if folder in ['ShadoPanMonastery','NiuzaoTemple','Scholomance'] else 25,difficulty)

midnight = [(2805,'Windrunner Spire','WindrunnerSpire'),(2813,'Murder Row','MurderRow'),
 (2811,'Magisters\' Terrace','MagistersTerrace'),(2859,'The Blinding Vale','TheBlindingVale'),
 (2825,'Den of Nalorakk','DenofNalorakk'),(2923,'Voidscar Arena','VoidscarArena'),
 (2874,'Maisara Caverns','MaisaraCaverns'),(2915,'Nexus-Point Xenas','NexusPointXenas'),(2993,'Altar of Fangs','AltarofFangs')]
toc=(SOURCE/'DBM-Party-Midnight/DBM-Party-Midnight.toc').read_text(encoding='utf-8-sig')
for mapid,name,folder in midnight:
    files='|'.join(re.findall(r'^'+folder+r'\\([^\r\n]+)\.lua$',toc,re.M))
    files='|'.join(f for f in files.split('|') if not f.endswith('Trash'))
    for difficulty,mode in [(1,'Normal'),(2,'Heroic'),(23,'Mythic')]:
        add('retail',f'{mapid}:{mode.lower()}',f'{name} ({mode})','DBM-Party-Midnight/'+folder,files,(90,90),30,difficulty)
# Current seasonal returning maps: heroic and Mythic 0 only (no imaginary normal mode).
for mapid,name,folder,files,minutes in [
 (1762,"Kings' Rest",'DBM-Party-BfA/KingsRest','GoldenSerpent|Mchimba|CouncilofTribes|Dazar',33),
 (1877,'Temple of Sethraliss','DBM-Party-BfA/TempleofSethraliss','AdderisandAspix|Merektha|Galvazzt|AvatarofSethraliss',32),
 (2521,'Ruby Life Pools','DBM-Party-Dragonflight/RubyLifePools','MelidrussaChillworn|KokiaBlazehoof|Kyrakka_and_Erkhart_Stormvein',28)]:
    for difficulty,mode in [(2,'Heroic'),(23,'Mythic')]:
        add('retail',f'{mapid}:{mode.lower()}',f'{name} ({mode})',folder,files,(90,90),minutes,difficulty)

output = {'revision':'guilded-provisional-2026-10-25-v1','source':f'https://github.com/DeadlyBossMods/DBM-Dungeons/tree/{REV}',
          'benchmarkBasis':'Guilded design estimates; no measured client runs. First-combat to named endpoint with listed checkpoints. Optional bosses/trash not required.',
          'routes':rows}
(ROOT/'companion/dungeon-catalog.mjs').write_text('// Numeric game facts with source paths; generated by scripts/prepare-dungeon-catalog.py.\nexport const dungeonCatalog = '+json.dumps(output,ensure_ascii=False,indent=2)+';\n',encoding='utf-8')
print('Prepared',len(rows),'source-reviewed routes; benchmarks provisional.')
