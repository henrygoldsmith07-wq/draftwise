"use client";

import { ArrowDown, Check, Copy, Lightbulb, RotateCw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { RewritePreviewState } from "@/hooks/useRewrite";

function diffPreview(original: string, replacement: string) {
  let prefix = 0;
  while (prefix < original.length && prefix < replacement.length && original[prefix] === replacement[prefix]) prefix += 1;
  let suffix = 0;
  while (suffix < original.length - prefix && suffix < replacement.length - prefix && original[original.length - suffix - 1] === replacement[replacement.length - suffix - 1]) suffix += 1;
  const replacementEnd = replacement.length - suffix;
  return <>{replacement.slice(0, prefix)}<mark className="rewrite-diff">{replacement.slice(prefix, replacementEnd)}</mark>{suffix ? replacement.slice(replacementEnd) : null}</>;
}

export function RewritePreview({ preview, onReplace, onInsert, onCopy, onRetry, onCancel }: { preview: RewritePreviewState; onReplace: () => void; onInsert: () => void; onCopy: () => void; onRetry: () => void; onCancel: () => void }) {
  return <section className="rewrite-preview" aria-live="polite"><div className="rewrite-preview-header"><span><span aria-hidden="true">✦</span> {preview.label} <small>{preview.source === "ai" ? "AI preview" : "local preview"}</small></span><button onClick={onCancel} aria-label="Close rewrite preview" type="button"><X size={15} /></button></div>{preview.loading ? <div className="rewrite-loading"><span className="loading-pulse" /> Drafting a preview…</div> : <><div className="rewrite-columns"><div><small>Original</small><p>{preview.original}</p></div><ArrowDown className="rewrite-arrow" size={16} /><div><small>Suggested — changed text highlighted</small><p className="rewrite-suggested">{diffPreview(preview.original, preview.replacement)}</p></div></div>{preview.explanation ? <p className="rewrite-explanation"><Lightbulb size={14} /> {preview.explanation}</p> : null}<div className="rewrite-actions"><Button size="sm" onClick={onReplace}><Check size={14} /> Replace</Button><Button size="sm" variant="outline" onClick={onInsert}><ArrowDown size={14} /> Insert</Button><Button size="sm" variant="ghost" onClick={onCopy}><Copy size={14} /> Copy</Button><Button size="sm" variant="ghost" onClick={onRetry}><RotateCw size={14} /> Retry</Button><Button size="sm" variant="ghost" onClick={onCancel}>Cancel</Button></div></>}</section>;
}
