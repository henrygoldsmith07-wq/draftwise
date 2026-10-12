"use client";

import { useMemo, useState } from "react";
import { ChevronDown, Compass, EyeOff, ListTree } from "lucide-react";
import { buildDocumentOutline, summariseDocument } from "@/packages/grammar/src";
import { SUPPRESSION_REASONS, describeSuppression } from "@/packages/grammar/src/prioritise.ts";
import type { SuggestionReport, SuppressedFinding, WritingGoals, WritingIssue, WritingStats, StylePreferences } from "@/packages/types/src";
import type { SuggestionState } from "@/lib/suggestions";

/**
 * How many held-back findings to list before asking the writer to filter. The
 * list is a route into the draft, not the review list itself, so it stays
 * bounded no matter how long the document is.
 */
const SUPPRESSED_PREVIEW_LIMIT = 20;

/**
 * Whole-document reading for the writer.
 *
 * Everything here is computed locally from the draft text. It is what keeps
 * Draftwise useful with no AI at all, and it is the part that matters most once
 * a draft is too long to hold in your head: where the weight sits, which
 * sections carry new ground, and what the draft is currently most concerned
 * with.
 */
export function DocumentOverview({ text, stats, goals, style, onJumpToRange }: {
  text: string;
  stats: WritingStats;
  goals?: WritingGoals;
  style?: StylePreferences;
  onJumpToRange?: (start: number, end: number) => void;
}) {
  const [showOutline, setShowOutline] = useState(false);
  const outline = useMemo(() => buildDocumentOutline(text, stats, undefined, { goals, preferences: style }), [text, stats, goals, style]);
  const summary = useMemo(() => summariseDocument(outline, stats, goals), [outline, stats, goals]);

  if (!outline.sections.length) return null;

  return (
    <section className="document-overview" aria-label="Document overview">
      <div className="document-overview-head">
        <div>
          <p className="eyebrow">Whole draft</p>
          <h3>{outline.focus}</h3>
          <p className="document-overview-summary">{summary}</p>
        </div>
        <Compass size={18} aria-hidden="true" className="document-overview-icon" />
      </div>

      {outline.themes.length ? (
        <div className="document-themes" aria-label="Recurring subjects">
          {outline.themes.slice(0, 6).map((theme) => (
            <span key={theme.term} className="theme-chip" title={`${theme.count} mentions`}>
              {theme.term}
            </span>
          ))}
        </div>
      ) : null}

      {outline.notes.length ? (
        <ul className="document-notes">
          {outline.notes.slice(0, 4).map((note) => (
            <li key={note.id} className={`document-note document-note-${note.kind}`}>
              <button
                type="button"
                className="document-note-button"
                onClick={() => onJumpToRange?.(note.start, note.end)}
                disabled={!onJumpToRange}
              >
                <strong>{note.title}</strong>
                <span>{note.detail}</span>
                <em>{note.suggestion}</em>
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {outline.sections.length > 1 ? (
        <>
          <button
            type="button"
            className="document-outline-toggle"
            aria-expanded={showOutline}
            onClick={() => setShowOutline((value) => !value)}
          >
            <ListTree size={14} aria-hidden="true" />
            {showOutline ? "Hide" : "Show"} the {outline.sections.length}-part outline
            <ChevronDown size={14} className={showOutline ? "is-open" : ""} aria-hidden="true" />
          </button>
          {showOutline ? (
            <ol className="document-outline">
              {outline.sections.map((section) => (
                <li key={section.id} className={`document-section document-section-${section.role}${section.filler ? " is-filler" : ""}`}>
                  <button
                    type="button"
                    className="document-section-button"
                    onClick={() => onJumpToRange?.(section.start, section.end)}
                    disabled={!onJumpToRange}
                  >
                    <span className="document-section-head">
                      <em className="document-section-role">{section.role.replace("-", " ")}</em>
                      <span className="document-section-meta">{section.words} words · {section.sentences} sentences{section.filler ? " · light on new material" : ""}</span>
                    </span>
                    <span className="document-section-opening">{section.opening}</span>
                  </button>
                </li>
              ))}
            </ol>
          ) : null}
        </>
      ) : null}
    </section>
  );
}

/**
 * What Draftwise held back, and why.
 *
 * Suppressing low-value findings is the right call for a reviewable list. Doing
 * it silently is not: on a long draft "N findings held back" reads as "there is
 * nothing else wrong", which is the most misleading thing the product could say.
 *
 * An earlier version counted the reasons and stopped there, so "51 findings held
 * back" was a dead end — the writer was told real findings existed and given no
 * way to reach any of them. Every suppressed entry already carries its own
 * issue, so each one is listed and jumps to the passage it came from.
 */
export function SuppressedFindings({ suppressed, report, onSelectIssue }: {
  suppressed: SuppressedFinding[];
  report: SuggestionReport;
  onSelectIssue?: (issue: WritingIssue) => void;
}) {
  const [open, setOpen] = useState(false);
  const [reasonFilter, setReasonFilter] = useState<string | null>(null);
  if (!report.suppressedCount) return null;

  const byReason = new Map<string, SuppressedFinding[]>();
  for (const entry of suppressed) {
    const bucket = byReason.get(entry.reason);
    if (bucket) bucket.push(entry);
    else byReason.set(entry.reason, [entry]);
  }
  // Keep the most common reason first: it is the one worth showing by default.
  const reasons = [...byReason.entries()].sort((left, right) => right[1].length - left[1].length);

  // Findings the writer turned off or dismissed themselves are not actionable
  // here — jumping to them would offer a fix they already refused.
  const ACTIONABLE = new Set(["density-cap", "repeated-pattern", "low-confidence-style", "register-budget"]);
  const shown = reasonFilter
    ? suppressed.filter((entry) => entry.reason === reasonFilter)
    : suppressed.filter((entry) => ACTIONABLE.has(entry.reason));

  return (
    <div className="suppressed-findings">
      <button type="button" className="suppressed-toggle" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        <EyeOff size={13} aria-hidden="true" />
        {report.suppressedCount} finding{report.suppressedCount === 1 ? "" : "s"} held back
        <ChevronDown size={13} className={open ? "is-open" : ""} aria-hidden="true" />
      </button>
      {open ? (
        <div className="suppressed-body">
          <p>{describeSuppression(report)}</p>
          <div className="suppressed-reasons">
            {reasons.map(([reason, entries]) => (
              <button
                key={reason}
                type="button"
                className={reasonFilter === reason ? "is-active" : ""}
                aria-pressed={reasonFilter === reason}
                onClick={() => setReasonFilter((value) => (value === reason ? null : reason))}
              >
                {SUPPRESSION_REASONS[reason as keyof typeof SUPPRESSION_REASONS] ?? reason}
                <em>{entries.length}</em>
              </button>
            ))}
            {reasonFilter ? (
              <button type="button" className="suppressed-reasons-clear" onClick={() => setReasonFilter(null)}>
                Clear filter
              </button>
            ) : null}
          </div>
          {shown.length ? (
            <ul className="suppressed-list">
              {shown.slice(0, SUPPRESSED_PREVIEW_LIMIT).map((entry) => (
                <li key={entry.issue.id}>
                  <button
                    type="button"
                    onClick={() => onSelectIssue?.(entry.issue)}
                    disabled={!onSelectIssue}
                    title={`Jump to: ${entry.issue.original || entry.issue.title}`}
                  >
                    <span>{entry.issue.title}</span>
                    <em>{entry.issue.original?.trim() || "open the passage"}</em>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="suppressed-empty">
              {reasonFilter
                ? "None of those are left to review here."
                : "Everything held back was turned off or dismissed by you, so there is nothing new to open."}
            </p>
          )}
          {shown.length > SUPPRESSED_PREVIEW_LIMIT ? (
            <p className="suppressed-more">
              Showing the first {SUPPRESSED_PREVIEW_LIMIT} of {shown.length}. Filter by a reason to narrow the list.
            </p>
          ) : null}
          <small>These are real findings. They are hidden to keep the list reviewable, not because they do not matter.</small>
        </div>
      ) : null}
    </div>
  );
}

/** Convenience wrapper so callers pass the suggestion state they already have. */
export function SuggestionDisclosure({ suggestions }: { suggestions: SuggestionState }) {
  return <SuppressedFindings suppressed={suggestions.suppressed} report={suggestions.report} />;
}