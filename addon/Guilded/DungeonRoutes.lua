-- Client-verified overrides and a separate source-reviewed provisional catalog.
local _, ns = ...
local routes = { verified = {} }
ns.dungeonRoutes = routes

-- BEGIN GENERATED SOURCE CATALOG
-- https://github.com/DeadlyBossMods/DBM-Dungeons/tree/d989f711bfb99eb002a51e32aebcdcebefc207f3
-- Source reviewed; client acceptance and benchmark calibration are pending.
routes.sourced = {
  {edition="classic-era",instanceId=389,participationBand={difficultyId=1},completion={ids={},npcIds={11519},names={}},requiredEncounters={{ids={},npcIds={11520},names={}}}},
  {edition="classic-era",instanceId=43,participationBand={difficultyId=1},completion={ids={592},npcIds={3654},names={}},requiredEncounters={{ids={586},npcIds={3669},names={}},{ids={585},npcIds={3671},names={}},{ids={588},npcIds={3670},names={}},{ids={590},npcIds={3673},names={}}}},
  {edition="classic-era",instanceId=36,participationBand={difficultyId=1},completion={ids={2972},npcIds={639},names={}},requiredEncounters={{ids={2967},npcIds={644},names={}},{ids={2968},npcIds={},names={}},{ids={2969},npcIds={1763},names={}},{ids={2970},npcIds={646},names={}},{ids={2971},npcIds={647},names={}}}},
  {edition="classic-era",instanceId=33,participationBand={difficultyId=1},completion={ids={},npcIds={4275},names={}},requiredEncounters={{ids={},npcIds={3914},names={}},{ids={},npcIds={4278},names={}}}},
  {edition="classic-era",instanceId=34,participationBand={difficultyId=1},completion={ids={},npcIds={1716},names={}},requiredEncounters={{ids={},npcIds={1663},names={}}}},
  {edition="classic-era",instanceId=48,participationBand={difficultyId=1},completion={ids={2767},npcIds={4829},names={}},requiredEncounters={{ids={2766},npcIds={4832},names={}}}},
  {edition="classic-era",instanceId=189,participationBand={difficultyId=1},completion={ids={2779},npcIds={4543},names={}},requiredEncounters={{ids={444},npcIds={3983},names={}}}},
  {edition="classic-era",instanceId=90,participationBand={difficultyId=1},completion={ids={2772},npcIds={7800},names={}},requiredEncounters={{ids={2770},npcIds={6235},names={}}}},
  {edition="classic-era",instanceId=47,participationBand={difficultyId=1},completion={ids={},npcIds={4421},names={}},requiredEncounters={{ids={},npcIds={4420},names={}}}},
  {edition="classic-era",instanceId=189,participationBand={difficultyId=1},completion={ids={447},npcIds={6487},names={}},requiredEncounters={{ids={446},npcIds={3974},names={}}}},
  {edition="classic-era",instanceId=189,participationBand={difficultyId=1},completion={ids={448},npcIds={3975},names={}},requiredEncounters={}},
  {edition="classic-era",instanceId=189,participationBand={difficultyId=1},completion={ids={450},npcIds={},names={}},requiredEncounters={}},
  {edition="classic-era",instanceId=129,participationBand={difficultyId=1},completion={ids={},npcIds={7358},names={}},requiredEncounters={{ids={},npcIds={7355},names={}},{ids={},npcIds={7357},names={}}}},
  {edition="classic-era",instanceId=70,participationBand={difficultyId=1},completion={ids={554},npcIds={2748},names={}},requiredEncounters={{ids={552},npcIds={7291},names={}},{ids={553},npcIds={4854},names={}}}},
  {edition="classic-era",instanceId=209,participationBand={difficultyId=1},completion={ids={600},npcIds={7267},names={}},requiredEncounters={{ids={597},npcIds={7271},names={}}}},
  {edition="classic-era",instanceId=349,participationBand={difficultyId=1},completion={ids={429},npcIds={12201},names={}},requiredEncounters={{ids={425},npcIds={12225},names={}},{ids={426},npcIds={12203},names={}}}},
  {edition="classic-era",instanceId=109,participationBand={difficultyId=1},completion={ids={493,3584},npcIds={5709},names={}},requiredEncounters={{ids={488,3589},npcIds={5710},names={}}}},
  {edition="classic-era",instanceId=230,participationBand={difficultyId=1},completion={ids={245},npcIds={9019},names={}},requiredEncounters={{ids={243},npcIds={},names={}},{ids={244},npcIds={9938},names={}}}},
  {edition="classic-era",instanceId=229,participationBand={difficultyId=1},completion={ids={275},npcIds={9568},names={}},requiredEncounters={{ids={267},npcIds={9196},names={}},{ids={269},npcIds={9237},names={}}}},
  {edition="classic-era",instanceId=229,participationBand={difficultyId=1},completion={ids={},npcIds={10363},names={}},requiredEncounters={{ids={},npcIds={9816},names={}},{ids={},npcIds={10429},names={}}}},
  {edition="classic-era",instanceId=429,participationBand={difficultyId=1},completion={ids={346},npcIds={11492},names={}},requiredEncounters={{ids={},npcIds={11490},names={}}}},
  {edition="classic-era",instanceId=429,participationBand={difficultyId=1},completion={ids={361},npcIds={11486},names={}},requiredEncounters={{ids={349},npcIds={11496},names={}}}},
  {edition="classic-era",instanceId=429,participationBand={difficultyId=1},completion={ids={368},npcIds={11501},names={}},requiredEncounters={}},
  {edition="classic-era",instanceId=289,participationBand={difficultyId=1},completion={ids={2801},npcIds={1853},names={}},requiredEncounters={{ids={2811},npcIds={11622},names={}},{ids={2810},npcIds={10508},names={}}}},
  {edition="classic-era",instanceId=329,participationBand={difficultyId=1},completion={ids={478},npcIds={},names={}},requiredEncounters={{ids={475},npcIds={10997},names={}},{ids={477},npcIds={10811},names={}}}},
  {edition="classic-era",instanceId=329,participationBand={difficultyId=1},completion={ids={484},npcIds={},names={}},requiredEncounters={{ids={479},npcIds={10436},names={}},{ids={480},npcIds={10437},names={}},{ids={481},npcIds={10438},names={}},{ids={483},npcIds={10439},names={}}}},
  {edition="classic-tbc",instanceId=389,participationBand={difficultyId=1},completion={ids={},npcIds={11519},names={}},requiredEncounters={{ids={},npcIds={11520},names={}}}},
  {edition="classic-tbc",instanceId=43,participationBand={difficultyId=1},completion={ids={592},npcIds={3654},names={}},requiredEncounters={{ids={586},npcIds={3669},names={}},{ids={585},npcIds={3671},names={}},{ids={588},npcIds={3670},names={}},{ids={590},npcIds={3673},names={}}}},
  {edition="classic-tbc",instanceId=36,participationBand={difficultyId=1},completion={ids={2972},npcIds={639},names={}},requiredEncounters={{ids={2967},npcIds={644},names={}},{ids={2968},npcIds={},names={}},{ids={2969},npcIds={1763},names={}},{ids={2970},npcIds={646},names={}},{ids={2971},npcIds={647},names={}}}},
  {edition="classic-tbc",instanceId=33,participationBand={difficultyId=1},completion={ids={},npcIds={4275},names={}},requiredEncounters={{ids={},npcIds={3914},names={}},{ids={},npcIds={4278},names={}}}},
  {edition="classic-tbc",instanceId=34,participationBand={difficultyId=1},completion={ids={},npcIds={1716},names={}},requiredEncounters={{ids={},npcIds={1663},names={}}}},
  {edition="classic-tbc",instanceId=48,participationBand={difficultyId=1},completion={ids={2767},npcIds={4829},names={}},requiredEncounters={{ids={2766},npcIds={4832},names={}}}},
  {edition="classic-tbc",instanceId=189,participationBand={difficultyId=1},completion={ids={445},npcIds={4543},names={}},requiredEncounters={{ids={444},npcIds={3983},names={}}}},
  {edition="classic-tbc",instanceId=90,participationBand={difficultyId=1},completion={ids={382},npcIds={7800},names={}},requiredEncounters={{ids={380},npcIds={6235},names={}}}},
  {edition="classic-tbc",instanceId=47,participationBand={difficultyId=1},completion={ids={},npcIds={4421},names={}},requiredEncounters={{ids={},npcIds={4420},names={}}}},
  {edition="classic-tbc",instanceId=189,participationBand={difficultyId=1},completion={ids={447},npcIds={6487},names={}},requiredEncounters={{ids={446},npcIds={3974},names={}}}},
  {edition="classic-tbc",instanceId=189,participationBand={difficultyId=1},completion={ids={448},npcIds={3975},names={}},requiredEncounters={}},
  {edition="classic-tbc",instanceId=189,participationBand={difficultyId=1},completion={ids={450},npcIds={},names={}},requiredEncounters={}},
  {edition="classic-tbc",instanceId=129,participationBand={difficultyId=1},completion={ids={},npcIds={7358},names={}},requiredEncounters={{ids={},npcIds={7355},names={}},{ids={},npcIds={7357},names={}}}},
  {edition="classic-tbc",instanceId=70,participationBand={difficultyId=1},completion={ids={554},npcIds={2748},names={}},requiredEncounters={{ids={552},npcIds={7291},names={}},{ids={553},npcIds={4854},names={}}}},
  {edition="classic-tbc",instanceId=209,participationBand={difficultyId=1},completion={ids={600},npcIds={7267},names={}},requiredEncounters={{ids={597},npcIds={7271},names={}}}},
  {edition="classic-tbc",instanceId=349,participationBand={difficultyId=1},completion={ids={429},npcIds={12201},names={}},requiredEncounters={{ids={425},npcIds={12225},names={}},{ids={426},npcIds={12203},names={}}}},
  {edition="classic-tbc",instanceId=109,participationBand={difficultyId=1},completion={ids={493,3584},npcIds={5709},names={}},requiredEncounters={{ids={488,3589},npcIds={5710},names={}}}},
  {edition="classic-tbc",instanceId=230,participationBand={difficultyId=1},completion={ids={245},npcIds={9019},names={}},requiredEncounters={{ids={243},npcIds={},names={}},{ids={244},npcIds={9938},names={}}}},
  {edition="classic-tbc",instanceId=229,participationBand={difficultyId=1},completion={ids={275},npcIds={9568},names={}},requiredEncounters={{ids={267},npcIds={9196},names={}},{ids={269},npcIds={9237},names={}}}},
  {edition="classic-tbc",instanceId=229,participationBand={difficultyId=1},completion={ids={},npcIds={10363},names={}},requiredEncounters={{ids={},npcIds={9816},names={}},{ids={},npcIds={10429},names={}}}},
  {edition="classic-tbc",instanceId=429,participationBand={difficultyId=1},completion={ids={346},npcIds={11492},names={}},requiredEncounters={{ids={},npcIds={11490},names={}}}},
  {edition="classic-tbc",instanceId=429,participationBand={difficultyId=1},completion={ids={361},npcIds={11486},names={}},requiredEncounters={{ids={349},npcIds={11496},names={}}}},
  {edition="classic-tbc",instanceId=429,participationBand={difficultyId=1},completion={ids={368},npcIds={11501},names={}},requiredEncounters={}},
  {edition="classic-tbc",instanceId=289,participationBand={difficultyId=1},completion={ids={463},npcIds={1853},names={}},requiredEncounters={{ids={453},npcIds={11622},names={}},{ids={456},npcIds={10508},names={}}}},
  {edition="classic-tbc",instanceId=329,participationBand={difficultyId=1},completion={ids={478},npcIds={},names={}},requiredEncounters={{ids={475},npcIds={10997},names={}},{ids={477},npcIds={10811},names={}}}},
  {edition="classic-tbc",instanceId=329,participationBand={difficultyId=1},completion={ids={484},npcIds={},names={}},requiredEncounters={{ids={479},npcIds={10436},names={}},{ids={480},npcIds={10437},names={}},{ids={481},npcIds={10438},names={}},{ids={483},npcIds={10439},names={}}}},
  {edition="classic-tbc",instanceId=543,participationBand={difficultyId=1},completion={ids={1892},npcIds={},names={}},requiredEncounters={{ids={1893},npcIds={17306},names={}},{ids={1891},npcIds={17308},names={}}}},
  {edition="classic-tbc",instanceId=543,participationBand={difficultyId=2},completion={ids={1892},npcIds={},names={}},requiredEncounters={{ids={1893},npcIds={17306},names={}},{ids={1891},npcIds={17308},names={}}}},
  {edition="classic-tbc",instanceId=542,participationBand={difficultyId=1},completion={ids={1923},npcIds={17377},names={}},requiredEncounters={{ids={1922},npcIds={17381},names={}},{ids={1924},npcIds={17380},names={}}}},
  {edition="classic-tbc",instanceId=542,participationBand={difficultyId=2},completion={ids={1923},npcIds={17377},names={}},requiredEncounters={{ids={1922},npcIds={17381},names={}},{ids={1924},npcIds={17380},names={}}}},
  {edition="classic-tbc",instanceId=540,participationBand={difficultyId=1},completion={ids={1938},npcIds={16808},names={}},requiredEncounters={{ids={1936},npcIds={16807},names={}},{ids={1937},npcIds={16809},names={}}}},
  {edition="classic-tbc",instanceId=540,participationBand={difficultyId=2},completion={ids={1938},npcIds={16808},names={}},requiredEncounters={{ids={1936},npcIds={16807},names={}},{ids={1937},npcIds={16809},names={}}}},
  {edition="classic-tbc",instanceId=547,participationBand={difficultyId=1},completion={ids={1940},npcIds={17942},names={}},requiredEncounters={{ids={1939},npcIds={17941},names={}},{ids={1941},npcIds={17991},names={}}}},
  {edition="classic-tbc",instanceId=547,participationBand={difficultyId=2},completion={ids={1940},npcIds={17942},names={}},requiredEncounters={{ids={1939},npcIds={17941},names={}},{ids={1941},npcIds={17991},names={}}}},
  {edition="classic-tbc",instanceId=546,participationBand={difficultyId=1},completion={ids={1948},npcIds={17882},names={}},requiredEncounters={{ids={1946},npcIds={17770},names={}},{ids={1945},npcIds={18105},names={}},{ids={1947},npcIds={17826},names={}}}},
  {edition="classic-tbc",instanceId=546,participationBand={difficultyId=2},completion={ids={1948},npcIds={17882},names={}},requiredEncounters={{ids={1946},npcIds={17770},names={}},{ids={1945},npcIds={18105},names={}},{ids={1947},npcIds={17826},names={}}}},
  {edition="classic-tbc",instanceId=545,participationBand={difficultyId=1},completion={ids={1944},npcIds={17798},names={}},requiredEncounters={{ids={1942},npcIds={17797},names={}},{ids={1943},npcIds={17796},names={}}}},
  {edition="classic-tbc",instanceId=545,participationBand={difficultyId=2},completion={ids={1944},npcIds={17798},names={}},requiredEncounters={{ids={1942},npcIds={17797},names={}},{ids={1943},npcIds={17796},names={}}}},
  {edition="classic-tbc",instanceId=558,participationBand={difficultyId=1},completion={ids={1889},npcIds={18373},names={}},requiredEncounters={{ids={1890},npcIds={18371},names={}}}},
  {edition="classic-tbc",instanceId=558,participationBand={difficultyId=2},completion={ids={1889},npcIds={18373},names={}},requiredEncounters={{ids={1890},npcIds={18371},names={}}}},
  {edition="classic-tbc",instanceId=557,participationBand={difficultyId=1},completion={ids={1899},npcIds={18344},names={}},requiredEncounters={{ids={1900},npcIds={18341},names={}},{ids={1901},npcIds={18343},names={}}}},
  {edition="classic-tbc",instanceId=557,participationBand={difficultyId=2},completion={ids={1899},npcIds={18344},names={}},requiredEncounters={{ids={1900},npcIds={18341},names={}},{ids={1901},npcIds={18343},names={}}}},
  {edition="classic-tbc",instanceId=556,participationBand={difficultyId=1},completion={ids={1902},npcIds={18473},names={}},requiredEncounters={{ids={1903},npcIds={18472},names={}}}},
  {edition="classic-tbc",instanceId=556,participationBand={difficultyId=2},completion={ids={1902},npcIds={18473},names={}},requiredEncounters={{ids={1903},npcIds={18472},names={}}}},
  {edition="classic-tbc",instanceId=555,participationBand={difficultyId=1},completion={ids={1910},npcIds={18708},names={}},requiredEncounters={{ids={1908},npcIds={18731},names={}},{ids={1909},npcIds={18667},names={}},{ids={1911},npcIds={18732},names={}}}},
  {edition="classic-tbc",instanceId=555,participationBand={difficultyId=2},completion={ids={1910},npcIds={18708},names={}},requiredEncounters={{ids={1908},npcIds={18731},names={}},{ids={1909},npcIds={18667},names={}},{ids={1911},npcIds={18732},names={}}}},
  {edition="classic-tbc",instanceId=560,participationBand={difficultyId=1},completion={ids={1906},npcIds={18096},names={}},requiredEncounters={{ids={1905},npcIds={17848},names={}},{ids={1907},npcIds={17862},names={}}}},
  {edition="classic-tbc",instanceId=560,participationBand={difficultyId=2},completion={ids={1906},npcIds={18096},names={}},requiredEncounters={{ids={1905},npcIds={17848},names={}},{ids={1907},npcIds={17862},names={}}}},
  {edition="classic-tbc",instanceId=269,participationBand={difficultyId=1},completion={ids={1919},npcIds={17881},names={}},requiredEncounters={{ids={1920},npcIds={17879},names={}},{ids={1921},npcIds={17880},names={}}}},
  {edition="classic-tbc",instanceId=269,participationBand={difficultyId=2},completion={ids={1919},npcIds={17881},names={}},requiredEncounters={{ids={1920},npcIds={17879},names={}},{ids={1921},npcIds={17880},names={}}}},
  {edition="classic-tbc",instanceId=554,participationBand={difficultyId=1},completion={ids={1931},npcIds={19220},names={}},requiredEncounters={{ids={1932},npcIds={19219},names={}},{ids={1930},npcIds={19221},names={}}}},
  {edition="classic-tbc",instanceId=554,participationBand={difficultyId=2},completion={ids={1931},npcIds={19220},names={}},requiredEncounters={{ids={1932},npcIds={19219},names={}},{ids={1930},npcIds={19221},names={}}}},
  {edition="classic-tbc",instanceId=553,participationBand={difficultyId=1},completion={ids={1929},npcIds={17977},names={}},requiredEncounters={{ids={1925},npcIds={17976},names={}},{ids={1926},npcIds={17975},names={}},{ids={1928},npcIds={17978},names={}},{ids={1927},npcIds={17980},names={}}}},
  {edition="classic-tbc",instanceId=553,participationBand={difficultyId=2},completion={ids={1929},npcIds={17977},names={}},requiredEncounters={{ids={1925},npcIds={17976},names={}},{ids={1926},npcIds={17975},names={}},{ids={1928},npcIds={17978},names={}},{ids={1927},npcIds={17980},names={}}}},
  {edition="classic-tbc",instanceId=552,participationBand={difficultyId=1},completion={ids={1914},npcIds={20912},names={}},requiredEncounters={{ids={1916},npcIds={20870},names={}},{ids={1913},npcIds={20885},names={}},{ids={1915},npcIds={20886},names={}}}},
  {edition="classic-tbc",instanceId=552,participationBand={difficultyId=2},completion={ids={1914},npcIds={20912},names={}},requiredEncounters={{ids={1916},npcIds={20870},names={}},{ids={1913},npcIds={20885},names={}},{ids={1915},npcIds={20886},names={}}}},
  {edition="classic-tbc",instanceId=585,participationBand={difficultyId=1},completion={ids={1894},npcIds={24664},names={}},requiredEncounters={{ids={1897},npcIds={24723},names={}},{ids={1898},npcIds={24744},names={}},{ids={1895},npcIds={24560},names={}}}},
  {edition="classic-tbc",instanceId=585,participationBand={difficultyId=2},completion={ids={1894},npcIds={24664},names={}},requiredEncounters={{ids={1897},npcIds={24723},names={}},{ids={1898},npcIds={24744},names={}},{ids={1895},npcIds={24560},names={}}}},
  {edition="classic-mists",instanceId=960,participationBand={difficultyId=1},completion={ids={1439},npcIds={56439},names={}},requiredEncounters={{ids={1418},npcIds={56448},names={}},{ids={1417},npcIds={},names={}},{ids={1416},npcIds={56732},names={}}}},
  {edition="classic-mists",instanceId=960,participationBand={difficultyId=2},completion={ids={1439},npcIds={56439},names={}},requiredEncounters={{ids={1418},npcIds={56448},names={}},{ids={1417},npcIds={},names={}},{ids={1416},npcIds={56732},names={}}}},
  {edition="classic-mists",instanceId=961,participationBand={difficultyId=1},completion={ids={1414},npcIds={59479},names={}},requiredEncounters={{ids={1412},npcIds={56637},names={}},{ids={1413},npcIds={56717},names={}}}},
  {edition="classic-mists",instanceId=961,participationBand={difficultyId=2},completion={ids={1414},npcIds={59479},names={}},requiredEncounters={{ids={1412},npcIds={56637},names={}},{ids={1413},npcIds={56717},names={}}}},
  {edition="classic-mists",instanceId=959,participationBand={difficultyId=1},completion={ids={1306},npcIds={56884},names={}},requiredEncounters={{ids={1303},npcIds={56747},names={}},{ids={1304},npcIds={56541},names={}},{ids={1305},npcIds={56719},names={}}}},
  {edition="classic-mists",instanceId=959,participationBand={difficultyId=2},completion={ids={1306},npcIds={56884},names={}},requiredEncounters={{ids={1303},npcIds={56747},names={}},{ids={1304},npcIds={56541},names={}},{ids={1305},npcIds={56719},names={}}}},
  {edition="classic-mists",instanceId=962,participationBand={difficultyId=1},completion={ids={1419},npcIds={56877},names={}},requiredEncounters={{ids={1397},npcIds={56906},names={}},{ids={1405},npcIds={56589},names={}},{ids={1406},npcIds={56636},names={}}}},
  {edition="classic-mists",instanceId=962,participationBand={difficultyId=2},completion={ids={1419},npcIds={56877},names={}},requiredEncounters={{ids={1397},npcIds={56906},names={}},{ids={1405},npcIds={56589},names={}},{ids={1406},npcIds={56636},names={}}}},
  {edition="classic-mists",instanceId=994,participationBand={difficultyId=1},completion={ids={1441},npcIds={61398},names={}},requiredEncounters={{ids={1442},npcIds={},names={}},{ids={1509,1510},npcIds={},names={}}}},
  {edition="classic-mists",instanceId=994,participationBand={difficultyId=2},completion={ids={1441},npcIds={61398},names={}},requiredEncounters={{ids={1442},npcIds={},names={}},{ids={1509,1510},npcIds={},names={}}}},
  {edition="classic-mists",instanceId=1011,participationBand={difficultyId=1},completion={ids={1464},npcIds={62205},names={}},requiredEncounters={{ids={1465},npcIds={61567},names={}},{ids={1502},npcIds={61634},names={}},{ids={1447},npcIds={61485},names={}}}},
  {edition="classic-mists",instanceId=1011,participationBand={difficultyId=2},completion={ids={1464},npcIds={62205},names={}},requiredEncounters={{ids={1465},npcIds={61567},names={}},{ids={1502},npcIds={61634},names={}},{ids={1447},npcIds={61485},names={}}}},
  {edition="classic-mists",instanceId=1007,participationBand={difficultyId=1},completion={ids={1430},npcIds={59080},names={}},requiredEncounters={{ids={1426},npcIds={},names={}},{ids={1427},npcIds={59184},names={}},{ids={1428},npcIds={59153},names={}},{ids={1429},npcIds={58722},names={}}}},
  {edition="classic-mists",instanceId=1007,participationBand={difficultyId=2},completion={ids={1430},npcIds={59080},names={}},requiredEncounters={{ids={1426},npcIds={},names={}},{ids={1427},npcIds={59184},names={}},{ids={1428},npcIds={59153},names={}},{ids={1429},npcIds={58722},names={}}}},
  {edition="classic-mists",instanceId=1001,participationBand={difficultyId=1},completion={ids={1420},npcIds={59150},names={}},requiredEncounters={{ids={1422},npcIds={59303},names={}},{ids={1421},npcIds={58632},names={}}}},
  {edition="classic-mists",instanceId=1001,participationBand={difficultyId=2},completion={ids={1420},npcIds={59150},names={}},requiredEncounters={{ids={1422},npcIds={59303},names={}},{ids={1421},npcIds={58632},names={}}}},
  {edition="classic-mists",instanceId=1004,participationBand={difficultyId=1},completion={ids={1425},npcIds={},names={}},requiredEncounters={{ids={1423},npcIds={59789},names={}},{ids={1424},npcIds={59223},names={}}}},
  {edition="classic-mists",instanceId=1004,participationBand={difficultyId=2},completion={ids={1425},npcIds={},names={}},requiredEncounters={{ids={1423},npcIds={59789},names={}},{ids={1424},npcIds={59223},names={}}}},
  {edition="retail",instanceId=2805,participationBand={difficultyId=1},completion={ids={3059},npcIds={231636},names={}},requiredEncounters={{ids={3056},npcIds={231606},names={}},{ids={3057},npcIds={231626},names={}},{ids={3058},npcIds={231631},names={}}}},
  {edition="retail",instanceId=2805,participationBand={difficultyId=2},completion={ids={3059},npcIds={231636},names={}},requiredEncounters={{ids={3056},npcIds={231606},names={}},{ids={3057},npcIds={231626},names={}},{ids={3058},npcIds={231631},names={}}}},
  {edition="retail",instanceId=2805,participationBand={difficultyId=23},completion={ids={3059},npcIds={231636},names={}},requiredEncounters={{ids={3056},npcIds={231606},names={}},{ids={3057},npcIds={231626},names={}},{ids={3058},npcIds={231631},names={}}}},
  {edition="retail",instanceId=2813,participationBand={difficultyId=1},completion={ids={3105},npcIds={237415},names={}},requiredEncounters={{ids={3101},npcIds={252458},names={}},{ids={3102},npcIds={234649},names={}},{ids={3103},npcIds={234647},names={}}}},
  {edition="retail",instanceId=2813,participationBand={difficultyId=2},completion={ids={3105},npcIds={237415},names={}},requiredEncounters={{ids={3101},npcIds={252458},names={}},{ids={3102},npcIds={234649},names={}},{ids={3103},npcIds={234647},names={}}}},
  {edition="retail",instanceId=2813,participationBand={difficultyId=23},completion={ids={3105},npcIds={237415},names={}},requiredEncounters={{ids={3101},npcIds={252458},names={}},{ids={3102},npcIds={234649},names={}},{ids={3103},npcIds={234647},names={}}}},
  {edition="retail",instanceId=2811,participationBand={difficultyId=1},completion={ids={3074},npcIds={231865},names={}},requiredEncounters={{ids={3071},npcIds={231861},names={}},{ids={3072},npcIds={231863},names={}},{ids={3073},npcIds={239636},names={}}}},
  {edition="retail",instanceId=2811,participationBand={difficultyId=2},completion={ids={3074},npcIds={231865},names={}},requiredEncounters={{ids={3071},npcIds={231861},names={}},{ids={3072},npcIds={231863},names={}},{ids={3073},npcIds={239636},names={}}}},
  {edition="retail",instanceId=2811,participationBand={difficultyId=23},completion={ids={3074},npcIds={231865},names={}},requiredEncounters={{ids={3071},npcIds={231861},names={}},{ids={3072},npcIds={231863},names={}},{ids={3073},npcIds={239636},names={}}}},
  {edition="retail",instanceId=2859,participationBand={difficultyId=1},completion={ids={3202},npcIds={247676},names={}},requiredEncounters={{ids={3199},npcIds={243028},names={}},{ids={3200},npcIds={244887},names={}},{ids={3201},npcIds={245912},names={}}}},
  {edition="retail",instanceId=2859,participationBand={difficultyId=2},completion={ids={3202},npcIds={247676},names={}},requiredEncounters={{ids={3199},npcIds={243028},names={}},{ids={3200},npcIds={244887},names={}},{ids={3201},npcIds={245912},names={}}}},
  {edition="retail",instanceId=2859,participationBand={difficultyId=23},completion={ids={3202},npcIds={247676},names={}},requiredEncounters={{ids={3199},npcIds={243028},names={}},{ids={3200},npcIds={244887},names={}},{ids={3201},npcIds={245912},names={}}}},
  {edition="retail",instanceId=2825,participationBand={difficultyId=1},completion={ids={3209},npcIds={},names={}},requiredEncounters={{ids={3207},npcIds={248710},names={}},{ids={3208},npcIds={244100},names={}}}},
  {edition="retail",instanceId=2825,participationBand={difficultyId=2},completion={ids={3209},npcIds={},names={}},requiredEncounters={{ids={3207},npcIds={248710},names={}},{ids={3208},npcIds={244100},names={}}}},
  {edition="retail",instanceId=2825,participationBand={difficultyId=23},completion={ids={3209},npcIds={},names={}},requiredEncounters={{ids={3207},npcIds={248710},names={}},{ids={3208},npcIds={244100},names={}}}},
  {edition="retail",instanceId=2923,participationBand={difficultyId=1},completion={ids={3287},npcIds={248015},names={}},requiredEncounters={{ids={3285},npcIds={238887},names={}},{ids={3286},npcIds={239008},names={}}}},
  {edition="retail",instanceId=2923,participationBand={difficultyId=2},completion={ids={3287},npcIds={248015},names={}},requiredEncounters={{ids={3285},npcIds={238887},names={}},{ids={3286},npcIds={239008},names={}}}},
  {edition="retail",instanceId=2923,participationBand={difficultyId=23},completion={ids={3287},npcIds={248015},names={}},requiredEncounters={{ids={3285},npcIds={238887},names={}},{ids={3286},npcIds={239008},names={}}}},
  {edition="retail",instanceId=2874,participationBand={difficultyId=1},completion={ids={3214},npcIds={248605},names={}},requiredEncounters={{ids={3212},npcIds={247570},names={}},{ids={3213},npcIds={248595},names={}}}},
  {edition="retail",instanceId=2874,participationBand={difficultyId=2},completion={ids={3214},npcIds={248605},names={}},requiredEncounters={{ids={3212},npcIds={247570},names={}},{ids={3213},npcIds={248595},names={}}}},
  {edition="retail",instanceId=2874,participationBand={difficultyId=23},completion={ids={3214},npcIds={248605},names={}},requiredEncounters={{ids={3212},npcIds={247570},names={}},{ids={3213},npcIds={248595},names={}}}},
  {edition="retail",instanceId=2915,participationBand={difficultyId=1},completion={ids={3328},npcIds={241539},names={}},requiredEncounters={{ids={3333},npcIds={241546},names={}},{ids={3332},npcIds={254227},names={}}}},
  {edition="retail",instanceId=2915,participationBand={difficultyId=2},completion={ids={3328},npcIds={241539},names={}},requiredEncounters={{ids={3333},npcIds={241546},names={}},{ids={3332},npcIds={254227},names={}}}},
  {edition="retail",instanceId=2915,participationBand={difficultyId=23},completion={ids={3328},npcIds={241539},names={}},requiredEncounters={{ids={3333},npcIds={241546},names={}},{ids={3332},npcIds={254227},names={}}}},
  {edition="retail",instanceId=2993,participationBand={difficultyId=1},completion={ids={3458},npcIds={},names={}},requiredEncounters={{ids={3456},npcIds={},names={}},{ids={3457},npcIds={},names={}}}},
  {edition="retail",instanceId=2993,participationBand={difficultyId=2},completion={ids={3458},npcIds={},names={}},requiredEncounters={{ids={3456},npcIds={},names={}},{ids={3457},npcIds={},names={}}}},
  {edition="retail",instanceId=2993,participationBand={difficultyId=23},completion={ids={3458},npcIds={},names={}},requiredEncounters={{ids={3456},npcIds={},names={}},{ids={3457},npcIds={},names={}}}},
  {edition="retail",instanceId=1762,participationBand={difficultyId=2},completion={ids={2143},npcIds={136160},names={}},requiredEncounters={{ids={2139},npcIds={135322},names={}},{ids={2142},npcIds={134993},names={}},{ids={2140},npcIds={},names={}}}},
  {edition="retail",instanceId=1762,participationBand={difficultyId=23},completion={ids={2143},npcIds={136160},names={}},requiredEncounters={{ids={2139},npcIds={135322},names={}},{ids={2142},npcIds={134993},names={}},{ids={2140},npcIds={},names={}}}},
  {edition="retail",instanceId=1877,participationBand={difficultyId=2},completion={ids={2127},npcIds={133392},names={}},requiredEncounters={{ids={2124},npcIds={},names={}},{ids={2125},npcIds={133384},names={}},{ids={2126},npcIds={133389},names={}}}},
  {edition="retail",instanceId=1877,participationBand={difficultyId=23},completion={ids={2127},npcIds={133392},names={}},requiredEncounters={{ids={2124},npcIds={},names={}},{ids={2125},npcIds={133384},names={}},{ids={2126},npcIds={133389},names={}}}},
  {edition="retail",instanceId=2521,participationBand={difficultyId=2},completion={ids={2623},npcIds={},names={}},requiredEncounters={{ids={2609},npcIds={188252},names={}},{ids={2606},npcIds={189232},names={}}}},
  {edition="retail",instanceId=2521,participationBand={difficultyId=23},completion={ids={2623},npcIds={},names={}},requiredEncounters={{ids={2609},npcIds={188252},names={}},{ids={2606},npcIds={189232},names={}}}},
}
-- END GENERATED SOURCE CATALOG

