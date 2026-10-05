import type { StylePreferences, WritingIssue } from "../../types/src/index.js";
import { makeIssue, pushIssue } from "./issues.ts";
import { type ParsedDocument, parseDocument } from "./parser.ts";
import { preserveCase } from "./util.ts";

/**
 * Document-wide consistency.
 *
 * Nothing here asks "which of these is right?". A document that says "colour"
 * throughout is not inconsistent, and neither is one that says "color"
 * throughout. Inconsistency is only visible across the whole draft: the writer
 * used one form to open and a different form later, usually because a section
 * was written days apart or pasted from elsewhere.
 *
 * That is why this is a separate pass. Every rule below must see both variants
 * before it is willing to say anything, and it only ever flags the minority
 * form, pointing at the majority as the one to keep. All of it runs locally and
 * deterministically, so a long draft gets this reasoning with no AI at all.
 */

/**
 * Variant families. Each entry lists spellings of the same word; only families
 * the draft has actually mixed produce a finding.
 */
const SPELLING_VARIANTS: string[][] = [
  ["colour", "color"], ["colours", "colors"], ["favour", "favor"], ["favours", "favors"],
  ["behaviour", "behavior"], ["behaviours", "behaviors"], ["honour", "honor"], ["labour", "labor"],
  ["neighbour", "neighbor"], ["neighbours", "neighbors"], ["centre", "center"], ["centres", "centers"],
  ["theatre", "theater"], ["metre", "meter"], ["metres", "meters"], ["litre", "liter"], ["litres", "liters"],
  ["defence", "defense"], ["offence", "offense"], ["licence", "license"], ["practise", "practice"],
  ["organisation", "organization"], ["organisations", "organizations"], ["organise", "organize"],
  ["recognise", "recognize"], ["realise", "realize"], ["analyse", "analyze"], ["summarise", "summarize"],
  ["organisation", "organization"], ["apologise", "apologize"], ["prioritise", "prioritise"],
  ["travelling", "traveling"], ["cancelled", "canceled"], ["labelled", "labeled"], ["fuelled", "fueled"],
  ["modelled", "modeled"], ["signalled", "signaled"], ["catalogue", "catalog"], ["dialogue", "dialog"],
];

/**
 * Words that mean the same thing. Mixing two of these is a genuine house-style
 * drift even when both are perfectly good English, and the reader notices the
 * seam between sections even if they cannot name it.
 *
 * Every family stays within one part of speech. A family that mixed "use" with
 * "utilisation" would suggest replacing a verb with a noun at every occurrence,
 * which is how a consistency rule starts producing ungrammatical text.
 */
const SYNONYM_FAMILIES: string[][] = [
  ["utilise", "utilize", "use"], ["utilisation", "utilization"], ["utilises", "utilizes"],
  ["whilst", "while"], ["purchase", "buy"], ["purchase", "procure"], ["assist", "help"], ["attempt", "try"],
  ["acknowledgement", "acknowledgment"], ["judgement", "judgment"], ["enrolment", "enrollment"],
  ["fulfilment", "fulfillment"], ["instalment", "installment"], ["skilful", "skillful"],
  ["programme", "program"], ["programmes", "programs"], ["specialised", "specialized"],
  ["organisation", "organization"], ["organised", "organized"], ["recognised", "recognized"],
  ["realised", "realized"], ["analysed", "analyzed"], ["summarised", "summarized"],
  ["authorised", "authorized"], ["prioritised", "prioritized"], ["minimised", "minimized"],
  ["maximised", "maximized"], ["standardised", "standardized"], ["emphasised", "emphasized"],
  ["criticised", "criticized"], ["customised", "customized"], ["centralise", "centralize"],
];

/**
 * Pairs where one form is simply the long way of saying the other.
 *
 * These used to live in SYNONYM_FAMILIES, which made them symmetric: the
 * dominant form won, so a draft that said "before" more often than "prior to"
 * was told to replace "before" with "prior to". That inverted the engine's own
 * conciseness rules and made it recommend exactly the padding a writer was
 * avoiding. A wordy form is now only ever the thing being flagged.
 *
 * Order matters: [wordy, plain].
 */
const WORDY_VARIANTS: Array<[string, string]> = [
  ["terminate", "end"], ["commence", "start"], ["additional", "extra"],
  ["numerous", "many"], ["approximately", "about"], ["demonstrate", "show"],
  ["sufficient", "enough"], ["prior to", "before"], ["subsequent to", "after"],
  ["in the event that", "if"], ["at the present time", "now"],
  ["in spite of the fact that", "although"], ["due to the fact that", "because"],
  ["for the purpose of", "for"], ["in order to", "to"], ["with regard to", "about"],
  ["a large number of", "many"], ["the majority of", "most"], ["is able to", "can"],
  ["has the ability to", "can"], ["make a decision", "decide"],
  ["provide assistance", "help"], ["in close proximity", "near"],
  ["at this point in time", "now"],
];

