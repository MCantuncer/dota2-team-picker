/** Reads the saved ranked games back from local files or the public hero-data bucket. */
import { existsSync, readFileSync } from "node:fs";
import { isEvalMatch, monthPath, type EvalMatch } from "./eval-matches";
import { HERO_DATA_URL } from "./pull";

const BUCKET_URL = HERO_DATA_URL.replace(/snapshot\.json$/, "");

/**
 * The games in one local file or bucket path (such as `eval/matches-2026-10.json`). A month
 * with no file yet gives no games; games with a bad shape are skipped with a warning.
 */
export async function loadEvalGames(source: string): Promise<EvalMatch[]> {
  let text: string;
  if (existsSync(source)) {
    text = readFileSync(source, "utf8");
  } else {
    const res = await fetch(BUCKET_URL + source, { cache: "no-store" });
    // Supabase Storage answers 400 for an object that does not exist.
    if (res.status === 404 || res.status === 400) return [];
    if (!res.ok) throw new Error(`GET ${source} failed: HTTP ${res.status}`);
    text = await res.text();
  }
  const list: unknown = JSON.parse(text);
  if (!Array.isArray(list)) throw new Error(`${source} is not a list of games`);
  const games = list.filter(isEvalMatch);
  if (games.length < list.length) console.warn(`${source}: skipped ${list.length - games.length} games with a bad shape`);
  return games;
}

/** The month files from the month of `from` to the month of `to` (Unix seconds), oldest first. */
export function monthPaths(from: number, to: number): string[] {
  const paths: string[] = [];
  const d = new Date(from * 1000);
  d.setUTCDate(1);
  while (d.getTime() / 1000 <= to) {
    paths.push(monthPath(d.getTime() / 1000));
    d.setUTCMonth(d.getUTCMonth() + 1);
  }
  return paths;
}
