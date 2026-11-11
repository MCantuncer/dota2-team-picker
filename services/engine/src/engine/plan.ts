import { comboMap, styleSets, STYLES, type Style } from "./gameplan";
import { list, points, RANK_NAMES, ROLE_NAMES } from "./reasons";
import { clearMatchup, personalScore, type Engine } from "./score";
import { NEED_SHORT, traitsOf, unmetNeeds, WANTED, type Need } from "./traits";
import { POSITIONS, type EnemyPositions, type GamesWins, type HeroInfo, type Position, type RankBracket } from "./types";

/**
 * WCST (Wombo-Combo Super Team): plan all five heroes of the captain's team at
 * once, then re-plan the open slots every time a hero is picked.
 *
 * Each open slot gets a short list of candidates scored on their own (meta,
 * position fit, the player's comfort, counters against known enemies). Then
 * every combination of candidates is tried and the five heroes that work best
 * together win: pairwise synergy, how many team needs the full five cover,
 * known spell combos, and whether the five share one way to win (a style).
 * A second search finds Another Super Team: the best five with a different
 * hero in every open slot, for when the party wants another way to play.
 */

/** One position on the captain's team. */
export interface PlanSlot {
  position: Position;
  /** Who plays this position, passed back untouched so the caller can show it. */
  playerId?: string;
  /** The player's name, for reasons like "zeri's win rate on it". */
  playerName?: string;
  /** The player is the one reading the plan, so reasons say "your". */
  isMe?: boolean;
  /** The player's favorite heroes for this position. Planned first. */
  favorites?: number[];
  /** The player's Top 5 for this position. Only heroes also in `favorites` count. */
  top?: number[];
  /** The player's own record per hero id, from their Steam match history. */
  personal?: Record<number, GamesWins>;
  /** The player's rank, if their Steam account is linked. */
  rankBracket?: RankBracket;
  /** Already picked in the draft: kept as is. */
  heroId?: number;
}

export interface PlanInput {
  /** Up to five slots with different positions; missing positions are planned without a player. */
  slots: PlanSlot[];
  /** Enemy picks entered so far. Empty before the draft. */
  enemies?: number[];
  /** Enemy positions a player set by hand; the rest are guessed. */
  enemyPositions?: EnemyPositions;
  bans?: number[];
  /** Used for slots without their own rank. Omit to use all ranks. */
  rankBracket?: RankBracket;
}

/**
 * One line on why a hero or a team is in the plan, always with the number behind it: `lead` is that number or
 * word ("+3.2", "62%", "Only", "5 of 7") and `text` the rest of the line ("with Puck (2,232 games)").
 */
export interface PlanReason {
  kind: "combo" | "pair" | "counter" | "need" | "record" | "top" | "meta" | "fit" | "pool";
  lead: string;
  text: string;
  /**
   * The heroes the line is about, for faces: on a hero's card the partner (pair, combo) or the enemy (counter); on
   * the team's lines a pair's two heroes, or a hero and the enemy it beats most.
   */
  heroes?: number[];
  /** The team need a "need" line is about, for its icon. */
  need?: Need;
}

/** One team need and the heroes in a five that cover it, for a row of need chips. */
export interface TeamNeed {
  need: Need;
  /** "Stun", "Frontliner", ... */
  label: string;
  /** Heroes in the five that bring it; fewer than `wanted` means the team still lacks it. */
  heroes: number[];
  wanted: number;
}

export interface PlannedSlot {
  position: Position;
  playerId?: string;
  heroId: number;
  name: string;
  /** Picked already in the draft. */
  locked: boolean;
  inPool: boolean;
  /** Up to three, the biggest first. */
  reasons: PlanReason[];
}

/** One hero of Another Super Team. */
export interface AnotherSlot {
  position: Position;
  playerId?: string;
  heroId: number;
  name: string;
  locked: boolean;
  inPool: boolean;
  /** The same hero as the plan in this position: picked already, or the player's only hero left for it. */
  same: boolean;
}