-- Same endpoint shape as the frozen server routes. Only the server decides
-- eligibility, required encounters, presence and points.
function routes.matchesFinal(config, instanceId, difficultyId, encounterId, name)
  local matches = 0
  for _, route in ipairs(config or {}) do
    local proof = route.verification
    local band = route.participationBand
    if proof and type(proof.build) == "string" and proof.build ~= ""
      and type(proof.runRef) == "string" and proof.runRef ~= ""
      and route.instanceId == instanceId and band and band.difficultyId == difficultyId then
      local matched = false
      for _, id in ipairs(route.completion and route.completion.ids or {}) do
        if type(id) == "number" and id > 0 and id == encounterId then matched = true end
      end
      for _, alias in ipairs(route.completion and route.completion.names or {}) do
        if type(name) == "string" and name ~= "" and type(alias) == "string"
          and string.lower(alias) == string.lower(name) then matched = true end
      end
      if matched then matches = matches + 1 end
    end
  end
  return matches == 1
end

function routes.sourceFinal(instanceId, difficultyId, encounterId, npcId)
  local count = 0
  for _, route in ipairs(routes.sourced or {}) do
    if route.edition == ns.util.gameEdition() and route.instanceId == instanceId
      and route.participationBand.difficultyId == difficultyId then
      for _, id in ipairs(npcId and route.completion.npcIds or route.completion.ids) do
        if id == (npcId or encounterId) then count = count + 1 end
      end
    end
  end
  return count == 1
