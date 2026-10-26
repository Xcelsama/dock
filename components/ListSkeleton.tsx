// Placeholder rows shown while the first list is on its way, so the page has
// its final shape from the first paint instead of a lone "Loading…".
export default function ListSkeleton() {
  return (
    <div className="flex flex-col gap-2" role="status" aria-label="Loading your items">
      <span className="sr-only">Loading your items…</span>
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          aria-hidden="true"
          className="flex animate-pulse items-start gap-3 rounded-md border border-border bg-surface p-3"
        >
          <div className="h-8 w-8 shrink-0 rounded-sm bg-surfaceRaised" />
          <div className="min-w-0 flex-1 space-y-2 pt-1">
            <div className="h-3.5 w-2/5 rounded-sm bg-surfaceRaised" />
            <div className="h-3 w-1/4 rounded-sm bg-surfaceRaised" />
          </div>
        </div>
      ))}
    </div>
  );
}
