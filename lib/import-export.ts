/**
 * Plain-text and Markdown import/export.
 *
 * Import is deliberately conservative: the text is read as-is and never
 * interpreted as markup, HTML or template content, so a hostile file cannot
 * inject anything into the draft. Sizes are bounded and binary-looking content
 * is rejected before it reaches the editor.
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
