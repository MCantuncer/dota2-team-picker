/**
 * A fixed set of drafts to show what the suggestions look like, and how a change moves them.
 * Each draft names its heroes, so the set reads the same on any snapshot. Run it on two versions
 * of the engine (or two snapshots), save each run as JSON, and render the pair side by side.
 */
import type { Engine } from "../engine/score";
import type { DraftInput, Position, RankBracket } from "../engine/types";

export interface NamedDraft {
  label: string;
  myPosition: Position;
  rankBracket?: RankBracket;
  /** "Hero" or "Hero:position". */
  allies?: string[];
  enemies?: string[];
  bans?: string[];
  favorites?: string[];
}

/** One draft's top suggestions, as saved to JSON. */
export interface DraftRun {
  label: string;
  /** `summary` and `tags` are missing from runs saved by older versions. */
  cards: { name: string; score: number; reasons: string[]; summary?: string; tags?: string[] }[];
}

const BANS = ["Pudge", "Invoker", "Faceless Void", "Slark", "Anti-Mage"];

/** Real-shaped drafts at Legend, from an empty board to four picks a side, across positions. */
export const DRAFTS: NamedDraft[] = [
  { label: "Mid, empty draft", myPosition: 2, rankBracket: 5, favorites: ["Storm Spirit", "Puck", "Shadow Fiend"] },
  { label: "Mid, five bans", myPosition: 2, rankBracket: 5, bans: BANS, favorites: ["Storm Spirit", "Puck", "Shadow Fiend"] },
  { label: "Carry, 1 v 1", myPosition: 1, rankBracket: 5, allies: ["Crystal Maiden:5"], enemies: ["Axe"], bans: BANS },
  {
    label: "Mid, 2 v 2",
    myPosition: 2,
    rankBracket: 5,
    allies: ["Crystal Maiden:5", "Juggernaut:1"],
    enemies: ["Axe", "Viper"],
    bans: BANS,
    favorites: ["Storm Spirit", "Puck", "Shadow Fiend"],
  },
  {
    label: "Hard support, 3 v 3",
    myPosition: 5,
    rankBracket: 5,
    allies: ["Juggernaut:1", "Mars:3", "Storm Spirit:2"],
    enemies: ["Axe", "Viper", "Nyx Assassin"],
    bans: BANS,
  },
  {
    label: "Offlane, 4 v 4",
    myPosition: 3,
    rankBracket: 5,
    allies: ["Juggernaut:1", "Crystal Maiden:5", "Leshrac:2", "Hoodwink:4"],
    enemies: ["Axe", "Viper", "Nyx Assassin", "Ursa"],
    bans: BANS,
  },
];

const key = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Turns hero names into a draft the engine takes. Throws on a name the snapshot does not have. */
export function toInput(engine: Engine, draft: NamedDraft, count = 8): DraftInput {
  const ids = new Map(engine.heroes.map((h) => [key(h.name), h.id]));
  const find = (name: string) => {
    const id = ids.get(key(name));
    if (id === undefined) throw new Error(`"${name}" is not a hero in this snapshot`);
    return id;
  };
  return {
    myPosition: draft.myPosition,
    rankBracket: draft.rankBracket,
    allies: (draft.allies ?? []).map((entry) => {
      const [name = "", pos] = entry.split(":");
      return pos ? { heroId: find(name), position: Number(pos) as Position } : { heroId: find(name) };
    }),
    enemies: (draft.enemies ?? []).map(find),
    bans: (draft.bans ?? []).map(find),
    favorites: (draft.favorites ?? []).map(find),
    count,
  };
}

export function runDrafts(engine: Engine, drafts: NamedDraft[] = DRAFTS): DraftRun[] {
  return drafts.map((draft) => ({
    label: draft.label,
    cards: engine.suggest(toInput(engine, draft)).map((s) => ({ name: s.name, score: s.score, reasons: s.reasons, summary: s.summary, tags: s.tags })),
  }));
}

/** Describes a draft in one line: what is picked and banned. */
export function describe(draft: NamedDraft): string {
  const parts = [`pos ${draft.myPosition}`];
  if (draft.allies?.length) parts.push(`allies ${draft.allies.join(", ")}`);
  if (draft.enemies?.length) parts.push(`enemies ${draft.enemies.join(", ")}`);
  if (draft.bans?.length) parts.push(`bans ${draft.bans.join(", ")}`);
  if (draft.favorites?.length) parts.push(`favorites ${draft.favorites.join(", ")}`);
  return parts.join("; ");
}

const cell = (card: DraftRun["cards"][number] | undefined) => {
  if (!card) return "";
  const lines = [`**${card.name}** ${card.score.toFixed(1)}`, ...card.reasons];
  if (card.tags?.length) lines.push(card.tags.join(", "));
  if (card.summary) lines.push(`_${card.summary}_`);
  return lines.join("<br>").replace(/\|/g, "/");
};

/**
 * Markdown for each draft: the top cards with their reasons, and with `before`, the old list
 * beside the new one and how many of the heroes changed.
 */
export function toMarkdown(after: DraftRun[], before?: DraftRun[], drafts: NamedDraft[] = DRAFTS): string {
  const out: string[] = [];
  after.forEach((run, d) => {
    const draft = drafts.find((x) => x.label === run.label);
    out.push(`### ${run.label}`, "", draft ? `_${describe(draft)}_` : "", "");
    const old = before?.find((b) => b.label === run.label);
    if (old) {
      const was = new Set(old.cards.map((c) => c.name));
      const changed = run.cards.filter((c) => !was.has(c.name)).length;
      out.push(`${changed} of ${run.cards.length} heroes changed.`, "", "| # | Before | After |", "| --- | --- | --- |");
      const rows = Math.max(run.cards.length, old.cards.length);
      for (let i = 0; i < rows; i++) out.push(`| ${i + 1} | ${cell(old.cards[i])} | ${cell(run.cards[i])} |`);
    } else {
      out.push("| # | Suggestion |", "| --- | --- |");
      run.cards.forEach((c, i) => out.push(`| ${i + 1} | ${cell(c)} |`));
    }
    if (d < after.length - 1) out.push("");
  });
  return out.join("\n");
}