export interface AnotherTeam {
  /** Sorted by position, 1 to 5. */
  slots: AnotherSlot[];
  /** Team score, like TeamPlan.score. */
  score: number;
  /** Points behind the plan (0 or more). */
  behind: number;
  /** How far behind the plan it is and why, e.g. "2.9 points behind: its pairs win less together (-3.1)." */
  verdict: string;
  /** Why these five work together too, the biggest first. */
  why: PlanReason[];
  needs: TeamNeed[];
}

export interface TeamPlan {
  /** Sorted by position, 1 to 5. */
  slots: PlannedSlot[];
  /** Team score in win-rate percentage points, like the single-hero score. */
  score: number;
  /** Things the planned five still lack, in plain words. */
  missing: string[];
  /** How the five want to win, when at least three share a style. */
  style: { key: Style; label: string; heroes: number } | null;
  /** Known combos in the five. */
  combos: { heroes: [string, string]; text: string }[];
  /** One line on how to play the five, e.g. "Teamfight: group up ... Key combo: ...". */
  gamePlan: string;
  /** Why the five are a super team: their best pairs, the enemy picks, the players' record and the team needs. */
  why: PlanReason[];
  /** Every team need, in a fixed order, with the heroes that cover it. */
  needs: TeamNeed[];
  /**
   * The open slot to lock first, while two or more are open: its planned hero is picked in the most games, so it is
   * the one the enemy is most likely to take or ban before the party gets to it.
   */
  pickFirst: { position: Position; heroId: number; pickRate: number } | null;
  /** The best five with a different hero in every open slot, or null when no open slot has another hero. */
  another: AnotherTeam | null;
}

const WEIGHTS = {
  /**
   * Comfort for a hero in the player's pool. A player with a pool is planned from it alone (see FALLBACK_COST),
   * so this is the same for every hero the plan can choose and never shows as a reason.
   */
  inPool: 8,
  /**
   * Extra for one of the player's Top 5, on top of `inPool`. `inPool` is the same for every pool hero, so this
   * is the whole gap between a starred hero and the rest of the pool: the same +0.5 the draft score gives, a
   * nudge for the player's best heroes, never a reason to plan only them.
   */
  top: 0.5,
  /**
   * Share of each pair's synergy that counts. A team has 10 pairs and their
   * edges overlap, so adding them all in full overstates synergy and lets
   * noisy pairs take over the plan.
   */
  synergy: 0.5,
  /** Points lost per team need the final five leave uncovered. */
  missingNeed: 1.2,
  /** Points per known combo in the five. */
  combo: 1.5,
  /** Points per hero beyond two that shares the team's main style. */
  style: 1,
};

/** Heroes sharing a style before the team counts as having that plan. */
const STYLE_MIN = 3;
/** Extra candidates per slot added because they combo with a hero elsewhere in the plan. */
const COMBO_CANDIDATES = 3;

/** Short names for what a finished team lacks. */
const MISSING_LABELS: Record<Need, string> = {
  disable: "stuns or disables",
  initiation: "an initiator",
  save: "a save",
  durable: "a tanky frontliner",
  push: "wave clear and pushing",
  magicDamage: "magic damage",
  physicalDamage: "right-click damage",
};

/** What a hero brings that the rest of the five lack, after "Only" or "2nd": "Only frontliner on the team". */
const NEED_NOUNS: Record<Need, string> = {
  disable: "stun on the team",
  initiation: "initiator on the team",
  save: "save on the team",
  durable: "frontliner on the team",
  push: "wave clear on the team",
  magicDamage: "magic damage on the team",
  physicalDamage: "right-click damage on the team",
};

/** Pair lines a hero's card and the team's lines show at most. */
const MAX_PAIRS = 2;
/** Reasons on a hero's card. */
const MAX_REASONS = 3;
/** The players' record on the five shows once it covers this many games. */
const MIN_TEAM_RECORD_GAMES = 10;
/** A hero played in the position at least this often has a line saying so: it is clearly at home there. */
const HOME_FIT = 0.5;
/** Teams this close read as level: below the 0.1 a line shows. */
const LEVEL = 0.05;

