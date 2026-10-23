/**
 * Reading a draft aloud is the oldest editing trick there is: the ear catches
 * the sentence the eye has already forgiven. This module is the part of that
 * feature which can be reasoned about without a browser — where the speech
 * units fall in the draft, what should actually be said, and which installed
 * voice matches the draft's dialect.
 *
 * It is deliberately pure. The browser's speech engine is quirky in ways that
 * cannot be tested here (voices load asynchronously, Chrome truncates long
 * utterances, `pause` is a no-op on some platforms), so everything that defines
 * the product's behaviour lives on this side of the boundary and the hook in
 * `hooks/useReadAloud.ts` only drives it.
 */

export interface SpeechSegment {
  /** Offset of the first character of this segment in the original draft. */
  start: number;
  /** Offset just past the last character. */
  end: number;
  /** What the synthesiser should say: the draft with markdown removed. */
  spoken: string;
}

/**
 * Longest span handed to one utterance.
 *
 * Chrome silently truncates an utterance after roughly fifteen seconds of
 * speech, which is about forty words at a normal rate. A single 300-word
 * paragraph would therefore stop mid-reading with no error, which looks exactly
 * like a bug in the app. Sentence splitting alone does not prevent it (a
 * writer can produce a 120-word sentence), so every segment is also capped at a
 * length that keeps a whole utterance inside that window.
 */
const MAX_SEGMENT_CHARS = 220;

