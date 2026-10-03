import assert from "node:assert/strict";
import test from "node:test";
import {
  DISMISSAL_LEARNING_THRESHOLD,
  familyLabel,
  familyOf,
  isFamilyDampened,
  profileAdjustments,
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