/** Candidates kept per open slot before trying combinations. 10^5 combinations at most. */
const CANDIDATES = 10;
/**
 * Heroes from outside a player's pool kept for their slot, used only when the pool can't fill it:
 * every pool hero is taken, banned or planned for another player. Enough for a conflict between all
 * five players.
 */
const FALLBACKS = 3;
/**
 * Team score lost per slot filled from outside its player's pool. Larger than any team score, so the
 * plan uses the pool wherever it can and a fallback only when no pool hero is left for that slot.
 */
const FALLBACK_COST = 1000;
/**
 * Heroes played in a position less often than this are not planned for it, unless in the pool.
 * Stricter than for single picks, so the plan sticks to heroes clearly at home in each role.
 */
const MIN_POSITION_FIT = 0.3;

/** A hero's own score for a slot, split into the parts a team is compared on. */
interface SoloParts {
  counter: number;
  meta: number;
  fit: number;
  /** The player's record and Top 5 star; the pool's flat `inPool` is left out, as it never differs. */
  comfort: number;
}

interface Candidate {
  hero: HeroInfo;
  inPool: boolean;
  /** From outside the player's pool, kept only in case the pool can't fill the slot. */
  fallback: boolean;
  /** Score of the hero on its own, before synergy and team needs. */
  solo: number;
  parts: SoloParts;
  /** Lines about the hero on its own; `value` ranks them, in score points. */
  reasons: (PlanReason & { value: number })[];
}

interface Slot extends PlanSlot {
  locked: Candidate | undefined;
  candidates: Candidate[];
  /** Rated heroes that missed the shortlist. */
  rest: Candidate[];
}

/** A team's score split into parts, so two teams can be compared on the part where they differ most. */
type TeamParts = SoloParts & { pairs: number; needs: number; style: number };

const one = (x: number) => x.toFixed(1);
const count = (n: number) => n.toLocaleString("en-US");
const percent = (r: GamesWins) => `${Math.round((r.wins / r.games) * 100)}%`;
const pairKey = (a: number, b: number) => (a < b ? `${a}-${b}` : `${b}-${a}`);

/** "zeri's", "your" or "the player's". */
function owner(slot: Pick<PlanSlot, "playerName" | "isMe">): string {
  if (slot.isMe) return "your";
  return slot.playerName ? `${slot.playerName}'s` : "the player's";
}

