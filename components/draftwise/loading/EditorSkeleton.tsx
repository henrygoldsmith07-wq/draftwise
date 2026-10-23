"use client";

/**
 * Skeleton loader for editor workspace view.
 * Shows loading placeholders while editor is being initialized.
 */
export function EditorSkeleton() {
  return (
    <div className="editor-surface editor-loading" aria-busy="true">
      <textarea
        className="draft-textarea skeleton-text-area"
        readOnly
        aria-label="Document content loading..."
      />
      
      <aside className="suggestions-panel skeleton-panel" aria-label="Suggestions panel loading">
        <div className="suggestion-header-skeleton" />
        {[0, 1, 2].map((index) => (
          <div key={index} className="suggestion-item skeleton-suggestion">
            <div className="suggestion-tier-indicator skeleton-tier" />
            <div className="suggestion-content">
              <div className="suggestion-text skeleton-line" />
              <div className="suggestion-actions skeleton-line-action" />
            </div>
          </div>
        ))}
      </aside>
    </div>
  );
}
