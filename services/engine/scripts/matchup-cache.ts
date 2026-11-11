/**
 * Reads the whole matchup cache (matchup_guides) for the offline item reports. Needs SUPABASE_URL and
 * SUPABASE_SECRET_KEY; makes no STRATZ calls.
 */
import { createClient } from "@supabase/supabase-js";

const PAGE = 1000;

/** One cached slice: a hero at a position against one enemy, with its games as saved (unchecked JSON). */
export interface CacheRow {
  hero_id: number;
  position: number;
  enemy_id: number;
  game_version: number;
  games: unknown;
}

function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

/** Every row of the cache, every game version, a page at a time. */
export async function readCache(): Promise<CacheRow[]> {
  const supabase = createClient(env("SUPABASE_URL"), env("SUPABASE_SECRET_KEY"), { auth: { persistSession: false } });
  const rows: CacheRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("matchup_guides")
      .select("hero_id, position, enemy_id, game_version, games")
      .order("hero_id")
      .order("position")
      .order("enemy_id")
      .order("game_version")
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`Reading the cache failed: ${error.message}`);
    // The select above names exactly CacheRow's columns.
    rows.push(...((data ?? []) as CacheRow[]));
    if (!data || data.length < PAGE) return rows;
  }
}