export function planTeam(engine: Engine, input: PlanInput): TeamPlan {
  const enemies = input.enemies ?? [];
  const seen = new Set<Position>();
  for (const s of input.slots) {
    if (seen.has(s.position)) throw new Error(`Position ${s.position} is listed twice`);
    seen.add(s.position);
  }
  const lockedIds = input.slots.flatMap((s) => (s.heroId === undefined ? [] : [s.heroId]));
  const taken = new Set([...lockedIds, ...enemies, ...(input.bans ?? [])]);

  const slots: Slot[] = POSITIONS.map((position) => {
    const given = input.slots.find((s) => s.position === position) ?? { position };
    const ctx = { ...given, rankBracket: given.rankBracket ?? input.rankBracket };
    if (given.heroId !== undefined) {
      return { ...given, locked: rate(engine, engine.hero(given.heroId), ctx, enemies, input.enemyPositions), candidates: [], rest: [] };
    }
    // A player with a pool is planned from it alone (Can, 2026-11-08); a slot without one from every
    // hero at home in the position.
    const pool = new Set(given.favorites ?? []);
    const byScore = (heroes: HeroInfo[], fallback = false) =>
      heroes.map((h) => ({ ...rate(engine, h, ctx, enemies, input.enemyPositions), fallback })).sort((a, b) => b.solo - a.solo);
    const open = engine.heroes.filter((h) => !taken.has(h.id));
    const fits = open.filter((h) => engine.fit(h.id)[position] >= MIN_POSITION_FIT);
    if (!pool.size) {
      const rated = byScore(fits);
      return { ...given, locked: undefined, candidates: rated.slice(0, CANDIDATES), rest: rated.slice(CANDIDATES) };
    }
    const rated = byScore(open.filter((h) => pool.has(h.id)));
    const fallbacks = byScore(fits.filter((h) => !pool.has(h.id)), true).slice(0, FALLBACKS);
    return { ...given, locked: undefined, candidates: [...rated.slice(0, CANDIDATES), ...fallbacks], rest: rated.slice(CANDIDATES) };
  });

  const combos = comboMap(engine.heroes);
  const styles = styleSets(engine.heroes);

  // A combo partner may fall just outside a slot's shortlist, so give it a chance.
  const anchors = slots.flatMap((s) => (s.locked ? [s.locked] : s.candidates.filter((c) => !c.fallback))).map((c) => c.hero.id);
  for (const s of slots) {
    const partners = s.rest.filter((c) => anchors.some((a) => combos.has(pairKey(a, c.hero.id))));
    s.candidates.push(...partners.slice(0, COMBO_CANDIDATES));
  }

  const open = slots.filter((s) => !s.locked);
  for (const s of open) {
    if (!s.candidates.length) throw new Error(`No hero left for position ${s.position}`);
  }
  const fixed = slots.flatMap((s) => (s.locked ? [s.locked] : []));

  // The search scores up to ~400k teams, so pair scores and hero traits are looked up once here.
  const all = [...new Set(slots.flatMap((s) => (s.locked ? [s.locked] : s.candidates)))];
  const index = new Map(all.map((c, i) => [c, i]));
  const pairScore = new Float64Array(all.length * all.length);
  all.forEach((c, i) =>
    all.forEach((d, j) => {
      if (i < j) {
        const a = c.hero.id;
        const b = d.hero.id;
        const v = WEIGHTS.synergy * engine.synergyEdge(a, b, input.rankBracket) + (combos.has(pairKey(a, b)) ? WEIGHTS.combo : 0);
        pairScore[i * all.length + j] = pairScore[j * all.length + i] = v;
      }
    }),
  );
  const traits = all.map((c) => [...traitsOf(c.hero)]);
  const mainStyle = (team: Candidate[]) => {
    let best: { key: Style; heroes: number } | null = null;
    for (const key of Object.keys(styles) as Style[]) {
      const heroes = team.filter((c) => styles[key].has(c.hero.id)).length;
      if (heroes >= STYLE_MIN && (!best || heroes > best.heroes)) best = { key, heroes };
    }
    return best;
  };
  /** The team score split into its parts; `teamScore` is their sum plus the flat pool comfort, less fallbacks. */
  const partsOf = (team: Candidate[]): TeamParts => {
    const ids = team.map((c) => index.get(c)!);
    const covered = new Map<Need, number>();
    const parts: TeamParts = { counter: 0, meta: 0, fit: 0, comfort: 0, pairs: 0, needs: 0, style: 0 };
    ids.forEach((i, n) => {
      const c = all[i]!;
      parts.counter += c.parts.counter;
      parts.meta += c.parts.meta;
      parts.fit += c.parts.fit;
      parts.comfort += c.parts.comfort;
      for (let m = n + 1; m < ids.length; m++) parts.pairs += pairScore[i * all.length + ids[m]!]!;
      for (const t of traits[i]!) covered.set(t, (covered.get(t) ?? 0) + 1);
    });
    const style = mainStyle(team);
    if (style) parts.style = (style.heroes - 2) * WEIGHTS.style;
    parts.needs = -(Object.keys(WANTED) as Need[]).filter((n) => (covered.get(n) ?? 0) < WANTED[n]).length * WEIGHTS.missingNeed;
    return parts;
  };
  const teamScore = (team: Candidate[]) => {
    const ids = team.map((c) => index.get(c)!);
    const covered = new Map<Need, number>();
    let score = 0;
    ids.forEach((i, n) => {
      score += all[i]!.solo;
      for (let m = n + 1; m < ids.length; m++) score += pairScore[i * all.length + ids[m]!]!;
      for (const t of traits[i]!) covered.set(t, (covered.get(t) ?? 0) + 1);
    });
    const style = mainStyle(team);
    if (style) score += (style.heroes - 2) * WEIGHTS.style;
    const missing = (Object.keys(WANTED) as Need[]).filter((n) => (covered.get(n) ?? 0) < WANTED[n]).length;
    const fallbacks = team.filter((c) => c.fallback).length;
    return score - missing * WEIGHTS.missingNeed - fallbacks * FALLBACK_COST;
  };

  /** Tries every combination of `choices` for the open slots, one hero per slot, and keeps the best team. */
  const search = (choices: Candidate[][]) => {
    let best: Candidate[] = [];
    let bestScore = -Infinity;
    const chosen: Candidate[] = [];
    const used = new Set<number>();
    const walk = (i: number) => {
      if (i === open.length) {
        const score = teamScore([...fixed, ...chosen]);
        if (score > bestScore) [best, bestScore] = [[...chosen], score];
        return;
      }
      for (const c of choices[i]!) {
        if (used.has(c.hero.id)) continue;
        used.add(c.hero.id);
        chosen.push(c);
        walk(i + 1);
        chosen.pop();
        used.delete(c.hero.id);
      }
    };
    walk(0);
    return { best, bestScore };
  };
  const { best, bestScore } = search(open.map((s) => s.candidates));
  if (bestScore === -Infinity) throw new Error("Not enough heroes left to fill every position");

  const planned = new Map(open.map((s, i) => [s.position, best[i]!]));
  const team = slots.map((s) => s.locked ?? planned.get(s.position)!);
  const teamCombos = team.flatMap((c, i) =>
    team.slice(i + 1).flatMap((d) => {
      const text = combos.get(pairKey(c.hero.id, d.hero.id));
      return text ? [{ heroes: [c.hero.name, d.hero.name] as [string, string], text }] : [];
    }),
  );
  const style = mainStyle(team);
  /** The team's own score, without the cost that kept fallbacks out of it. */
  const ownScore = (t: Candidate[], score: number) => score + t.filter((c) => c.fallback).length * FALLBACK_COST;
  const ctx = { engine, enemies, enemyPositions: input.enemyPositions, slots, bracket: input.rankBracket };

  return {
    slots: slots.map((s, i) => {
      const pick = team[i]!;
      const others = team.filter((_, j) => j !== i);
      return {
        position: s.position,
        playerId: s.playerId,
        heroId: pick.hero.id,
        name: pick.hero.name,
        locked: !!s.locked,
        inPool: pick.inPool,
        reasons: explain(engine, pick, others, combos, input.rankBracket),
      };
    }),
    score: round(ownScore(team, bestScore)),
    missing: unmetNeeds(team.map((c) => c.hero)).map((n) => MISSING_LABELS[n]),
    style: style && { ...style, label: STYLES[style.key].label },
    combos: teamCombos,
    gamePlan: gamePlan(style?.key, teamCombos),
    why: teamWhy(ctx, team),
    needs: needsOf(team),
    pickFirst: pickFirstOf(),
    another: anotherTeam(),
  };

  function pickFirstOf(): TeamPlan["pickFirst"] {
    if (open.length < 2) return null;
    const ranked = open
      .map((s) => ({ position: s.position, heroId: planned.get(s.position)!.hero.id }))
      .map((x) => ({ ...x, pickRate: round(engine.pickRate(x.heroId)) }))
      .sort((a, b) => b.pickRate - a.pickRate);
    return ranked[0]!;
  }

  /**
   * The best five with a different hero in every open slot than the plan. A slot whose player has no other
   * hero left keeps the plan's hero, so a small pool never pushes a player off their heroes.
   */
  function anotherTeam(): AnotherTeam | null {
    const choices = open.map((s) => {
      const mine = planned.get(s.position)!;
      const others = s.candidates.filter((c) => c.hero.id !== mine.hero.id);
      return others.some((c) => !c.fallback) ? others : s.candidates;
    });
    const found = search(choices);
    if (found.bestScore === -Infinity) return null;
    const other = new Map(open.map((s, i) => [s.position, found.best[i]!]));
    const five = slots.map((s) => s.locked ?? other.get(s.position)!);
    if (five.every((c, i) => c === team[i])) return null;
    const score = ownScore(five, found.bestScore);
    const behind = Math.max(0, ownScore(team, bestScore) - score);
    return {
      slots: slots.map((s, i) => ({
        position: s.position,
        playerId: s.playerId,
        heroId: five[i]!.hero.id,
        name: five[i]!.hero.name,
        locked: !!s.locked,
        inPool: five[i]!.inPool,
        same: five[i] === team[i],
      })),
      score: round(score),
      behind: round(behind),
      verdict: behind < LEVEL ? "Level with the plan." : `${one(behind)} points behind: ${whyBehind(partsOf(team), partsOf(five))}.`,
      why: teamWhy(ctx, five),
      needs: needsOf(five),
    };
  }
}

