import { SURE_POSITION_ODDS, chooseDangerHeroes, dangerLine } from "./danger";
import { pickFallbacks, type Scaling } from "./fallbacks";
import { enemyList, type EnemyNote } from "./enemy-list";
import { laneAdjusted } from "./lane-items";
import type { MatchupGame } from "./matchup-talents";
import { skillPlan, type SkillPlan } from "./skill-plan";
import { gameStory, ourWindow, type Story, type Timing } from "./story";
import { comboMap, styleSets, STYLES, type Style } from "./gameplan";
import { isUpgradedBoots, itemBuild, listNames, type BuildItem, type ItemBuild } from "./item-build";
import { guessEnemyPositions, type PositionFit } from "./positions";
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
/**
 * An enemy counts as a core (and, in the pos 1 slot, as their carry) when players put the hero in
 * pos 1 to 3 at least this often...
 */
const CORE_SHARE = 0.5;
/**
 * ...or when the hero is played in their guessed core slot this often and the guess is sure: a
 * flex carry like Vengeful Spirit (pos 1 in 1 game of 5). The position guess always fills pos 1,
 * so a hero who is never played there (Witch Doctor) still doesn't become "their carry".
 */
const FLEX_SHARE = 0.15;

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
  /** What to do if their lane or items go wrong, at most two lines. */
  fallbacks: string[];
  /** The five enemies as this player meets them, in-lane first (see enemy-list.ts). */
  enemies: EnemyNote[];
  /** Skill order and talent tree with reasons, when the snapshot has this hero's abilities. */
  skills?: SkillPlan;
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
  /** The one or two enemies who decide the game, with when they come online and our answer. */
  danger: string[];
  roadmap: { phase: string; text: string }[];
  players: PlayerPlan[];
  /** What the team does if it is behind or ahead at 20 minutes. */
  teamFallbacks: string[];
  /** The game in four timed chapters with a one-line headline. */
  story: Story;
}

