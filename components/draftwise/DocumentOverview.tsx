"use client";

import { useMemo, useState } from "react";
import { CheckCheck, ChevronDown, Compass, EyeOff, ListTree, Search, X } from "lucide-react";
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

/** Upper bound on what "Show more" can reveal before it re-prompts to filter. */
const SUPPRESSED_LIST_LIMIT = 100;

/** Only show the search input once there are enough findings to warrant one. */
const SEARCH_THRESHOLD = 8;

/**
 * Bulk dismissal is only worth offering above this many findings: below it,
 * dismissing individually is cheaper than reading and confirming a dialog.
 */
const BATCH_THRESHOLD = 5;

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
export function SuppressedFindings({ suppressed, report, onSelectIssue, onDismissMany }: {
  suppressed: SuppressedFinding[];
  report: SuggestionReport;
  onSelectIssue?: (issue: WritingIssue) => void;
  /** Bulk dismissal for the currently filtered set. Omit to hide the affordance. */
  onDismissMany?: (issues: WritingIssue[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [reasonFilter, setReasonFilter] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [visibleLimit, setVisibleLimit] = useState(SUPPRESSED_PREVIEW_LIMIT);
  const [batchConfirm, setBatchConfirm] = useState(false);
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
  const base = reasonFilter
    ? suppressed.filter((entry) => entry.reason === reasonFilter)
    : suppressed.filter((entry) => ACTIONABLE.has(entry.reason));

  // The reason filter narrows by WHY a finding was held back. It cannot answer
  // "where is the spelling finding I remember writing?", which is the actual
  // question on a draft with 200 held-back findings and 20 shown. This matches
  // the dashboard's own search, over the finding's title, the offending text
  // and the passage around it.
  const needle = query.trim().toLocaleLowerCase();
  const shown = !needle
    ? base
    : base.filter((entry) => {
      const issue = entry.issue;
      return (issue.title ?? "").toLocaleLowerCase().includes(needle)
        || (issue.original ?? "").toLocaleLowerCase().includes(needle)
        || (issue.replacement ?? "").toLocaleLowerCase().includes(needle)
        || (issue.explanation ?? "").toLocaleLowerCase().includes(needle);
    });

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
          {/* Shown once there is anything worth searching: a 4-finding list does
              not need a search box, and an empty one should not invite typing. */}
          {base.length > SEARCH_THRESHOLD ? (
            <label className="suppressed-search">
              <Search size={12} aria-hidden="true" />
              <input
                type="text"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search held-back findings"
                aria-label="Search held-back findings"
              />
              {query ? (
                <button type="button" aria-label="Clear search" onClick={() => setQuery("")}>
                  <X size={12} aria-hidden="true" />
                </button>
              ) : null}
            </label>
          ) : null}
          {shown.length ? (
            <ul className="suppressed-list">
              {shown.slice(0, visibleLimit).map((entry) => (
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
              {needle
                ? `Nothing held back matches “${query.trim()}”.`
                : reasonFilter
                  ? "None of those are left to review here."
                  : "Everything held back was turned off or dismissed by you, so there is nothing new to open."}
            </p>
          )}
          {/* Bulk handling for the filtered set. Opening them one at a time does
              not scale, and a writer who does not want this kind of feedback at
              all currently has to dismiss each finding individually. Only offered
              for reasons the writer can meaningfully refuse in bulk — a density
              cap is a budget, not a judgement about the writing. */}
          {onDismissMany && shown.length > BATCH_THRESHOLD ? (
            batchConfirm ? (
              <div className="suppressed-batch-confirm" role="alertdialog" aria-label="Confirm dismissing these findings">
                <p>
                  Dismiss all {shown.length}{needle ? " matches" : reasonFilter ? " findings of this kind" : " held-back findings"}?
                  This also tells Draftwise to show you less of this kind of note.
                </p>
                <div className="suppressed-batch-actions">
                  <button type="button" className="suppressed-batch-yes" onClick={() => { onDismissMany(shown.map((entry) => entry.issue)); setBatchConfirm(false); }}>
                    Dismiss all {shown.length}
                  </button>
                  <button type="button" onClick={() => setBatchConfirm(false)}>Keep them</button>
                </div>
              </div>
            ) : (
              <button type="button" className="suppressed-batch" onClick={() => setBatchConfirm(true)}>
                <CheckCheck size={12} aria-hidden="true" /> Dismiss all {shown.length}
                {needle ? " matches" : reasonFilter ? " of this kind" : " held back"}
              </button>
            )
          ) : null}
          {shown.length > visibleLimit ? (
            <>
              <p className="suppressed-more">
                Showing {visibleLimit} of {shown.length}
                {needle ? " matches" : " held back"}.{" "}
                {needle ? "Narrow the search to see the rest." : "Search or filter by a reason to narrow the list."}
              </p>
              <button type="button" className="suppressed-show-all" onClick={() => setVisibleLimit(SUPPRESSED_LIST_LIMIT)}>
                Show {Math.min(SUPPRESSED_LIST_LIMIT, shown.length) - visibleLimit} more
              </button>
            </>
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