/** The part of the plan's score that leads Another Super Team's most, in words, with the difference. */
function whyBehind(plan: TeamParts, other: TeamParts): string {
  const keys = Object.keys(plan) as (keyof TeamParts)[];
  const part = keys.reduce((a, b) => (plan[b] - other[b] > plan[a] - other[a] ? b : a));
  const less = `(${points(other[part] - plan[part])})`;
  switch (part) {
    case "pairs":
      return `its pairs win less together ${less}`;
    case "counter":
      return `weaker against the enemy picks ${less}`;
    case "meta":
      return `its heroes win less in this patch ${less}`;
    case "fit":
      return `its heroes play these positions less often ${less}`;
    case "comfort":
      return `the players win less on its heroes ${less}`;
    case "needs":
      return `it covers fewer team needs ${less}`;
    case "style":
      return `its heroes share less of one way to win ${less}`;
  }
}

function gamePlan(style: Style | undefined, combos: TeamPlan["combos"]): string {
  const plan = style
    ? `${STYLES[style].label}: ${STYLES[style].plan}.`
    : "Balanced: no single style stands out, so play around your strongest heroes.";
  const combo = combos[0];
  return combo ? `${plan} Key combo: ${combo.heroes.join(" + ")}, ${combo.text}.` : plan;
}

