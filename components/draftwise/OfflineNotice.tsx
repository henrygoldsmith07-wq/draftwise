"use client";

import { CloudOff } from "lucide-react";

/**
 * The offline notice.
 *
 * Draftwise's checks run in the browser, so losing the network costs the
 * writer nothing that matters: the rules, the scores, the outline and the
 * local rewrite previews all keep working. Only a provider call needs a
 * connection. This says exactly that, instead of leaving a writer to wonder
 * why the AI button went quiet.
 */
export function OfflineNotice({ online }: { online: boolean }) {
  if (online) return null;
  return (
    <div className="offline-notice" role="status">
      <CloudOff size={15} aria-hidden="true" />
      <span>
        You are offline. Draftwise keeps checking your draft locally — only AI
        suggestions need a connection.
      </span>
    </div>
  );
}
