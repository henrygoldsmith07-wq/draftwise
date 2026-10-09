# Evaluation

Draftwise has three regression corpora, a held-out blind corpus and an
operational benchmark, and they serve different purposes.

| Corpus | Purpose | Tuned against? |
| --- | --- | --- |
| `evaluation/corpus.json` | Deterministic regression corpus with labelled expectations | Yes |
| `evaluation/clean-prose.json` | Clean-text false-positive corpus | Yes |
| `evaluation/dev-corpus.json` | Development register corpus (essay, chat, mixed) | Yes |
| `evaluation/context-corpus.json` | Structured, ambiguous, meaning-risk and overlapping cases | Yes |
| `evaluation/blind-corpus.json` | **Held out.** Independent signal | **No** |

## The context corpus

`corpus.json` is made of single-line, single-clause sentences. Real drafts are
not: they have headings, lists, quotations and code, they contain sentences where
a plausible suggestion would damage the meaning, and they produce findings that
overlap on the same span. None of that was covered, so the main corpus reported
1.0 precision on inputs it never exercised.

`context-corpus.json` adds those shapes. Each case carries a `notes` field
explaining what it exists to prove, and three cases carry a `conflict` field
describing how two findings interact — because a suggestion engine that produces
two correct findings on one span and then silently drops one is worse than one
that produces one.

Fields the other corpora do not use:

- `dialect` — which spelling is in force. "Correct British spelling produces
  nothing" is meaningless without it, and the original corpus only ever asserted
  that US spellings *are* flagged under a GB preference. A rule that flagged
  every British word would have scored perfectly.
- `preferences` — per-case style preferences, so terminology and protected-span
  behaviour is testable.
- `acceptable` — outcomes that are defensible but not required, so an ambiguous
  case is not scored as a miss when the engine makes the other reasonable call.
- `conflict` — the interaction between two findings on the same text.

The context corpus is reported as its own block rather than averaged into the
headline number. It is deliberately harder and its expectations are stricter, so
folding it in would hide a regression in either direction and make the headline
incomparable with every previous run.

## Reading the numbers

**Precision** is measured on *displayed* suggestions, not raw detections. The
engine deliberately holds some findings back to keep the review list usable, so a
raw-detector precision would describe something the writer never sees.

**Recall** is measured against labelled expectations. A case marked `acceptable`
with an outcome the engine chose is not counted as a miss.

**False-positive rate** counts objective error categories only (spelling,
grammar, punctuation, capitalization). A stylistic opinion is not a false
positive — see below.

**Suppression** is reported by reason, never as a single total. A finding held
back by a cap is a different product decision from one held back as
register-irrelevant, and the writer can inspect both in "Hidden findings".

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

1. ~~Fix the two spelling defects on the development corpus, not here.~~ **Done.**
   `settling` → `setting` and `won` → `own` were the fuzzy suggester reaching past
   valid words for the nearest shape in the compact lexicon. Both words and their
   inflections are now recognised, which stops the fuzzy path from being consulted
   at all — the only place the suggestion was made.
2. ~~Make register affect density: casual text should not be asked to end every
   fragment, and sentence-start capitalisation should be less eager.~~ **Done for
   density.** A casual audience or tone now scales the objective and improve tier
   caps down (0.6), and a narrative intent to 0.8. On the casual probe sentence
   below, the displayed list fell from 7 findings to 1. The findings themselves
   are unchanged and still inspectable under "Hidden findings", where they are now
   labelled `register-budget` rather than a generic density cap. The per-rule
   eagerness of `capitalization-sentence-start` and
   `punctuation-missing-terminal` is untouched and remains the largest single
   source of blind-corpus noise.
3. Expand the blind corpus. 2,377 words is enough to find problems, not enough to
   trust a rate.

## Investigated and deliberately not changed

A finding strictly contained inside another finding is discarded by the merge:
`recieve the package today.` produces a spelling finding over `[0,7]` and, in
principle, a capitalisation finding over `[0,1]`, and only the spelling one
survives. That looks like a defect — accepting the spelling fix would leave
`Recieve` mis-cased.

It is not. Accepting any suggestion re-analyses the document, and on the
re-analysed text (`receive the package today.`) the capitalisation finding is no
longer shadowed and appears normally. The containment is temporary by
construction, so nothing is permanently hidden.

Changing it was attempted and reverted. Keeping contained findings broke the
merge contract the project already asserts in
`tests/analysis-pipeline.test.mjs` — a stronger overlapping finding suppressing a
weaker one is the documented behaviour, and containment is a special case of
overlap. The intent behind it is preserved as the case
`overlap-spelling-capitalisation-01` in `evaluation/context-corpus.json`, with
`acceptable` recording that the current behaviour is correct so the point cannot
be re-litigated without new evidence.