/** Score a hero on its own for a slot. */
function rate(
  engine: Engine,
  hero: HeroInfo,
  slot: Pick<PlanSlot, "position" | "favorites" | "top" | "personal" | "rankBracket" | "playerName" | "isMe">,
  enemies: number[],
  enemyPositions: EnemyPositions | undefined,
): Candidate {
  const reasons: Candidate["reasons"] = [];
  const inPool = slot.favorites?.includes(hero.id) ?? false;
  const whose = owner(slot);

  const edges = engine.counterEdges(hero.id, enemies, engine.laneChances(enemies, slot.position, enemyPositions), slot.rankBracket);
  const counter = edges.reduce((s, x) => s + x.edge, 0);
  for (const x of edges.filter((x) => clearMatchup(x) > 0)) {
    reasons.push({ kind: "counter", lead: points(x.edge), text: `against ${engine.hero(x.enemy).name}`, heroes: [x.enemy], value: x.edge });
  }

  const winRate = engine.winRate(hero.id, slot.rankBracket);
  const meta = (winRate - 0.5) * 100;
  if (meta >= 1) {
    const where = slot.rankBracket ? `at ${RANK_NAMES[slot.rankBracket - 1]}` : "in all ranks";
    reasons.push({ kind: "meta", lead: `${(winRate * 100).toFixed(1)}%`, text: `win rate ${where}`, value: meta });
  }

  const fit = engine.positionScore(hero.id, slot.position);
  const share = engine.fit(hero.id)[slot.position];
  if (share >= HOME_FIT) {
    // True of most planned heroes, so it ranks last and only fills a card with little else to say.
    reasons.push({ kind: "fit", lead: `${Math.round(share * 100)}%`, text: `of its games as ${ROLE_NAMES[slot.position]}`, value: 0.1 });
  }

  let comfort = 0;
  // The pool's comfort is the same for every hero the plan can choose, so it only fills an empty card.
  if (inPool) reasons.push({ kind: "pool", lead: "Pool", text: `one of ${whose} heroes here`, value: 0 });
  if (inPool && slot.top?.includes(hero.id)) {
    comfort += WEIGHTS.top;
    reasons.push({ kind: "top", lead: "Top 5", text: `one of ${whose} best heroes here`, value: WEIGHTS.top });
  }
  const mine = slot.personal?.[hero.id];
  if (mine && mine.games > 0) {
    const personal = personalScore(mine);
    comfort += personal;
    if (personal >= 0.5) {
      reasons.push({ kind: "record", lead: percent(mine), text: `${whose} win rate on it (${count(mine.games)} games)`, value: personal });
    }
  }

  return {
    hero,
    inPool,
    fallback: false,
    solo: counter + meta + fit + comfort + (inPool ? WEIGHTS.inPool : 0),
    parts: { counter, meta, fit, comfort },
    reasons,
  };
}