/** British and American -ise/-ize endings, checked only when both appear. */
const SUFFIX_VARIANTS: Array<[string, string]> = [
  ["organisation", "organize"], ["realise", "realize"], ["recognise", "recognize"],
  ["analyse", "analyze"], ["summarise", "summarize"], ["apologise", "apologize"],
  ["prioritise", "prioritize"], ["emphasise", "emphasize"], ["criticise", "criticize"],
  ["minimise", "minimize"], ["maximise", "maximize"], ["standardise", "standardize"],
  ["specialise", "specialize"], ["visualise", "visualize"], ["utilise", "utilize"],
];

/** Number words that should not drift between digits and words. */
const NUMBER_WORDS = ["one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"];

/**
 * The digit form of each number word.
 *
 * This rule replaces a number word with its digit, never with a different
 * number word. It previously reused resolveInconsistency's winning word, which
 * meant a draft could be told "three" should be "five" — a suggestion that
 * silently rewrites the facts of the sentence.
 */
const NUMBER_WORD_DIGITS: Record<string, string> = {
  one: "1", two: "2", three: "3", four: "4", five: "5", six: "6", seven: "7",
  eight: "8", nine: "9", ten: "10", eleven: "11", twelve: "12",
};

interface Occurrence {
  start: number;
  end: number;
  value: string;
}

function countForms(text: string, forms: string[]): Map<string, Occurrence[]> {
  const found = new Map<string, Occurrence[]>();
  for (const form of forms) {
    const pattern = new RegExp(`\\b${form.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/gu, "\\s+")}\\b`, "gi");
    const occurrences: Occurrence[] = [];
    for (const match of text.matchAll(pattern)) {
      const start = match.index ?? 0;
      occurrences.push({ start, end: start + match[0].length, value: match[0] });
    }
    if (occurrences.length) found.set(form, occurrences);
  }
  return found;
}

/**
 * Decide whether a set of variants is genuinely mixed, and if so which form to
 * flag. A family is only inconsistent when a second form appears at least once
 * AND the dominant form is used clearly more often, so a single slip is caught
 * without punishing a deliberate choice made once.
 */
function resolveInconsistency(
  families: Map<string, Occurrence[]>,
  minimumDominance = 2,
): { keep: string; flag: string; keepCount: number; flagCount: number } | null {
  if (families.size < 2) return null;
  const ranked = [...families.entries()].sort((left, right) => right[1].length - left[1].length);
  const [keep, keepEntries] = ranked[0];
  const [flag, flagEntries] = ranked[1];
  if (keepEntries.length < minimumDominance) return null;
  if (keepEntries.length <= flagEntries.length) return null;
  return { keep, flag, keepCount: keepEntries.length, flagCount: flagEntries.length };
}

