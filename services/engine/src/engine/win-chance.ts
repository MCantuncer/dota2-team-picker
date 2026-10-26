import type { Engine } from "./score";
import type { RankBracket, Snapshot } from "./types";

export type WinModel = NonNullable<Snapshot["winModel"]>;

/**
 * How much better one side's draft is than the other's, in win-rate points: the heroes' win
 * rates, their matchups against each other (hard counters included) and the synergy inside
 * each team. Only heroes picked so far count.
 */
export function draftEdge(engine: Engine, ours: number[], theirs: number[], bracket?: RankBracket): number {
  const meta = (ids: number[]) => ids.reduce((s, id) => s + (engine.winRate(id, bracket) - 0.5) * 100, 0);
  // Each matchup is the average of both heroes' view of it; a hard counter on either side sets
  // at least its listed gap, so it counts once and in full.
  const matchup = (o: number, t: number) => {
    let edge = (engine.matchupEdge(o, t, bracket) - engine.matchupEdge(t, o, bracket)) / 2;
    const [ours] = engine.counterEdges(o, [t], [0], bracket);
    const [theirs] = engine.counterEdges(t, [o], [0], bracket);
    if (ours!.edge < engine.matchupEdge(o, t, bracket)) edge = Math.min(edge, ours!.edge);
    if (theirs!.edge < engine.matchupEdge(t, o, bracket)) edge = Math.max(edge, -theirs!.edge);
    return edge;
  };
  const counters = ours.reduce((s, o) => s + theirs.reduce((t, x) => t + matchup(o, x), 0), 0);
  const synergy = (ids: number[]) => {
    let s = 0;
    for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) s += engine.synergyEdge(ids[i]!, ids[j]!, bracket);
    return s;
  };
  return meta(ours) - meta(theirs) + counters + synergy(ours) - synergy(theirs);
}

/**
 * The chance (0-1) that the side with `edge` wins, with `known` heroes picked so far (both teams).
 * Null when there is no checked model for that many picks, so nothing misleading is shown.
 */
export function winChance(model: WinModel | undefined, edge: number, known: number): number | null {
  const step = nearestStep(model, known);
  if (!step) return null;
  return 1 / (1 + Math.exp(-(step.a + step.b * edge)));
}

/** The fitted step for the largest number of known picks not above `known`. */
function nearestStep(model: WinModel | undefined, known: number) {
  if (!model) return undefined;
  const steps = Object.keys(model.byKnown)
    .map(Number)
    .filter((k) => k <= known)
    .sort((a, b) => b - a);
  return steps.length ? model.byKnown[steps[0]!] : undefined;
}
