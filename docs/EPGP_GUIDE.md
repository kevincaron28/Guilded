# Guilded: EPGP and loot workflow

Use this guide to agree on a point policy, record a raid, and check the result.
Guilded's addon can manage points and publish standings **without Discord**.
Optional Discord integration adds shared core rules, prices, history and import review.
Instructions here apply to the shipped 6.5.x workflow on WoW Forever 1.60.1;
your guild permissions and selected modules determine the controls you see.

## 1. Agree on the rules before awarding anything

- **EP (effort points)** records the participation your guild chooses to reward.
- **GP (gear points)** records the gear cost your guild assigns.
- **PR (priority)** is `EP / (GP + base GP)`. As in EPGP, GP counts as at least 1, so a
  raider with EP and no gear yet ranks by their EP. Base GP and minimum-EP eligibility
  are guild/core rules, not universal values.
- Choose the correct **core and point pool**. Two cores may keep separate points;
  compare standings within the same pool. Some guilds require a core for every award.
- Name the officer recording awards and agree on attendance, bench credit, prices,
  off-spec costs and any decay policy. Do not change those rules mid-award.

For example only, 1,000 EP with 100 GP and 100 base GP gives PR 5. These numbers
are an explanation, not recommended defaults or a sample of a real player.

## 2. Run an addon-only raid

1. An authorized officer opens Guilded from the gold minimap coin. Select the
   intended local core and roster before starting the raid.
2. Start on the Raid page, or use `/guilded start <raid title>`. Record attendance
   and boss kills. In 6.5.x, **From core roster** marks present and absent mains
   from the selected roster; the bench is left alone. Review the result.
3. On the EPGP page, select the correct player and amount. Add a meaningful reason.
   `/guilded award <player> <amount> <reason>` awards EP; `/guilded gp <player> <amount> <reason>`
   charges GP. These change records: use your guild's agreed amounts, not the example above.
4. Handle loot using the chosen method below. End the raid and inspect its summary.
5. The record-keeping officer can use `/guilded standings publish` to share current
   standings with online guildmates. `/guilded history` requests your recent EP/GP
   and loot history from an online officer who has those records. It does not
   retrieve an unavailable offline officer's data.
6. `/reload` or logout saves data to disk. Keep SavedVariables backups before updates.

Do not have several officers independently record the same award. Use the local
core's record-keeper/handover controls when another officer takes over.

## 3. Keep the four loot methods distinct

| Method | What decides the award |
| --- | --- |
| GP bidding | The submitted GP bids under your raid's rules. |
| Loot council | Your authorized council's decision, informed by player responses. |
| Soft reserves | The reserve list and the applicable roll/SR+ rules. |
| EPGP priority | The eligible interested player's priority and configured item price. |

An officer starts a session with `/guilded drop <item>` or the loot panel.
Addon users can respond in the popup; the supported whisper route lets players
without Guilded respond. Off-spec pricing, minimum EP and item prices depend on
your selected rules. Selecting EPGP does not turn council or reserve awards into bids.

## 4. Optional: use your guild's Discord rules and imports

First complete [pilot approval or independent setup](HOSTED_PILOT.md), then
[personal pairing](MEMBER_INSTALL.md). In the bot, raid leaders can use
`/core setup` and `/core edit` for rosters/rules and `/core items` for GP prices.
The companion's **Cores & prices** screen uses your existing Discord permissions.
Pairing never grants officer access.

After recording in game, `/reload`, sync the correct saved-data file, and inspect
the import outcome. If automatic import is disabled, an officer reviews with
`/import apply`. `/import held` explains unresolved entries. A connected core's
loot must match its Discord raid; missing character links or the wrong core need review.
**Do not award again just because an entry is held:** some parts may already be applied.

Refresh/save returned standings, choose `/guilded setup connected` when you want
Discord standings in game, and `/reload`. Check the same core's character, EP,
GP and history in both places. Members can inspect `/epgp balance` and
`/epgp history`; specify the intended core when needed.

## 5. Verify one complete cycle

- The intended character and core are selected.
- One attendance award and one loot record appear once, with the expected reason.
- A regular member sees the correct standings and cannot award officer points.
- Reloading preserves the records; connected guilds also check import status and returned standings.
- For a mistake, review history first. Addon `/guilded undo` reverses your last
  eligible EP/GP award; Discord `/officer epgp reverse` retains history with an opposite entry.
  These are correction actions, not a reason to delete SavedVariables or re-import blindly.

