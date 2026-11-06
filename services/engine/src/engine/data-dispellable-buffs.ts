/**
 * Enemy spells that protect or power up a hero and that a basic dispel like Nullifier removes: ethereal
 * forms that stop right clicks (Ghost Shroud, Decrepify), shields, and strong buffs. Kept by hand, because
 * OpenDota has no "this is a buff" flag and its dispel flag also covers debuffs on you. That each one goes
 * with a basic dispel comes from the spell facts (spell-facts.ts), and a test fails if a patch changes it.
 * Keys are Dota's internal ability names.
 *
 * Left out on purpose: Fate's Edict (disarms the ally, no help against right clicks), Escape Act (the ally
 * is hidden, Nullifier can't target it), Flame Guard (only blocks magic damage), Repel (not sure Nullifier
 * lands through its debuff immunity), and saves no dispel removes (Shallow Grave, False Promise, Refraction).
 */
export const DISPELLABLE_BUFFS: ReadonlySet<string> = new Set([
  "necrolyte_ghost_shroud",
  "pugna_decrepify",
  "abaddon_aphotic_shield",
  "oracle_purifying_flames",
  "treant_living_armor",
  "windrunner_windrun",
  "legion_commander_press_the_attack",
  "ogre_magi_bloodlust",
  "ogre_magi_smash",
  "lich_frost_shield",
  "grimstroke_spirit_walk",
]);
