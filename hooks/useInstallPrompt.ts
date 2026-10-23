"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";

/**
 * Installation and offline readiness.
 *
 * The app can be installed, and it works offline — but neither fact is
 * visible to a writer unless something in the interface says so. A browser
 * that offers an install prompt will not show it on its own; it fires
 * `beforeinstallprompt` and waits for the page to call `prompt()`. So the
 * event is captured here and the settings dialog offers the install itself.
 *
 * The same place reports whether the app is actually ready to open with no
 * network, because a writer who has been told "install this" and then finds
 * it needs the wifi has been misled.
 */

/**
 * The event Chrome and Edge fire when the app meets their installability
 * criteria. It is not in TypeScript's DOM library yet, so it is declared
 * here rather than cast at every use.
 */
export interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

const INSTALLED_QUERY = "(display-mode: standalone), (display-mode: window-controls-overlay), (display-mode: minimal-ui)";

function subscribeInstalled(onChange: () => void): () => void {
  if (typeof window === "undefined" || !window.matchMedia) return () => {};
  const query = window.matchMedia(INSTALLED_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

function getInstalled(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia(INSTALLED_QUERY).matches;
}

/** The server has no way to know, and the app renders the same either way. */
function getInstalledOnServer(): boolean {
  return false;
}

export interface InstallState {
  /** The browser has offered an install and it has not been used yet. */
  canInstall: boolean;
  /** The app is running as an installed app rather than in a browser tab. */
  installed: boolean;
  /** Ask the browser to install. Resolves to the outcome, or "unavailable". */
  install: () => Promise<"accepted" | "dismissed" | "unavailable">;
}

export function useInstallPrompt(): InstallState {
  const [event, setEvent] = useState<InstallPromptEvent | null>(null);
  const installed = useSyncExternalStore(subscribeInstalled, getInstalled, getInstalledOnServer);

  useEffect(() => {
    // The event is only useful if the page calls prompt() during the
    // interaction, so the default is suppressed and the choice is offered
    // in the settings instead.
    const onBeforeInstall = (raw: Event) => {
      raw.preventDefault();
      setEvent(raw as InstallPromptEvent);
    };
    const onInstalled = () => setEvent(null);
    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const install = useCallback(async (): Promise<"accepted" | "dismissed" | "unavailable"> => {
    if (!event) return "unavailable";
    try {
      await event.prompt();
      const choice = await event.userChoice;
      if (choice.outcome === "accepted") setEvent(null);
      return choice.outcome;
    } catch {
      return "unavailable";
    }
  }, [event]);

  return { canInstall: Boolean(event), installed, install };
}
