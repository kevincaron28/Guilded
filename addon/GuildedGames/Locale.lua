local _, ns = ...
local FR = {
  ["Team"] = "\195\137quipe",
  ["Duel: host and chosen opponent alternate rolls. First to roll 1 loses. No gold."] = "Duel : l'organisateur et l'adversaire jouent \195\160 tour de r\195\180le. Le premier 1 perd. Sans or.",
  ["Open the host window after combat."] = "Ouvrez la fen\195\170tre apr\195\168s le combat.",
  ["Finish Guilded's loot roll before hosting a game."] = "Terminez le jet de butin Guilded avant de lancer un jeu.",
  high = "Grand jet", death = "\195\137limination", duel = "Duel", target = "Cible", trivia = "Quiz",
  JOINING = "Inscriptions", READY = "Pr\195\170t", ROLLING = "Jets en cours", ANSWERING = "R\195\169ponses",
  out = "\195\169limin\195\169", waiting = "en attente",
  ["High roll"] = "Grand jet", ["Deathroll"] = "\195\137limination", ["Duel"] = "Duel",
  ["Closest target"] = "Proche de la cible", ["Trivia"] = "Quiz", ["Team trivia"] = "Quiz en \195\169quipes",
  ["Next round"] = "Manche suivante", ["Join myself"] = "Participer", ["Remove player"] = "Retirer le joueur",
  ["Skip question"] = "Passer la question", ["Cancel"] = "Annuler", ["Confirm cancel"] = "Confirmer",
  ["Rematch"] = "Rejouer", ["History"] = "Historique", ["Back"] = "Retour",
  ["Player / duel opponent (name-realm)"] = "Joueur / adversaire (nom-royaume)",
  ["Five rounds for Target and Trivia. Teams alternate A/B on joining."] = "Cinq manches pour Cible et Quiz. \195\137quipes A/B attribu\195\169es en alternance.",
  ["Choose a game or rematch. Only the host needs this addon."] = "Choisissez un jeu. Seul l'organisateur a besoin de cet addon.",
  ["Finish or cancel the current game first."] = "Terminez ou annulez le jeu en cours.",
  ["Join a party or raid first."] = "Rejoignez d'abord un groupe ou raid.",
  ["Choose another player in your group."] = "Choisissez un autre joueur de votre groupe.",
  ["Type 1 to join, out to leave. Only the host needs the addon. No gold."] = "Tapez 1 pour participer, out pour quitter. Seul l'organisateur a besoin de l'addon. Sans or.",
  ["At least two players must join."] = "Il faut au moins deux joueurs.",
  ["Winner: %s"] = "Victoire : %s",
  ["Round complete. Host: Next round when ready."] = "Manche termin\195\169e. Organisateur : lancez la suivante quand le groupe est pr\195\170t.",
  ["Tie: only tied players roll again. See host for names."] = "\195\137galit\195\169 : seuls les joueurs \195\160 \195\169galit\195\169 relancent. Noms annonc\195\169s par l'organisateur.",
  ["%s: /roll %d"] = "%s : /roll %d",
  ["Eliminated: %s"] = "\195\137limin\195\169 : %s", ["Point: %s"] = "Point : %s",
  ["Round %d: %s"] = "Manche %d : %s",
  ["One answer each in group chat. First correct answer scores. Host can skip."] = "Une r\195\169ponse chacun dans le groupe. La premi\195\168re bonne r\195\169ponse marque. L'organisateur peut passer.",
  ["Round %d: target %d. Everyone /roll 100. Closest scores; ties share a point."] = "Manche %d : cible %d. Tous /roll 100. Le plus proche marque ; \195\169galit\195\169 = un point chacun.",
  ["Round %d: everyone /roll %d. %s"] = "Manche %d : tous /roll %d. %s",
  ["Highest wins."] = "Le plus haut gagne.", ["Lowest is eliminated."] = "Le plus bas est \195\169limin\195\169.",
  ["Removed: %s. Current round abandoned; no point awarded."] = "Retrait : %s. Manche abandonn\195\169e ; aucun point attribu\195\169.",
  ["Correct: %s. Answer: %s"] = "Correct : %s. R\195\169ponse : %s",
  ["Answer: %s. No point this round."] = "R\195\169ponse : %s. Aucun point cette manche.",
  ["Game cancelled. No result saved."] = "Jeu annul\195\169. Aucun r\195\169sultat enregistr\195\169.",
  ["No completed matches yet."] = "Aucune partie termin\195\169e.",
  ["Game error; cancel and restart."] = "Erreur du jeu ; annulez et recommencez.",
}
function ns.language()
  return GuildedGamesDB and GuildedGamesDB.language or (GetLocale and GetLocale() == "frFR" and "fr" or "en")
end
-- Internal keys shown in the window (game and phase) get readable English names too: the
-- lobby used to read "high - JOINING - 0/5".
local EN = {
  high = "High roll", death = "Deathroll", duel = "Duel", target = "Closest target", trivia = "Trivia",
  JOINING = "Joining", READY = "Ready", ROLLING = "Rolling", ANSWERING = "Answering",
}
function ns.L(text) return ns.language() == "fr" and FR[text] or EN[text] or text end
