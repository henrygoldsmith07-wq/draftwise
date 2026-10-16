/**
 * Plain-text and Markdown import/export.
 *
 * Import is deliberately conservative: the text is read as-is and never
 * interpreted as markup, HTML or template content, so a hostile file cannot
 * inject anything into the draft. Sizes are bounded and binary-looking content
 * is rejected before it reaches the editor.
 */

/**
 * Two bounds, and the character one is usually tighter: 500,000 ASCII
 * characters are roughly 0.5 MB, well under the 2 MB byte bound, so Latin
 * text hits the character bound first — the one that protects the analysis
 * pass, which scales with characters, not bytes. The byte bound only bites
 * first past ~4 bytes per character (dense CJK/emoji runs), where it protects
 * memory instead. Neither implies the other, so both stay: removing the byte
 * bound re-opens the pre-read memory blowup, removing the char bound lets a
 * 2 MB ASCII file through to the analysers.
 */
export const MAX_IMPORT_BYTES = 2_000_000;
export const MAX_IMPORT_CHARS = 500_000;

export type ImportFormat = "markdown" | "text";

export type ImportResult =
  | {
      ok: true;
      title: string;
      text: string;
      format: ImportFormat;
    }
  | {
      ok: false;
      error: string;
    };

function looksBinary(text: string) {
  return /[\u0000-\u0008\u000E-\u001F]/u.test(text.slice(0, 2000));
}

export function titleFromFilename(name: string) {
  return name.replace(/\.(?:md|markdown|txt|text)$/iu, "").replace(/[_-]+/gu, " ").trim() || "Imported draft";
}

export function importDocument(fileName: string, content: string): ImportResult {
  if (content.length > MAX_IMPORT_CHARS) return { ok: false, error: "That file is too large to edit here (over 500,000 characters)." };
  if (looksBinary(content)) return { ok: false, error: "That file looks like binary data, not writing." };
  const format: ImportFormat = /\.(?:md|markdown)$/iu.test(fileName) ? "markdown" : "text";
  // Strip a UTF-8 BOM if present; keep everything else exactly as written.
  const text = content.replace(/^\uFEFF/u, "");
  return { ok: true, title: titleFromFilename(fileName), text, format };
}

/**
 * Reject an oversized file before its contents are read.
 *
 * `File.text()` materialises the whole file in memory, and the only size check
 * used to happen afterwards on the decoded string — so a 200 MB file was read
 * into memory in full and only then refused. The byte bound was declared but
 * never consulted. Checking `file.size` first costs nothing and refuses the
 * file before any of it is loaded.
 */
export function oversizedImport(file: { size: number }): string | null {
  if (file.size > MAX_IMPORT_BYTES) {
    const limit = Math.round(MAX_IMPORT_BYTES / 1_000_000);
    return `That file is too large to import (over ${limit} MB).`;
  }
  return null;
}

export function exportAsText(title: string, draft: string) {
  return { filename: `${safeFilename(title)}.txt`, content: draft, type: "text/plain;charset=utf-8" };
}

export function exportAsMarkdown(title: string, draft: string) {
  const body = draft.trimStart().startsWith("#") ? draft : `# ${title}\n\n${draft}`;
  return { filename: `${safeFilename(title)}.md`, content: body, type: "text/markdown;charset=utf-8" };
}

export function safeFilename(title: string) {
  return (title || "draft").replace(/[\\/:*?"<>|\u0000-\u001F]/gu, "-").replace(/-{2,}/gu, "-").slice(0, 80).trim() || "draft";
}

export function downloadFile({ filename, content, type }: { filename: string; content: string; type: string }) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
