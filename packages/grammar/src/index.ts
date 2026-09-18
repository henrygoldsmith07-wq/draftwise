import type {
  AnalysisScores,
  IssueCategory,
  IssueSeverity,
  WritingIssue,
  WritingStats,
} from "../../types/src/index.js";

const TYPO_FIXES: Record<string, string> = {
  alot: "a lot",
  definately: "definitely",
  enviroment: "environment",
  occured: "occurred",
  recieve: "receive",
  seperate: "separate",
  thier: "their",
  untill: "until",
  wich: "which",
  youve: "you've",
  isnt: "isn't",
  cant: "can't",
  dont: "don't",
  doesnt: "doesn't",
  shouldnt: "shouldn't",
  repeatd: "repeated",
  writting: "writing",
};

const FILLER_WORDS = new Set([
  "actually",
  "basically",
  "just",
  "really",
  "quite",
  "very",
  "perhaps",
  "simply",
  "somewhat",
]);

const POSITIVE_WORDS = new Set([
  "clear",
  "confident",
  "helpful",
  "great",
  "strong",
  "excited",
  "useful",
  "improve",
  "improved",
  "progress",
]);

const CAUTIOUS_WORDS = new Set([
  "might",
  "maybe",
  "perhaps",
  "could",
  "possibly",
  "uncertain",
]);

const issue = (
  id: string,
  start: number,
  end: number,
  original: string,
  replacement: string,
  category: IssueCategory,
  severity: IssueSeverity,
  title: string,
  explanation: string,
): WritingIssue => ({
  id,
  start,
  end,
  original,
  replacement,
  category,
  severity,
  title,
  explanation,
  source: "local",
});

const wordCount = (text: string) => {
  const matches = text.match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu);
  return matches?.length ?? 0;
};

const clamp = (value: number) => Math.max(0, Math.min(100, Math.round(value)));

