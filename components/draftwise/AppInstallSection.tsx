"use client";

import { useState, useSyncExternalStore } from "react";
import { Check, Download, HardDriveDownload, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useInstallPrompt } from "@/hooks/useInstallPrompt";
import {
  describeOfflineReadiness,
  getServiceWorkerServerState,
  getServiceWorkerState,
  subscribeServiceWorker,
} from "@/lib/service-worker";

/**
 * The app's own install and offline status.
 *
 * Everything else in the settings describes what Draftwise will do with a
 * draft. This describes what the app itself can do: whether it can be
 * installed, and whether it opens with no network.
 *
 * It is here rather than in a banner because it is a fact, not an alarm.
 * A writer who installs Draftwise and later opens it on a train should not
 * have to wonder whether the app worked — and a writer who has not installed
 * it should at least be able to find out that they can.
 */
export function AppInstallSection() {
  const workerState = useSyncExternalStore(
    subscribeServiceWorker,
    getServiceWorkerState,
    getServiceWorkerServerState,
  );
  const { canInstall, installed, install } = useInstallPrompt();
  const [message, setMessage] = useState<string | null>(null);

  const readiness = describeOfflineReadiness(workerState, installed);
  const Icon = readiness.tone === "ready" ? Check : readiness.tone === "pending" ? HardDriveDownload : WifiOff;

  return (
    <div className="app-install">
      <div className="writing-profile-heading">
        <strong>The app</strong>
        <span>{readiness.detail}</span>
      </div>
      <div className="app-install-status" data-state={readiness.tone}>
        <Icon size={14} aria-hidden="true" />
        <span>{readiness.label}</span>
      </div>
      {canInstall && !installed ? (
        <div className="writing-profile-transfer">
          <Button
            size="sm"
            variant="outline"
            onClick={async () => {
              const outcome = await install();
              setMessage(
                outcome === "accepted"
                  ? "Draftwise is installed. Open it from your device like any other app."
                  : outcome === "dismissed"
                    ? "No problem — you can install it later from here."
                    : "This browser would not open the install prompt.",
              );
            }}
          >
            <Download size={13} /> Install Draftwise
          </Button>
        </div>
      ) : null}
      {message ? <p className="writing-profile-transfer-message" role="status">{message}</p> : null}
    </div>
  );
}
