import assert from "node:assert/strict";
import test from "node:test";
import { analyzeLocally } from "../packages/grammar/src/index.ts";
import {
  SUGGESTION_DENSITY_CAPS,
  SUPPRESSION_REASONS,
  densityCapsFor,
  describeSuppression,
  prioritiseSuggestions,
} from "../packages/grammar/src/prioritise.ts";
import { buildDocumentOutline, summariseDocument } from "../packages/grammar/src/outline.ts";
import { buildAction, buildExplanation, explainRanking, explainRelevance } from "../packages/grammar/src/explain.ts";
import { createAnalysisChunks, mapRelativeRange } from "../packages/analysis/src/index.ts";
import { DEFAULT_GOALS, DEFAULT_STYLE_PREFERENCES } from "../packages/types/src/index.ts";

const style = DEFAULT_STYLE_PREFERENCES;
const goals = (patch = {}) => ({ ...DEFAULT_GOALS, ...patch });

/** A draft with one identical repeated mistake per paragraph: a constant error rate. */
function repeatedDraft(paragraphs) {
  return Array.from({ length: paragraphs }, (_, index) =>
    `The the committee reviewed the budget report for quarter ${index + 1} and noted concerns.`,
  ).join("\n\n");
}

/** A draft with many *distinct* style findings spread through it. */
function variedDraft(paragraphs) {
  const vague = ["various", "several", "many", "numerous", "certain"];
  const fillers = ["basically", "actually", "really", "just", "quite"];
  return Array.from({ length: paragraphs }, (_, index) =>
    `The ${vague[index % vague.length]} report ${fillers[index % fillers.length]} shows that the ${vague[(index + 2) % vague.length]} team ${fillers[(index + 3) % fillers.length]} reviewed the outcomes in detail and agreed on next steps.`,
  ).join("\n\n");
}

/**
 * A draft long enough to be genuinely sectioned: ten paragraphs of roughly
 * thirty-five words each. Paragraph one turns on a contrast and the last opens
 * with a summary, so the structural notes have something real to point at.
 * The vocabulary in the two halves barely overlaps, so the outline must not
 * merge them back into one section.
 */
function multiTopicDraft() {
  return [
    "However, the earlier approach failed. Our access to the reporting process requires careful review across the organisation, and any exception must be recorded before Thursday's deadline passes without an approved waiver.",
    "Reporting deadlines matter because the audit depends on them. The reporting team publishes a schedule each quarter so supervisors can check their figures against the same calendar the auditors will use when they arrive in June.",
    "Exceptions are rare and always documented in writing. Each one is examined by the compliance committee before it takes effect, and the committee records its reasoning for later inspection by the regulator.",
    "Requests that lack prior approval are refused automatically by the gateway. This behaviour was configured during the migration last autumn and has not changed since the switch to the new identity provider.",
    "Quarterly reviews confirm that most teams comply, though a handful continue to submit incomplete paperwork. Those cases are escalated to the programme board, which meets monthly to consider each outstanding request.",
    "A second subject concerns deployment and rollout for the new service. Rollout took two days across the estate, and the operations team reported no customer-visible failures during the change window in April.",
    "Before the launch, engineers rehearsed the procedure twice against a copy of production. The rehearsals surfaced two problems with certificate rotation, both of which were fixed before anyone touched live traffic.",
    "Load testing indicated that capacity would hold comfortably through the busiest hour. The margin was thin during the morning peak, so additional hardware was scheduled to arrive a fortnight ahead of plan.",
    "Customers were notified in advance through the usual status channel, and the support desk received a briefing beforehand. Ticket volumes stayed close to normal throughout, which the desk manager later described as reassuring.",
    "Overall, the results speak for themselves and the project is complete. The remaining work is limited to documentation updates that the service desk will carry out before the end of the month.",
  ].join("\n\n");
}

// ---------------------------------------------------------------------------
// Prioritisation has to scale with the document.
// ---------------------------------------------------------------------------

test("a short draft keeps the curated density caps", () => {
  const caps = densityCapsFor(40);
  assert.equal(caps["fix-first"], SUGGESTION_DENSITY_CAPS["fix-first"]);
  assert.equal(caps.improve, SUGGESTION_DENSITY_CAPS.improve);
});

