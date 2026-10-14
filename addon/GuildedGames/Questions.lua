local _, ns = ...
-- Answers are exact, case-insensitive chat messages. Packs avoid patch-dependent facts.
ns.questions = {
  en = {
    { q = "How many sides does a triangle have?", a = { "3", "three" } },
    { q = "What is 7 times 8?", a = { "56" } },
    { q = "Which planet is called the red planet?", a = { "mars" } },
    { q = "What is the opposite of north?", a = { "south" } },
    { q = "How many minutes are in two hours?", a = { "120" } },
    { q = "Which chess piece moves in an L shape?", a = { "knight", "the knight" } },
    { q = "What is the largest ocean on Earth?", a = { "pacific", "pacific ocean" } },
    { q = "How many strings does a standard violin have?", a = { "4", "four" } },
    { q = "What is the square root of 81?", a = { "9", "nine" } },
    { q = "Which metal has the chemical symbol Fe?", a = { "iron" } },
  },
  fr = {
    { q = "Combien de cotes a un triangle?", a = { "3", "trois" } },
    { q = "Combien font 7 fois 8?", a = { "56" } },
    { q = "Quelle planete est appelee la planete rouge?", a = { "mars" } },
    { q = "Quel est le contraire du nord?", a = { "sud" } },
    { q = "Combien de minutes dans deux heures?", a = { "120" } },
    { q = "Quelle piece d'echecs se deplace en L?", a = { "cavalier", "le cavalier" } },
    { q = "Quel est le plus grand ocean?", a = { "pacifique", "ocean pacifique" } },
    { q = "Combien de cordes a un violon standard?", a = { "4", "quatre" } },
    { q = "Quelle est la racine carree de 81?", a = { "9", "neuf" } },
    { q = "Quel metal a le symbole chimique Fe?", a = { "fer", "le fer" } },
  }
}