export interface GamePlanInput {
  /** All five of our heroes with their positions. */
  ours: (AllyPick & { position: Position })[];
  /** All five enemy heroes. */
  theirs: number[];
  rankBracket?: RankBracket;
  /**
   * The live matchup lookup's games for each of our heroes against these enemies, by hero id. Leave
   * it out while the lookup runs. null means the lookup failed or was refused; a hero missing from
   * an answered lookup had no games.
   */
  matchups?: Record<number, MatchupGame[]> | null;
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

/** Each enemy's most likely position, giving every position to one hero, from their position odds. */
function enemyPositions(theirs: number[], odds: PositionFit[]): Map<Position, number> {
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

/**
 * The item that decides the player's timing: Blink Dagger for a non-carry who starts fights and
 * buys one (Tidehunter, Magnus, Lion start fights with it, whatever they buy first), else the first
 * big item of the build. A carry's timing stays its farming item (Wraith King's Radiance).
 */
function keyItem(engine: Engine, build: ItemBuild | null, heroId: number | undefined, position: Position) {
  const isBlink = (i: BuildItem) => engine.data.items?.[i.itemId]?.key === "blink";
  const startsFights = position !== 1 && heroId !== undefined && traitsOf(engine.hero(heroId)).has("initiation");
  const blink = startsFights ? build?.core.find(isBlink) : undefined;
  // Boots of Travel costs enough, but it moves a hero; it doesn't win fights.
  return blink ?? build?.core.find((i) => (engine.data.items?.[i.itemId]?.cost ?? 0) >= KEY_ITEM_MIN_COST && !isUpgradedBoots(engine.data.items?.[i.itemId]));
}

function playerJob(
  position: Position,
  name: string,
  isInitiator: boolean,
  item: ItemBuild["core"][number] | undefined,
  window: Timing,
  hasCarry: boolean,
  combo?: string,
): string {
  const theirLane = hasCarry ? "their carry's lane" : "their safe lane";
  const timingText = item ? ` Your timing is ${item.name} around minute ${item.minute}.` : "";
  const comboText = combo ? ` Set up ${combo}.` : "";
  switch (position) {
    case 1:
      return window === "early"
        ? `Farm fast, then join every push: this game should end before 30 minutes.${timingText}${comboText}`
        : `Farm and carry the late game; join fights once your items are in.${timingText}${comboText}`;
    case 2:
      return `Win your lane, then use runes to help the side lanes.${timingText}${comboText}`;
    case 3:
      return isInitiator
        ? `Make ${theirLane} hard, then start the team's fights as ${name}.${timingText}${comboText}`
        : `Make ${theirLane} hard and soak damage at the front in fights.${timingText}${comboText}`;
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

  const theirOdds = guessEnemyPositions(input.theirs.map((id) => engine.fit(id)));
  const theirByPos = enemyPositions(input.theirs, theirOdds);
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

  /** Whether the enemy plays core in their guessed slot (see CORE_SHARE and FLEX_SHARE). */
  const playsCore = (id: number, position: Position) => {
    const fit = engine.fit(id);
    if (position > 3) return false;
    if (fit[1] + fit[2] + fit[3] >= CORE_SHARE) return true;
    return fit[position] >= FLEX_SHARE && (theirOdds[input.theirs.indexOf(id)]?.[position] ?? 0) >= SURE_POSITION_ODDS;
  };
  const isCore = (id: number) => [...theirByPos].some(([pos, h]) => h === id && playsCore(id, pos));
  const threats = input.theirs
    .filter(isCore)
    .map((t) => ({ t, edge: ourIds.reduce((s, o) => s + engine.matchupEdge(t, o, bracket), 0) }))
    .filter((e) => e.edge >= THREAT_TOTAL_EDGE)
    .sort((a, b) => b.edge - a.edge)
    .map((e) => e.t);
  const guessedCarry = theirByPos.get(1);
  const theirCarry = guessedCarry !== undefined && playsCore(guessedCarry, 1) ? guessedCarry : undefined;
  /**
   * An enemy's key item, the one their power comes from, only when its minute can be trusted: the
   * hero's position is a sure guess, and the build is for that position. STRATZ timings are; a rough
   * OpenDota build ("around") mixes every position, so it only counts for a hero who mostly plays
   * this one. A support's Manta Style "around 28" from carry games is worse than no minute.
   */
  const sureKeyItem = (id: number, position: Position) => {
    if ((theirOdds[input.theirs.indexOf(id)]?.[position] ?? 0) < SURE_POSITION_ODDS) return undefined;
    const build = itemBuild(engine.data, id, position, [], bracket);
    const exact = build?.timings !== "around";
    if (!exact && engine.fit(id)[position] < SURE_POSITION_ODDS) return undefined;
    const item = keyItem(engine, build, id, position);
    return item && { itemId: item.itemId, name: item.name, minute: item.minute, exact };
  };
  // Their cores who start fights with a Blink Dagger, from a sure minute, earliest first.
  const initiators = [...theirByPos]
    .filter(([, id]) => isCore(id) && traitsOf(engine.hero(id)).has("initiation"))
    .flatMap(([pos, id]) => {
      const item = sureKeyItem(id, pos);
      return item && engine.data.items?.[item.itemId]?.key === "blink" ? [{ id, minute: item.minute }] : [];
    })
    .sort((a, b) => a.minute - b.minute)
    .map((i) => i.id);
  // Their carry is a danger hero only with a sure minute: "farms fast" adds nothing to the plan.
  const dangerCarry = theirCarry !== undefined && sureKeyItem(theirCarry, 1) ? theirCarry : undefined;
  const danger = chooseDangerHeroes(threats, dangerCarry, initiators).map(({ id, kind }) => {
    const position = [...theirByPos].find(([, h]) => h === id)?.[0] ?? 1;
    const item = sureKeyItem(id, position);
    return dangerLine({
      hero: name(id),
      kind,
      ...(item ? { item: { name: item.name, minute: item.minute } } : {}),
      isSure: item?.exact ?? false,
      window: ourWindow(timing(ourStyle?.key), timing(theirStyle?.key)),
    });
  });

  const players = input.ours.map((p): PlayerPlan => {
    const usual = itemBuild(engine.data, p.heroId, p.position, input.theirs, bracket);
    const lane = lanes.find((l) => l.ours.includes(p.heroId))!; // Every position is in a lane.
    const build =
      usual && engine.data.items
        ? laneAdjusted(usual, { verdict: lane.verdict, enemies: lane.theirs.map((id) => engine.hero(id)) }, engine.data.items)
        : usual;
    const combo = ourCombos.find((c) => c.a === p.heroId || c.b === p.heroId);
    const partner = combo && name(combo.a === p.heroId ? combo.b : combo.a);
    const isInitiator = traitsOf(engine.hero(p.heroId)).has("initiation");
    const games = input.matchups === undefined ? undefined : input.matchups && (input.matchups[p.heroId] ?? []);
    const skills = skillPlan(engine.data, p.heroId, p.position, input.theirs.map(name), games);
    return {
      heroId: p.heroId,
      position: p.position,
      build,
      job: playerJob(
        p.position,
        name(p.heroId),
        isInitiator,
        keyItem(engine, build, p.heroId, p.position),
        ourWindow(timing(ourStyle?.key), timing(theirStyle?.key)),
        theirCarry !== undefined,
        combo && `${combo.text} with ${partner}`,
      ),
      fallbacks: [],
      enemies: enemyList(
        build,
        input.theirs.map((id, i) => {
          const position = [...theirByPos].find(([, h]) => h === id)?.[0];
          return {
            hero: engine.hero(id),
            inLane: lane.theirs.includes(id),
            laneSure: position !== undefined && (theirOdds[i]?.[position] ?? 0) >= SURE_POSITION_ODDS,
          };
        }),
      ),
      ...(skills ? { skills } : {}),
    };
  });

  const laneOf = (heroId: number) => lanes.find((l) => l.ours.includes(heroId))!; // Every position is in a lane.
  const carry = players.find((p) => p.position === 1);
  const carryItem = keyItem(engine, carry?.build ?? null, carry?.heroId, 1);
  const enemyAt = (p: Position) => (theirByPos.has(p) ? name(theirByPos.get(p)!) : undefined); // has() checked.
  const enemyCarry = theirCarry !== undefined ? name(theirCarry) : undefined;
  const picked = pickFallbacks({
    players: players.map((p) => {
      const item = keyItem(engine, p.build, p.heroId, p.position);
      return {
        position: p.position,
        hero: name(p.heroId),
        lane: laneOf(p.heroId).verdict,
        ...(item ? { keyItem: { name: item.name, lateMinute: item.lateMinute } } : {}),
      };
    }),
    offLaneHard: lanes[2]!.verdict === "hard", // LANES has three entries, the off lane last.
    scaling: scaling(timing(ourStyle?.key), timing(theirStyle?.key)),
    ourCarry: carry && name(carry.heroId),
    ourKeyItem: carryItem?.name,
    enemyCarry,
    enemyOfflaner: enemyAt(3),
  });
  players.forEach((p, i) => (p.fallbacks = picked.players[i]!)); // Same order as players.

  const wonLane = lanes.find((l) => l.verdict === "win");
  const hardLane = lanes.find((l) => l.verdict === "hard");
  const ourTiming = timing(ourStyle?.key);
  const theirTiming = timing(theirStyle?.key);
  const firstCombo = ourCombos[0];
  const laneFact = (l: LanePlan) => ({ name: l.name.toLowerCase(), ours: l.ours.map(name), theirs: l.theirs.map(name) });
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
    danger,
    roadmap,
    players,
    teamFallbacks: picked.team,
    story: gameStory({
      ourTiming,
      theirTiming,
      ...(wonLane ? { wonLane: laneFact(wonLane) } : {}),
      ...(hardLane ? { hardLane: laneFact(hardLane) } : {}),
      theirSpikes: [...theirByPos]
        .filter(([pos, id]) => playsCore(id, pos))
        .flatMap(([pos, id]) => {
          const item = sureKeyItem(id, pos);
          return item ? [{ hero: name(id), item: item.name, minute: item.minute, ...(item.exact ? {} : { around: true }) }] : [];
        }),
      // Cores only: a support's Glimmer Cape isn't a team timing.
      spikes: players.filter((p) => p.position <= 3).flatMap((p) => {
        const item = keyItem(engine, p.build, p.heroId, p.position);
        return item ? [{ hero: name(p.heroId), item: item.name, minute: item.minute, ...(p.build?.timings === "around" ? { around: true } : {}) }] : [];
      }),
      combo: firstCombo?.text,
      ourCarry: carry && name(carry.heroId),
      enemyCarry,
    }),
  };
}

/** Which team gets stronger later, from the same decision as the story (see ourWindow). */
function scaling(ours: Timing, theirs: Timing): Scaling {
  const window = ourWindow(ours, theirs);
  return window === "late" ? "ours" : window === "early" ? "theirs" : "even";
}

const round = (x: number) => Math.round(x * 10) / 10;
