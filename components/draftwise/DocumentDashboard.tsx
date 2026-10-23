"use client";

import { useDeferredValue, useMemo, useState } from "react";
import { Copy, FilePlus2, FileText, History, Search, Trash2, Upload, Download } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { documentMatchesQuery, matchingExcerpt, type DocumentReview, type DocumentSummary, type StoredDocument } from "@/lib/documents";
import { formatRelativeTime as formatRelative } from "@/lib/time";

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

/** Mark the part of the excerpt the search found, so the match is obvious. */
function HighlightedExcerpt({ text, query }: { text: string; query: string }) {
  const needle = query.trim();
  const index = needle ? text.toLocaleLowerCase().indexOf(needle.toLocaleLowerCase()) : -1;
  if (index < 0) return <>{text}</>;
  return <>{text.slice(0, index)}<mark>{text.slice(index, index + needle.length)}</mark>{text.slice(index + needle.length)}</>;
}

export function DocumentDashboard({ summaries, documents, activeId, importError, loading, onOpen, onNew, onSample, onDuplicate, onDelete, onImport, onExport, onHistory }: {
  summaries: DocumentSummary[];
  /** Full documents, so search can look past the card's opening excerpt. */
  documents: StoredDocument[];
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
  onExport: (id: string, format: "txt" | "md" | "pdf") => void;
  onHistory: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  // Fresh installs (and writers who deleted everything) own no words yet.
  // That is the moment for an explicit choice — blank page or sample —
  // instead of foreign prose or a bare empty state.
  const isFresh = !loading && summaries.every((document) => document.wordCount === 0);
  // Searching every draft's full text is work the keystroke should not wait on:
  // the input updates immediately and the result list catches up.
  const deferredQuery = useDeferredValue(query);
  const documentsById = useMemo(() => new Map(documents.map((document) => [document.id, document])), [documents]);
  const filtered = useMemo(() => {
    const needle = deferredQuery.trim();
    if (!needle) return summaries;
    const lower = needle.toLocaleLowerCase();
    return summaries.filter((summary) => {
      const document = documentsById.get(summary.id);
      // A summary without its document can only be older state than the list
      // itself; fall back to the cheap fields rather than dropping the row.
      return document
        ? documentMatchesQuery(document, needle)
        : summary.title.toLocaleLowerCase().includes(lower) || summary.excerpt.toLocaleLowerCase().includes(lower);
    });
  }, [deferredQuery, summaries, documentsById]);
  // With a query, the card shows the passage that matched rather than the
  // opening line, which is the one part of the draft search already found.
  const excerptFor = (summary: DocumentSummary) => {
    if (!deferredQuery.trim()) return summary.excerpt;
    const source = documentsById.get(summary.id);
    return (source ? matchingExcerpt(source, deferredQuery) : null) ?? summary.excerpt;
  };

  return <section className="full-view"><div className="full-view-heading"><div><p className="eyebrow">Your drafts</p><h1>Everything you have written, on this device.</h1><p>Drafts are stored locally in your browser. No account, no sync, no upload.</p></div><div className="heading-actions"><Button onClick={onNew}><FilePlus2 size={15} /> New document</Button></div></div><div className="dashboard-toolbar"><label className="dashboard-search"><Search size={15} /><Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search titles and text" aria-label="Search documents" /></label><label className="dashboard-import"><Upload size={14} /> Import .txt or .md<input type="file" accept=".txt,.md,.markdown,text/plain,text/markdown" onChange={(event) => { const file = event.target.files?.[0]; if (file) onImport(file); event.target.value = ""; }} /></label></div>{importError ? <div className="import-error" role="alert">{importError}</div> : null}{loading ? (<><p className="sr-only" role="status">Loading your drafts…</p><div className="document-grid" aria-hidden="true">{[0, 1, 2].map((index) => (<div key={index} className="document-card skeleton-card" data-testid={`skeleton-document-${index}`}><span className="skeleton-line skeleton-line-title" data-testid="skeleton-line-title" /><span className="skeleton-line" data-testid="skeleton-line-excerpt" /><span className="skeleton-line skeleton-line-short" data-testid="skeleton-line-meta" /></div>))}</div></>) : null}{!loading && isFresh ? (<div className="welcome-panel"><h2>Start with a blank page.</h2><p>Draftwise opens here, on your documents — never inside sample text pretending to be your draft. Write something of your own, or load the sample to see what analysis looks like.</p><div className="welcome-actions"><Button onClick={onNew}><FilePlus2 size={15} /> Start writing</Button><Button variant="outline" onClick={onSample}>Try the sample text</Button></div></div>) : null}{!loading ? <div className="document-grid">{filtered.map((document) => <article key={document.id} className={`document-card ${document.id === activeId ? "is-active" : ""}`}><button type="button" className="document-card-main" onClick={() => onOpen(document.id)}><span className="document-card-title"><FileText size={15} /> {document.title}</span><span className="document-card-excerpt">{document.excerpt || "Empty draft"}</span><span className="document-card-meta">{document.wordCount.toLocaleString("en-GB")} words · edited {formatRelative(document.updatedAt)}</span>{document.goals || document.dialect ? <span className="document-card-meta">Goals: {[document.goals?.audience, document.goals?.intent, document.goals?.tone].filter(Boolean).join(" · ")}{document.dialect ? ` · ${document.dialect === "en-GB" ? "British English" : "American English"}` : ""}</span> : null}<span className={document.review && document.review.worthMaking > 0 ? "document-card-review has-work" : "document-card-review"}>{reviewLabel(document.review)}</span>{document.id === activeId ? <Badge className="local-badge">Open</Badge> : null}</button><div className="document-card-actions">
  <Button size="sm" variant="ghost" aria-label={`Version history for ${document.title}`} onClick={() => onHistory(document.id)}>
    <History size={13} />
  </Button>
  <Button size="sm" variant="ghost" aria-label={`Duplicate ${document.title}`} onClick={() => onDuplicate(document.id)}>
    <Copy size={13} />
  </Button>
  <div className="export-dropdown">
    <Button 
      size="sm" 
      variant="ghost" 
      aria-label={`Export ${document.title}`}
      title="Export options"
    >
      <Download size={13} />
    </Button>
    <div className="dropdown-menu" role="menu">
      <button 
        className="dropdown-item" 
        role="menuitem"
        onClick={() => onExport(document.id, "md")}
      >
        Export as Markdown (.md)
      </button>
      <button 
        className="dropdown-item" 
        role="menuitem"
        onClick={() => onExport(document.id, "txt")}
      >
        Export as Plain Text (.txt)
      </button>
      <button 
        className="dropdown-item" 
        role="menuitem"
        onClick={() => onExport(document.id, "pdf")}
      >
        Export as PDF (.pdf)
      </button>
    </div>
  </div>
  {pendingDelete === document.id ? (
    <>
      <Button size="sm" variant="ghost" onClick={() => { onDelete(document.id); setPendingDelete(null);}}>Confirm delete</Button>
      <Button size="sm" variant="ghost" onClick={() => setPendingDelete(null)}>Cancel</Button>
    </>
  ) : (
    <Button size="sm" variant="ghost" aria-label={`Delete ${document.title}`} onClick={() => setPendingDelete(document.id)}>
      <Trash2 size={13} />
    </Button>
  )}
</div></article>)}</div> : null}{!loading && filtered.length === 0 ? <div className="empty-suggestions"><div className="empty-icon"><FileText size={22} /></div><h3>No documents match</h3><p>{query ? "Try a different search term." : "Create your first draft to get started."}</p></div> : null}</section>;
}
