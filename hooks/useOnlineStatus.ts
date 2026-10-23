"use client";

import { useEffect, useState } from "react";

/**
 * Whether the browser currently believes it has a network.
 *
 * The point of this is not to report the browser's opinion — it is to stop
 * the writer from wondering why the AI button is not doing anything. Every
 * local check keeps working offline, and the only thing that needs a
 * connection is a provider call. Saying so is more useful than a silent
 * failure.
 *
 * The initial value is `true` rather than the real value so the server and
 * the first client render agree. A writer who is offline sees the notice a
 * moment later rather than a layout that jumps.
 */
export function useOnlineStatus(): boolean {
  const [online, setOnline] = useState(true);

  useEffect(() => {
    if (typeof navigator === "undefined") return;
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  return online;
}
