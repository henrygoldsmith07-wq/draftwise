import assert from "node:assert/strict";
import test from "node:test";
import {
  cleanPreferredReplacements,
  formatPreferredReplacements,
  parsePreferredReplacements,
  resolvePreferredTerminology,
} from "../lib/terminology.ts";
import {
  MemoryDocumentBackend,
  createDocument,
  sanitiseStoredDocument,
} from "../lib/documents.ts";
import { DocumentLifecycle } from "../lib/document-lifecycle.ts";
import { analyzeLocally } from "../packages/grammar/src/index.ts";
import { buildGoalsContext } from "../packages/ai/src/index.ts";

/**
 * Per-document word swaps: the per-document counterpart to the global
 * preferredTerminology style guide. A client draft can prefer "sign in"
 * while another draft in the same library prefers "log in", and the
 * document's own map wins for that draft only.
 */

test("parse accepts ->, => and = separators", () => {
  assert.deepEqual(parsePreferredReplacements("login -> sign in"), { login: "sign in" });
  assert.deepEqual(parsePreferredReplacements("login => sign in"), { login: "sign in" });
  assert.deepEqual(parsePreferredReplacements("login = sign in"), { login: "sign in" });
});

test("parse splits on commas and newlines and collapses whitespace", () => {
  assert.deepEqual(
    parsePreferredReplacements("login -> sign   in,\nutilise -> use"),
    { login: "sign in", utilise: "use" },
  );
});

test("parse drops entries without a separator, with an empty side, or that change nothing", () => {
  assert.deepEqual(parsePreferredReplacements("just a term, -> use, login -> "), {});
  assert.deepEqual(parsePreferredReplacements("login -> login"), {});
  assert.deepEqual(parsePreferredReplacements("Login -> LOGIN"), {});
});

test("parse dedupes case-insensitively on the from side, first wins", () => {
  assert.deepEqual(
    parsePreferredReplacements("Login -> sign in, login -> log in"),
    { Login: "sign in" },
  );
});

test("parse drops overlong sides and caps the map", () => {
  assert.deepEqual(parsePreferredReplacements(`${"a".repeat(81)} -> use`), {});
  assert.deepEqual(parsePreferredReplacements(`login -> ${"b".repeat(81)}`), {});
  const input = Array.from({ length: 200 }, (_, i) => `from${i} -> to${i}`).join(", ");
  assert.equal(Object.keys(parsePreferredReplacements(input)).length, 50);
});

test("format round-trips through parse", () => {
  const swaps = { login: "sign in", utilise: "use" };
  assert.deepEqual(parsePreferredReplacements(formatPreferredReplacements(swaps)), swaps);
  assert.equal(formatPreferredReplacements(undefined), "");
});

test("clean drops non-strings, overlong entries and self-swaps from stored values", () => {
  assert.deepEqual(
    cleanPreferredReplacements({ login: "sign in", bad: 7, "": "empty", same: "same" }),
    { login: "sign in" },
  );
  assert.deepEqual(cleanPreferredReplacements("login -> sign in"), {});
  assert.deepEqual(cleanPreferredReplacements(undefined), {});
  assert.deepEqual(cleanPreferredReplacements(null), {});
});

test("resolve lets the document win over the global map case-insensitively", () => {
  const { merged, documentFroms } = resolvePreferredTerminology(
    { login: "log in", utilise: "use" },
    { Login: "sign in" },
  );
  assert.deepEqual(merged, { Login: "sign in", utilise: "use" });
  assert.ok(documentFroms.has("login"));
  assert.ok(!documentFroms.has("utilise"));
});

test("resolve keeps global entries the document does not override", () => {
  const { merged } = resolvePreferredTerminology({ utilise: "use" }, {});
  assert.deepEqual(merged, { utilise: "use" });
  assert.deepEqual(resolvePreferredTerminology(undefined, undefined).merged, {});
});

test("a document swap flags the draft with the document message", () => {
  const { issues } = analyzeLocally("Please login to continue.", {}, {
    audience: "general",
    intent: "inform",
    tone: "neutral",
    preferredReplacements: { login: "sign in" },
  });
  const flagged = issues.filter((issue) => issue.ruleId === "consistency-preferred-term");
  assert.equal(flagged.length, 1);
  assert.equal(flagged[0].replacement, "sign in");
  assert.match(flagged[0].explanation, /This document prefers/);
});

