/**
 * Lightweight, dependency-free constants and error classes shared by the
 * provider adapter and its callers.
 *
 * These used to live in index.ts, which pulls in the whole local analysis
 * engine. The web app imports the constants on first paint (for settings
 * fingerprints and error checks) even when AI is off, so they are split out
 * here. index.ts re-exports them, preserving the public API and, crucially,
 * a single ProviderError class identity for `instanceof` checks.
 */
import type { ClassifierErrorCode, ProviderErrorCode } from "../../types/src/index.js";

export const PROVIDER_CONCURRENCY = 3;
export const MAX_AI_CHUNKS_PER_ANALYSIS = 10;
export const MAX_AI_CHARS_PER_ANALYSIS = 50_000;

export const CLASSIFIER_MAX_EXCERPT_CHARS = 500;
export const CLASSIFIER_MAX_BATCH_CHUNKS = 100;
export const CLASSIFIER_BATCH_SIZES = [5, 10, 25, 50, 100] as const;

export const TRIAGE_LABEL_FORMULATIONS = {
  "semantic-v2": [
    "The local writing checks are sufficient; no semantic AI review is needed.",
    "A semantic AI writing review would likely find useful issues the local checks cannot reliably detect.",
  ],
  "direct-v1": [
    "Local writing checks are sufficient.",
    "Semantic AI review would likely add useful feedback.",
  ],
  "explicit-v1": [
    "No additional semantic review is needed beyond the local writing checks.",
    "A semantic writing model would likely identify useful issues the local checks cannot reliably detect.",
  ],
  "compact-v1": [
    "Local checks are enough for this passage.",
    "An AI writing review would likely add useful feedback.",
  ],
} as const;
export type TriageLabelFormulationId = keyof typeof TRIAGE_LABEL_FORMULATIONS;
export const TRIAGE_LABEL_FORMULATION_ID: TriageLabelFormulationId = "semantic-v2";
export const CLASSIFIER_TRIAGE_LABELS = TRIAGE_LABEL_FORMULATIONS[TRIAGE_LABEL_FORMULATION_ID];

export interface TriageConfidenceThresholds {
  aiNeeded: number;
  locallySufficient: number;
}
export const TRIAGE_CONFIDENCE_THRESHOLDS: TriageConfidenceThresholds = {
  aiNeeded: 0.75,
  locallySufficient: 0.80,
};

export class ProviderError extends Error {
  readonly code: ProviderErrorCode;
  readonly status?: number;

  constructor(code: ProviderErrorCode, message: string, status?: number) {
    super(message);
    this.code = code;
    this.status = status;
    this.name = "ProviderError";
  }
}

export class ClassifierError extends Error {
  readonly code: ClassifierErrorCode;
  readonly status?: number;

  constructor(code: ClassifierErrorCode, message: string, status?: number) {
    super(message);
    this.code = code;
    this.status = status;
    this.name = "ClassifierError";
  }
}
