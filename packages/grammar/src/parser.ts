
export const WORD_PATTERN = /[\p{L}\p{N}]+(?:['’\-][\p{L}\p{N}]+)*/gu;

export interface Token  {
  value: string;
  lower: string;
  start: number;
  end: number;
}

export interface SentenceSpan  {
  text: string;
  start: number;
  end: number;
  tokens: Token[];
}


export interface ParsedDocument {
  text: string;
  tokens: Token[];
  sentences: SentenceSpan[];
  paragraphs: Array<{ text: string; start: number; end: number; tokens: Token[] }>;
  frequencies: Map<string, number>;
  sentenceLengths: number[];
  paragraphLengths: number[];
}

function tokensIn(text: string, offset = 0): Token[] {
  return [...text.matchAll(WORD_PATTERN)].map((match) => ({
    value: match[0],
    lower: match[0].toLocaleLowerCase(),
    start: offset + (match.index ?? 0),
    end: offset + (match.index ?? 0) + match[0].length,
  }));
}

function sentenceSpans(text: string, allTokens?: Token[]): SentenceSpan[] {
  const spans: SentenceSpan[] = [];
  const tokens = allTokens ?? tokensIn(text);
  let tokenIndex = 0;

  // A sentence is a run of text ending in .!?…, and the terminator must be
  // followed by whitespace or the end of the document.
  //
  // The lazy body matters, and so does requiring a non-space start. The
  // previous pattern paired a greedy negated class with an alternation it
  // could not satisfy, so a long run of spaces was consumed and then
  // un-consumed one character at a time, at every start position in the run.
  // One 16 KB whitespace paragraph cost ~1s here and ~2s in analyzeLocally, on
  // the keystroke path. With `(?=\S)` a start inside a whitespace run is
  // rejected immediately instead of rescanning the run, and the body only
  // expands while it is finding a terminator.
  const pattern = /(?=\S)[^.!?…\n]*?[.!?…]+(?=\s|$)/gu;
  const addSpan = (start: number, end: number) => {
    const value = text.slice(start, end);
    if (!value.trim()) return;
    while (tokenIndex < tokens.length && tokens[tokenIndex].end <= start) tokenIndex += 1;
    const sentenceTokens: Token[] = [];
    while (tokenIndex < tokens.length && tokens[tokenIndex].start < end) {
      sentenceTokens.push(tokens[tokenIndex]);
      tokenIndex += 1;
    }
    spans.push({ text: value, start, end, tokens: sentenceTokens });
  };

  let consumedTo = 0;
  for (const match of text.matchAll(pattern)) {
    const raw = match[0];
    const leading = raw.search(/\S/u);
    if (leading < 0) continue;
    const start = (match.index ?? 0) + leading;
    const end = (match.index ?? 0) + raw.trimEnd().length;
    if (!text.slice(start, end).trim()) continue;
    addSpan(start, end);
    consumedTo = (match.index ?? 0) + raw.length;
  }

  // Whatever follows the last terminator is a sentence in its own right.
  const tailStart = text.slice(consumedTo).search(/\S/u);
  if (tailStart >= 0) {
    const start = consumedTo + tailStart;
    addSpan(start, text.length);
  }
  return spans;
}

export function parseDocument(text: string): ParsedDocument {
  const tokens = tokensIn(text);
  const sentences = sentenceSpans(text, tokens);
  const paragraphs: ParsedDocument["paragraphs"] = [];
  let cursor = 0;
  let tokenCursor = 0;
  for (const paragraph of text.split(/\n\s*\n/gu)) {
    const start = text.indexOf(paragraph, cursor);
    cursor = Math.max(cursor, start + paragraph.length);
    if (!paragraph.trim() || start < 0) continue;
    const end = start + paragraph.length;
    while (tokenCursor < tokens.length && tokens[tokenCursor].end <= start) tokenCursor += 1;
    const paragraphTokens: Token[] = [];
    while (tokenCursor < tokens.length && tokens[tokenCursor].end <= end) {
      paragraphTokens.push(tokens[tokenCursor]);
      tokenCursor += 1;
    }
    paragraphs.push({ text: paragraph, start, end, tokens: paragraphTokens });
  }
  const frequencies = new Map<string, number>();
  for (const token of tokens) frequencies.set(token.lower, (frequencies.get(token.lower) ?? 0) + 1);
  return {
    text,
    tokens,
    sentences,
    paragraphs,
    frequencies,
    sentenceLengths: sentences.map((sentence) => sentence.tokens.length),
    paragraphLengths: paragraphs.map((paragraph) => paragraph.tokens.length),
  };
}

export const analyzeDocument = parseDocument;
