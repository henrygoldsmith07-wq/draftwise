
export const clamp  = (value: number) => Math.max(0, Math.min(100, Math.round(value)));

export function preserveCase(original: string, replacement: string) {
if (!replacement) return replacement;
  // A single character is trivially equal to its own uppercase form, so
  // "A" -> "an" used to take the shouting branch and produce "AN" mid-sentence.
  if (original.length > 1 && original === original.toUpperCase()) return replacement.toUpperCase();
  if (original[0] === original[0]?.toUpperCase()) return replacement[0].toUpperCase() + replacement.slice(1);
  return replacement;
}

export function issueTextFingerprint(text: string) {
  let hash = 2_166_136_261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0).toString(36);
}

export function createIssueId(ruleId: string, start: number, end: number, original: string) {
  return `${ruleId}-${start}-${end}-${issueTextFingerprint(original)}`;
}