test("a long draft is never shown fewer suggestions than a short one", () => {
  const short = densityCapsFor(60);
  for (const words of [500, 1_500, 5_000, 20_000]) {
    const caps = densityCapsFor(words);
    for (const tier of ["fix-first", "improve", "optional"]) {
      assert.ok(caps[tier] >= short[tier], `${tier} budget shrank at ${words} words`);
    }
  }
});

test("suggestion coverage no longer collapses as documents get longer", () => {
  // Regression: absolute caps meant a 1,600-word draft showed one suggestion and
  // hid 119, so long drafts were strictly worse served than short ones.
  const coverageFor = (text) => {
    const { issues } = analyzeLocally(text, style, DEFAULT_GOALS);
    const result = prioritiseSuggestions(issues, { text, goals: DEFAULT_GOALS, preferences: style });
    return { findings: issues.length, displayed: result.displayed.length };
  };

  const short = coverageFor(repeatedDraft(4));
  const long = coverageFor(repeatedDraft(120));
  assert.ok(long.findings > 100, "fixture must actually be long");
  assert.ok(
    long.displayed > short.displayed,
    `a long draft showed ${long.displayed} suggestions, no better than a short draft's ${short.displayed}`,
  );
});

test("repeated patterns keep several jumpable instances in a long draft", () => {
  const text = repeatedDraft(120);
  const { issues } = analyzeLocally(text, style, DEFAULT_GOALS);
  const result = prioritiseSuggestions(issues, { text, goals: DEFAULT_GOALS, preferences: style });
  assert.ok(result.displayed.length >= 5, "expected several instances of the repeated pattern");
  // Every displayed instance must carry its own location so it is actionable.
  const starts = new Set(result.displayed.map((item) => item.start));
  assert.equal(starts.size, result.displayed.length, "instances must not collapse onto one location");
  assert.ok(result.displayed.every((item) => item.groupedCount > 0), "instances must report the total pattern size");
});

test("a short draft still folds a repeated pattern into one suggestion", () => {
  const text = repeatedDraft(3);
  const { issues } = analyzeLocally(text, style, DEFAULT_GOALS);
  const result = prioritiseSuggestions(issues, { text, goals: DEFAULT_GOALS, preferences: style });
  assert.equal(result.displayed.length, 1, "a short draft should not be padded with duplicates");
  assert.ok(result.displayed[0].groupedCount >= 1);
});

// ---------------------------------------------------------------------------
// Suppression has to stay honest.
// ---------------------------------------------------------------------------

test("held-back findings are reported and every reason has a human explanation", () => {
  const text = variedDraft(60);
  const { issues } = analyzeLocally(text, style, DEFAULT_GOALS);
  const result = prioritiseSuggestions(issues, { text, goals: DEFAULT_GOALS, preferences: style });
  assert.ok(result.report.suppressedCount > 0, "fixture must suppress something");

  const reasons = new Set(result.suppressed.map((entry) => entry.reason));
  for (const reason of reasons) {
    assert.ok(SUPPRESSION_REASONS[reason], `${reason} has no writer-facing explanation`);
    assert.ok(SUPPRESSION_REASONS[reason].length > 10, `${reason} explanation is not usable copy`);
  }
  const summary = describeSuppression(result.report);
  assert.match(summary, /held back/);
  assert.match(summary, /Hidden findings/);
});

test("describeSuppression is honest when nothing was held back", () => {
  const text = "The council met on Tuesday to review the budget report in detail.";
  const { issues } = analyzeLocally(text, style, DEFAULT_GOALS);
  const result = prioritiseSuggestions(issues, { text, goals: DEFAULT_GOALS, preferences: style });
  if (result.report.suppressedCount === 0) {
    assert.match(describeSuppression(result.report), /Nothing was held back/);
  }
});

test("the report accounts for every finding as displayed or suppressed", () => {
  const text = variedDraft(25);
  const { issues } = analyzeLocally(text, style, DEFAULT_GOALS);
  const result = prioritiseSuggestions(issues, { text, goals: DEFAULT_GOALS, preferences: style });
  assert.equal(result.report.rawCount, issues.length);
  assert.equal(result.report.displayedCount, result.displayed.length);
  assert.ok(result.report.displayedCount + result.report.suppressedCount <= result.report.rawCount);
  assert.equal(
    Object.values(result.report.byTier).reduce((total, value) => total + value, 0),
    result.displayed.length,
  );
});

// ---------------------------------------------------------------------------
// Dismissal lookup must stay correct after being indexed.
// ---------------------------------------------------------------------------

