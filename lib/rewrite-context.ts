/**
 * Context for a rewrite request.
 *
 * A rewrite of a few words in isolation is guesswork: the model cannot tell
 * whether "it" refers to the preceding sentence or the following one, so it
 * produces text that reads well and means something else. Sending the
 * sentences around the selection fixes that.
 *
 * These sentences are context for the model, never a wider edit target. The
 * response is still validated and applied against the selection alone.
 */
export function surroundingContext(draft: string, selection: { start: number; end: number }, limit = 600) {
  const before = draft.slice(Math.max(0, selection.start - limit), selection.start);
  const after = draft.slice(selection.end, Math.min(draft.length, selection.end + limit));
  // Whole sentences only, on both sides.
  //
  // A half-sentence in the prompt reads as part of the thing being rewritten:
  // given "The figure" as preceding context, a model will happily write text
  // about that fragment. So each side keeps only text that ends on a sentence
  // boundary. When there is not enough room for a whole sentence, the context
  // is empty rather than partial — no context is better than misleading
  // context.
  const lastCompleteSentence = (value: string) => {
    const trimmed = value.trimEnd();
    // A terminator only ends a sentence when whitespace or the end follows it;
    // "3.5" and "e.g." contain terminators that do not.
    const sentenceEnds: number[] = [];
    for (const match of trimmed.matchAll(/[.!?…][)"'”]*/gu)) {
      const after = trimmed[match.index + match[0].length];
      if (after === undefined || /\s/u.test(after)) sentenceEnds.push(match.index + match[0].length);
    }
    if (!sentenceEnds.length) return "";
    // The last complete sentence, not the whole window: it is the one that
    // explains what the selection is about.
    return trimmed.slice(sentenceEnds[sentenceEnds.length - 2] ?? 0, sentenceEnds[sentenceEnds.length - 1]).trim();
  };
  const firstCompleteSentence = (value: string) => {
    const match = /[.!?…][)"'”]*(?:\s|$)/u.exec(value);
    return match ? value.slice(0, match.index + 1).trim() : "";
  };
  return { contextBefore: lastCompleteSentence(before), contextAfter: firstCompleteSentence(after) };
}