import { comboMap, styleSets, STYLES, type Style } from "./gameplan";
import { itemBuild, listNames, type ItemBuild } from "./item-build";
import { guessEnemyPositions } from "./positions";
import type { Engine } from "./score";
import { traitsOf } from "./traits";
import { POSITIONS, type AllyPick, type Position, type RankBracket } from "./types";
import { draftEdge } from "./win-chance";

/**
 * The game plan once all ten heroes are in: who each player meets in lane, what to buy against
 * these five, how each team wants to win and a short roadmap. Built from the same match data and
 * hand-kept lists as the suggestions, so it shows at once and costs nothing.
 */

/** A lane as our team sees it: our positions there and the enemy positions they usually meet. */
const LANES: { name: string; ours: Position[]; theirs: Position[] }[] = [
  { name: "Safe lane", ours: [1, 5], theirs: [3, 4] },
  { name: "Mid", ours: [2], theirs: [2] },
  { name: "Off lane", ours: [3, 4], theirs: [1, 5] },
];
/** Lane edge in win-rate points beyond which a lane counts as won or hard. */
const LANE_CLEAR_EDGE = 1.5;
/** Matchup edge (win-rate points) of an enemy over one of our heroes that counts as beating it. */
const THREAT_EDGE = 1;
/** Summed edge over our five before an enemy is called their biggest threat. */
const THREAT_TOTAL_EDGE = 2;
/** Heroes in a style before a team counts as playing it. */
const STYLE_MIN = 2;

export type LaneVerdict = "win" | "even" | "hard";

export interface LanePlan {
  name: string;
  ours: number[];
  /** Enemy heroes most likely in this lane, guessed from where each hero is usually played. */
  theirs: number[];
  /** Our heroes' summed matchup edge against theirs, in win-rate points. */
  edge: number;
  verdict: LaneVerdict;
  text: string;
}

export interface PlayerPlan {
  heroId: number;
  position: Position;
  build: ItemBuild | null;
  /** What this player does to win, in a sentence or two. */
  job: string;
}

export interface GamePlan {
  /** How much better our draft is, in win-rate points (see win-chance.ts). */
  edge: number;
  ourStyle: { key: Style; label: string } | null;
  theirStyle: { key: Style; label: string } | null;
  winCondition: string;
  lanes: LanePlan[];
  /** Our combos and the enemy's, as lines to read. */
  ourCombos: string[];
  /** Enemy combos and hard counters to our heroes. */
  fears: string[];
  roadmap: { phase: string; text: string }[];
  players: PlayerPlan[];
}

export interface GamePlanInput {
  /** All five of our heroes with their positions. */
  ours: (AllyPick & { position: Position })[];
  /** All five enemy heroes. */
  theirs: number[];
  rankBracket?: RankBracket;
}

/** Heroes per style, and the style with the most heroes when at least STYLE_MIN share it. */
function teamStyle(ids: number[], styles: Record<Style, Set<number>>) {
  let best: { key: Style; heroes: number } | null = null;
  for (const key of Object.keys(styles) as Style[]) {
    const heroes = ids.filter((id) => styles[key].has(id)).length;
    if (heroes >= STYLE_MIN && (!best || heroes > best.heroes)) best = { key, heroes };
  }
  return best && { key: best.key, label: STYLES[best.key].label };
}

/** Each enemy's most likely position, giving every position to one hero. */
function enemyPositions(engine: Engine, theirs: number[]): Map<Position, number> {
  const odds = guessEnemyPositions(theirs.map((id) => engine.fit(id)));
  const out = new Map<Position, number>();
  const pairs = theirs.flatMap((id, i) => POSITIONS.map((p) => ({ id, p, odds: odds[i]![p] })));
  for (const { id, p } of pairs.sort((a, b) => b.odds - a.odds)) {
    if (!out.has(p) && ![...out.values()].includes(id)) out.set(p, id);
  }
  return out;
}

/** When a team is strongest: late for farming styles, early for push and pick-off. */
function timing(style: Style | undefined): "early" | "late" | null {
  if (style === "lategame") return "late";
  if (style === "push" || style === "pickoff") return "early";
  return null;
}