test("dismissals still suppress near matches after the lookup was indexed", () => {
  const text = "The really good report was basically fine. The report was fine.";
  const { issues } = analyzeLocally(text, style, DEFAULT_GOALS);
  const first = issues.find((item) => item.original.toLowerCase() === "really");
  assert.ok(first, "fixture must contain the dismissed pattern");

  const without = prioritiseSuggestions(issues, { text, goals: DEFAULT_GOALS, preferences: style });
  assert.ok(without.displayed.some((item) => item.ruleId === first.ruleId));

  const dismissed = prioritiseSuggestions(issues, {
    text,
    goals: DEFAULT_GOALS,
    preferences: style,
    dismissed: [{ ruleId: first.ruleId, start: first.start, end: first.end, original: first.original }],
  });
  assert.ok(!dismissed.displayed.some((item) => item.ruleId === first.ruleId && item.start === first.start));
  assert.ok(dismissed.suppressed.some((entry) => entry.reason === "near-dismissal"));
});

// ---------------------------------------------------------------------------
// Document-level reasoning.
// ---------------------------------------------------------------------------

test("a long draft is broken into sections that carry real vocabulary", () => {
  // Each paragraph must clear the section target on its own, and must share
  // little vocabulary with its neighbour, or the outline is right to merge them.
  const text = multiTopicDraft();
  const { stats } = analyzeLocally(text, style, DEFAULT_GOALS);
  const outline = buildDocumentOutline(text, stats, undefined, { goals: DEFAULT_GOALS, preferences: style });

  assert.ok(outline.sections.length >= 2, "a multi-topic draft should produce sections");
  for (const section of outline.sections) {
    assert.ok(section.words > 0);
    assert.ok(section.start >= 0 && section.end <= text.length);
    assert.ok(section.end > section.start);
    assert.ok(["opening", "development", "supporting-detail", "turn", "closing", "unclear"].includes(section.role));
    assert.ok(section.novelty >= 0 && section.novelty <= 1);
  }
  assert.equal(outline.sections[0].role, "opening");
  assert.equal(outline.sections[outline.sections.length - 1].role, "closing");
});

test("themes are real words, not mangled stems", () => {
  // Regression: a naive plural strip turned "across" into "acros", so the
  // document reported a topic the writer never mentioned.
  const text = [
    "Our access to the reporting process requires careful review.",
    "Access to the reporting process is a policy concern.",
    "The policy reports across the class of students.",
    "Reporting requires access to detail.",
  ].join("\n\n");
  const { stats } = analyzeLocally(text, style, DEFAULT_GOALS);
  const outline = buildDocumentOutline(text, stats, undefined, { goals: DEFAULT_GOALS, preferences: style });
  const terms = outline.themes.map((theme) => theme.term);
  assert.ok(terms.includes("access"), "expected the recurring subject to be found");
  assert.ok(terms.includes("report"), "inflections of one word should collapse together");
  assert.ok(!terms.some((term) => ["acros", "across".slice(0, 5), "careful"].includes(term)), `mangled stem in ${terms.join(", ")}`);
  assert.ok(!outline.focus.toLowerCase().includes("acros"));
});

test("a draft that never states its aim is told so", () => {
  const paragraphs = Array.from({ length: 8 }, (_, index) =>
    `The team reviewed the quarterly figures for region ${index + 1}. The numbers were consistent with the previous period.`,
  );
  const text = paragraphs.join("\n\n");
  const { stats } = analyzeLocally(text, style, DEFAULT_GOALS);
  const outline = buildDocumentOutline(text, stats, undefined, { goals: DEFAULT_GOALS, preferences: style });
  const note = outline.notes.find((entry) => entry.id === "note-coverage-no-claim");
  assert.ok(note, "a long draft with no stated aim should be reported");
  assert.match(note.detail, /nothing states the aim/);
  assert.ok(note.suggestion.length > 20, "a note must suggest something");
  assert.ok(note.confidence < 1, "an editorial read must not claim certainty");
});

