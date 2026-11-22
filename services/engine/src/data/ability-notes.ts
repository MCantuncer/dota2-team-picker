/**
 * Reads Valve's ability notes (the ALT "Note" lines in the game's English text) and turns the ones that state a
 * hidden rule into facts the engine can use (src/engine/ability-notes.ts). The text comes from the same game file
 * mirror as the talent order (talents.ts), so it changes with each patch: the facts are written to a committed
 * file (scripts/ability-notes.ts) and the diff is reviewed in a pull request.
 *
 * Each rule is matched from Valve's own wording, which follows a small set of fixed sentences ("Break disables
 * ...", "... is not blocked by Linken's Sphere.", "... cannot be disjointed."). A note that matches no rule is
 * left out, never guessed at.
 */
import type { AbilityNotes, AbilityRules } from "../engine/ability-notes";

/** The English ability text in the game file mirror the talent order also reads. */
export const ABILITY_TEXT_URL = "https://raw.githubusercontent.com/dotabuff/d2vpkr/master/dota/resource/localization/abilities_english.txt";

/** `"DOTA_Tooltip_ability_<key>_Note<n>"  "<text>"`, one per line. */
const NOTE_LINE = /^\s*"DOTA_Tooltip_ability_(\w+?)_Note\d+"\s+"((?:[^"\\]|\\.)*)"/gim;

/** Every ability's note lines, in the file's order. Escapes and the doubled %% of the game's text are undone. */
export function parseNotes(text: string): Map<string, string[]> {
  const notes = new Map<string, string[]>();
  for (const [, key, raw] of text.matchAll(NOTE_LINE)) {
    if (!key || raw === undefined) continue;
    const note = raw.replace(/\\(.)/g, "$1").replace(/%%/g, "%").trim();
    if (!note) continue;
    notes.set(key, [...(notes.get(key) ?? []), note]);
  }
  return notes;
}

type Rule = Exclude<keyof AbilityRules, "notes">;

/**
 * One matcher per rule, first match wins within a rule. Order matters where a negative contains a positive
 * ("does not work on Spell Immune" holds "work on Spell Immune"), so negatives come first.
 */
const MATCHERS: ReadonlyArray<{ rule: Rule; test: RegExp; value: (m: RegExpMatchArray) => AbilityRules[Rule] }> = [
  { rule: "breaks", test: /\bnot disabled by Break\b/i, value: () => false },
  { rule: "breaks", test: /^Break (?:only )?disables\b/i, value: () => true },
  { rule: "linkenProof", test: /\b(?:is not|cannot|can't|can not) be blocked by Linken's Sphere\b|\bis not blocked by Linken's Sphere\b/i, value: () => true },
  { rule: "dodgeable", test: /\b(?:cannot|can't|can not) be disjointed\b/i, value: () => false },
  { rule: "dodgeable", test: /\bcan be disjointed\b/i, value: () => true },
  { rule: "hitsInvisible", test: /\b(?:cannot|can't|will not|won't|does not|doesn't) hit invisible units\b/i, value: () => false },
  { rule: "hitsInvisible", test: /\b(?:hits|will hit|can hit) invisible units\b/i, value: () => true },
  { rule: "debuffImmunity", test: /\bgaining debuff immunity will remove\b|\bgain debuff immunity after the effect starts\b/i, value: () => "removed" },
  { rule: "debuffImmunity", test: /^(?:Does not|Doesn't) (?:work on|affect|pierce) (?:Spell|Debuff) Immun/i, value: () => "blocked" },
  { rule: "debuffImmunity", test: /^Works on (?:Spell|Debuff) Immune units\b/i, value: () => "pierces" },
  { rule: "killsIllusions", test: /^Instantly (?:destroys|kills) illusions\b/i, value: () => true },
  { rule: "killedBy", test: /\bcan still be killed (?:with|by) (.+?)\.?$/i, value: (m) => m[1] },
  { rule: "failsInside", test: /^Will not work on a unit inside (.+?)\.?$/i, value: (m) => (m[1] ?? "").split(/,\s*(?:or\s+)?|\s+or\s+/).filter(Boolean) },
];

/** The rules one ability's notes state, or null when they state none. */
export function toRules(notes: readonly string[]): AbilityRules | null {
  const rules: Partial<Record<Rule, unknown>> = {};
  const used: string[] = [];
  for (const note of notes) {
    let hit = false;
    for (const { rule, test, value } of MATCHERS) {
      if (rule in rules) continue;
      const m = note.match(test);
      if (!m) continue;
      rules[rule] = value(m);
      hit = true;
    }
    if (hit) used.push(note);
  }
  return used.length ? ({ ...rules, notes: used } as AbilityRules) : null;
}

/** Fewer notes than this means the file came back cut short; the game has over a thousand. */
const MIN_NOTES = 500;

/** The rules for every ability and item whose notes state one, by internal name. Throws on a cut-short file. */
export function toAbilityNotes(text: string): AbilityNotes {
  const notes = parseNotes(text);
  const count = [...notes.values()].reduce((n, list) => n + list.length, 0);
  if (count < MIN_NOTES) throw new Error(`Only ${count} ability notes in the game text`);
  const out: AbilityNotes = {};
  for (const key of [...notes.keys()].sort()) {
    const rules = toRules(notes.get(key) ?? []);
    if (rules) out[key] = rules;
  }
  return out;
}

/** Downloads the game text and builds the rules. */
export async function fetchAbilityNotes(): Promise<AbilityNotes> {
  const res = await fetch(ABILITY_TEXT_URL);
  if (!res.ok) throw new Error(`Ability text: HTTP ${res.status}`);
  return toAbilityNotes(await res.text());
}