/** The top reasons a hero is in the plan, including what it adds to the rest of the team. */
function explain(engine: Engine, pick: Candidate, others: Candidate[], combos: Map<string, string>, bracket?: RankBracket): PlanReason[] {
  const reasons = [...pick.reasons];
  for (const c of others) {
    const text = combos.get(pairKey(pick.hero.id, c.hero.id));
    // Ranked above everything else: a combo is the point of the plan.
    if (text) reasons.push({ kind: "combo", lead: "Combo", text: `with ${c.hero.name}: ${text}`, heroes: [c.hero.id], value: 100 });
  }
  const pairs = others
    .map((c) => ({ c, ...pairOf(engine, pick.hero.id, c.hero.id, bracket) }))
    .filter((x) => x.clear)
    .sort((a, b) => b.edge - a.edge)
    .slice(0, MAX_PAIRS);
  for (const x of pairs) {
    reasons.push({
      kind: "pair",
      lead: points(x.edge),
      text: `with ${x.c.hero.name} (${count(x.games)} games)`,
      heroes: [x.c.hero.id],
      // Ranked by the number the line shows, like a counter line, so a card reads biggest first.
      value: x.edge,
    });
  }
  const mine = traitsOf(pick.hero);
  const have = new Map<Need, number>();
  for (const c of others) for (const t of traitsOf(c.hero)) have.set(t, (have.get(t) ?? 0) + 1);
  for (const need of Object.keys(WANTED) as Need[]) {
    const n = have.get(need) ?? 0;
    if (!mine.has(need) || n >= WANTED[need]) continue;
    reasons.push({ kind: "need", lead: n === 0 ? "Only" : "2nd", text: NEED_NOUNS[need], need, value: WEIGHTS.missingNeed });
  }
  // The pool line only fills a card that has nothing else to say.
  const real = reasons.filter((r) => r.kind !== "pool");
  return (real.length ? real : reasons)
    .sort((a, b) => b.value - a.value)
    .slice(0, MAX_REASONS)
    .map(({ kind, lead, text, heroes, need }): PlanReason => ({ kind, lead, text, ...(heroes && { heroes }), ...(need && { need }) }));
}

/** A pair's synergy, its standard error and games, and whether it is clear of noise and worth naming. */
function pairOf(engine: Engine, a: number, b: number, bracket?: RankBracket) {
  const edge = engine.synergyEdge(a, b, bracket);
  const error = engine.synergyError(a, b);
  return { edge, games: engine.data.synergy[pairKey(a, b)]?.games ?? 0, clear: clearMatchup({ edge, error }) > 0 };
}

