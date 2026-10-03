"use client";

import { useState } from "react";
import { ArrowLeft, Copy, History, RotateCcw, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { DocumentSnapshot, StoredDocument } from "@/lib/documents";

function formatTimestamp(timestamp: number) {
  const date = new Date(timestamp);
  return date.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function excerptOf(text: string) {
  return text.trim().replace(/\s+/gu, " ").slice(0, 140) || "Empty version";
}

function wordCount(text: string) {
  return text.trim().split(/\s+/u).filter(Boolean).length;
}

const REASON_LABELS: Record<DocumentSnapshot["reason"], string> = {
  autosave: "Autosave",
  manual: "Checkpoint",
  import: "Imported",
};

export interface VersionHistoryViewProps {
  document: StoredDocument;
  onBack: () => void;
  onRestore: (snapshot: DocumentSnapshot) => void;
  onDuplicateSnapshot: (snapshot: DocumentSnapshot) => void;
}

/**
 * Version History for one document: a plain list of checkpoints with a preview,
 * a current-version comparison, and safe restore/duplicate actions. The current
 * draft is always listed first and clearly marked, so returning to it is obvious.
 */
export function VersionHistoryView({ document: document, onBack, onRestore, onDuplicateSnapshot }: VersionHistoryViewProps) {
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [confirmRestoreId, setConfirmRestoreId] = useState<string | null>(null);
  const snapshots = [...document.snapshots].reverse();
  const preview = snapshots.find((snapshot) => snapshot.id === previewId) ?? null;

  return <section className="full-view">
    <div className="full-view-heading">
      <div>
        <p className="eyebrow">Version history</p>
        <h1>{document.title}</h1>
        <p>Checkpoints Draftwise saved for this document. Restoring keeps the current draft in history too.</p>
      </div>
      <Button onClick={onBack}><ArrowLeft size={15} /> Back to document</Button>
    </div>

    <div className="history-list">
      <article className="history-entry is-current">
        <div className="history-entry-main">
          <span className="history-entry-title"><History size={14} /> Current version <Badge className="local-badge">Open</Badge></span>
          <span className="history-entry-meta">{wordCount(document.draft)} words · edited {formatTimestamp(document.updatedAt)}</span>
          <span className="history-entry-excerpt">{excerptOf(document.draft)}</span>
        </div>
      </article>

      {snapshots.length === 0 ? (
        <div className="empty-suggestions">
          <div className="empty-icon"><History size={22} /></div>
          <h3>No earlier versions yet</h3>
          <p>Draftwise saves checkpoints before big changes and when you save manually. Keep writing and history will fill in.</p>
        </div>
      ) : snapshots.map((snapshot) => (
        <article key={snapshot.id} className={`history-entry ${previewId === snapshot.id ? "is-previewing" : ""}`}>
          <div className="history-entry-main">
            <span className="history-entry-title">{REASON_LABELS[snapshot.reason]} · {formatTimestamp(snapshot.createdAt)}</span>
            <span className="history-entry-meta">{wordCount(snapshot.text)} words</span>
            <span className="history-entry-excerpt">{excerptOf(snapshot.text)}</span>
          </div>
          <div className="history-entry-actions">
            <Button size="sm" variant="ghost" onClick={() => setPreviewId(previewId === snapshot.id ? null : snapshot.id)}>{previewId === snapshot.id ? "Hide preview" : "Preview"}</Button>
            {confirmRestoreId === snapshot.id ? (
              <>
                <Button size="sm" variant="ghost" onClick={() => { onRestore(snapshot); setConfirmRestoreId(null); }}>Confirm restore</Button>
                <Button size="sm" variant="ghost" onClick={() => setConfirmRestoreId(null)}>Cancel</Button>
              </>
            ) : (
              <Button size="sm" variant="ghost" onClick={() => setConfirmRestoreId(snapshot.id)}><RotateCcw size={13} /> Restore</Button>
            )}
            <Button size="sm" variant="ghost" onClick={() => onDuplicateSnapshot(snapshot)}><Copy size={13} /> Save as new</Button>
          </div>
        </article>
      ))}
    </div>

    {preview ? (
      <div className="history-preview" role="dialog" aria-label="Version preview">
        <div className="history-preview-header">
          <strong>{REASON_LABELS[preview.reason]} · {formatTimestamp(preview.createdAt)}</strong>
          <button type="button" aria-label="Close preview" onClick={() => setPreviewId(null)}><X size={15} /></button>
        </div>
        <div className="history-preview-columns">
          <div>
            <small>Current version</small>
            <p>{document.draft || "Empty"}</p>
          </div>
          <div>
            <small>{REASON_LABELS[preview.reason]} · {formatTimestamp(preview.createdAt)}</small>
            <p>{preview.text || "Empty"}</p>
          </div>
        </div>
        <div className="history-preview-actions">
          <Button size="sm" variant="ghost" onClick={() => setPreviewId(null)}>Back to current</Button>
          {confirmRestoreId === preview.id ? (
            <>
              <Button size="sm" onClick={() => { onRestore(preview); setConfirmRestoreId(null); setPreviewId(null); }}>Confirm restore this version</Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirmRestoreId(null)}>Cancel</Button>
            </>
          ) : (
            <Button size="sm" variant="outline" onClick={() => setConfirmRestoreId(preview.id)}><RotateCcw size={13} /> Restore this version</Button>
          )}
          <Button size="sm" variant="ghost" onClick={() => { onDuplicateSnapshot(preview); setPreviewId(null); }}><Copy size={13} /> Save as new document</Button>
        </div>
      </div>
    ) : null}
  </section>;
}
