import type {
  AnalysisDiagnostics,
} from "../../types/src/index.js";

export function analysisNow() {
  return typeof performance !== "undefined" && typeof performance.now === "function" ? performance.now() : Date.now();
}

function diagnosticsEnabled() {
  const runtime = globalThis as typeof globalThis & { DraftwiseDebug?: boolean };
  if (runtime.DraftwiseDebug === true) return true;
  return typeof process !== "undefined" && process.env?.NODE_ENV !== "production";
}

export function createAnalysisDiagnostics(
  issueCount: number,
  startedAt: number,
  engine: AnalysisDiagnostics["engine"],
  details: Partial<Omit<AnalysisDiagnostics, "processingMs" | "issueCount" | "engine">> = {},
): AnalysisDiagnostics | undefined {
  if (!diagnosticsEnabled()) return undefined;
  return {
    processingMs: Math.max(0, Math.round((analysisNow() - startedAt) * 100) / 100),
    issueCount,
    engine,
    ...details,
  };
}
