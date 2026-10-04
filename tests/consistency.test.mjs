import assert from "node:assert/strict";
import test from "node:test";
import { analyzeLocally } from "../packages/grammar/src/index.ts";
import { findConsistencyIssues, summariseConsistency } from "../packages/grammar/src/consistency.ts";
import { DEFAULT_GOALS, DEFAULT_STYLE_PREFERENCES } from "../packages/types/src/index.ts";

const style = DEFAULT_STYLE_PREFERENCES;

const consistencyIssues = (text) =>
  analyzeLocally(text, style, DEFAULT_GOALS).issues.filter((item) => item.category === "consistency");

const paragraph = (...lines) => lines.join("\n\n");

test("a draft that mixes spellings is told which form it mostly uses", () => {
  const text = paragraph(
    "The colour of the report was noted.",
    "The colour of the chart mattered.",
    "Our colour policy is strict.",
    "The colour guide is published.",
    "The color of the cover was a surprise.",
  );
  const found = consistencyIssues(text);
  assert.ok(found.length >= 1, "a mixed spelling should be reported");
  const issue = found.find((item) => item.original.toLowerCase() === "color");
  assert.ok(issue, "the minority spelling is the one to flag");
  assert.equal(issue.replacement, "colour", "the fix moves toward the draft's own dominant form");
  assert.match(issue.explanation, /4 times/);
  assert.match(issue.explanation, /once/);
});

test("a draft that is consistent is never told it is inconsistent", () => {
  // The whole point: a consistent choice is a choice, not a mistake. Flagging
  // this would be the fastest way to teach writers to ignore the feature.
  const consistent = paragraph(
    "The colour of the report was noted.",
    "The colour of the chart mattered.",
    "Our colour policy is strict.",
    "The colour guide is published.",
    "Our organisation publishes guidance.",
  );
  assert.deepEqual(consistencyIssues(consistent).filter((item) => item.ruleId.startsWith("consistency-spelling")), []);

  const american = paragraph(
    "The color of the report was noted.",
    "The color of the chart mattered.",
    "Our color policy is strict.",
    "The color guide is published.",
    "Our organization publishes guidance.",
  );
  assert.deepEqual(consistencyIssues(american).filter((item) => item.ruleId.startsWith("consistency-spelling")), []);
});

test("an even split is left alone rather than guessed at", () => {
  const even = paragraph(
    "The colour of the report was noted.",
    "The color of the chart mattered.",
    "Our colour policy is strict.",
    "The color guide is published.",
  );
  assert.deepEqual(consistencyIssues(even).filter((item) => item.ruleId.startsWith("consistency-spelling")), []);
});

test("a single slip is caught, a lone alternative usage is not", () => {
  const drift = paragraph(
    "The review continued whilst the team worked.",
    "We shall review the plan whilst the data arrives.",
    "The board met whilst the audit ran.",
    "We will review again while the pilot continues.",
  );
  const found = consistencyIssues(drift);
  assert.equal(found.length, 1);
  assert.equal(found[0].original.toLowerCase(), "while");
  assert.equal(found[0].replacement, "whilst");

  const oneOff = paragraph(
    "The review continued whilst the team worked.",
    "We shall review the plan whilst the data arrives.",
    "The board met whilst the audit ran.",
  );
  assert.deepEqual(consistencyIssues(oneOff), []);
});

test("capitalisation drift on a name is reported", () => {
  const text = paragraph(
    "Acme reported growth.",
    "ACME reported a decline.",
    "Acme expanded.",
    "ACME held steady.",
    "Acme opened a second site.",
  );
  const found = consistencyIssues(text);
  assert.equal(found.length, 1);
  assert.equal(found[0].original, "ACME");
  assert.equal(found[0].replacement, "Acme");
});

test("an ordinary word is not treated as a mis-capitalised name", () => {
  // "may" as a modal is not a capitalisation error. Treating it as one is the
  // fastest route to false positives that make a writer distrust every finding.
  const text = paragraph(
    "We may arrive soon.",
    "The team may wait.",
    "They may agree.",
    "You may leave.",
    "It may rain.",
    "May is also a month.",
    "We travel in May.",
    "May weather is variable.",
    "That may help.",
    "The result may vary.",
  );
  assert.deepEqual(consistencyIssues(text), []);
});