test("goal-aware notes react to the writer's own settings", () => {
  const text = Array.from({ length: 10 }, (_, index) =>
    `We reviewed the deployment notes for service ${index + 1} and confirmed the behaviour is unchanged.`,
  ).join("\n\n");
  const { stats } = analyzeLocally(text, style, DEFAULT_GOALS);

  const missing = buildDocumentOutline(text, stats, undefined, {
    goals: goals({ audience: "technical", requiredTerminology: ["runbook"] }),
    preferences: style,
  });
  assert.ok(missing.notes.some((entry) => entry.id === "note-goal-missing-term"), "a required term that never appears must be reported");

  const satisfied = buildDocumentOutline(`${text}\n\nThe runbook is attached.`, stats, undefined, {
    goals: goals({ audience: "technical", requiredTerminology: ["runbook"] }),
    preferences: style,
  });
  assert.ok(!satisfied.notes.some((entry) => entry.id === "note-goal-missing-term"));

  const tooShort = buildDocumentOutline(text, stats, undefined, {
    goals: goals({ targetLength: 5_000 }),
    preferences: style,
  });
  assert.ok(tooShort.notes.some((entry) => entry.id === "note-goal-length"), "a draft far under target should be reported");
});

test("document notes stay ordered and navigable", () => {
  const text = multiTopicDraft();
  const { stats } = analyzeLocally(text, style, DEFAULT_GOALS);
  const outline = buildDocumentOutline(text, stats, undefined, { goals: DEFAULT_GOALS, preferences: style });
  for (let index = 1; index < outline.notes.length; index += 1) {
    assert.ok(outline.notes[index].start >= outline.notes[index - 1].start, "notes must read in document order");
  }
  for (const note of outline.notes) {
    assert.ok(note.start >= 0 && note.end <= text.length && note.end > note.start);
    assert.ok(note.title.length > 0 && note.detail.length > 0 && note.suggestion.length > 0);
  }
  assert.ok(outline.sections.length >= 2, "structural notes are only raised once sections exist");
  assert.ok(outline.notes.some((note) => note.id === "note-opening-turn"), "an opening contrast should be reported");
  assert.ok(outline.notes.some((note) => note.id === "note-closing-summary"), "a summarising ending should be reported");
});

test("a very short draft produces no structural noise", () => {
  const text = "The council met.";
  const { stats } = analyzeLocally(text, style, DEFAULT_GOALS);
  const outline = buildDocumentOutline(text, stats, undefined, { goals: DEFAULT_GOALS, preferences: style });
  assert.equal(outline.notes.length, 0, "a three-word draft has nothing to say about its structure");
  assert.equal(outline.shape, "very-short");
});

test("summariseDocument describes the draft in one line", () => {
  const text = variedDraft(12);
  const { stats } = analyzeLocally(text, style, DEFAULT_GOALS);
  const outline = buildDocumentOutline(text, stats, undefined, { goals: DEFAULT_GOALS, preferences: style });
  const summary = summariseDocument(outline, stats, DEFAULT_GOALS);
  assert.ok(summary.length > 10 && summary.length < 400);
  assert.match(summary, /section/);
});

// ---------------------------------------------------------------------------
// Contextual, goal-aware explanations.
// ---------------------------------------------------------------------------

const sampleIssue = (patch = {}) => ({
  id: "issue-1",
  ruleId: "wordiness-in-order-to",
  start: 0,
  end: 11,
  original: "in order to",
  replacement: "to",
  category: "conciseness",
  severity: "low",
  confidence: 0.9,
  title: "Tighten this phrase",
  explanation: "This can usually be expressed more directly.",
  source: "local",
  tier: "improve",
  kind: "clarity",
  rank: 5,
  contextRelevance: 0.9,
  impact: 0.5,
  groupedCount: 0,
  groupedIds: [],
  reasonCodes: ["kind:clarity", "tier:improve", "high-confidence"],
  ...patch,
});

test("explanations reference the writer's actual goals", () => {
  const issue = sampleIssue();
  const persuasive = explainRelevance(issue, goals({ audience: "professional", intent: "persuade", tone: "confident" }));
  const academic = explainRelevance(issue, goals({ audience: "academic", intent: "inform", tone: "formal" }));
  assert.notEqual(persuasive, academic, "the same finding must read differently for different goals");
  assert.ok(persuasive.length > 20 && academic.length > 20);
});

test("explanations are optional when no goals are set, never invented", () => {
  assert.equal(explainRelevance(sampleIssue(), undefined), null);
  assert.ok(explainRanking(sampleIssue(), undefined).length > 10);
});

test("a low-confidence suggestion tells the writer it is safe to ignore", () => {
  const ranking = explainRanking(sampleIssue({ confidence: 0.55 }), goals());
  assert.match(ranking, /safe to ignore/i);
});

