/**
 * Try the engine from the command line:
 *
 *   npm run suggest -- --pos 2 --allies "Lion:5,Pudge" --enemies "Invoker,Axe" --rank 6 --favorites "Storm Spirit"
 *
 * Heroes are matched by name, ignoring case and punctuation ("am" will not
 * work, "anti" will). Ally positions go after a colon and are optional.
 */
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { Engine } from "../src/engine/score";
import type { AllyPick, Position, RankBracket, Snapshot } from "../src/engine/types";

const { values } = parseArgs({
  options: {
    pos: { type: "string" },
    allies: { type: "string", default: "" },
    enemies: { type: "string", default: "" },
    bans: { type: "string", default: "" },
    rank: { type: "string" },
    favorites: { type: "string", default: "" },
    count: { type: "string", default: "8" },
    data: { type: "string", default: "data/snapshot.json" },
    details: { type: "boolean", default: false },
  },
});

const pos = Number(values.pos);
if (![1, 2, 3, 4, 5].includes(pos)) {
  console.error("Pass your position with --pos 1..5");
  process.exit(1);
}

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

const list = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);

const allies: AllyPick[] = list(values.allies!).map((entry) => {
  const [name, p] = entry.split(":");
  return { heroId: findHero(name!), position: p ? (Number(p) as Position) : undefined };
});

const suggestions = engine.suggest({
  myPosition: pos as Position,
  allies,
  enemies: list(values.enemies!).map(findHero),
  bans: list(values.bans!).map(findHero),
  rankBracket: values.rank ? (Number(values.rank) as RankBracket) : undefined,
  favorites: list(values.favorites!).map(findHero),
  count: Number(values.count),
});

suggestions.forEach((s, i) => {
  console.log(`${i + 1}. ${s.name}  ${s.score >= 0 ? "+" : ""}${s.score.toFixed(1)}`);
  for (const r of s.reasons) console.log(`     - ${r}`);
  if (values.details) console.log(`     ${JSON.stringify(s.breakdown)}`);
});
