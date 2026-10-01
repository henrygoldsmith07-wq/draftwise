# Evaluation

Draftwise has two evaluation corpora plus an operational benchmark, and they serve
different purposes.

| Corpus | Purpose | Tuned against? |
| --- | --- | --- |
| `evaluation/corpus.json` | Deterministic regression corpus with labelled expectations | Yes |
| `evaluation/clean-prose.json` | Clean-text false-positive corpus | Yes |
| `evaluation/blind-corpus.json` | **Held out.** Independent signal | **No** |

## Why a blind corpus exists

The tuned corpus reports precision 1.0, recall 1.0 and **zero** false positives per
1,000 words. A perfectly clean score across 507 examples is not evidence that the
rules are correct. It is evidence that the rules were fitted to those examples.

Real prose is not like the tuned corpus. The tuned examples are short, formal,
single-clause sentences. Ordinary writing contains passive constructions, long
multi-clause sentences, lowercase chat register, abbreviations and incomplete
thoughts. Those are exactly the inputs the tuned corpus never exercises.

`evaluation/blind-corpus.json` exists to measure the difference.

## Discipline

The blind corpus is only useful while nobody tunes against it. If a rule threshold,
lexicon entry or scoring constant is changed in response to a blind result, the
examples it was measured on become training data and the next measurement stops
being independent.

Rules for working on this repository:

- Fix defects reported by the blind run on `evaluation/corpus.json` or a new
  **development** set, never on the blind examples.
- Prefer changes that are justified by the writing principle rather than by the
  example that failed.
- Treat a blind regression as a signal to investigate, not a number to restore.
- If blind examples must change, add new ones and record why; do not silently
  delete the example that exposed a defect.

## Measuring false positives honestly

A false positive is not "any suggestion a writer did not ask for". Flagging a
passive construction in an essay is a defensible editorial opinion; a writer may
accept or reject it. Counting that as a false positive produces a meaningless
number and, worse, pushes the tool towards suppressing useful style advice.

The runner therefore splits unrequested suggestions in two:

- **Error false positives** (`spelling`, `grammar`, `punctuation`,
  `capitalization`). The headline product-quality number.
- **Style suggestions** (passive voice, conciseness, clarity, repetition,
  structure, and so on). Tracked separately as a density per 1,000 words.

Both are reported. The `--strict` flag gates the **error** rate only, via
`DRAFTWISE_BLIND_FP_BUDGET`.

## Running it

```bash
npm run evaluate            # tuned corpus, gated
npm run evaluate:blind      # held-out corpus, report only
npm run evaluate:blind -- --strict
```

`evaluate:blind` is wired into CI as a **report**. It does not fail the build.
Binding a gate to the held-out set is precisely what would turn it into a tuning
target, and the current error rate is well outside any budget we would want to
enforce today.

## Current result

Measured on 60 examples / 2,377 words, 49 of them clean text:

| Metric | Value |
| --- | --- |
| Precision (all suggestions) | 0.049 |
| Recall (labelled) | 0.400 |
| Error false positives / 1,000 words | 20.2 |
| Style suggestions / 1,000 words | 29.0 |
| Error false positives / 1,000 words, clean text only | 21.0 |
| Style suggestions / 1,000 words, clean text only | 30.3 |

**This is a finding, not a target.** Read it as: the local engine behaves like a
tool written for edited formal prose, and it is noticeably noisier on ordinary
writing than the tuned corpus suggests.

Error-category false positives on clean text, by rule:

| Count | Rule | Character of the finding |
| --- | --- | --- |
| 20 | `capitalization-sentence-start` | Flags the first letter of chat-register lines ("ok", "haha"). Defensible but noisy. |
| 11 | `punctuation-missing-terminal` | Flags run-on fragments in casual text. |
| 6 | `capitalization-pronoun-i` | `i` → `I` in chat register. Correct, but frequent by construction. |
| 4 | `grammar-subject-verb-agreement` | `There's three` → `There are three`. Correct. |
| 2 | `spelling-lexicon` | **"settling" → "setting", "won" → "own".** These are genuine defects on valid English. |
| 2 | `grammar-confused-its` | `its` → `it's` in casual text. Correct. |
| 2 | `spelling-common-typo` | Missing apostrophes (`dont`, `couldnt`). Correct. |
| 1 | `punctuation-oxford-comma` | Correct. |

Two of these are real defects in the suggester and should be fixed on the
development corpus: "settling" is being corrected to "setting", and "won" (the
past tense of win) is being corrected to "own". The remainder is mostly register
mismatch, where the advice is technically right but the density is too high for
casual writing.

Recall is low (0.4) partly because expectations pin a category and an original
rather than a rule, and partly because the engine does not currently detect many
of the structural problems this corpus contains.

## Suggested next steps

1. Fix the two spelling defects on the development corpus, not here.
2. Make register affect density: casual text should not be asked to end every
   fragment, and sentence-start capitalisation should be less eager.
3. Expand the blind corpus. 2,377 words is enough to find problems, not enough to
   trust a rate.