function winCondition(ours: GamePlan["ourStyle"], theirs: GamePlan["theirStyle"]): string {
  const plan = ours ? `${ours.label}: ${STYLES[ours.key].plan}.` : "No single style: play around your strongest heroes.";
  const ourTiming = timing(ours?.key);
  const theirTiming = timing(theirs?.key);
  if (theirTiming === "late" && ourTiming !== "late") return `${plan} They outscale you, so take fights and towers before 30 minutes.`;
  if (theirTiming === "early" && ourTiming !== "early") return `${plan} They want an early game, so trade safely and defend towers together until your items come.`;
  if (theirs && theirs.key === ours?.key) return `${plan} They play the same way, so the team that opens the fight first wins it.`;
  if (theirs) return `${plan} They play ${theirs.label.toLowerCase()}, so deny them that.`;
  return plan;
}

function laneText(verdict: LaneVerdict, theirNames: string): string {
  if (verdict === "win") return `You should win this lane against ${theirNames}: trade often and pressure them.`;
  if (verdict === "hard") return `Hard lane against ${theirNames}: farm safely, give up kills less than you give up creeps.`;
  return `Even lane against ${theirNames}: the better last hits win it.`;
}

/** Items under this cost don't change a fight, so they are not named as a timing. */
const KEY_ITEM_MIN_COST = 2000;

/** First big item of the build, to name the player's timing. */
function keyItem(engine: Engine, build: ItemBuild | null) {
  return build?.core.find((i) => (engine.data.items?.[i.itemId]?.cost ?? 0) >= KEY_ITEM_MIN_COST);
}

function playerJob(position: Position, name: string, isInitiator: boolean, item: ItemBuild["core"][number] | undefined, combo?: string): string {
  const timingText = item ? ` Your timing is ${item.name} around minute ${item.minute}.` : "";
  const comboText = combo ? ` Set up ${combo}.` : "";
  switch (position) {
    case 1:
      return `Farm and carry the late game; join fights once your items are in.${timingText}${comboText}`;
    case 2:
      return `Win your lane, then use runes to help the side lanes.${timingText}${comboText}`;
    case 3:
      return isInitiator
        ? `Make their carry's lane hard, then start the team's fights as ${name}.${timingText}${comboText}`
        : `Make their carry's lane hard and soak damage at the front in fights.${timingText}${comboText}`;
    case 4:
      return `Help win the off lane, then look for kills around the map with your mid.${timingText}${comboText}`;
    case 5:
      return `Keep your carry alive in lane and place vision; save your key spell for their dive.${timingText}${comboText}`;
  }
}

