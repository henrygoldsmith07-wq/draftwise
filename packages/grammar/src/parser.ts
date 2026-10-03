
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
  const pattern = /[^.!?…\n]+(?:[.!?…]+(?=\s|$)|$)/gu;
  for (const match of text.matchAll(pattern)) {
    const raw = match[0];
    const leading = raw.search(/\S/u);
    if (leading < 0) continue;
    const start = (match.index ?? 0) + leading;
    const value = raw.slice(leading).trim();
    if (!value) continue;
    const end = start + value.length;
    while (tokenIndex < tokens.length && tokens[tokenIndex].end <= start) tokenIndex += 1;
    const sentenceTokens: Token[] = [];
    while (tokenIndex < tokens.length && tokens[tokenIndex].start < end) {
      sentenceTokens.push(tokens[tokenIndex]);
      tokenIndex += 1;
    }
    spans.push({ text: value, start, end, tokens: sentenceTokens });
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