test("no consistency fix is suggested across a part of speech", () => {
  // Replacing a verb with a noun would be ungrammatical, so "use" is never
  // swapped for "utilisation" — only the two noun forms are compared.
  const text = paragraph(
    "The utilisation of the tool improved.",
    "Utilisation rose again.",
    "Utilisation remained flat.",
    "The utilisation figures were published.",
  );
  assert.deepEqual(consistencyIssues(text), []);

  const verb = paragraph(
    "We utilise the tool daily.",
    "They utilise it weekly.",
    "Staff utilise it often.",
    "We use it constantly.",
  );
  const found = consistencyIssues(verb);
  assert.ok(found.every((item) => item.original.toLowerCase() !== "utilise" || item.replacement.toLowerCase() === "use"));
});

test("every consistency finding names the draft's own dominant form", () => {
  const text = paragraph(
    "The organisation published guidance.",
    "The organisation meets monthly.",
    "The organisation has three teams.",
    "The organisation reports annually.",
    "The organization will publish the colour guidance next quarter.",
  );
  const found = consistencyIssues(text);
  assert.ok(found.length >= 1);
  for (const issue of found) {
    assert.ok(issue.replacement.length > 0, "a consistency finding must offer a replacement");
    assert.ok(issue.confidence >= 0.5 && issue.confidence <= 1);
    assert.ok(issue.explanation.includes("“"), "the explanation must name the competing forms");
  }
});

test("consistency findings never overlap each other", () => {
  const text = paragraph(
    "The organisation published guidance about the color scheme.",
    "The organisation published more guidance about the colour scheme.",
    "The organisation has three color policies.",
    "The organisation publishes a colour chart.",
  );
  const found = findConsistencyIssues(text, style);
  const spans = found.map((item) => [item.start, item.end]).sort((left, right) => left[0] - right[0]);
  for (let index = 1; index < spans.length; index += 1) {
    assert.ok(spans[index][0] >= spans[index - 1][1], "the same words cannot be two kinds of drift at once");
  }
});

test("consistency offsets still point at the real text", () => {
  const text = paragraph(
    "The organisation published guidance.",
    "The organisation meets monthly.",
    "The organisation has three teams.",
    "The organisation reports annually.",
    "The organization will publish next quarter.",
  );
  for (const issue of findConsistencyIssues(text, style)) {
    assert.equal(text.slice(issue.start, issue.end), issue.original, "offsets must still match the draft");
  }
});

test("a clean, consistent draft produces no consistency noise at all", () => {
  const text = paragraph(
    "The committee reviewed the budget on Tuesday and agreed the revised figures.",
    "The finance team will publish the summary once every member has signed it off.",
    "Members can submit written objections before the end of the week.",
    "The chair will record any remaining disagreement in the minutes.",
  );
  assert.deepEqual(consistencyIssues(text), []);
});

test("the consistency summary reports what was checked", () => {
  const text = paragraph(
    "The organisation published guidance.",
    "The organisation meets monthly.",
    "The organisation has three teams.",
    "The organization will publish next quarter.",
  );
  const report = summariseConsistency(findConsistencyIssues(text, style));
  assert.ok(report.issues >= 1);
  assert.ok(report.families >= 1);
  assert.ok(report.findings.every((entry) => entry.kind.startsWith("consistency-")));
});

test("consistency checking stays local and deterministic", () => {
  const text = paragraph(
    "The organisation published guidance.",
    "The organisation meets monthly.",
    "The organisation has three teams.",
    "The organization will publish next quarter.",
  );
  const first = findConsistencyIssues(text, style).map((item) => `${item.ruleId}:${item.start}:${item.end}`);
  const second = findConsistencyIssues(text, style).map((item) => `${item.ruleId}:${item.start}:${item.end}`);
  assert.deepEqual(first, second, "the same draft must always produce the same findings");
});

test("consistency drift is found in a long document, not just a short one", () => {
  const paragraphs = [];
  for (let index = 0; index < 60; index += 1) {
    paragraphs.push(`The organisation reviewed the quarterly figures for region ${index + 1} and recorded the outcome in the register.`);
  }
  // The drift appears late, the way it does when a section was pasted in.
  paragraphs.push("The organization also reviewed the colour of the printed summary.");
  const text = paragraphs.join("\n\n");
  const found = consistencyIssues(text);
  const late = found.filter((item) => item.start > text.length * 0.8);
  assert.ok(late.length >= 1, "drift introduced late in a long draft must still be found");
  assert.ok(late.some((item) => item.original.toLowerCase() === "organization" || item.original.toLowerCase() === "colour"));
});