/** The game plan for a finished draft. Needs all ten heroes. */
export function gamePlan(engine: Engine, input: GamePlanInput): GamePlan {
  if (input.ours.length !== 5 || input.theirs.length !== 5) throw new Error("A game plan needs all ten heroes");
  const bracket = input.rankBracket;
  const ourIds = input.ours.map((p) => p.heroId);
  const name = (id: number) => engine.hero(id).name;
  const styles = styleSets(engine.heroes);
  const combos = comboMap(engine.heroes);
  const pairCombos = (ids: number[]) =>
    ids.flatMap((a, i) =>
      ids.slice(i + 1).flatMap((b) => {
        const text = combos.get(a < b ? `${a}-${b}` : `${b}-${a}`);
        return text ? [{ a, b, text }] : [];
      }),
    );

  const ourStyle = teamStyle(ourIds, styles);
  const theirStyle = teamStyle(input.theirs, styles);
  const ourCombos = pairCombos(ourIds);
  const theirCombos = pairCombos(input.theirs);

  const theirByPos = enemyPositions(engine, input.theirs);
  const lanes = LANES.map((lane): LanePlan => {
    const ours = input.ours.filter((p) => lane.ours.includes(p.position)).map((p) => p.heroId);
    const theirs = lane.theirs.flatMap((p) => (theirByPos.has(p) ? [theirByPos.get(p)!] : [])); // has() checked.
    const edge = ours.reduce((s, o) => s + theirs.reduce((t, x) => t + engine.matchupEdge(o, x, bracket), 0), 0);
    const verdict: LaneVerdict = edge >= LANE_CLEAR_EDGE ? "win" : edge <= -LANE_CLEAR_EDGE ? "hard" : "even";
    return { name: lane.name, ours, theirs, edge: round(edge), verdict, text: laneText(verdict, listNames(theirs.map(name))) };
  });

  // The enemy hero who beats the most of our heroes, by summed matchup edge.
  const threat = input.theirs
    .map((t) => ({ t, beats: ourIds.filter((o) => engine.matchupEdge(t, o, bracket) >= THREAT_EDGE), edge: ourIds.reduce((s, o) => s + engine.matchupEdge(t, o, bracket), 0) }))
    .sort((a, b) => b.edge - a.edge)[0];
  const fears = [
    ...(threat && threat.edge >= THREAT_TOTAL_EDGE && threat.beats.length
      ? [`${name(threat.t)} is their biggest threat: strong against ${listNames(threat.beats.map(name))}. Focus or lock them down first`]
      : []),
    ...theirCombos.map((c) => `${name(c.a)} + ${name(c.b)}: ${c.text}`),
    ...input.ours.flatMap((p) => {
      const counters = engine
        .hardCounterNotes(p.heroId, { allies: input.ours, enemies: input.theirs })
        .filter((n) => n.status === "enemy")
        .map((n) => name(n.counterId));
      return counters.length ? [`${name(p.heroId)} is hard countered by ${listNames(counters)}: play carefully around them`] : [];
    }),
  ].filter((line, i, all) => all.indexOf(line) === i);

  const players = input.ours.map((p): PlayerPlan => {
    const build = itemBuild(engine.data, p.heroId, p.position, input.theirs);
    const combo = ourCombos.find((c) => c.a === p.heroId || c.b === p.heroId);
    const partner = combo && name(combo.a === p.heroId ? combo.b : combo.a);
    const isInitiator = traitsOf(engine.hero(p.heroId)).has("initiation");
    return {
      heroId: p.heroId,
      position: p.position,
      build,
      job: playerJob(p.position, name(p.heroId), isInitiator, keyItem(engine, build), combo && `${combo.text} with ${partner}`),
    };
  });

  const wonLane = lanes.find((l) => l.verdict === "win");
  const hardLane = lanes.find((l) => l.verdict === "hard");
  const ourTiming = timing(ourStyle?.key);
  const theirTiming = timing(theirStyle?.key);
  const firstCombo = ourCombos[0];
  const roadmap = [
    {
      phase: "Laning (0 to 10 min)",
      text: [
        wonLane ? `Press your edge in the ${wonLane.name.toLowerCase()}.` : "No lane is clearly yours: farm and trade evenly.",
        hardLane ? `Help the ${hardLane.name.toLowerCase()} with rotations and smoke ganks.` : "",
      ].filter(Boolean).join(" "),
    },
    {
      phase: "Mid game (10 to 25 min)",
      text:
        ourTiming === "early" || theirTiming === "late"
          ? "This is your window: group up, take towers and Roshan before their carries are ready."
          : theirTiming === "early"
            ? "Their strongest time: defend high ground together and fight only on your terms."
            : `Fight around your core items${firstCombo ? ` and open with ${firstCombo.text}` : ""}.`,
    },
    {
      phase: "Late game (25 min on)",
      text:
        ourTiming === "late" || theirTiming === "early"
          ? "You are stronger now: take Roshan, then end with the Aegis."
          : theirTiming === "late"
            ? "Their carries are stronger: fight only with buyback and a big opening spell, never in a long fight."
            : "Keep vision on Roshan and catch one hero before each objective.",
    },
  ];

  return {
    edge: round(draftEdge(engine, ourIds, input.theirs, bracket)),
    ourStyle,
    theirStyle,
    winCondition: winCondition(ourStyle, theirStyle),
    lanes,
    ourCombos: ourCombos.map((c) => `${name(c.a)} + ${name(c.b)}: ${c.text}`),
    fears,
    roadmap,
    players,
  };
}

const round = (x: number) => Math.round(x * 10) / 10;
