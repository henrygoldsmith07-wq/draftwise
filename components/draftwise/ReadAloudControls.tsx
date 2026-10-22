"use client";

import { Headphones, Pause, Play, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ReadAloudController } from "@/hooks/useReadAloud";

/**
 * The editor's read-aloud control.
 *
 * Three states, never more: not reading (one button), reading (pause, stop,
 * progress), paused (resume, stop, progress). Everything is icon-only with an
 * accessible name, because the toolbar already carries enough words, and the
 * keyboard writer who triggers this needs the state in the accessibility tree
 * rather than only in the pixels.
 *
 * A browser with no speech engine gets a disabled control that says why. The
 * alternative — a button that looks live and does nothing — is the failure mode
 * this whole product is against.
 */
export function ReadAloudControls({ controller, hasText, disabled }: {
  controller: ReadAloudController;
  hasText: boolean;
  disabled?: boolean;
}) {
  const { supported, status, position, total } = controller;
  const unavailable = !supported
    ? "This browser cannot read text aloud: it has no speech voices installed."
    : !hasText
      ? "Write something first, then listen to it."
      : undefined;
  // "Reading 0 of 9" between the click and the engine's first sound is a lie the
  // writer can see; while the engine spins up, say what is actually happening.
  const progress = status === "idle"
    ? ""
    : position === 0
      ? "Preparing…"
      : `${status === "paused" ? "Paused" : "Reading"} ${position} of ${total}`;

  return (
    <span className="read-aloud">
      {status === "idle" ? (
        // The accessible name starts with the visible word on purpose: axe's
        // label-content-name-mismatch requires the name to contain the button's
        // visible text, and "Listen" alone does not say what will be read.
        <Button
          className="read-aloud-start"
          variant="ghost"
          size="sm"
          disabled={disabled || Boolean(unavailable)}
          title={unavailable}
          aria-label="Listen to the draft"
          onClick={controller.start}
        >
          <Headphones size={14} aria-hidden="true" />
          <span>Listen</span>
        </Button>
      ) : (
        <>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={status === "paused" ? "Resume reading" : "Pause reading"}
            onClick={status === "paused" ? controller.resume : controller.pause}
          >
            {status === "paused" ? <Play size={14} aria-hidden="true" /> : <Pause size={14} aria-hidden="true" />}
          </Button>
          <Button variant="ghost" size="icon-xs" aria-label="Stop reading" onClick={controller.stop}>
            <Square size={13} aria-hidden="true" />
          </Button>
          <span className="read-aloud-status" aria-hidden="true">{progress}</span>
        </>
      )}
      {/* The visual label and the announcement differ on purpose: a screen
          reader user should hear "Reading 2 of 9" once, when it changes, not
          have the toolbar re-announce on every segment. */}
      <span className="sr-only" role="status" aria-live="polite">{controller.message}</span>
    </span>
  );
}
