import assert from "node:assert/strict";
import test from "node:test";
import {
  ACCEPTANCE_LEARNING_THRESHOLD,
  DISMISSAL_LEARNING_THRESHOLD,
  familyLabel,
  familyOf,
  isFamilyDampened,
  profileAdjustments,
  recordAcceptance,
  recordDismissal,
  recordRuleControl,
  removeLearnedEntry,
} from "../lib/writing-profile.ts";

const baseStyle = {
  dialect: "en-GB",
  personalDictionary: [],
  names: [],
  ignoredWords: [],
  ignoredRuleIds: [],
  reducedRuleIds: [],
  preferredTerminology: {},
  oxfordComma: true,
  allowContractions: true,
  passiveVoiceSensitivity: "normal",
  preferredSentenceLength: "balanced",
  blockedWords: [],
};

test("repeated dismissals of the same type are learned as a dampening entry", () => {
  let style = baseStyle;
  for (let index = 0; index < DISMISSAL_LEARNING_THRESHOLD - 1; index += 1) {
    style = recordDismissal(style, { ruleId: "style-passive-voice", title: "Try active voice" });
    assert.equal(style.learned?.length ?? 0, 0, "below threshold nothing is learned yet");
  }
  style = recordDismissal(style, { ruleId: "style-passive-voice", title: "Try active voice" });
  const learned = style.learned ?? [];
  assert.equal(learned.length, 1);
  assert.equal(learned[0].family, "style-passive-voice");
  assert.equal(learned[0].kind, "dismissal-pattern");
  assert.match(learned[0].detail, /dismissed/u);
  assert.equal(isFamilyDampened(style, "style-passive-voice"), true);
  assert.equal(isFamilyDampened(style, "conciseness-filler"), false);
});

test("wordiness dismissals group into one family so the pattern is learned once", () => {
  let style = baseStyle;
  style = recordDismissal(style, { ruleId: "wordiness-due-to-the-fact-that", title: "Tighten this phrase" });
  style = recordDismissal(style, { ruleId: "wordiness-in-order-to", title: "Tighten this phrase" });
  style = recordDismissal(style, { ruleId: "wordiness-at-this-point-in-time", title: "Tighten this phrase" });
  assert.equal(style.learned?.length, 1);
  assert.equal(style.learned[0].family, "wordiness");
  assert.equal(familyOf({ ruleId: "wordiness-in-order-to" }), "wordiness");
  assert.equal(familyOf({ ruleId: "spelling-common-typo" }), "spelling-common-typo");
});

test("rule-control choices are recorded and reversible", () => {
  const reduced = recordRuleControl(baseStyle, "style-passive-voice", "reduce");
  assert.equal(reduced.learned?.[0].kind, "reduced-family");
  const off = recordRuleControl({ ...baseStyle, ignoredRuleIds: ["style-passive-voice"] }, "style-passive-voice", "off");
  assert.equal(off.learned?.[0].kind, "disabled-family");
  const cleaned = removeLearnedEntry(off, off.learned[0].id);
  assert.equal(cleaned.learned?.length ?? 0, 0);
});

test("profile adjustments are transparent named reasons, not opaque scores", () => {
  const concise = profileAdjustments({ ...baseStyle, preferredSentenceLength: "short" });
  assert.ok(concise.every((adjustment) => adjustment.reason.length > 0));
  assert.ok(concise.some((adjustment) => adjustment.family === "conciseness-filler" && adjustment.rankDelta > 0));
  const lenient = profileAdjustments({ ...baseStyle, allowContractions: true });
  assert.ok(lenient.some((adjustment) => adjustment.family === "style-contractions" && adjustment.rankDelta < 0));
  let dismissed = baseStyle;
  for (let index = 0; index < DISMISSAL_LEARNING_THRESHOLD; index += 1) {
    dismissed = recordDismissal(dismissed, { ruleId: "style-passive-voice", title: "x" });
  }
  const learnedAdjustments = profileAdjustments(dismissed);
  const passive = learnedAdjustments.find((adjustment) => adjustment.family === "style-passive-voice");
  assert.ok(passive);
  assert.ok(passive.rankDelta <= -0.8, "heavy dismissal dampens the family strongly");
  assert.match(passive.reason, /dismissed/u);
});

test("family labels read as product copy, not rule ids", () => {
  assert.equal(familyLabel("style-passive-voice"), "Passive voice suggestions");
  assert.equal(familyLabel("wordiness"), "Wordiness suggestions");
  assert.match(familyLabel("some-custom-rule"), /some-custom-rule/u);
});

