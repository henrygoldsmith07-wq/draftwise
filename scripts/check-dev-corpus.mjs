import { readFile } from "node:fs/promises";
const { analyzeLocally } = await import("../packages/grammar/src/index.ts");
const corpus = JSON.parse(await readFile(new URL("../evaluation/dev-corpus.json", import.meta.url), "utf8"));
for (const ex of corpus) {
  const r = analyzeLocally(ex.text, { dialect: "en-GB" }, ex.goals);
  const missing = [];
  const found = [];
  for (const exp of ex.expected) {
    const hit = r.issues.find((i) => i.category === exp.category && (!exp.original || i.original === exp.original));
    if (hit) found.push(hit.ruleId); else missing.push(exp);
  }
  const unexpected = r.issues.filter((i) => !(ex.expected || []).some((e) => e.category === i.category && (!e.original || e.original === i.original)));
  console.log(ex.id, "raw=" + r.issues.length, "found=" + found.length + "/" + ex.expected.length,
    missing.length ? "MISSING " + JSON.stringify(missing) : "",
    unexpected.length ? "| extra: " + unexpected.map((u) => u.ruleId + "(" + u.original + ")").join(", ") : "");
}
