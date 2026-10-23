"use client";

/**
 * Skeleton loader for document dashboard view.
 * Shows loading placeholders while documents are being fetched.
 */
export function DocumentDashboardSkeleton() {
  return (
    <section className="full-view" aria-busy="true">
      <div className="full-view-heading">
        <div className="eyebrow-skeleton" data-testid="skeleton-eyebrow" />
        <div className="title-skeleton" data-testid="skeleton-title" />
        <div className="description-skeleton" data-testid="skeleton-description" />
        <div className="heading-actions-skeleton" data-testid="skeleton-actions" />
      </div>
      
      <div className="dashboard-toolbar-skeleton" data-testid="skeleton-toolbar" />
      
      <div className="document-grid">
        {[0, 1, 2, 3].map((index) => (
          <article key={index} className="document-card skeleton-card">
            <div className="card-content">
              <div className="skeleton-line skeleton-line-title" data-testid={`skeleton-card-${index}-title`} />
              <div className="skeleton-line" data-testid={`skeleton-card-${index}-excerpt`} />
              <div className="skeleton-line skeleton-line-short" data-testid={`skeleton-card-${index}-meta`} />
            </div>
            <div className="skeleton-line-action" data-testid={`skeleton-card-${index}-actions`} />
          </article>
        ))}
      </div>
    </section>
  );
}