const FENCE = /^\s*(?:```|~~~)/u;
const HEADING_MARKER = /^\s*#{1,6}\s+/u;
const QUOTE_MARKER = /^\s*>\s?/u;
const LIST_MARKER = /^\s*(?:[-*+]|\d{1,3}[.)])\s+/u;
const SENTENCE_END = /[.!?…]+["'”’)\]]*(?=\s|$)/gu;

/**
 * Markdown that a speech engine would read out as punctuation, or worse, spell
 * out (a raw URL becomes a minute of "h-t-t-p-s-colon-slash-slash").
 */
const INLINE_PATTERNS: Array<[RegExp, string]> = [
  // Images before links: otherwise the leading "!" of "![alt](src)" survives.
  [/!\[([^\]]*)\]\([^)]*\)/gu, "$1"],
  [/\[([^\]]+)\]\([^)]*\)/gu, "$1"],
  [/(\*\*|__)(.+?)\1/gu, "$2"],
  [/(\*|_)(.+?)\1/gu, "$2"],
  [/`([^`]+)`/gu, "$1"],
  [/<[^>\n]+>/gu, ""],
];

/** The words a segment should contribute, with markdown syntax removed. */
export function speakableText(raw: string) {
  let value = raw
    .replace(HEADING_MARKER, "")
    .replace(QUOTE_MARKER, "")
    .replace(LIST_MARKER, "");
  for (const [pattern, replacement] of INLINE_PATTERNS) value = value.replace(pattern, replacement);
  return value.replace(/\s+/gu, " ").trim();
}

function isSpace(character: string) {
  return /\s/u.test(character);
}

function trimRange(text: string, start: number, end: number) {
  let from = start;
  let to = end;
  while (from < to && isSpace(text[from])) from += 1;
  while (to > from && isSpace(text[to - 1])) to -= 1;
  return [from, to] as const;
}

/** Split a span that is still too long at word boundaries, never mid-character. */
function capLength(text: string, start: number, end: number): Array<[number, number]> {
  const pieces: Array<[number, number]> = [];
  let from = start;
  while (end - from > MAX_SEGMENT_CHARS) {
    let cut = text.lastIndexOf(" ", from + MAX_SEGMENT_CHARS);
    if (cut <= from) cut = from + MAX_SEGMENT_CHARS;
    // A hard cut inside a surrogate pair would produce a lone half-character.
    if (/[\uD800-\uDBFF]/u.test(text[cut - 1] ?? "")) cut += 1;
    pieces.push([from, Math.min(cut, end)]);
    from = cut;
    while (from < end && isSpace(text[from])) from += 1;
  }
  if (end > from) pieces.push([from, end]);
  return pieces;
}

function splitBlock(text: string, start: number, end: number): Array<[number, number]> {
  const block = text.slice(start, end);
  const cuts = new Set<number>();
  let match: RegExpExecArray | null;
  SENTENCE_END.lastIndex = 0;
  while ((match = SENTENCE_END.exec(block))) {
    const cut = match.index + match[0].length;
    if (cut < block.length) cuts.add(cut);
  }
  const boundaries = [0, ...[...cuts].sort((left, right) => left - right), block.length];
  const pieces: Array<[number, number]> = [];
  for (let index = 0; index < boundaries.length - 1; index += 1) {
    pieces.push(...capLength(block, boundaries[index], boundaries[index + 1]));
  }
  // Back into draft coordinates, trimmed so a segment never starts or ends on
  // the whitespace between sentences — the highlight would look detached.
  return pieces
    .map(([pieceStart, pieceEnd]) => trimRange(block, pieceStart, pieceEnd))
    .filter(([pieceStart, pieceEnd]) => pieceEnd > pieceStart)
    .map(([pieceStart, pieceEnd]) => [start + pieceStart, start + pieceEnd] as [number, number]);
}

/**
 * Split a draft into the units that will be spoken, in order.
 *
 * Fenced code blocks are skipped: reading source code aloud is noise, and the
 * product's own promise is about prose. Everything else — headings, list items,
 * blockquotes — is prose once its marker is removed, so it is read.
 */
export function speechSegments(text: string): SpeechSegment[] {
  if (!text.trim()) return [];
  const blocks: Array<{ start: number; end: number }> = [];
  let blockStart = -1;
  let blockEnd = -1;
  let inCode = false;
  const flush = () => {
    if (blockStart >= 0 && blockEnd > blockStart) blocks.push({ start: blockStart, end: blockEnd });
    blockStart = -1;
    blockEnd = -1;
  };

  const linePattern = /[^\n]*\n?/gu;
  let match: RegExpExecArray | null;
  while ((match = linePattern.exec(text))) {
    const line = match[0];
    if (!line) break;
    const lineStart = match.index;
    const content = line.replace(/\r?\n$/u, "");
    if (FENCE.test(content)) {
      flush();
      inCode = !inCode;
      continue;
    }
    if (inCode) continue;
    if (!content.trim()) {
      flush();
      continue;
    }
    if (blockStart < 0) blockStart = lineStart;
    blockEnd = lineStart + line.length;
  }
  flush();

  const segments: SpeechSegment[] = [];
  for (const block of blocks) {
    const [from, to] = trimRange(text, block.start, block.end);
    if (to <= from) continue;
    for (const [start, end] of splitBlock(text, from, to)) {
      const spoken = speakableText(text.slice(start, end));
      if (spoken) segments.push({ start, end, spoken });
    }
  }
  return segments;
}

export interface VoiceLike {
  name: string;
  lang: string;
  /** True when the voice ships with the operating system rather than a server. */
  localService?: boolean;
}

/**
 * Pick the installed voice that matches the draft's dialect.
 *
 * The draft already carries a British/American choice that drives spelling, so
 * reading a British draft in an American voice is a visible inconsistency — and
 * "schedule" is the least of it. A local voice is preferred over a network one
 * because this product is used offline, and a network voice fails silently the
 * moment the connection drops. Returns null when no English voice exists at
 * all, which leaves the utterance's own default in charge.
 */
export function chooseVoice<T extends VoiceLike>(voices: readonly T[], dialect: "en-GB" | "en-US"): T | null {
  if (!voices.length) return null;
  const normalise = (lang: string) => lang.replace(/_/gu, "-").toLocaleLowerCase();
  const wanted = dialect.toLocaleLowerCase();
  const exact = voices.filter((voice) => normalise(voice.lang) === wanted);
  const english = voices.filter((voice) => normalise(voice.lang).startsWith("en"));
  const pool = exact.length ? exact : english;
  if (!pool.length) return null;
  return pool.find((voice) => voice.localService) ?? pool[0];
}
