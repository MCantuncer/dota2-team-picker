import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { fetchPlayer, type PlayerData } from "./opendota.ts";
import { steamIdToAccountId } from "./steam.ts";

/**
 * Copies a Steam user's rank, name, picture and per-hero record from
 * OpenDota into their profile. Needs a service role client, because users
 * cannot write these fields themselves.
 */
export async function syncProfile(
  admin: SupabaseClient,
  userId: string,
  steamId: string,
  fetchFn: typeof fetch = fetch,
) {
  const player = await fetchPlayer(steamIdToAccountId(steamId), fetchFn);

  const { data, error } = await admin
    .from("profiles")
    .update(profileUpdate(player))
    .eq("id", userId)
    .select("display_name, avatar_url, steam_name, rank_tier, synced_at")
    .single();
  if (error) throw error;
  return data;
}

/**
 * The profile fields a sync writes. The site name is always the Steam name: Steam is the only sign in,
 * and players don't set a name of their own.
 */
export function profileUpdate(player: PlayerData, now = new Date()): Record<string, unknown> {
  const update: Record<string, unknown> = {
    rank_tier: player.rankTier,
    hero_stats: player.heroStats,
    hero_games: player.heroGames,
    synced_at: now.toISOString(),
    // Put the player first in line for the trends job, so games show on Your Games within its
    // next run (every 30 minutes) instead of after the 12 hour wait.
    trends_checked_at: null,
  };
  if (player.name) {
    update.steam_name = player.name.slice(0, 64);
    update.display_name = player.name.slice(0, 40);
  }
  if (player.avatarUrl) update.avatar_url = player.avatarUrl;
  return update;
}
