import { comboMap, styleSets, STYLES, type Style } from "./gameplan";
import { personalScore, type Engine } from "./score";
import { NEED_LABELS, traitsOf, unmetNeeds, WANTED, type Need } from "./traits";
import { POSITIONS, type GamesWins, type HeroInfo, type Position, type RankBracket } from "./types";

/**
 * WCST (Wombo-Combo Super Team): plan all five heroes of the captain's team at
 * once, then re-plan the open slots every time a hero is picked.
 *
 * Each open slot gets a short list of candidates scored on their own (meta,
 * position fit, the player's comfort, counters against known enemies). Then
 * every combination of candidates is tried and the five heroes that work best
 * together win: pairwise synergy, how many team needs the full five cover,
 * known spell combos, and whether the five share one way to win (a style).
 */

/** One position on the captain's team. */
export interface PlanSlot {
  position: Position;
  /** Who plays this position, passed back untouched so the caller can show it. */
  playerId?: string;
  /** The player's favorite heroes for this position. Planned first. */
  favorites?: number[];
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
  bans?: number[];
  /** Used for slots without their own rank. Omit to use all ranks. */
  rankBracket?: RankBracket;
  /** Backup heroes per open slot, in case the planned one is banned or taken. Default 2. */
  alternatives?: number;
}

export interface PlanAlternative {
  heroId: number;
  name: string;
  /** One of the player's favorites for this position. */
  inPool: boolean;
  /** Team score change compared with the plan (0 or less). */
  scoreDelta: number;
}

export interface PlannedSlot {
  position: Position;
  playerId?: string;
  heroId: number;
  name: string;
  /** Picked already in the draft. */
  locked: boolean;
  inPool: boolean;
  reasons: string[];
  alternatives: PlanAlternative[];
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
}

