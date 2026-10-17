"use client";

import { useMemo, useState } from "react";
import { Copy, FilePlus2, FileText, History, Search, Trash2, Upload, Download } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { DocumentReview, DocumentSummary } from "@/lib/documents";

function formatRelative(timestamp: number) {
  const elapsed = Date.now() - timestamp;
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

/**
 * What the last analysis found, in the writer's terms.
 *
 * Shown so the list answers "which of my drafts is worth picking up", not just
 * "which did I touch last". It is what the analysis found when the writer last
 * had that draft open, which the wording makes clear rather than presenting a
 * stale number as current.
 */
function reviewLabel(review: DocumentReview | undefined) {
  if (!review) return "Not analysed yet";
  if (review.worthMaking === 0) return "Nothing flagged";
  const fixes = review.fixFirst > 0 ? `, ${review.fixFirst} to fix first` : "";
  return `${review.worthMaking} worth making${fixes} — as of ${formatRelative(review.analysedAt)}`;
}

export function DocumentDashboard({ summaries, activeId, importError, loading, onOpen, onNew, onSample, onDuplicate, onDelete, onImport, onExport, onHistory }: {
  summaries: DocumentSummary[];
  activeId: string;
  importError?: string | null;
  /** True while the document store is hydrating: show a skeleton, never an
   * empty list that reads as "you have nothing" before storage answers. */
  loading: boolean;
  onOpen: (id: string) => void;
  onNew: () => void;
  /** Explicit first-run path to the sample text. Never invoked uninvited. */
  onSample: () => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
  onImport: (file: File) => void;
  onExport: (id: string, format: "txt" | "md") => void;
  onHistory: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  // Fresh installs (and writers who deleted everything) own no words yet.
  // That is the moment for an explicit choice — blank page or sample —
  // instead of foreign prose or a bare empty state.
  const isFresh = !loading && summaries.every((document) => document.wordCount === 0);
  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    if (!needle) return summaries;
    return summaries.filter((document) => document.title.toLocaleLowerCase().includes(needle) || document.excerpt.toLocaleLowerCase().includes(needle));
  }, [query, summaries]);

  return <section className="full-view"><div className="full-view-heading"><div><p className="eyebrow">Your drafts</p><h1>Everything you have written, on this device.</h1><p>Drafts are stored locally in your browser. No account, no sync, no upload.</p></div><div className="heading-actions"><Button onClick={onNew}><FilePlus2 size={15} /> New document</Button></div></div><div className="dashboard-toolbar"><label className="dashboard-search"><Search size={15} /><Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search titles and text" aria-label="Search documents" /></label><label className="dashboard-import"><Upload size={14} /> Import .txt or .md<input type="file" accept=".txt,.md,.markdown,text/plain,text/markdown" onChange={(event) => { const file = event.target.files?.[0]; if (file) onImport(file); event.target.value = ""; }} /></label></div>{importError ? <div className="import-error" role="alert">{importError}</div> : null}{loading ? (<><p className="sr-only" role="status">Loading your drafts…</p><div className="document-grid" aria-hidden="true">{[0, 1, 2].map((index) => (<div key={index} className="document-card skeleton-card"><span className="skeleton-line skeleton-line-title" /><span className="skeleton-line" /><span className="skeleton-line skeleton-line-short" /></div>))}</div></>) : null}{!loading && isFresh ? (<div className="welcome-panel"><h2>Start with a blank page.</h2><p>Draftwise opens here, on your documents — never inside sample text pretending to be your draft. Write something of your own, or load the sample to see what analysis looks like.</p><div className="welcome-actions"><Button onClick={onNew}><FilePlus2 size={15} /> Start writing</Button><Button variant="outline" onClick={onSample}>Try the sample text</Button></div></div>) : null}{!loading ? <div className="document-grid">{filtered.map((document) => <article key={document.id} className={`document-card ${document.id === activeId ? "is-active" : ""}`}><button type="button" className="document-card-main" onClick={() => onOpen(document.id)}><span className="document-card-title"><FileText size={15} /> {document.title}</span><span className="document-card-excerpt">{document.excerpt || "Empty draft"}</span><span className="document-card-meta">{document.wordCount.toLocaleString("en-GB")} words · edited {formatRelative(document.updatedAt)}</span>{document.goals ? <span className="document-card-meta">Goals: {document.goals.audience} · {document.goals.intent} · {document.goals.tone}</span> : null}<span className={document.review && document.review.worthMaking > 0 ? "document-card-review has-work" : "document-card-review"}>{reviewLabel(document.review)}</span>{document.id === activeId ? <Badge className="local-badge">Open</Badge> : null}</button><div className="document-card-actions"><Button size="sm" variant="ghost" aria-label={`Version history for ${document.title}`} onClick={() => onHistory(document.id)}><History size={13} /></Button><Button size="sm" variant="ghost" aria-label={`Duplicate ${document.title}`} onClick={() => onDuplicate(document.id)}><Copy size={13} /></Button><Button size="sm" variant="ghost" aria-label={`Export ${document.title} as Markdown`} onClick={() => onExport(document.id, "md")}><Download size={13} /></Button><Button size="sm" variant="ghost" aria-label={`Export ${document.title} as plain text`} onClick={() => onExport(document.id, "txt")}><FileText size={13} /></Button>{pendingDelete === document.id ? <><Button size="sm" variant="ghost" onClick={() => { onDelete(document.id); setPendingDelete(null); }}>Confirm delete</Button><Button size="sm" variant="ghost" onClick={() => setPendingDelete(null)}>Cancel</Button></> : <Button size="sm" variant="ghost" aria-label={`Delete ${document.title}`} onClick={() => setPendingDelete(document.id)}><Trash2 size={13} /></Button>}</div></article>)}</div> : null}{!loading && filtered.length === 0 ? <div className="empty-suggestions"><div className="empty-icon"><FileText size={22} /></div><h3>No documents match</h3><p>{query ? "Try a different search term." : "Create your first draft to get started."}</p></div> : null}</section>;
}