end

-- Classic-only combat log adapter calls this before recording a death.
function routes.knownNpc(instanceId, difficultyId, npcId)
  for _, route in ipairs(routes.sourced or {}) do
    if route.edition == ns.util.gameEdition() and route.instanceId == instanceId
      and route.participationBand.difficultyId == difficultyId then
      local bosses = {route.completion}
      for _, boss in ipairs(route.requiredEncounters) do bosses[#bosses + 1] = boss end
      for _, boss in ipairs(bosses) do
        for _, id in ipairs(boss.npcIds or {}) do if id == npcId then return true end end
      end
    end
  end
  return false
end

function routes.sameBoss(instanceId, difficultyId, a, id, kind)
  if a.id == id and a.kind == kind then return true end
  for _, route in ipairs(routes.sourced or {}) do
    if route.edition == ns.util.gameEdition() and route.instanceId == instanceId
      and route.participationBand.difficultyId == difficultyId then
      local bosses = {route.completion}
      for _, boss in ipairs(route.requiredEncounters) do bosses[#bosses+1] = boss end
      for _, boss in ipairs(bosses) do
        local first, second = false, false
        for _, value in ipairs(a.kind == "npc" and boss.npcIds or boss.ids) do if value == a.id then first = true end end
        for _, value in ipairs(kind == "npc" and boss.npcIds or boss.ids) do if value == id then second = true end end
        if first and second then return true end
      end
    end
  end
  return false
end