test("an overlapping global entry does not fire alongside the document swap", () => {
  const { issues } = analyzeLocally(
    "Please login to continue.",
    { preferredTerminology: { login: "log in" } },
    {
      audience: "general",
      intent: "inform",
      tone: "neutral",
      preferredReplacements: { login: "sign in" },
    },
  );
  const flagged = issues.filter((issue) => issue.ruleId === "consistency-preferred-term");
  assert.equal(flagged.length, 1);
  assert.equal(flagged[0].replacement, "sign in");
});

test("a global entry still fires with the style-guide message when the document has no swaps", () => {
  const { issues } = analyzeLocally(
    "Please login to continue.",
    { preferredTerminology: { login: "log in" } },
    { audience: "general", intent: "inform", tone: "neutral" },
  );
  const flagged = issues.filter((issue) => issue.ruleId === "consistency-preferred-term");
  assert.equal(flagged.length, 1);
  assert.equal(flagged[0].replacement, "log in");
  assert.match(flagged[0].explanation, /style guide/);
});

test("swaps do not leak across documents", () => {
  const goals = {
    audience: "general",
    intent: "inform",
    tone: "neutral",
    preferredReplacements: { login: "sign in" },
  };
  const withSwaps = analyzeLocally("Please login to continue.", {}, goals).issues
    .filter((issue) => issue.ruleId === "consistency-preferred-term");
  const without = analyzeLocally("Please login to continue.", {}, {
    audience: "general",
    intent: "inform",
    tone: "neutral",
  }).issues.filter((issue) => issue.ruleId === "consistency-preferred-term");
  assert.equal(withSwaps.length, 1);
  assert.equal(without.length, 0);
});

test("createDocument stores its own copy of the swap map", () => {
  const goals = {
    audience: "technical",
    intent: "inform",
    tone: "neutral",
    preferredReplacements: { login: "sign in" },
  };
  const document = createDocument("Essay", "Body.", Date.now(), goals);
  goals.preferredReplacements.login = "mutated";
  assert.deepEqual(document.goals?.preferredReplacements, { login: "sign in" });
});

test("sanitise keeps a valid swap map and cleans a hostile one without losing the document", () => {
  const kept = sanitiseStoredDocument({
    id: "a",
    draft: "Text.",
    goals: {
      audience: "technical",
      intent: "inform",
      tone: "neutral",
      preferredReplacements: { login: "sign in" },
    },
  });
  assert.deepEqual(kept?.goals?.preferredReplacements, { login: "sign in" });

  const hostile = Object.fromEntries(
    Array.from({ length: 200 }, (_, i) => [`from${i}`, `to${i}`]),
  );
  const cleaned = sanitiseStoredDocument({
    id: "b",
    draft: "Text.",
    goals: { audience: "technical", intent: "inform", tone: "neutral", preferredReplacements: hostile },
  });
  assert.equal(cleaned?.draft, "Text.");
  assert.equal(Object.keys(cleaned?.goals?.preferredReplacements ?? {}).length, 50);
});

test("each document keeps its own swaps while the other is edited", async () => {
  const lifecycle = new DocumentLifecycle(new MemoryDocumentBackend(), { title: "Untitled draft", draft: "" });
  await lifecycle.load();
  const first = lifecycle.getActive();
  lifecycle.updateActive({
    goals: {
      audience: "technical",
      intent: "inform",
      tone: "neutral",
      preferredReplacements: { login: "sign in" },
    },
  });

  const second = lifecycle.createNew("Email", "Quick note.", {
    audience: "professional",
    intent: "inform",
    tone: "casual",
  });
  assert.deepEqual(second.goals?.preferredReplacements ?? {}, {});
  lifecycle.open(first.id);
  assert.deepEqual(lifecycle.getActive()?.goals?.preferredReplacements, { login: "sign in" });

  const copy = lifecycle.duplicate(first.id);
  assert.deepEqual(copy?.goals?.preferredReplacements, { login: "sign in" });
  await lifecycle.flush();
});

test("the goals prompt states document swaps as overriding the general guide", () => {
  const context = buildGoalsContext(
    {
      audience: "technical",
      intent: "explain",
      tone: "confident",
      preferredReplacements: { login: "sign in" },
    },
    { preferredTerminology: { login: "log in", utilise: "use" } },
  );
  assert.match(context, /This document uses these exact terms.*login.*sign in/);
  assert.match(context, /utilise.*use/);
  // The overridden global value must not reappear as a competing instruction.
  assert.doesNotMatch(context, /"login" -> "log in"/);
});
