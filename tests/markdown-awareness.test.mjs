import assert from "node:assert/strict";
import test from "node:test";
import { findProtectedSpans, isInsideProtectedSpan, isStructuredLineStart } from "../packages/grammar/src/markdown.ts";
import { findGoalTerminology } from "../packages/grammar/src/structure.ts";
import { analyzeLocally } from "../packages/grammar/src/index.ts";
import { DEFAULT_STYLE_PREFERENCES } from "../packages/types/src/index.ts";

const style = DEFAULT_STYLE_PREFERENCES;

test("code fences and inline code are protected from prose rules", () => {
  const text = "Use the API like this:\n\n```js\nconst teh value = recieve()\n```\n\nOr call `recieve()` directly.";
  const spans = findProtectedSpans(text);
  assert.ok(spans.some((span) => span.kind === "code-fence"));
  assert.ok(spans.some((span) => span.kind === "inline-code"));
  const result = analyzeLocally(text, style);
  const spelling = result.issues.filter((issue) => issue.category === "spelling");
  assert.deepEqual(spelling.map((issue) => issue.original), [], "no spelling nits inside code");
});

test("URLs are never grammar-checked", () => {
  const text = "See https://example.com/its-a-path?recieve=teh for the reference page.";
  const result = analyzeLocally(text, style);
  assert.equal(result.issues.some((issue) => issue.original.includes("recieve") && issue.start > 4), false);
  assert.equal(result.issues.some((issue) => issue.original === "its"), false);
});

test("bullet lists are not nagged about sentence fragments or missing full stops", () => {
  const text = "The plan has three steps:\n\n- Gather the data\n- Draft the report\n- Share with the team\n\nThat covers everything.";
  const result = analyzeLocally(text, style);
  assert.equal(result.issues.some((issue) => issue.ruleId === "structure-fragment"), false);
  assert.equal(result.issues.some((issue) => issue.ruleId === "punctuation-missing-terminal"), false);
});

test("real fragments in prose paragraphs are still flagged", () => {
  const text = "The report is ready. just kidding though\n\nA proper sentence follows here to anchor the text.";
  const result = analyzeLocally(text, style);
  assert.equal(result.issues.some((issue) => issue.ruleId === "capitalization-sentence-start"), true);
});

test("forbidden terminology is flagged and required terminology is checked", () => {
  const goals = {
    audience: "professional",
    intent: "inform",
    tone: "professional",
    forbiddenTerminology: ["synergy"],
    requiredTerminology: ["AI model"],
  };
  const text = "The synergy between teams is strong. The system works.";
  const issues = findGoalTerminology(text, goals, style);
  assert.ok(issues.some((issue) => issue.ruleId === "goal-forbidden-term" && issue.original.toLowerCase() === "synergy"));
  assert.ok(issues.some((issue) => issue.ruleId === "goal-missing-term" && issue.explanation.includes("AI model")));
});

test("required terminology present in the draft produces no note", () => {
  const goals = { audience: "professional", intent: "inform", tone: "professional", requiredTerminology: ["AI model"] };
  const text = "The AI model performs well in production.";
  assert.deepEqual(findGoalTerminology(text, goals, style), []);
});

test("goal terminology notes flow through the full analysis", () => {
  const goals = { audience: "general", intent: "inform", tone: "neutral", forbiddenTerminology: ["paradigm"] };
  const text = "This new paradigm changes how we work every day in practice.";
  const result = analyzeLocally(text, style, goals);
  assert.ok(result.issues.some((issue) => issue.ruleId === "goal-forbidden-term"));
});

test("protected span helpers merge overlaps and answer containment queries", () => {
  const text = "`code` and `more code` with https://example.com links";
  const spans = findProtectedSpans(text);
  assert.equal(isInsideProtectedSpan(spans, 1, 4), true);
  assert.equal(isInsideProtectedSpan(spans, text.indexOf("and"), text.indexOf("and") + 3), false);
  assert.equal(isStructuredLineStart("- a bullet item", 2), true);
  assert.equal(isStructuredLineStart("1. a numbered step", 3), true);
  assert.equal(isStructuredLineStart("Normal prose here", 2), false);
});
