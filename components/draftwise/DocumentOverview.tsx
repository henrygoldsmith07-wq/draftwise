"use client";

import { useMemo, useState } from "react";
import { ChevronDown, Compass, EyeOff, ListTree } from "lucide-react";
import { buildDocumentOutline, summariseDocument } from "@/packages/grammar/src";
import { SUPPRESSION_REASONS, describeSuppression } from "@/packages/grammar/src/prioritise.ts";
import type { SuggestionReport, SuppressedFinding, WritingGoals, WritingStats, StylePreferences } from "@/packages/types/src";
import type { SuggestionState } from "@/lib/suggestions";

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
 * This makes the trade inspectable without putting the noise back in the list.
 */
export function SuppressedFindings({ suppressed, report }: { suppressed: SuppressedFinding[]; report: SuggestionReport }) {
  const [open, setOpen] = useState(false);
  if (!report.suppressedCount) return null;

  const byReason = new Map<string, number>();
  for (const entry of suppressed) {
    byReason.set(entry.reason, (byReason.get(entry.reason) ?? 0) + 1);
  }
  const reasons = [...byReason.entries()].sort((left, right) => right[1] - left[1]);

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
          <ul>
            {reasons.map(([reason, count]) => (
              <li key={reason}>
                <span>{SUPPRESSION_REASONS[reason as keyof typeof SUPPRESSION_REASONS] ?? reason}</span>
                <em>{count}</em>
              </li>
            ))}
          </ul>
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