test("accepting a suggestion family is learned as wanted advice", () => {
  let style = baseStyle;
  for (let index = 0; index < ACCEPTANCE_LEARNING_THRESHOLD - 1; index += 1) {
    style = recordAcceptance(style, { ruleId: "style-passive-voice", title: "Try active voice" });
    assert.equal(style.learned?.length ?? 0, 0, "below threshold nothing is learned yet");
  }
  style = recordAcceptance(style, { ruleId: "style-passive-voice", title: "Try active voice" });
  const learned = style.learned ?? [];
  assert.equal(learned.length, 1);
  assert.equal(learned[0].family, "style-passive-voice");
  assert.equal(learned[0].kind, "accepted-pattern");
  assert.match(learned[0].detail, /accepted/u);
});

test("accepted advice is raised in rank, not dampened", () => {
  // The profile used to learn only from dismissals, so its only possible
  // direction was suppression: a family the writer acted on every time looked
  // identical to one they had never seen.
  let style = baseStyle;
  for (let index = 0; index < ACCEPTANCE_LEARNING_THRESHOLD; index += 1) {
    style = recordAcceptance(style, { ruleId: "style-passive-voice", title: "x" });
  }
  const passive = profileAdjustments(style).find((adjustment) => adjustment.family === "style-passive-voice");
  assert.ok(passive, "an accepted family gets an adjustment");
  assert.ok(passive.rankDelta > 0, "the adjustment raises the family");
  assert.match(passive.reason, /accepted/u);
  assert.equal(isFamilyDampened(style, "style-passive-voice"), false, "accepted advice is not dampened");
});

test("the most recent signal wins between accepting and dismissing", () => {
  // Otherwise a writer who dismissed a rule three times in one sitting stays
  // permanently dampened no matter how often they later accept it.
  let dismissed = baseStyle;
  for (let index = 0; index < DISMISSAL_LEARNING_THRESHOLD; index += 1) {
    dismissed = recordDismissal(dismissed, { ruleId: "style-passive-voice", title: "x" });
  }
  assert.equal(isFamilyDampened(dismissed, "style-passive-voice"), true);

  let redeemed = dismissed;
  for (let index = 0; index < ACCEPTANCE_LEARNING_THRESHOLD; index += 1) {
    redeemed = recordAcceptance(redeemed, { ruleId: "style-passive-voice", title: "x" });
  }
  assert.equal(isFamilyDampened(redeemed, "style-passive-voice"), false, "later acceptances lift the dampening");
  assert.equal(redeemed.learned?.some((entry) => entry.kind === "dismissal-pattern" && entry.family === "style-passive-voice"), false, "the contradicted entry is gone");
  assert.equal(redeemed.learned?.some((entry) => entry.kind === "accepted-pattern"), true);

  // ...and the reverse: dismissing after accepting takes the promotion back.
  let reversed = redeemed;
  for (let index = 0; index < DISMISSAL_LEARNING_THRESHOLD; index += 1) {
    reversed = recordDismissal(reversed, { ruleId: "style-passive-voice", title: "x" });
  }
  assert.equal(reversed.learned?.some((entry) => entry.kind === "accepted-pattern" && entry.family === "style-passive-voice"), false);
  assert.equal(isFamilyDampened(reversed, "style-passive-voice"), true);
});

test("a family is never held as both wanted and unwanted", () => {
  let style = baseStyle;
  for (let index = 0; index < ACCEPTANCE_LEARNING_THRESHOLD; index += 1) {
    style = recordAcceptance(style, { ruleId: "conciseness-filler", title: "x" });
  }
  for (let index = 0; index < DISMISSAL_LEARNING_THRESHOLD; index += 1) {
    style = recordDismissal(style, { ruleId: "conciseness-filler", title: "x" });
  }
  const entries = (style.learned ?? []).filter((entry) => entry.family === "conciseness-filler");
  assert.equal(entries.length, 1, "the settings list shows one verdict per family, not both");
  assert.equal(entries[0].kind, "dismissal-pattern");
  const adjustments = profileAdjustments(style).filter((adjustment) => adjustment.family === "conciseness-filler");
  assert.equal(adjustments.length, 1);
  assert.ok(adjustments[0].rankDelta < 0, "the surviving signal is the dampening one");
});