/**
 * Why a five works as a team, from data only: its pairs that win more together (clear of noise), how much it
 * beats the enemy picks by, the players' own record on its heroes and how many team needs it covers.
 */
function teamWhy(
  ctx: { engine: Engine; enemies: number[]; enemyPositions?: EnemyPositions; slots: PlanSlot[]; bracket?: RankBracket },
  team: Candidate[],
): PlanReason[] {
  const { engine, bracket } = ctx;
  const why: PlanReason[] = [];

  const pairs = team
    .flatMap((c, i) => team.slice(i + 1).map((d) => ({ a: c.hero, b: d.hero, ...pairOf(engine, c.hero.id, d.hero.id, bracket) })))
    .filter((x) => x.clear)
    .sort((x, y) => y.edge - x.edge)
    .slice(0, MAX_PAIRS);
  for (const x of pairs) {
    why.push({
      kind: "pair",
      lead: points(x.edge),
      text: `${x.a.name} and ${x.b.name} win more together (${count(x.games)} games)`,
      heroes: [x.a.id, x.b.id],
    });
  }

  if (ctx.enemies.length) {
    const total = team.reduce((s, c) => s + c.parts.counter, 0);
    if (total >= LEVEL) {
      const best = team
        .flatMap((c, i) => {
          const pos = POSITIONS[i]!;
          const rank = ctx.slots.find((s) => s.position === pos)?.rankBracket ?? bracket;
          const edges = engine.counterEdges(c.hero.id, ctx.enemies, engine.laneChances(ctx.enemies, pos, ctx.enemyPositions), rank);
          return edges.filter((x) => clearMatchup(x) > 0).map((x) => ({ id: c.hero.id, hero: c.hero.name, enemyId: x.enemy, enemy: engine.hero(x.enemy).name, edge: x.edge }));
        })
        .sort((x, y) => y.edge - x.edge)[0];
      const most = best ? `, most from ${best.hero} against ${best.enemy} (${points(best.edge)})` : "";
      why.push({ kind: "counter", lead: points(total), text: `against the enemy picks${most}`, heroes: best ? [best.id, best.enemyId] : undefined });
    }
  }

  const record = team.reduce(
    (r, c, i) => {
      const mine = ctx.slots.find((s) => s.position === POSITIONS[i])?.personal?.[c.hero.id];
      return mine ? { games: r.games + mine.games, wins: r.wins + mine.wins } : r;
    },
    { games: 0, wins: 0 },
  );
  if (record.games >= MIN_TEAM_RECORD_GAMES) {
    why.push({ kind: "record", lead: percent(record), text: `the players' win rate on these heroes (${count(record.games)} games)` });
  }

  const needs = Object.keys(WANTED).length;
  const missing = unmetNeeds(team.map((c) => c.hero));
  why.push({
    kind: "need",
    lead: `${needs - missing.length} of ${needs}`,
    text: missing.length ? `team needs covered, lacks ${list(missing.map((n) => NEED_SHORT[n]))}` : "team needs covered",
  });
  return why;
}

/** Labels for need chips, in the order they show. */
const NEED_CHIPS: Record<Need, string> = {
  disable: "Stun",
  initiation: "Initiator",
  save: "Save",
  durable: "Frontliner",
  push: "Wave Clear",
  magicDamage: "Magic Damage",
  physicalDamage: "Right-Click",
};

function needsOf(team: Candidate[]): TeamNeed[] {
  return (Object.keys(NEED_CHIPS) as Need[]).map((need) => ({
    need,
    label: NEED_CHIPS[need],
    heroes: team.filter((c) => traitsOf(c.hero).has(need)).map((c) => c.hero.id),
    wanted: WANTED[need],
  }));
}

const round = (x: number) => Math.round(x * 100) / 100;
