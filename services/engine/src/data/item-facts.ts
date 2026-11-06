/**
 * Facts about every shop item from OpenDota's /constants/items: the dispel it applies, who it reaches, and
 * whether it is an attack item. The engine reads them (src/engine/item-facts.ts) so an answer is chosen
 * from what an item does. The constants change with each patch, so the facts are written to a committed
 * file (scripts/item-facts.ts) and the diff is reviewed in a pull request.
 */
import type { ItemFact, Reach } from "../engine/item-facts";
import { getOpenDota } from "./opendota";

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Attribute keys that mean an item adds to right clicks. */
const ATTACK_KEY = /^(bonus_damage|bonus_attack_speed(_pct)?|crit_(chance|multiplier)|bash_(chance|chance_melee|chance_ranged))$/;

const DISPEL_TYPE = /Dispel Type: (Basic|Strong) Dispel/i;

/** Who the dispel reaches: OpenDota's target_team when it says, else the item's cast rules in its text, else the user. */
function reachOf(team: unknown, text: string): Reach[] {
  const teams = new Set(Array.isArray(team) ? team : [team]);
  const reach = new Set<Reach>();
  if (teams.has("Enemy") || teams.has("Both")) reach.add("enemy");
  if (teams.has("Friendly") || teams.has("Both")) reach.add("ally").add("self");
  if (!reach.size) {
    if (/\benemy units?\b/i.test(text)) reach.add("enemy");
    if (/\ballied units?\b/i.test(text)) reach.add("ally");
    reach.add("self");
  }
  if (/\bboth the wearer and the target\b/i.test(text)) reach.add("self");
  const order: Reach[] = ["enemy", "self", "ally"];
  return order.filter((r) => reach.has(r));
}

/**
 * Builds the facts, by item key, for shop items (a cost above 0, not a recipe). Only items with a fact are
 * kept. Throws when the constant is not an object, so a changed API never writes a broken facts file.
 */
export function toItemFacts(items: unknown): Record<string, ItemFact> {
  if (!isRecord(items)) throw new Error("OpenDota item constants are not an object");
  const facts: Record<string, ItemFact> = {};
  for (const [key, row] of Object.entries(items)) {
    if (!isRecord(row) || key.startsWith("recipe_") || typeof row.cost !== "number" || row.cost <= 0) continue;
    const abilities = Array.isArray(row.abilities) ? row.abilities.filter(isRecord) : [];
    // The ability that dispels; its text alone says who it reaches (Guardian Greaves' aura names allies, its dispel only the caster).
    const dispelling = abilities.find((a) => typeof a.description === "string" && DISPEL_TYPE.test(a.description));
    const text = typeof dispelling?.description === "string" ? dispelling.description : "";
    const attrib = Array.isArray(row.attrib) ? row.attrib.filter(isRecord) : [];
    const attack = attrib.some((a) => typeof a.key === "string" && ATTACK_KEY.test(a.key));
    const dispel = DISPEL_TYPE.exec(text)?.[1]?.toLowerCase() as "basic" | "strong" | undefined;
    const fact: ItemFact = {};
    if (dispel) {
      const behavior = Array.isArray(row.behavior) ? row.behavior : [row.behavior];
      const passive = behavior.includes("Passive") || dispelling?.type !== "active";
      fact.dispel = dispel;
      fact.reaches = passive ? ["self"] : reachOf(row.target_team, text);
      if (/\bcontinuously dispels\b/i.test(text)) fact.repeats = true;
      if (fact.reaches.includes("enemy") && /\binvulnerable\b/i.test(text)) fact.invulnerableTarget = true;
      if (passive) fact.passive = true;
    }
    if (attack) fact.attack = true;
    if (Object.keys(fact).length) facts[key] = fact;
  }
  return facts;
}

/** Fewer shop items than this means the constant came back cut short. */
const MIN_ITEMS = 150;

/** Downloads the item constants and builds the facts. */
export async function fetchItemFacts(): Promise<Record<string, ItemFact>> {
  const items = await getOpenDota<unknown>("/constants/items");
  if (!isRecord(items)) throw new Error("OpenDota item constants are not an object");
  const shop = Object.entries(items).filter(([k, r]) => !k.startsWith("recipe_") && isRecord(r) && typeof r.cost === "number" && r.cost > 0).length;
  if (shop < MIN_ITEMS) throw new Error(`Item constants list only ${shop} shop items`);
  return toItemFacts(items);
}
