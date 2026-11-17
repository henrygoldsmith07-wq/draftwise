"use client";

/**
 * Skeleton loader for document dashboard view.
 * Shows loading placeholders while documents are being fetched.
 *
 * The markup mirrors the loaded DocumentDashboard chrome (full-view →
 * full-view-heading → dashboard-toolbar → document-grid), so the real UI drops
 * into the same layout instead of jumping when it replaces this skeleton.
 */
export function DocumentDashboardSkeleton() {
  return (
    <section className="full-view" aria-busy="true">
      <div className="full-view-heading">
        <div>
          <span className="skeleton-line w-24 mb-2" data-testid="skeleton-eyebrow" />
          <span className="skeleton-line w-72" data-testid="skeleton-title" />
          <span className="skeleton-line w-96 mt-3" data-testid="skeleton-description" />
        </div>
        <div className="heading-actions">
          <span className="skeleton-line w-28" data-testid="skeleton-actions" />
        </div>
      </div>

      <div className="dashboard-toolbar" data-testid="skeleton-toolbar">
        <div className="dashboard-search">
          <span className="skeleton-line w-full" />
        </div>
        <span className="skeleton-line w-24" />
      </div>

      <div className="document-grid" aria-hidden="true">
        {[0, 1, 2, 3].map((index) => (
          <article key={index} className="document-card skeleton-card">
            <span className="skeleton-line skeleton-line-title" data-testid={`skeleton-card-${index}-title`} />
            <span className="skeleton-line" data-testid={`skeleton-card-${index}-excerpt`} />
            <span className="skeleton-line skeleton-line-short" data-testid={`skeleton-card-${index}-meta`} />
            <span className="skeleton-line skeleton-line-short" data-testid={`skeleton-card-${index}-actions`} />
          </article>
        ))}
      </div>
    </section>
  );
}
