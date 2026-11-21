/**
 * Each hero's biggest changes in the current patch, for the Meta page's leader cards, from OpenDota's copy of
 * Valve's patch notes (/constants/patchnotes, the same text as the game's notes). The notes are keyed by patch
 * ("7_42", "7_42a"), then by hero ("invoker"), then by ability ("invoker_sun_strike"), "general" or "talents".
 *
 * A card has room for three lines, so each hero keeps one line per ability, picked for having numbers ("from 120
 * to 110") over prose, and the three abilities with the strongest lines. Each line gets a buff or nerf mark from
 * its words when they are clear ("Cooldown decreased" is a buff, "Damage decreased" a nerf), else none.
 */

/** A patch line: the ability's name ("Hero" for base stats, "Talent"), the text, 1 buff, -1 nerf, 0 unclear. */
export interface PatchLine {
  ability: string;
  text: string;
  tone: 1 | 0 | -1;
}

/** Per hero id: up to LINES_SHOWN lines and the number of changes the hero had in the patch. */
export type HeroPatchNotes = Record<string, { lines: PatchLine[]; changes: number }>;

export const LINES_SHOWN = 3;
/** Longer lines are explanations or examples, too long for a card. */
export const MAX_LINE_LENGTH = 110;

/** OpenDota's patchnotes rows: patch key, then "heroes", then hero name, then ability key to its lines. */
export type PatchNotesConstants = Record<string, { heroes?: Record<string, Record<string, unknown>> }>;

/** Words that make a change better when they go up, and those that make it better when they go down. */
const BETTER_UP = /damage|duration|range|regen|heal|bonus|speed|armor|health|strength|agility|intelligence|radius|lifesteal|barrier|gain|vision|charges|resistance|slow|stun|evasion|multiplier/i;
const BETTER_DOWN = /cooldown|mana cost|cast point|attack time|cost/i;

/** 1 when the line reads as a buff, -1 as a nerf, 0 when the words do not say. */
export function lineTone(text: string): 1 | 0 | -1 {
  const up = /increased/i.test(text);
  const down = /decreased/i.test(text);
  if (up === down) return 0;
  // A bigger bounty helps the enemy; whether that is a nerf depends on the hero, so no mark.
  if (/bounty/i.test(text)) return 0;
  if (/cooldown reduction|cost reduction/i.test(text)) return up ? 1 : -1;
  if (BETTER_DOWN.test(text)) return down ? 1 : -1;
  if (BETTER_UP.test(text)) return up ? 1 : -1;
  return 0;
}

const isLine = (text: string) => !/^(from |<|i\.e|e\.g|example)/i.test(text.trim());

/** How much a line says on a card: an ability over base stats over talents, numbers, reworks and a clear mark. */
function weight(key: string, text: string): number {
  return (key === "talents" ? 0 : key === "general" ? 1 : 2) + (/from .*\d.* to /i.test(text) ? 2 : 0) + (/rework|now /i.test(text) ? 1 : 0) + (lineTone(text) ? 1 : 0);
}

/**
 * One hero's notes as up to LINES_SHOWN lines, one per ability, and its number of changes. `names` gives an
 * ability key's display name; a key without one is shown as is.
 */
export function heroLines(notes: Record<string, unknown>, names: Record<string, string>): { lines: PatchLine[]; changes: number } {
  const best: (PatchLine & { weight: number })[] = [];
  let changes = 0;
  for (const [key, value] of Object.entries(notes)) {
    if (key.endsWith("_info") || !Array.isArray(value)) continue;
    const ability = key === "talents" ? "Talent" : key === "general" ? "Hero" : (names[key] ?? key);
    let pick: (PatchLine & { weight: number }) | null = null;
    for (const raw of value) {
      if (typeof raw !== "string" || !isLine(raw)) continue;
      changes++;
      const text = raw.trim();
      if (text.length > MAX_LINE_LENGTH) continue;
      const w = weight(key, text);
      if (!pick || w > pick.weight) pick = { ability, text, tone: lineTone(text), weight: w };
    }
    if (pick) best.push(pick);
  }
  // Stable sort keeps the notes' own order among equal weights.
  best.sort((a, b) => b.weight - a.weight);
  return { lines: best.slice(0, LINES_SHOWN).map(({ ability, text, tone }) => ({ ability, text, tone })), changes };
}

/**
 * Every hero's lines for `patch` ("7.42"), from the notes of the patch and its letter patches ("7_42", "7_42a").
 * `heroNames` maps a hero id to its internal name ("npc_dota_hero_invoker"), `abilityNames` an ability key to
 * its display name. Heroes without changes are left out.
 */
export function patchNotes(
  constants: PatchNotesConstants,
  patch: string,
  heroNames: Record<string, string>,
  abilityNames: Record<string, string>,
): HeroPatchNotes {
  const base = patch.replace(/\./g, "_");
  const keys = Object.keys(constants).filter((k) => k === base || new RegExp(`^${base}[a-z]$`).test(k));
  const out: HeroPatchNotes = {};
  for (const [id, internal] of Object.entries(heroNames)) {
    const name = internal.replace(/^npc_dota_hero_/, "");
    const merged: Record<string, unknown[]> = {};
    for (const key of keys) {
      for (const [ability, lines] of Object.entries(constants[key]?.heroes?.[name] ?? {})) {
        if (Array.isArray(lines)) (merged[ability] ??= []).push(...lines);
      }
    }
    const notes = heroLines(merged, abilityNames);
    if (notes.changes > 0) out[id] = notes;
  }
  return out;
}
