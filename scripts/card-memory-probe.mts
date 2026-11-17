// Renders many varied cards and prints memory. Usage: npx tsx scripts/card-memory-probe.mts [limits]   ("limits" applies src/memory-limits.ts first)
import sharp from "sharp";
import { scoreCardPng } from "../src/services/score-card.js";
import { applySharpLimits } from "../src/memory-limits.js";
if (process.argv[2] === "limits") applySharpLimits();
const mb = (n: number) => (n / 1048576).toFixed(0);
const report = (label: string) => { const m = process.memoryUsage(); console.log(`${label.padEnd(10)} rss ${mb(m.rss)} MB  heap ${mb(m.heapUsed)}  external ${mb(m.external)}  arrayBuffers ${mb(m.arrayBuffers)}  sharp.cache ${JSON.stringify(sharp.cache())}`); };
const classes = ["Warrior", "Mage", "Rogue", "Priest", "Druid", "Hunter", "Paladin", "Warlock", "Shaman"];
report("start");
for (let i = 0; i < 200; i++) {
  await scoreCardPng({ title: `Card ${i}`, subtitle: `Saison 1 · Niveau ${15 + (i % 15)}`, stats: [{ label: "Temps", value: `${i}:00`, note: "Cible 22:00" }, { label: "Score", value: String(200 + i) }],
    rows: classes.map((c, j) => ({ name: `Joueur${i}-${j}`, sub: c, right: j % 3 ? "DPS" : "Tank", color: "#c79c6e" })), rowsLabel: "Groupe", badges: [{ text: "Confirmé", tone: "ok" }], footer: "Rapport" });
  if (i % 50 === 49) report(`after ${i + 1}`);
}
if (global.gc) global.gc();
report("end");