If you need help, provide versions, client build, selected workflow, steps and the
exact message. Redact names, guild identifiers and private codes. Use the
[GitHub issue tracker](https://github.com/kevincaron28/Guilded/issues) or
[K Caron Projects Discord](https://discord.gg/YjzFwtP64V). Downloading and addon-only
play do not require joining Discord.

<section id="fr" lang="fr" aria-label="Guide EPGP en français">

## EPGP et butin : le parcours en français

L'addon peut gérer les points et partager les classements sans Discord. La
connexion facultative ajoute les règles et tarifs des cores, les historiques
et la révision des imports. Ce guide décrit les fonctions livrées en 6.5.x pour
WoW Forever 1.60.1; vos permissions et modules déterminent les contrôles visibles.

### Avant le raid

Les **EP** représentent la participation récompensée; les **GP**, le coût du
butin. La priorité est `PR = EP / (GP + GP de base)`; comme dans EPGP, les GP comptent
pour au moins 1, donc un raider avec des EP et sans butin est classé selon ses EP. Les GP de base, le minimum d'EP et les tarifs dépendent
du règlement de votre guilde ou core. Comparez toujours le même groupe de points.
Par exemple fictif, 1 000 EP, 100 GP et 100 GP de base donnent une priorité de 5.

Choisissez le core, le responsable des écritures, les règles de présence et de
banc, les coûts hors spécialisation et la politique de décroissance éventuelle.
Certains serveurs exigent un core pour chaque attribution. Deux cores peuvent
avoir des comptes séparés; ne mélangez pas leurs classements.

### Enregistrer en jeu sans Discord

1. Un officier autorisé ouvre la pièce dorée, sélectionne le core local et son roster.
2. Démarrez le raid dans la page Raid ou avec `/guilded start <titre>`. Contrôlez
   la présence et les boss. **From core roster** marque les principaux présents
   et absents du roster choisi, sans changer le banc; vérifiez les noms.
3. Dans EPGP, choisissez le bon joueur, le montant convenu et une raison.
   `/guilded award <joueur> <montant> <raison>` attribue des EP;
   `/guilded gp <joueur> <montant> <raison>` ajoute des GP.
4. Terminez le raid et vérifiez le bilan. Le responsable publie les classements
   avec `/guilded standings publish`. `/guilded history` demande votre historique
   à un officier en ligne qui possède les écritures.
5. Faites `/reload` ou déconnectez-vous pour enregistrer. Sauvegardez SavedVariables
   avant les mises à jour. Utilisez le transfert de responsable du core plutôt
   que d'enregistrer deux fois les mêmes points sur deux ordinateurs.

### Choisir une méthode de butin

- **Enchères GP :** les offres GP selon les règles du raid.
- **Conseil :** la décision du conseil autorisé, éclairée par les réponses.
- **Réserves :** la liste de réservations et les règles de jets/SR+.
- **Priorité EPGP :** la priorité du joueur intéressé admissible et le tarif configuré.

L'officier ouvre une session avec `/guilded drop <objet>` ou le panneau de butin.
Les utilisateurs de Guilded répondent dans la fenêtre; les réponses par message
privé permettent aussi de participer sans l'addon. Vérifiez les règles de prix
et hors spécialisation avant de confirmer.

### Connexion Discord facultative

Après l'approbation du pilote ou l'installation indépendante, configurez les
cores et associez chaque membre. Les chefs utilisent `/core setup`, `/core edit`
et `/core items`; **Cores & prices** dans le compagnon respecte les permissions
Discord existantes. La liaison ne donne aucun droit d'officier.

Après `/reload`, synchronisez le bon fichier et lisez le résultat. Un import peut
attendre `/import apply`; `/import held` explique les éléments à corriger.
Le butin d'un core connecté doit correspondre à son raid Discord. Une liaison
manquante ou un mauvais core nécessite une révision. **N'attribuez pas à nouveau
des points parce qu'une ligne est retenue : une partie peut déjà être appliquée.**

Enregistrez les classements retournés, choisissez `/guilded setup connected`
pour les utiliser, puis faites `/reload`. Comparez personnage, core, EP, GP et
historique. `/epgp balance` et `/epgp history` permettent la vérification côté Discord.

### Contrôler et corriger

Vérifiez une attribution de présence et un butin enregistrés une seule fois,
les permissions d'un membre ordinaire et la conservation après rechargement.
Relisez l'historique avant toute correction. `/guilded undo` annule votre dernière
attribution EP/GP admissible; `/officer epgp reverse` ajoute une écriture opposée sur
Discord en conservant l'historique. Ne supprimez pas SavedVariables pour corriger un montant.

Pour un signalement utile : versions, build du client, core, étapes et message
exact, avec les données personnelles anonymisées. [Installation](MEMBER_INSTALL.md#fr)
et [pilote facultatif](HOSTED_PILOT.md#fr). Aucun paiement ni inscription Discord
n'est nécessaire pour télécharger l'addon et l'utiliser seul.

</section>
