"use client";

/**
 * Skeleton loader for editor workspace view.
 * Shows loading placeholders while the editor is being initialized.
 *
 * Mirrors the loaded EditorWorkspace layout — a workspace-grid with an editor
 * column (heading, goal bar, editor card and toolbar) and a suggestions column
 * — so the real UI replaces it without a layout jump. The editor surface uses
 * shimmer lines instead of a bare textarea.
 */
export function EditorSkeleton() {
  return (
    <div className="workspace-grid" aria-busy="true">
      <section className="editor-column">
        <div className="workspace-heading">
          <div>
            <span className="skeleton-line w-28 mb-2" />
            <span className="skeleton-line w-80" />
          </div>
          <div className="heading-actions">
            <span className="skeleton-line w-16" />
            <span className="skeleton-line w-16" />
            <span className="skeleton-line w-24" />
          </div>
        </div>

        <div className="goal-bar">
          <span className="skeleton-line w-24" />
          <span className="skeleton-line w-24" />
          <span className="skeleton-line w-24" />
          <span className="skeleton-line w-24" />
        </div>

        <div className="editor-card">
          <div className="editor-toolbar">
            <div className="editor-toolbar-left">
              <span className="skeleton-line w-10" />
              <span className="skeleton-line w-10" />
              <span className="skeleton-line w-24" />
            </div>
            <div className="editor-toolbar-right">
              <span className="skeleton-line w-32" />
            </div>
          </div>

          <div className="editor-scroll-wrap">
            <div className="editor-input flex flex-col gap-4">
              <span className="skeleton-line skeleton-line-title" />
              <span className="skeleton-line" />
              <span className="skeleton-line" />
              <span className="skeleton-line" />
              <span className="skeleton-line skeleton-line-short" />
              <span className="skeleton-line" />
              <span className="skeleton-line skeleton-line-short" />
            </div>
          </div>

          <div className="editor-footer">
            <span className="skeleton-line w-48" />
            <span className="skeleton-line w-32" />
          </div>
        </div>
      </section>

      <aside className="suggestions-column" aria-label="Suggestions panel loading">
        <div className="suggestions-header">
          <div>
            <span className="skeleton-line w-24 mb-2" />
            <span className="skeleton-line w-40" />
          </div>
          <span className="skeleton-line w-7" />
        </div>

        <div className="suggestions-list">
          {[0, 1, 2].map((index) => (
            <div key={index} className="suggestion-card">
              <div className="suggestion-main">
                <div className="suggestion-heading">
                  <span className="skeleton-line w-4" />
                  <span className="skeleton-line w-32" />
                </div>
                <span className="skeleton-line" />
                <span className="skeleton-line skeleton-line-short" />
              </div>
              <div className="suggestion-actions">
                <span className="skeleton-line w-16" />
                <span className="skeleton-line w-16" />
              </div>
            </div>
          ))}
        </div>
      </aside>
    </div>
  );
}
