import { assertEquals } from "jsr:@std/assert@1";
import { sameSecret } from "./job_secret.ts";

Deno.test("accepts only the exact secret", async () => {
  assertEquals(await sameSecret("s3cret", "s3cret"), true);
  assertEquals(await sameSecret("s3cre", "s3cret"), false);
  assertEquals(await sameSecret("", "s3cret"), false);
});