const WEIGHTS = {
  /**
   * Bonus for a hero in the player's pool. A player is usually several
   * percent better on heroes they know, and the plan should be built around
   * them, so a hero from outside the pool only makes it when clearly better.
   */
  inPool: 8,
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

/** Candidates kept per open slot before trying combinations. 10^5 combinations at most. */
const CANDIDATES = 10;
/**
 * Heroes played in a position less often than this are not planned for it, unless in the pool.
 * Stricter than for single picks, so the plan sticks to heroes clearly at home in each role.
 */
const MIN_POSITION_FIT = 0.3;

interface Candidate {
  hero: HeroInfo;
  inPool: boolean;
  /** Score of the hero on its own, before synergy and team needs. */
  solo: number;
  reasons: { text: string; value: number }[];
}

interface Slot extends PlanSlot {
  locked: Candidate | undefined;
  candidates: Candidate[];
  /** Rated heroes that missed the shortlist. */
  rest: Candidate[];
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
      return { ...given, locked: rate(engine, engine.hero(given.heroId), ctx, enemies), candidates: [], rest: [] };
    }
    const pool = new Set(given.favorites ?? []);
    const rated = engine.heroes
      .filter((h) => !taken.has(h.id) && (pool.has(h.id) || engine.fit(h.id)[position] >= MIN_POSITION_FIT))
      .map((h) => rate(engine, h, ctx, enemies))
      .sort((a, b) => b.solo - a.solo);
    return { ...given, locked: undefined, candidates: rated.slice(0, CANDIDATES), rest: rated.slice(CANDIDATES) };
  });

  const combos = comboMap(engine.heroes);
  const styles = styleSets(engine.heroes);
  const pairKey = (a: number, b: number) => (a < b ? `${a}-${b}` : `${b}-${a}`);

  // A combo partner may fall just outside a slot's shortlist, so give it a chance.
  const anchors = slots.flatMap((s) => (s.locked ? [s.locked] : s.candidates)).map((c) => c.hero.id);
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
        const v = WEIGHTS.synergy * engine.synergyEdge(a, b) + (combos.has(pairKey(a, b)) ? WEIGHTS.combo : 0);
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
    return score - missing * WEIGHTS.missingNeed;
  };

  // Try every combination of candidates for the open slots, one hero per slot.
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
    for (const c of open[i]!.candidates) {
      if (used.has(c.hero.id)) continue;
      used.add(c.hero.id);
      chosen.push(c);
      walk(i + 1);
      chosen.pop();
      used.delete(c.hero.id);
    }
  };
  walk(0);
  if (bestScore === -Infinity) throw new Error("Not enough heroes left to fill every position");

  const planned = new Map(open.map((s, i) => [s.position, best[i]!]));
  const team = slots.map((s) => s.locked ?? planned.get(s.position)!);
  const teamIds = new Set(team.map((c) => c.hero.id));
  const teamCombos = team.flatMap((c, i) =>
    team.slice(i + 1).flatMap((d) => {
      const text = combos.get(pairKey(c.hero.id, d.hero.id));
      return text ? [{ heroes: [c.hero.name, d.hero.name] as [string, string], text }] : [];
    }),
  );
  const style = mainStyle(team);

  return {
    slots: slots.map((s, i) => {
      const pick = team[i]!;
      const others = team.filter((_, j) => j !== i);
      const alternatives = s.locked
        ? []
        : s.candidates
            .filter((c) => !teamIds.has(c.hero.id))
            .map((c) => ({ c, delta: teamScore([...others, c]) - bestScore }))
            .sort((a, b) => b.delta - a.delta)
            .slice(0, input.alternatives ?? 2)
            .map(({ c, delta }) => ({ heroId: c.hero.id, name: c.hero.name, inPool: c.inPool, scoreDelta: round(delta) }));
      return {
        position: s.position,
        playerId: s.playerId,
        heroId: pick.hero.id,
        name: pick.hero.name,
        locked: !!s.locked,
        inPool: pick.inPool,
        reasons: explain(engine, pick, others, unmetNeeds(others.map((c) => c.hero)), combos),
        alternatives,
      };
    }),
    score: round(bestScore),
    missing: unmetNeeds(team.map((c) => c.hero)).map((n) => MISSING_LABELS[n]),
    style: style && { ...style, label: STYLES[style.key].label },
    combos: teamCombos,
    gamePlan: gamePlan(style?.key, teamCombos),
  };
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
  slot: Pick<PlanSlot, "position" | "favorites" | "personal" | "rankBracket">,
  enemies: number[],
): Candidate {
  const reasons: Candidate["reasons"] = [];
  const inPool = slot.favorites?.includes(hero.id) ?? false;

  const edges = engine.counterEdges(hero.id, enemies, engine.laneChances(enemies, slot.position));
  const counter = edges.reduce((s, x) => s + x.edge, 0);
  const good = edges.filter((x) => x.edge >= 0.5).sort((a, b) => b.edge - a.edge);
  if (good.length) reasons.push({ text: `Strong against ${engine.names(good.map((x) => x.enemy))}`, value: counter });

  const meta = (engine.winRate(hero.id, slot.rankBracket) - 0.5) * 100;
  if (meta >= 1) reasons.push({ text: "Strong in the current meta", value: meta });

  const fit = engine.positionScore(hero.id, slot.position);

  let comfort = inPool ? WEIGHTS.inPool : 0;
  if (inPool) reasons.push({ text: "From the player's hero pool", value: WEIGHTS.inPool });
  const mine = slot.personal?.[hero.id];
  if (mine && mine.games > 0) {
    const personal = personalScore(mine);
    comfort += personal;
    if (personal >= 0.5) reasons.push({ text: `Player has won ${mine.wins} of ${mine.games} games on it`, value: personal });
  }

  return { hero, inPool, solo: counter + meta + fit + comfort, reasons };
}

/** The top reasons a hero is in the plan, including what it adds to the rest of the team. */
function explain(engine: Engine, pick: Candidate, others: Candidate[], needs: Need[], combos: Map<string, string>): string[] {
  const reasons = [...pick.reasons];
  for (const c of others) {
    const a = pick.hero.id;
    const b = c.hero.id;
    const text = combos.get(a < b ? `${a}-${b}` : `${b}-${a}`);
    // Ranked above everything else: a combo is the point of the plan.
    if (text) reasons.push({ text: `Combo with ${c.hero.name}: ${text}`, value: 100 });
  }
  const friends = others
    .map((c) => ({ id: c.hero.id, edge: engine.synergyEdge(pick.hero.id, c.hero.id) }))
    .filter((x) => x.edge >= 0.5)
    .sort((a, b) => b.edge - a.edge);
  if (friends.length) {
    reasons.push({ text: `Works well with ${engine.names(friends.map((x) => x.id))}`, value: friends.reduce((s, x) => s + x.edge, 0) });
  }
  const covered = needs.filter((n) => traitsOf(pick.hero).has(n));
  if (covered.length) {
    const text = covered.map((n) => NEED_LABELS[n]).join(", ");
    reasons.push({ text: text.charAt(0).toUpperCase() + text.slice(1), value: covered.length * WEIGHTS.missingNeed });
  }
  return reasons
    .sort((a, b) => b.value - a.value)
    .slice(0, 3)
    .map((r) => r.text);
}

const round = (x: number) => Math.round(x * 100) / 100;
