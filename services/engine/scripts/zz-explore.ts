import { readFileSync } from "node:fs";
import { Engine, clearMatchup } from "../src/engine/score";
import { traitsOf } from "../src/engine/traits";
const engine = new Engine(JSON.parse(readFileSync(process.argv[2]!, "utf8")));
const id = (n: string) => engine.heroes.find((h) => h.name === n)!.id;
const team = process.argv[3]!.split(",").map(id);
const br = 6 as const;
for (let i = 0; i < team.length; i++) for (let j = i + 1; j < team.length; j++) {
  const a = team[i]!, b = team[j]!;
  const key = a < b ? `${a}-${b}` : `${b}-${a}`;
  const gw = engine.data.synergy[key];
  const e = engine.synergyEdge(a, b, br), err = engine.synergyError(a, b);
  console.log(engine.hero(a).name, "+", engine.hero(b).name, "edge", e.toFixed(2), "err", err.toFixed(2), "clear", clearMatchup({ edge: e, error: err }), "games", gw?.games, "wr", gw ? (gw.wins / gw.games * 100).toFixed(1) : "-");
}
for (const h of team) {
  const s = engine.data.bracketStats[h]!;
  console.log(engine.hero(h).name, "wr@6", (engine.winRate(h, br) * 100).toFixed(1), "games@6", s.picks[5], "roles", engine.hero(h).roles.join("/"), "traits", [...traitsOf(engine.hero(h))].join(","), "fit", JSON.stringify(engine.fit(h)));
}
