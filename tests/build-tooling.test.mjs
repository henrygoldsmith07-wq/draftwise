import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

/**
 * The build tooling.
 *
 * This repository has two builds. `npm run build` produces the Cloudflare
 * Workers artifact through vinext, and `npm run build:vercel` produces the
 * Next.js build that Vercel serves. They are different frameworks that happen
 * to share one repository, and they both write route types into `.next/types`.
 *
 * That overlap had a consequence nobody intended: vinext writes
 * `.next/types/routes.d.ts` in its own shape, while Next writes
 * `.next/types/validator.ts` against its own shape. Run the Cloudflare build
 * after the Vercel build and the two files disagree — and `tsc` reports three
 * errors in a file nobody wrote, about a change nobody made.
 *
 * The fix is to regenerate the types before checking them, so the check is
 * correct whatever ran before it. These tests pin that behaviour, because a
 * type-check that fails for reasons unrelated to the source is a type-check
 * people learn to ignore.
 */

const read = (relativePath) => readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");

const packageJson = JSON.parse(read("package.json"));

test("the type check regenerates the route types before it runs", () => {
  // `next typegen` rewrites `.next/types` in Next's shape, so the check
  // cannot be broken by a build that wrote them in another shape.
  assert.match(packageJson.scripts["type-check"], /next typegen/u);
  assert.match(packageJson.scripts["type-check"], /tsc --noEmit/u);
  // The order matters: generating after the check would be pointless.
  assert.ok(
    packageJson.scripts["type-check"].indexOf("next typegen") < packageJson.scripts["type-check"].indexOf("tsc --noEmit"),
    "the types are generated before they are checked",
  );
});

test("the repository keeps both builds", () => {
  // The two artifacts are the reason the types collide in the first place,
  // and both are deployed, so neither script can be quietly dropped.
  assert.ok(packageJson.scripts.build, "the Cloudflare build is kept");
  assert.ok(packageJson.scripts["build:vercel"], "the Vercel build is kept");
});

test("the type check is part of the continuous integration contract", () => {
  // A check nobody runs is not a check. CI runs it before the build, which
  // is why it never saw the collision — this pins that it still runs.
  const workflow = read(".github/workflows/ci.yml");
  assert.match(workflow, /type-check/u);
});