test("the ranking explanation reflects a register dampening", () => {
  const issue = sampleIssue({ reasonCodes: ["kind:style", "tier:optional", "register-dampened"] });
  assert.match(explainRanking(issue, goals({ audience: "casual" })), /less for a casual reader/i);
});

test("every suggestion gets a concrete action, not a platitude", () => {
  const withReplacement = buildAction(sampleIssue(), goals(), style);
  assert.match(withReplacement, /Replace/);

  const passive = buildAction(sampleIssue({ ruleId: "style-passive-voice", original: "was made", replacement: "", category: "passive voice" }), goals(), style);
  assert.ok(passive.length > 15 && !/^Consider/i.test(passive), "an action must be actionable");

  const spelling = buildAction(sampleIssue({ ruleId: "spelling-lexicon", category: "spelling" }), goals(), style);
  assert.ok(/dictionary|correct/i.test(spelling));
});

test("buildExplanation is complete and never fabricates a goal", () => {
  const issue = sampleIssue();
  const explanation = buildExplanation(issue, goals({ audience: "academic", intent: "explain", tone: "formal" }), style);
  assert.equal(explanation.base, issue.explanation);
  assert.ok(explanation.ranking.length > 10);
  assert.ok(explanation.relevance);
  assert.ok(explanation.action.length > 10);

  const noGoals = buildExplanation(issue, undefined, undefined);
  assert.equal(noGoals.relevance, null);
});

// ---------------------------------------------------------------------------
// Chunking: overlapping context must not produce duplicate work.
// ---------------------------------------------------------------------------

test("a chunk only accepts findings inside the span it owns", () => {
  // Regression: ranges were clamped to the context window, so both a chunk and
  // its neighbour could claim the same words and the same passage was analysed,
  // and suggested, twice.
  const paragraph = (index) => `Paragraph ${index} discusses topic ${index} with several distinct and reasonably detailed sentences worth reading. `;
  const text = Array.from({ length: 40 }, (_, index) => paragraph(index + 1)).join("\n\n");
  const chunks = createAnalysisChunks(text, { maxChars: 500, contextWindow: 150 });
  assert.ok(chunks.length > 2, "fixture must chunk");

  let shared = null;
  for (let index = 0; index + 1 < chunks.length && !shared; index += 1) {
    const current = chunks[index];
    const next = chunks[index + 1];
    const start = Math.max(current.contentStartOffset, next.startOffset);
    const end = Math.min(current.contentEndOffset, next.endOffset);
    if (end - start > 20) shared = { current, next, start };
  }
  assert.ok(shared, "fixture must produce an overlap between adjacent chunks");

  const probe = text.slice(shared.start, shared.start + 18);
  const owner = mapRelativeRange(
    { start: shared.start - shared.current.startOffset, end: shared.start - shared.current.startOffset + probe.length, original: probe },
    shared.current,
    text,
  );
  const neighbour = mapRelativeRange(
    { start: shared.start - shared.next.startOffset, end: shared.start - shared.next.startOffset + probe.length, original: probe },
    shared.next,
    text,
  );
  assert.ok(owner, "the chunk that owns the text must still accept it");
  assert.equal(neighbour, null, "a neighbour must not claim text it only has as context");
});

test("mapping still rejects ranges whose text does not match", () => {
  const text = "The quick brown fox jumps over the lazy dog near the river bank.";
  const [chunk] = createAnalysisChunks(text, { maxChars: 200, contextWindow: 40 });
  assert.equal(mapRelativeRange({ start: 0, end: 3, original: "XYZ" }, chunk, text), null);
  assert.equal(mapRelativeRange({ start: 5, end: 2, original: "quick" }, chunk, text), null);
});

// ---------------------------------------------------------------------------
// Analysis stays honest on a long document.
// ---------------------------------------------------------------------------

test("analysis of a long document stays responsive and coherent", () => {
  const text = variedDraft(120);
  const startedAt = Date.now();
  const { issues, stats, scores } = analyzeLocally(text, style, DEFAULT_GOALS);
  const elapsed = Date.now() - startedAt;

  assert.ok(stats.words > 2_000, "fixture must be a long document");
  assert.ok(issues.length > 0);
  assert.ok(Number.isFinite(scores.overall));
  assert.ok(elapsed < 5_000, `local analysis of a long draft took ${elapsed}ms`);
  for (const item of issues) {
    assert.ok(item.start >= 0 && item.end <= text.length && item.end > item.start, "every offset must stay inside the draft");
    assert.equal(text.slice(item.start, item.end), item.original, "offsets must still match the source text");
  }
});

