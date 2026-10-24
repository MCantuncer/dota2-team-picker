/**
 * Downloads the latest published hero data into data/snapshot.json:
 *
 *   npm run pull-data
 *
 * The daily GitHub Action runs this before fetch-data so each run builds on the
 * last one. Locally it gives the suggest and plan scripts today's data.
 */
import { writeFileSync } from "node:fs";

const SNAPSHOT_PATH = "data/snapshot.json";
export const HERO_DATA_URL =
  process.env.HERO_DATA_URL ??
  "https://odigcdwsvajkbvcxeskj.supabase.co/storage/v1/object/public/hero-data/snapshot.json";

async function main() {
  const res = await fetch(HERO_DATA_URL, { cache: "no-store" });
  if (!res.ok) throw new Error(`GET ${HERO_DATA_URL} failed: HTTP ${res.status}`);
  writeFileSync(SNAPSHOT_PATH, await res.text());
  console.log(`Saved ${SNAPSHOT_PATH} from ${HERO_DATA_URL}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
