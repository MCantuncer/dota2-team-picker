/**
 * One STRATZ run that checks the fields the item odds need (item journey plan, PR 8) and records one
 * real answer as a test fixture:
 *
 *   STRATZ_TOKEN=... npm run record-stratz-items -w services/engine -- [matchId]
 *
 * Run it from one machine only (STRATZ lets a token be used from 2 addresses per 15 minutes), outside the
 * refresh hours (02:17, 06:17, 10:17, 14:17 UTC). It makes 3 calls: the schema of the match and player
 * types, the guide list of one matchup to find a recent match (when no id is given), and that match with
 * the new fields. It writes stratz-items-record.json next to this script; the token is never printed or
 * written.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";

const URL = "https://api.stratz.com/graphql";
const OUT = join(import.meta.dirname, "stratz-items-record.json");

async function post(
  token: string,
  query: string,
): Promise<{ ms: number; status: number; body: unknown }> {
  const started = performance.now();
  const res = await fetch(URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "User-Agent": "STRATZ_API",
    },
    body: JSON.stringify({ query }),
  });
  const body: unknown = await res.json().catch(() => null);
  return {
    ms: Math.round(performance.now() - started),
    status: res.status,
    body,
  };
}

const SCHEMA_QUERY = `{
  match: __type(name: "MatchType") { fields { name type { name kind ofType { name kind } } } }
  player: __type(name: "MatchPlayerType") { fields { name type { name kind ofType { name kind } } } }
  stats: __type(name: "MatchPlayerStatsType") { fields { name type { name kind ofType { name kind } } } }
  purchase: __type(name: "MatchPlayerItemPurchaseEventType") { fields { name type { name kind } } }
}`;

/** Juggernaut (8) pos 1 against Lion (26): a common matchup, to find a recent high-rank match. */
const GUIDE_QUERY = `{ heroStats { g: guide(heroId: 8, positionId: POSITION_1, againstHeroId: 26, take: 1) { guides { matchId } } } }`;

/** The match fields today's lookup asks for, plus the ones PR 8 adds. */
const matchQuery = (id: number) => `{
  m0: match(id: ${id}) {
    id gameVersionId durationSeconds didRadiantWin radiantNetworthLeads
    players {
      steamAccountId heroId position level isVictory isRadiant
      abilities { abilityId time }
      stats { itemPurchases { time itemId } }
    }
  }
}`;

async function main() {
  const token = process.env.STRATZ_TOKEN;
  if (!token) throw new Error("STRATZ_TOKEN is not set");
  const record: Record<string, unknown> = { at: new Date().toISOString() };

  record.schema = await post(token, SCHEMA_QUERY);
  let id = Number(process.argv[2]);
  if (!Number.isSafeInteger(id) || id <= 0) {
    const guide = await post(token, GUIDE_QUERY);
    record.guide = guide;
    // Checked right below; a missing id stops the run.
    const found = (
      guide.body as {
        data?: { heroStats?: { g?: { guides?: { matchId?: unknown }[] }[] } };
      } | null
    )?.data?.heroStats?.g?.[0]?.guides?.[0]?.matchId;
    if (typeof found !== "number") {
      writeFileSync(OUT, JSON.stringify(record, null, 2));
      throw new Error(`No match id in the guide answer; see ${OUT}`);
    }
    id = found;
  }
  record.match = await post(token, matchQuery(id));
  writeFileSync(OUT, JSON.stringify(record, null, 2));
  // Checked loosely: this only reports, the file has the whole answer.
  const errors =
    (record.match as { body?: { errors?: { message?: string }[] } }).body
      ?.errors ?? [];
  console.log(
    `Match ${id}: ${errors.length ? `errors: ${errors.map((e) => e.message).join("; ")}` : "answered"}`,
  );
  console.log(`Wrote ${OUT}. Send this file back (it holds no token).`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