test("a long draft never marks something clean", () => {
  const clean = Array.from({ length: 40 }, (_, index) =>
    `The council reviewed the quarterly budget report for region ${index + 1}. The figures were consistent with the previous period.`,
  ).join("\n\n");
  const { issues } = analyzeLocally(clean, style, DEFAULT_GOALS);
  const objective = issues.filter((item) => ["spelling", "grammar", "punctuation", "capitalization"].includes(item.category));
  assert.ok(objective.length < issues.length / 4, "clean prose must not generate a wall of objective findings");
});

test("a score describes the writing, not how long the draft is", () => {
  // The penalties used to be a plain sum of issue weights, so at a constant
  // error rate correctness fell from 93 on a 170-word draft to 0 on a
  // 3,400-word one and stayed pinned there however much worse the writing
  // became. A long draft could not report on itself at all.
  const sentence = (index) => `The committee reviewed the quarterly budget figures for region ${index + 1} and agreed the revised totals in the usual way. `;
  const withTypoEveryTen = (paragraphs) => Array.from({ length: paragraphs }, (_, index) =>
    sentence(index).replace(/region (\d+)/u, (match, digits) => (Number(digits) % 10 === 0 ? "reigon" : match)),
  ).join("\n\n");

  const scored = [10, 50, 200, 800].map((paragraphs) => analyzeLocally(withTypoEveryTen(paragraphs), style, DEFAULT_GOALS).scores.correctness);
  const spread = Math.max(...scored) - Math.min(...scored);
  assert.ok(spread <= 4, `the same error rate should score the same at any length, spread was ${spread}: ${scored.join(", ")}`);

  // And it must still fall when the writing genuinely gets worse.
  const fixed = 50;
  const rate = (every) => analyzeLocally(
    Array.from({ length: fixed }, (_, index) => sentence(index).replace(/region (\d+)/u, (match, digits) => (Number(digits) % every === 0 ? "reigon" : match))).join("\n\n"),
    style,
    DEFAULT_GOALS,
  ).scores.correctness;
  const better = rate(100);
  const worse = rate(4);
  assert.ok(worse < better, `worse writing must score lower at a fixed length: ${better} vs ${worse}`);
});

test("hundreds of errors are not excused by a long draft", () => {
  // Rate alone would call a large document with hundreds of typos "fine". The
  // volume term is what stops that.
  const text = Array.from({ length: 800 }, (_, index) =>
    `The committee reviewed the quarterly budget figures for region ${index + 1} and agreed the revised totals in the usual way. `.replace(/region (\d+)/u, (match, digits) => (Number(digits) % 2 === 0 ? "reigon" : match)),
  ).join("\n\n");
  const result = analyzeLocally(text, style, DEFAULT_GOALS);
  assert.ok(result.scores.correctness < 80, `a draft with hundreds of typos must not read as good, got ${result.scores.correctness}`);
});

test("goal alignment does not saturate once a draft gets long", () => {
  // Markers were matched by substring and scored by presence, so the inform
  // intent was satisfied by "is" inside "this", and any draft past a few
  // hundred words contained every marker somewhere and scored full marks on
  // every dimension regardless of what it was about.
  const technical = (index) => `The system data function configuration ${index} implements the api test code method for the model.`;
  const offTopic = (index) => `We you our us feel really thanks ${index} it just the thing we like.`;
  const goalsForTechnical = goals({ audience: "technical", intent: "inform", tone: "confident" });

  const matched = [20, 60, 200].map((paragraphs) => analyzeLocally(Array.from({ length: paragraphs }, (_, index) => technical(index)).join(" "), style, goalsForTechnical).scores.goalAlignment);
  const mismatched = [20, 60, 200].map((paragraphs) => analyzeLocally(Array.from({ length: paragraphs }, (_, index) => offTopic(index)).join(" "), style, goalsForTechnical).scores.goalAlignment);

  for (const score of mismatched) {
    assert.ok(score <= 65, `off-topic prose must not score well against technical goals, got ${score}`);
  }
  for (const score of matched) {
    assert.ok(score >= 85, `on-topic prose must score well against technical goals, got ${score}`);
  }
  assert.ok(Math.max(...mismatched) < Math.min(...matched), "aligned and misaligned drafts must stay distinguishable at every length");
});