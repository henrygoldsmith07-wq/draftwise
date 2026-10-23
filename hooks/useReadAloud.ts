"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { chooseVoice, speechSegments, type SpeechSegment, type VoiceLike } from "@/lib/read-aloud";
import type { Dialect } from "@/packages/types/src";

export type ReadAloudStatus = "idle" | "speaking" | "paused";

export interface ReadAloudController {
  /** False when the browser exposes no speech engine, or no voice is installed. */
  supported: boolean;
  status: ReadAloudStatus;
  /** 1-based index of the segment being read; 0 while the engine starts. */
  position: number;
  total: number;
  /** Draft offsets of the segment being read, for the editor highlight. */
  range: { start: number; end: number } | null;
  /** Spoken status copy for the live region; empty when there is nothing to say. */
  message: string;
  start: () => void;
  pause: () => void;
  resume: () => void;
  stop: () => void;
}

/**
 * Browser capability is external state, so it is read rather than mirrored into
 * a state variable from an effect.
 */
function speechApiPresent() {
  if (typeof window === "undefined") return false;
  return Boolean(window.speechSynthesis) && typeof window.SpeechSynthesisUtterance === "function";
}

function installedVoiceCount() {
  if (typeof window === "undefined" || !window.speechSynthesis) return 0;
  return window.speechSynthesis.getVoices().length;
}

/**
 * Voices arrive asynchronously on several platforms. The list is not cached
 * here: the button only needs to know whether any voice exists at all, and the
 * utterance asks the engine for the actual voice when it starts.
 */
function subscribeToVoices(onChange: () => void) {
  if (typeof window === "undefined") return () => {};
  const engine = window.speechSynthesis;
  if (!engine?.addEventListener) return () => {};
  const handle = () => onChange();
  engine.addEventListener("voiceschanged", handle);
  // Some engines finish loading before this listener exists, and would then
  // never fire again. Re-read once on the next tick so the control cannot stay
  // disabled for a browser that does have voices.
  const timer = window.setTimeout(handle, 0);
  return () => {
    window.clearTimeout(timer);
    engine.removeEventListener("voiceschanged", handle);
  };
}

/**
 * Read the draft aloud with the browser's own speech engine.
 *
 * Everything here exists to keep one promise: what the highlight says is what
 * the ear hears, and stopping always stops. The browser APIs are old and
 * uneven, so the states are driven by a run token rather than by trusting
 * event ordering — Chrome fires the previous utterance's `end` after
 * `cancel()`, and an `end` from a cancelled run would otherwise advance the
 * highlight into a draft that is no longer being read.
 *
 * Nothing leaves the browser: the engine is local, and the draft is only ever
 * handed to `SpeechSynthesisUtterance`.
 */
export function useReadAloud({ text, dialect }: { text: string; dialect: Dialect }): ReadAloudController {
  // A browser that exposes the API but has no installed voice cannot read
  // anything: speaking would fail silently and the control would sit on
  // "Preparing…" forever. Both conditions have to hold for the button to be
  // live, and when they do not, the control says why instead of pretending.
  const supported = useSyncExternalStore(
    subscribeToVoices,
    () => speechApiPresent() && installedVoiceCount() > 0,
    () => false,
  );
  const [status, setStatus] = useState<ReadAloudStatus>("idle");
  const [position, setPosition] = useState(0);
  const [total, setTotal] = useState(0);
  const [range, setRange] = useState<{ start: number; end: number } | null>(null);
  const [message, setMessage] = useState("");

  const segmentsRef = useRef<SpeechSegment[]>([]);
  const runRef = useRef(0);
  const spokenTextRef = useRef<string | null>(null);

  const cancelEngine = useCallback(() => {
    if (typeof window === "undefined" || !window.speechSynthesis) return;
    window.speechSynthesis.cancel();
  }, []);

  const reset = useCallback((announcement: string) => {
    runRef.current += 1;
    spokenTextRef.current = null;
    segmentsRef.current = [];
    cancelEngine();
    setStatus("idle");
    setPosition(0);
    setRange(null);
    setMessage(announcement);
  }, [cancelEngine]);

  const speakFrom = useCallback((index: number, run: number) => {
    const engine = typeof window === "undefined" ? null : window.speechSynthesis;
    if (!engine || run !== runRef.current) return;

    // A local recursive reader, so advancing to the next segment does not need
    // a callback that refers to itself before it exists.
    const speakSegment = (current: number) => {
      if (run !== runRef.current) return;
      const segments = segmentsRef.current;
      if (current >= segments.length) {
        reset("");
        setMessage("Finished reading the draft.");
        return;
      }
      const segment = segments[current];
      const utterance = new window.SpeechSynthesisUtterance(segment.spoken);
      const voice = chooseVoice(engine.getVoices() as unknown as VoiceLike[], dialect);
      if (voice) {
        utterance.voice = voice as SpeechSynthesisVoice;
        utterance.lang = voice.lang;
      }
      utterance.onstart = () => {
        if (run !== runRef.current) return;
        setStatus("speaking");
        setPosition(current + 1);
        setRange({ start: segment.start, end: segment.end });
      };
      utterance.onend = () => {
        if (run !== runRef.current) return;
        speakSegment(current + 1);
      };
      utterance.onerror = (event) => {
        if (run !== runRef.current) return;
        // `cancel` and `interrupt` are how a stopped run ends; they are not
        // failures and must not be announced as one.
        if (event.error === "canceled" || event.error === "interrupted") return;
        reset("");
        setMessage("Your browser could not read this draft aloud.");
      };
      engine.speak(utterance);
    };

    speakSegment(index);
  }, [dialect, reset]);

  const start = useCallback(() => {
    const segments = speechSegments(text);
    if (!segments.length) {
      setMessage("There is nothing to read yet.");
      return;
    }
    const run = runRef.current + 1;
    runRef.current = run;
    segmentsRef.current = segments;
    spokenTextRef.current = text;
    setTotal(segments.length);
    setPosition(0);
    setRange(null);
    setStatus("speaking");
    setMessage(`Reading ${segments.length} ${segments.length === 1 ? "passage" : "passages"} aloud.`);
    // Cancelling the previous run and speaking in the same task makes Chrome
    // drop the new utterance, so the first one is queued for the next tick.
    cancelEngine();
    window.setTimeout(() => speakFrom(0, run), 0);
  }, [cancelEngine, speakFrom, text]);

  const pause = useCallback(() => {
    if (typeof window === "undefined" || !window.speechSynthesis) return;
    window.speechSynthesis.pause();
    setStatus("paused");
    setMessage("Reading paused.");
  }, []);

  const resume = useCallback(() => {
    if (typeof window === "undefined" || !window.speechSynthesis) return;
    window.speechSynthesis.resume();
    setStatus("speaking");
    setMessage("Reading resumed.");
  }, []);

  const stop = useCallback(() => {
    reset("");
    setMessage("Reading stopped.");
  }, [reset]);

  // Editing while the engine reads a stale snapshot would leave the highlight
  // pointing at text that has moved. Stopping is the honest response, and it
  // says why rather than going quiet. The check runs on the draft, not on
  // render, so a writer who keeps typing is not interrupted once per keystroke.
  useEffect(() => {
    if (spokenTextRef.current === null) return;
    if (text === spokenTextRef.current) return;
    reset("Reading stopped because the draft changed.");
  }, [reset, text]);

  // Speech outlives the component: leaving the editor or switching documents
  // must not leave a voice reading the previous draft.
  useEffect(() => () => { cancelEngine(); }, [cancelEngine]);

  return { supported, status, position, total, range, message, start, pause, resume, stop };
}
