/**
 * Short relative timestamps ("just now", "3 min ago", "2 days ago").
 *
 * Shared because three surfaces say it: the document dashboard, the backup
 * age in settings, and the reminder banner's word counts sit beside it.
 * Time-injectable so tests pin the boundaries without clocks.
 */
export function formatRelativeTime(timestamp: number, now: number = Date.now()): string {
  const elapsed = now - timestamp;
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}
