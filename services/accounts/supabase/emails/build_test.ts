import { assert, assertEquals } from "jsr:@std/assert@1";
import { emails, render } from "./build.ts";

const dir = new URL("../templates/", import.meta.url);

for (const email of emails) {
  Deno.test(`${email.file} is up to date (run npm run emails)`, async () => {
    assertEquals(await Deno.readTextFile(new URL(email.file, dir)), render(email));
  });

  Deno.test(`${email.file} is safe for Supabase's renderer`, () => {
    const html = render(email);
    // html/template removes comments, so nothing may rely on them.
    assert(!html.includes("<!--"), "no HTML comments");
    const opens = html.match(/\{\{\s*(if|range|with)\b/g)?.length ?? 0;
    const ends = html.match(/\{\{\s*end\s*\}\}/g)?.length ?? 0;
    assertEquals(opens, ends, "every {{ if }} has an {{ end }}");
    assert(html.length < 100_000, "under Gmail's clipping size");
  });
}

Deno.test("config.toml uses the same subjects and files", async () => {
  const config = await Deno.readTextFile(new URL("../config.toml", import.meta.url));
  for (const email of emails) {
    assert(config.includes(`subject = ${JSON.stringify(email.subject)}`), `${email.file} subject in config.toml`);
    assert(config.includes(`content_path = "./supabase/templates/${email.file}"`), `${email.file} in config.toml`);
  }
});