export function findConsistencyIssues(
  text: string,
  preferences: StylePreferences,
  document: ParsedDocument = parseDocument(text),
): WritingIssue[] {
  const issues: WritingIssue[] = [];
  const claimed = new Uint8Array(text.length);

  /** Never flag overlapping spans: the same word cannot be two kinds of drift. */
  const isFree = (start: number, end: number) => {
    for (let index = start; index < end; index += 1) if (claimed[index]) return false;
    return true;
  };
  const claim = (start: number, end: number) => {
    for (let index = start; index < end; index += 1) claimed[index] = 1;
  };

  const flagOccurrences = (
    occurrences: Occurrence[],
    replacement: string,
    ruleId: string,
    title: string,
    explanation: (value: string) => string,
    severity: "low" | "medium",
    confidence: number,
  ) => {
    for (const occurrence of occurrences) {
      if (!isFree(occurrence.start, occurrence.end)) continue;
      claim(occurrence.start, occurrence.end);
      pushIssue(issues, makeIssue(ruleId, occurrence.start, occurrence.end, occurrence.value, preserveCase(occurrence.value, replacement), "consistency", severity, title, explanation(occurrence.value), confidence, preferences));
    }
  };

  // 1. Spelling variants: colour/color, organisation/organization, and so on.
  for (const family of SPELLING_VARIANTS) {
    const forms = countForms(text, family);
    const decision = resolveInconsistency(forms);
    if (!decision) continue;
    flagOccurrences(
      forms.get(decision.flag) ?? [],
      decision.keep,
      "consistency-spelling-variant",
      "Mixed spelling in this draft",
      (value) => `This draft uses “${decision.keep}” ${decision.keepCount} times and “${value}” ${decision.flagCount === 1 ? "once" : `${decision.flagCount} times`}. Picking one spelling throughout is what a reader notices first.`,
      "medium",
      0.9,
    );
  }

  // 2. -ise/-ize endings appearing alongside each other in one document.
  for (const [british, american] of SUFFIX_VARIANTS) {
    const forms = countForms(text, [british, american]);
    const decision = resolveInconsistency(forms, 2);
    if (!decision) continue;
    flagOccurrences(
      forms.get(decision.flag) ?? [],
      decision.keep,
      "consistency-ise-ize",
      "Mixed -ise and -ize endings",
      (value) => `This draft mostly writes “${decision.keep}” but also “${value}”. The two endings together read as an editing seam.`,
      "low",
      0.82,
    );
  }

  // 3. Synonym pairs: different words for the same thing, in one document.
  for (const family of SYNONYM_FAMILIES) {
    const forms = countForms(text, family);
    const decision = resolveInconsistency(forms, 2);
    if (!decision) continue;
    flagOccurrences(
      forms.get(decision.flag) ?? [],
      decision.keep,
      "consistency-synonym-drift",
      "Two words for the same thing",
      (value) => `This draft uses “${decision.keep}” ${decision.keepCount} times and “${value}” ${decision.flagCount === 1 ? "once" : `${decision.flagCount} times`}. Switching between them is a common sign of text written in separate sittings.`,
      "low",
      0.78,
    );
  }

  // 3b. Wordy vs plain: only ever flag the long form, and only when the
  //     shorter form is also in use, so this stays a consistency rule rather
  //     than a second conciseness rule.
  for (const [wordy, plain] of WORDY_VARIANTS) {
    const wordyOccurrences = countForms(text, [wordy]).get(wordy);
    if (!wordyOccurrences?.length) continue;
    const plainOccurrences = countForms(text, [plain]).get(plain);
    if (!plainOccurrences?.length) continue;
    flagOccurrences(
      wordyOccurrences,
      plain,
      "consistency-synonym-drift",
      "The long way round",
      (value) => `This draft also writes “${plain}”, but uses “${value}” here. The shorter form reads better without changing the meaning.`,
      "low",
      0.78,
    );
  }

  // 4. Numbers written as words in some places and digits in others.
  const digitNumbers = countForms(text, ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"]);
  const wordNumbers = new Map<string, Occurrence[]>();
  for (const number of NUMBER_WORDS) {
    const occurrences: Occurrence[] = [];
    const pattern = new RegExp(`\\b${number}\\b`, "giu");
    for (const match of text.matchAll(pattern)) {
      // A number word used to count something specific is fine. Only flag it
      // when a digit sits in the same document for the same small magnitude.
      const start = match.index ?? 0;
      const after = text.slice(start + match[0].length, start + match[0].length + 1);
      if (after === "%") continue;
      occurrences.push({ start, end: start + match[0].length, value: match[0] });
    }
    if (occurrences.length) wordNumbers.set(number, occurrences);
  }
  const numberDecision = resolveInconsistency(wordNumbers, 3);
  if (numberDecision && digitNumbers.size >= 2) {
    const replacement = NUMBER_WORD_DIGITS[numberDecision.flag];
    if (replacement) {
      flagOccurrences(
        wordNumbers.get(numberDecision.flag) ?? [],
        replacement,
        "consistency-number-format",
        "Numbers switch between words and digits",
        (value) => `This draft writes small numbers as digits elsewhere but as “${value}” here. One format is easier to scan.`,
        "low",
        0.7,
      );
    }
  }

  // 5. Capitalisation drift on a name. "Acme" then "ACME" then "acme" is a
  //    consistency problem no sentence-level rule can see. The word has to be
  //    used as a name first: if the same letters appear mostly in lower case it
  //    is an ordinary word ("may", "us", "will"), and flagging its capitalisation
  //    would be wrong rather than helpful.
  const byWord = new Map<string, Occurrence[]>();
  for (const token of document.tokens) {
    if (!/^[A-Za-z][A-Za-z'-]{2,}$/u.test(token.value)) continue;
    const list = byWord.get(token.lower) ?? [];
    list.push({ start: token.start, end: token.end, value: token.value });
    byWord.set(token.lower, list);
  }
  for (const [key, occurrences] of byWord) {
    if (occurrences.length < 3) continue;
    const capitalised = occurrences.filter((occurrence) => /^[A-Z]/u.test(occurrence.value));
    // Only a word the writer consistently capitalises can have its shape checked.
    if (capitalised.length < occurrences.length * 0.6) continue;
    const shapes = new Map<string, Occurrence[]>();
    for (const occurrence of capitalised) {
      const list = shapes.get(occurrence.value) ?? [];
      list.push(occurrence);
      shapes.set(occurrence.value, list);
    }
    if (shapes.size < 2) continue;
    const ranked = [...shapes.entries()].sort((left, right) => right[1].length - left[1].length);
    const [keepShape, keepEntries] = ranked[0];
    const [flagShape, flagEntries] = ranked[1];
    if (keepEntries.length <= flagEntries.length) continue;
    for (const occurrence of flagEntries) {
      if (!isFree(occurrence.start, occurrence.end)) continue;
      claim(occurrence.start, occurrence.end);
      pushIssue(issues, makeIssue("consistency-capitalisation", occurrence.start, occurrence.end, occurrence.value, keepShape, "consistency", "low", "Capitalisation drifts on the same name", `This name appears as “${keepShape}” ${keepEntries.length} times and as “${flagShape}” ${flagEntries.length === 1 ? "once" : `${flagEntries.length} times`} in this draft. The capitalisation is noticed before the name itself.`, 0.72, preferences));
    }
    void key;
  }

  return issues;
}