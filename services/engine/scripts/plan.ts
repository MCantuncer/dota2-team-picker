/**
 * Try a WCST team plan from the command line:
 *
 *   npm run plan -- --slots "1:Juggernaut|Faceless Void,2:Storm Spirit|Puck,5:Dazzle" --enemies "Pudge,Anti-Mage"
 *
 * Each slot is a position, a colon and that player's favorite heroes split by
 * "|". Put "=" before a hero that is already picked ("2:=Puck"). Positions
 * left out are planned without a player.
 */
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { planTeam, type PlanSlot } from "../src/engine/plan";
import { Engine } from "../src/engine/score";
import type { Position, RankBracket, Snapshot } from "../src/engine/types";

const { values } = parseArgs({
  options: {
    slots: { type: "string", default: "" },
    enemies: { type: "string", default: "" },
    bans: { type: "string", default: "" },
    rank: { type: "string" },
    data: { type: "string", default: "data/snapshot.json" },
  },
});

const engine = new Engine(JSON.parse(readFileSync(values.data!, "utf8")) as Snapshot);
const key = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

function findHero(name: string): number {
  const k = key(name);
  const exact = engine.heroes.find((h) => key(h.name) === k);
  const matches = exact ? [exact] : engine.heroes.filter((h) => key(h.name).includes(k));
  if (matches.length !== 1) {
    const hint = matches.length ? `could be ${matches.map((h) => h.name).join(", ")}` : "no hero matches";
    console.error(`"${name}": ${hint}`);
    process.exit(1);
  }
  return matches[0]!.id;
}

const list = (s: string, sep = ",") => s.split(sep).map((x) => x.trim()).filter(Boolean);

const slots: PlanSlot[] = list(values.slots!).map((entry) => {
  const [p, heroes = ""] = entry.split(":");
  const position = Number(p) as Position;
  if (![1, 2, 3, 4, 5].includes(position)) {
    console.error(`"${entry}": start each slot with a position 1..5`);
    process.exit(1);
  }
  const names = list(heroes, "|");
  const picked = names.find((n) => n.startsWith("="));
  return {
    position,
    heroId: picked ? findHero(picked.slice(1)) : undefined,
    favorites: names.filter((n) => !n.startsWith("=")).map(findHero),
  };
});

const plan = planTeam(engine, {
  slots,
  enemies: list(values.enemies!).map(findHero),
  bans: list(values.bans!).map(findHero),
  rankBracket: values.rank ? (Number(values.rank) as RankBracket) : undefined,
});

for (const s of plan.slots) {
  const tag = s.locked ? " (picked)" : s.inPool ? "" : " (outside pool)";
  console.log(`Pos ${s.position}: ${s.name}${tag}`);
  for (const r of s.reasons) console.log(`     - ${r}`);
  if (s.alternatives.length) {
    const alts = s.alternatives.map((a) => `${a.name}${a.inPool ? "" : "*"} ${a.scoreDelta.toFixed(1)}`);
    console.log(`     backups: ${alts.join(", ")}`);
  }
}
console.log(`Team score ${plan.score >= 0 ? "+" : ""}${plan.score.toFixed(1)}`);
if (plan.missing.length) console.log(`Still missing: ${plan.missing.join(", ")}`);
