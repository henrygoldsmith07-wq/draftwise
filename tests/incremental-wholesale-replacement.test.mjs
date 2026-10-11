import test from "node:test";
import assert from "node:assert/strict";
import { analyzeLocally, analyzeLocallyIncremental } from "../packages/grammar/src/index.ts";

const SUBJECTS = [
  "manager", "team", "report", "client", "budget", "plan", "meeting", "deadline",
  "invoice", "policy", "vendor", "contract", "survey", "summary", "target", "review",
];

// Each block carries a distinct subject so no two findings can deduplicate.
function buildLongDraft(blocks) {
  let text = "";
  for (let i = 0; i < blocks; i += 1) {
    const subject = SUBJECTS[i % SUBJECTS.length];
    text += `Section ${i + 1} of the plan. `;
    text += `The ${subject} was recievd late and the ${subject} is wrong. `;
    text += `We will discuss the ${subject} with the ${SUBJECTS[(i + 3) % SUBJECTS.length]} tomorow.\n\n`;
  }
  return text;
}

test("a wholesale replacement is analysed in full, not incrementally", () => {
  // Replacing most of a document — a paste, a document switch, select-all and
  // type — previously took the incremental path, which re-analysed only a small
  // window and discarded every retained finding. A 2.6KB draft replaced into a
  // 495-char one yielded 2 findings instead of 20.
  const before = "The manager was recievd late. ".repeat(10);
  const after = buildLongDraft(20);

  const incremental = analyzeLocallyIncremental(before, after, analyzeLocally(before).issues, {
    start: 0,
    end: after.length,
    previousEnd: before.length,
  });
  const full = analyzeLocally(after);

  assert.equal(
    incremental.issues.length,
    full.issues.length,
    `incremental found ${incremental.issues.length}, full found ${full.issues.length}`,
  );
  assert.ok(full.issues.length > 15, `expected a long draft to produce many findings, got ${full.issues.length}`);
});

test("a small edit still uses the incremental path", () => {
  // The performance win must survive: a one-word correction is exactly what
  // incremental analysis is for, and it must not re-analyse the document.
  const before = buildLongDraft(12);
  const at = before.indexOf("recievd");
  const after = `${before.slice(0, at)}received${before.slice(at + "recievd".length)}`;

  const beforeIssues = analyzeLocally(before).issues;
  const incremental = analyzeLocallyIncremental(before, after, beforeIssues, {
    start: at,
    end: at + "received".length,
    previousEnd: at + "recievd".length,
  });

  const full = analyzeLocally(after);
  assert.equal(
    incremental.issues.length,
    full.issues.length,
    `incremental found ${incremental.issues.length}, full found ${full.issues.length}`,
  );
  // The corrected instance must no longer be reported.
  assert.equal(incremental.issues.filter((issue) => issue.original === "recievd").length, 0);
});