function findDuplicateWords(text: string): WritingIssue[] {
  const results: WritingIssue[] = [];
  const duplicatePattern = /\b([\p{L}][\p{L}'’-]*)\s+\1\b/giu;
  for (const match of text.matchAll(duplicatePattern)) {
    const start = match.index ?? 0;
    const original = match[0];
    const first = match[1] ?? "";
    results.push(
      issue(
        `repeat-${start}`,
        start,
        start + original.length,
        original,
        first,
        "repetition",
        "medium",
        "Repeated word",
        "This word appears twice in a row. Removing the repeat keeps the sentence moving.",
      ),
    );
  }
  return results;
}

function findTypos(text: string): WritingIssue[] {
  const results: WritingIssue[] = [];
  const typoPattern = /\b[\p{L}]+\b/gu;
  for (const match of text.matchAll(typoPattern)) {
    const original = match[0];
    const replacement = TYPO_FIXES[original.toLowerCase()];
    if (!replacement) continue;
    const start = match.index ?? 0;
    const preservedCase = original[0] === original[0]?.toUpperCase()
      ? replacement[0].toUpperCase() + replacement.slice(1)
      : replacement;
    results.push(
      issue(
        `typo-${start}`,
        start,
        start + original.length,
        original,
        preservedCase,
        "spelling",
        "high",
        `Spelling: ${preservedCase}`,
        `“${original}” is a common spelling slip. The suggested replacement is “${preservedCase}”.`,
      ),
    );
  }
  return results;
}

function findPunctuation(text: string): WritingIssue[] {
  const results: WritingIssue[] = [];
  for (const match of text.matchAll(/ {2,}/g)) {
    const start = match.index ?? 0;
    results.push(
      issue(
        `space-${start}`,
        start,
        start + match[0].length,
        match[0],
        " ",
        "punctuation",
        "low",
        "Extra space",
        "A single space is enough here and keeps the document’s rhythm consistent.",
      ),
    );
  }
  for (const match of text.matchAll(/\s+([,.;!?])/g)) {
    const start = match.index ?? 0;
    const original = match[0];
    results.push(
      issue(
        `punct-${start}`,
        start,
        start + original.length,
        original,
        match[1] ?? "",
        "punctuation",
        "medium",
        "Space before punctuation",
        "Punctuation reads more naturally when it sits directly after the word before it.",
      ),
    );
  }
  for (const match of text.matchAll(/([!?.,])\1+/g)) {
    const start = match.index ?? 0;
    results.push(
      issue(
        `dup-punct-${start}`,
        start,
        start + match[0].length,
        match[0],
        match[1] ?? "",
        "punctuation",
        "low",
        "Repeated punctuation",
        "One punctuation mark is enough to carry the sentence’s emphasis.",
      ),
    );
  }
  return results;
}

function findCapitalization(text: string): WritingIssue[] {
  const results: WritingIssue[] = [];
  const pattern = /(^|[.!?]\s+)([a-z])/g;
  for (const match of text.matchAll(pattern)) {
    const index = (match.index ?? 0) + (match[1]?.length ?? 0);
    const original = match[2] ?? "";
    results.push(
      issue(
        `capital-${index}`,
        index,
        index + 1,
        original,
        original.toUpperCase(),
        "grammar",
        "medium",
        "Start with a capital letter",
        "A new sentence usually begins with a capital letter, which makes the structure easier to scan.",
      ),
    );
  }
  return results;
}

function findPassiveVoice(text: string): WritingIssue[] {
  const results: WritingIssue[] = [];
  const pattern = /\b(?:was|were|is|are|be|been|being)\s+\w+(?:ed|en)\b/gi;
  for (const match of text.matchAll(pattern)) {
    const start = match.index ?? 0;
    results.push(
      issue(
        `passive-${start}`,
        start,
        start + match[0].length,
        match[0],
        match[0],
        "passive voice",
        "low",
        "Try active voice",
        "Active voice often makes the actor and the action clearer. Keep this suggestion only if it matches your intent.",
      ),
    );
  }
  return results;
}

function findFillerWords(text: string): WritingIssue[] {
  const results: WritingIssue[] = [];
  const pattern = /\b[\p{L}]+\b/gu;
  for (const match of text.matchAll(pattern)) {
    const original = match[0];
    if (!FILLER_WORDS.has(original.toLowerCase())) continue;
    const start = match.index ?? 0;
    results.push(
      issue(
        `filler-${start}`,
        start,
        start + original.length,
        original,
        "",
        "conciseness",
        "low",
        "Possible filler word",
        "This word may be doing less work than the words around it. Remove it if the sentence keeps its meaning without it.",
      ),
    );
  }
  return results.slice(0, 4);
}

export function getWritingStats(text: string): WritingStats {
  const words = wordCount(text);
  const sentences = text.trim() ? Math.max(1, (text.match(/[.!?]+(?=\s|$)/g) ?? []).length) : 0;
  const paragraphs = text.trim() ? text.split(/\n\s*\n/).filter(Boolean).length : 0;
  const syllableEstimate = text
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .reduce((total, word) => total + Math.max(1, (word.match(/[aeiouy]{1,2}/g) ?? []).length), 0);
  const readability = words && sentences
    ? clamp(206.835 - 1.015 * (words / sentences) - 84.6 * (syllableEstimate / words))
    : 0;
  const longSentences = text.split(/[.!?]+/).filter((sentence) => wordCount(sentence) > 28).length;
  const fillerWords = [...text.toLowerCase().matchAll(/\b[\p{L}]+\b/gu)].filter((match) =>
    FILLER_WORDS.has(match[0]),
  ).length;
  const passiveVoice = [...text.matchAll(/\b(?:was|were|is|are|be|been|being)\s+\w+(?:ed|en)\b/gi)].length;

  return {
    words,
    characters: text.length,
    sentences,
    paragraphs,
    readingTime: Math.max(1, Math.ceil(words / 200)),
    readability,
    longSentences,
    fillerWords,
    passiveVoice,
  };
}

export function inferTone(text: string): string[] {
  const words: string[] = text.toLowerCase().match(/[\p{L}]+/gu) ?? [];
  const positive = words.filter((word) => POSITIVE_WORDS.has(word)).length;
  const cautious = words.filter((word) => CAUTIOUS_WORDS.has(word)).length;
  const tone: string[] = [];
  if (positive > 1 || text.includes("!")) tone.push("confident");
  if (cautious > 0) tone.push("thoughtful");
  if (words.includes("we") || words.includes("you") || words.includes("your")) tone.push("direct");
  if (tone.length === 0) tone.push("neutral");
  return tone.slice(0, 3);
}

export function scoreWriting(stats: WritingStats, issues: WritingIssue[]): AnalysisScores {
  const high = issues.filter((item) => item.severity === "high").length;
  const medium = issues.filter((item) => item.severity === "medium").length;
  const grammar = clamp(100 - high * 9 - medium * 3);
  const clarity = clamp(96 - stats.longSentences * 6 - stats.passiveVoice * 4 - medium * 1.5);
  const conciseness = clamp(96 - stats.fillerWords * 5 - Math.max(0, stats.words - 260) / 10);
  const engagement = clamp(84 + (inferTone(issues.map((item) => item.original).join(" ")).includes("confident") ? 8 : 0));
  const overall = clamp(grammar * 0.34 + clarity * 0.24 + conciseness * 0.2 + engagement * 0.22);
  return { grammar, clarity, conciseness, engagement, overall };
}

export function mergeWritingIssues(issues: WritingIssue[]): WritingIssue[] {
  const sorted = [...issues]
    .filter((item) => item.start >= 0 && item.end > item.start && item.original.length > 0)
    .sort((a, b) => a.start - b.start || a.end - b.end);
  const deduped: WritingIssue[] = [];
  for (const candidate of sorted) {
    const duplicate = deduped.find(
      (item) => item.start === candidate.start && item.end === candidate.end,
    );
    if (duplicate) {
      if (candidate.source === "ai" && duplicate.source === "local") {
        deduped[deduped.indexOf(duplicate)] = candidate;
      }
      continue;
    }
    const overlaps = deduped.some((item) => candidate.start < item.end && candidate.end > item.start);
    if (!overlaps) deduped.push(candidate);
  }
  return deduped;
}

export function analyzeLocally(text: string) {
  const stats = getWritingStats(text);
  const issues = mergeWritingIssues([
    ...findTypos(text),
    ...findPunctuation(text),
    ...findDuplicateWords(text),
    ...findCapitalization(text),
    ...findPassiveVoice(text),
    ...findFillerWords(text),
  ]);
  return {
    issues,
    tone: inferTone(text),
    stats,
    scores: scoreWriting(stats, issues),
  };
}

export const categoryColors: Record<IssueCategory, string> = {
  spelling: "#e25d70",
  grammar: "#ef9f55",
  punctuation: "#8b78e6",
  clarity: "#4a9a9d",
  conciseness: "#d8944a",
  "word choice": "#3e87c7",
  repetition: "#d46191",
  tone: "#7b6fd2",
  formality: "#4e879c",
  readability: "#4e879c",
  fluency: "#4e879c",
  "passive voice": "#b5794e",
  "sentence structure": "#7a9d5e",
};
