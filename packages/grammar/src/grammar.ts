import type {
  StylePreferences,
  WritingIssue,
} from "../../types/src/index.js";
import {
  ARTICLE_AN_EXCEPTIONS,
  ARTICLE_A_SOUND_PREFIXES,
  VERB_HINTS,
} from "./lexicon.ts";
import {
  makeIssue,
  pushIssue,
} from "./issues.ts";
import {
  parseDocument,
} from "./parser.ts";
import {
  preserveCase,
} from "./util.ts";

export function findConfusedWords(text: string, preferences: StylePreferences) {
  const issues: WritingIssue[] = [];
  const patterns: Array<[RegExp, string, string, string, number?]> = [
    [/\b(your)\s+(welcome|going|right|sure)\b/giu, "you're", "grammar-confused-your", "Your is possessive; you’re means you are."],
    // Temporal and additive adverbs almost never sit between a possessive and
    // its noun ("your still able" is always "you're still able"), while
    // intensifiers routinely do ("your very first attempt", "your quite nice
    // garden"), so only the former are checked. "own" is excluded because
    // "your very own" is never in the list and "your own" is possessive.
    [/\b(your)\s+(still|always|never|already|also)\s+(?!own\b)[\p{L}]+/giu, "you're", "grammar-confused-your", "Your is possessive; you’re means you are."],
    // A possessive can never precede "the": determiners do not stack, so
    // "your the best" and "its the last thing" are always the contraction.
    [/\b(your)\s+the\b/giu, "you're", "grammar-confused-your", "Your is possessive; you’re means you are."],
    [/\b(its)\s+(a|an|the|not|been|going)\b/giu, "it's", "grammar-confused-its", "It’s means it is; its shows possession."],
    [/\b(its)\s+(?:almost|nearly|just|really|quite|very|so|pretty|already|finally|always|never|probably|definitely|simply|literally)\s+[\p{L}]+(?=\s+(?:to\b|and\b|but\b|or\b|because\b|though\b|although\b|so\b|then\b))/giu, "it's", "grammar-confused-its", "It’s means it is; its shows possession."],
    [/\b(its)\s+(ready|done|over|finished|fine|great|obvious|clear|unclear|impossible)(?=\s+(?:to\b|and\b|but\b|or\b|because\b)|[.,!?;:]|$)/giu, "it's", "grammar-confused-its", "It’s means it is; its shows possession."],
    // Your/its followed by a bare confusion adjective at the end of the
    // sentence ("Hope your well", "I think its late"). The clause-final
    // position is the whole test: a possessive needs its noun ("your well
    // water", "your late arrival"), so with no noun coming the contraction
    // dominates. Adjectives already covered above (welcome/going/right/sure
    // for your; ready/done/over/… for its) are excluded to avoid flagging
    // the same span twice. Guards: "for your own good" (benefit, not
    // confusion) via for/of, and locative water-wells ("down your well")
    // via the preposition before your.
    [/(?<!\b(?:for|of|down|near|behind|at|to|into|from|by|around|over|under|inside|outside|upon|within|without|toward|towards|off|onto|past)\s)\b(your)\s+(well|wrong|ready|late|early|sick|tired|busy|correct|alright|okay|ok|free|great)(?=\s*[.!?…]|$)/giu, "you're", "grammar-confused-your", "Your is possessive; you’re means you are."],
    [/(?<!\b(?:for|of|down|near|behind|at|to|into|from|by|around|over|under|inside|outside|upon|within|without|toward|towards|off|onto|past)\s)\b(its)\s+(well|wrong|late|early|sick|tired|busy|correct|alright|okay|ok|free)(?=\s*[.!?…]|$)/giu, "it's", "grammar-confused-its", "It’s means it is; its shows possession."],
    [/\b(their)\s+(is|are|was|were|has|have|a|an|not)\b/giu, "there", "grammar-confused-their", "There points to a place or introduces a statement."],
    [/\b(there)\s+(own|idea|ideas|team|house|car|name|responsibility)\b/giu, "their", "grammar-confused-there", "Their shows possession; there points to a place or introduces a statement."],
    [/\b(better|worse|more|less|rather|different)\s+(then)\b/giu, "than", "grammar-confused-than", "Than compares; then describes time or sequence.", 2],
    // A modal verb is never followed by the preposition "of" ("should of
    // called" is "should have called" misheard). The lookbehind keeps the
    // noun reading: in "a must of modern life", must is the thing itself.
    [/(?<!\b(?:a|the|this|that)\s)\b(could|should|would|might|must)\s+(of)\b/giu, "have", "grammar-confused-of", "After a modal verb the word is “have” (“should have called”), not “of”.", 2],
    [/\b(an?|the|this|that)\s+(affect)\b/giu, "effect", "grammar-confused-affect", "Effect is usually the noun for a result; affect is usually the verb.", 2],
    [/\b(to|will|can|may|might|could|does|did)\s+(effect)\b/giu, "affect", "grammar-confused-effect", "Affect is usually the verb meaning to influence; effect is usually the noun.", 2],
    [/\b(to)\s+(much|many|late|long|loud|quiet|far|quickly)\b/giu, "too", "grammar-confused-too", "Too means excessively or also; to usually introduces a destination or verb.", 1],
    [/\b(too)\s+(the|a|an|my|your|our|their)\b/giu, "to", "grammar-confused-to", "To usually introduces a destination or verb; too means excessively or also.", 1],
    [/\b(to)\s+(advice)\b/giu, "advise", "grammar-confused-advice", "Advise is the verb; advice is the noun.", 1],
    [/\b(some|good|useful|professional|sound|bad|wise|best|practical|helpful|excellent|terrible|free|much|any|no|medical|legal|financial|expert|a|an|the|this|that)\s+(advise)\b/giu, "advice", "grammar-confused-advise", "Advice is the noun; advise is the verb.", 2],
    [/\b(to|will|can|may|might|could)\s+(loose)\b/giu, "lose", "grammar-confused-loose", "Lose means misplace or fail to win; loose means not tight.", 2],
    // "ought of" is the same mishearing as "should of": the infinitive
    // marker is "to".
    [/\b(ought)\s+(of)\b/giu, "to", "grammar-confused-of", "After “ought” the word is “to” (“ought to go”), not “of”.", 2],
    // "different than" with a determiner phrase takes "from" ("different
    // from the others"). Bare pronoun and clause followers ("different than
    // I expected") are left alone: the minimal swap would not be minimal.
    [/\bdifferent\s+(than)(?=\s+(?:the|a|an|that|those|these|my|your|his|her|its|our|their)\b)/giu, "from", "grammar-confused-different", "In formal writing use “different from” (“different from the others”), not “different than”.", 1],
    // "Who's car" is always "whose car": who is + noun never reads as
    // who is. The list is possessible nouns only, never verb-forms.
    [/\b(who's)\s+(car|cars|house|houses|home|name|names|idea|ideas|team|teams|fault|brother|sister|mother|father|wife|husband|son|daughter|friend|friends|turn|job|work|book|books|decision|decisions|choice|choices|office|desk|room|rooms|cat|dog|phone|phones|computer|computers|keys|wallet|bag|coat|shoes|responsibility|attitude|problem|problems)\b/giu, "whose", "grammar-confused-whose", "Whose shows possession; who’s means who is.", 1],
    // "Bare with me" is always "bear with me" (endure). The lookahead
    // pins the endure-readings; bare everywhere else (bare feet) is correct.
    [/\b(bare)\b(?=\s+(?:with\s+(?:me|us)|in\s+mind|witness|the\s+(?:cost|burden|weight|pain|load|brunt)))/giu, "bear", "grammar-confused-bare", "“Bear with me” and “bear in mind” use bear (endure); bare means uncovered.", 1],
    // Scholars pore over documents; cooks pour liquids. The object list
    // keeps the study-reading unambiguous.
    [/\b(pour)(?=\s+over\s+(?:the\s+)?(?:documents|books|records|files|data|details|manuscript|papers|evidence|accounts|reports|notes|ledgers)\b)/giu, "pore", "grammar-confused-pore", "Pore over writing means study it closely; pour is for liquids.", 1],
    [/\b(tow)\s+the\s+line\b/giu, "toe", "grammar-confused-toe", "“Toe the line” means conform; tow means pull.", 1],
    [/\b(free)\s+(reign)\b/giu, "rein", "grammar-confused-rein", "A free rein is permission to act; a reign is a monarch’s rule.", 2],
    // "reign in spending" is always "rein in": reign (rule) takes places
    // and periods (the reign in Spain), never budget nouns.
    [/\b(reign)\s+(in)\s+(spending|costs|cost|budgets?|deficits?|debt|inflation|prices|excesses|impulses|emotions|appetites)\b/giu, "rein", "grammar-confused-rein", "To rein in spending is to restrain it, like a horse’s reins.", 1],
    [/\b(peak|peek)\s+(my|your|his|her|its|our|their|the)\s+(interest|curiosity)\b/giu, "piqued", "grammar-confused-pique", "“Piqued my interest” (aroused) is the idiom; a peak is a summit.", 1],
    // "phase me in/out" schedules someone, so the in/out follower keeps
    // the legitimate phrasal verb. Without it, "didn't phase her" is faze.
    [/\b(phase)(?=\s+(?:me|him|her|them|us|you)\b(?!\s+(?:in|out)\b))/giu, "faze", "grammar-confused-faze", "“Didn’t faze her” (disturb) is the verb; phase is a stage.", 1],
    [/\b(phased)(?=\s+(?:me|him|her|them|us|you)\b(?!\s+(?:in|out)\b))/giu, "fazed", "grammar-confused-faze", "“Didn’t faze her” (disturb) is the verb; phase is a stage.", 1],
    [/\b(hone\s+in\s+on)\b/giu, "home in on", "grammar-confused-home", "“Home in on” (move towards) is the idiom; hone means sharpen.", 1],
    [/\b(deep[-\s]seeded)\b/giu, "deep-seated", "grammar-confused-seated", "“Deep-seated” (firmly established) is the idiom, not “deep-seeded”.", 1],
    [/\b(baited)(?=\s+breath\b)/giu, "bated", "grammar-confused-bated", "“Bated breath” (held breath) is the idiom; bait is for traps.", 1],
    [/\b(one\s+in\s+the\s+same)\b/giu, "one and the same", "grammar-confused-same", "The idiom is “one and the same”.", 1],
    [/\bfor\s+all\s+(intensive)\s+purposes\b/giu, "intents and", "grammar-confused-intents", "The idiom is “for all intents and purposes”.", 1],
    [/\b(extract)(?=\s+revenge\b)/giu, "exact", "grammar-confused-exact", "You exact revenge (demand it); extract means pull out.", 1],
    [/\b(wreck)(?=\s+havoc\b)/giu, "wreak", "grammar-confused-wreak", "You wreak havoc (cause it); wreck means destroy.", 1],
    [/\bof\s+(coarse)\b/giu, "course", "grammar-confused-coarse", "“Of course” is the phrase; coarse means rough.", 1],
    [/\bgolf\s+(coarse)\b/giu, "course", "grammar-confused-coarse", "A golf course is the ground played on; coarse means rough.", 1],
    [/\b(piece)(?=\s+of\s+mind\b)/giu, "peace", "grammar-confused-peace", "“Peace of mind” is calm; a piece is a part.", 1],
    [/\b(piece)(?=\s+and\s+quiet\b)/giu, "peace", "grammar-confused-peace", "“Peace and quiet” is calm; a piece is a part.", 1],
    [/\b(right)(?=\s+of\s+passage\b)/giu, "rite", "grammar-confused-rite", "A “rite of passage” is a ritual; right means correct.", 1],
    // "play a roll" is never the bread: the play/starring frame pins the
    // part-reading, while dinner and bakery rolls never match it.
    [/\b(play|played|playing|plays)\s+((?:a|an|the|his|her|their|our|my|your|key|major|leading|starring|crucial|central|big|small|important|vital|pivotal|supporting|cameo)\s+){1,2}(roll)\b/giu, "role", "grammar-confused-roll", "A role is a part played; a roll is bread or a turn.", 3],
    // "teaming up with" collaborates, so only a with-phrase naming a
    // multitude (tourists, problems) reads as teeming (full of).
    [/\b(teaming)(?=\s+with\s+(?:tourists?|visitors?|crowds?|fans?|people|problems?|errors?|mistakes?|issues?|cars?|bacteria|germs?|talent|options?|shoppers?|protesters?|wildlife|fish|birds?)\b)/giu, "teeming", "grammar-confused-teem", "“Teeming with” means full of; teaming up means collaborating.", 1],
    [/\b(weather)(?=\s+(?:you|he|she|it|we|they|I|or\s+not)\b)/giu, "whether", "grammar-confused-weather", "“Whether you like it” gives alternatives; weather is atmospheric.", 1],
    [/\b(sweet|chocolate)\s+(desert)\b/giu, "dessert", "grammar-confused-dessert", "Dessert is the sweet course; a desert is arid land.", 2],
    [/\b(new|different|fresh|another)\s+(angel)(?=\s+on\b)/giu, "angle", "grammar-confused-angle", "A new angle on a problem is a perspective; an angel is celestial.", 2],
    // "his medal collection" owns medals, so collection-words after medal
    // keep the award-reading and never match.
    [/\b(?:his|her|their|true)\s+(medal)\b(?!\s+(?:collection|collections|cabinet|cases?|ceremon(?:y|ies)|winners?|tables?|hopes?|tally|count|designs?)\b)/giu, "mettle", "grammar-confused-mettle", "Mettle is courage under test; a medal is an award.", 1],
    [/\b(?:won|win|wins|earn|earns|earned|deserve|deserves|deserved|awarded)\s+(?:a|another|the|his|her|their)?\s*(mettle)\b/giu, "medal", "grammar-confused-medal", "A medal is the award; mettle is courage.", 1],
    [/\b(meddle)\s+detector\b/giu, "metal", "grammar-confused-metal", "A metal detector finds metal; to meddle is to interfere.", 1],
    [/\bcourt\s+(marshal)\b/giu, "martial", "grammar-confused-martial", "A court martial is a military trial; a marshal enforces law.", 1],
    [/\b(too|very|so|quite|how)\s+(lose)\b/giu, "loose", "grammar-confused-loose", "Loose means not tight; lose means misplace or fail to win.", 2],
    // "cut loose" and "let loose" end the phrase or continue with
    // somewhere, never with these objects — so only these followers flip.
    [/\b(loose)(?=\s+(?:weight|games?|match(?:es)?|keys|phone|job|temper|count|track|faith|hope|money|pounds|out)\b)/giu, "lose", "grammar-confused-loose", "Lose means misplace or fail to win; loose means not tight.", 1],
    [/\b(a|one|deep|big|last|final|slow|shallow)\s+(breathe)\b/giu, "breath", "grammar-confused-breath", "Breath is the noun; breathe is the verb.", 2],
    [/\bto\s+(breath)\b(?!\s+(?:mints?|fresheners?|tests?|alysers?|alyzers?))/giu, "breathe", "grammar-confused-breath", "Breathe is the verb; breath is the noun.", 1],
    [/\b(a|an|the|this|that|clever|ingenious|new|electronic|useful|simple|literary)\s+(devise)\b/giu, "device", "grammar-confused-device", "A device is a gadget; devise is the verb (plan).", 2],
    [/\b(these|those)\s+(devise)\b/giu, "devices", "grammar-confused-device", "Devices are gadgets; devise is the verb (plan).", 2],
    // "a full complement of staff" is the complete crew; the praise
    // reading needs a pay/give verb, which takes the reverse fix.
    [/\b(full|complete)\s+(compliment)\s+of\b/giu, "complement", "grammar-confused-complement", "A full complement is the complete set; a compliment is praise.", 2],
    [/\b(paid|pay|pays|paying|gave|give|gives|giving|offered|deserve|deserves|deserved)\b\s+(?:(?:him|her|them|me|us|you)\s+)?(?:a\s+)?(complement)\b/giu, "compliment", "grammar-confused-compliment", "A compliment is praise; a complement completes something.", 1],
    [/\blet\s+me\s+(complement)\b/giu, "compliment", "grammar-confused-compliment", "A compliment is praise; a complement completes something.", 1],
    [/\b(discreet)\s+(components?|parts?|variables?|units?|steps?|stages?|trials?|categor(?:y|ies)|entities|values|signals?|packets?|intervals?|models|systems)\b/giu, "discrete", "grammar-confused-discrete", "Discrete means separate; discreet means tactful.", 1],
    [/\b(discrete)\s+(inquir(?:y|ies)|charm|meetings?|words?|envelopes?|packaging|locations?|affairs?|glances?|nods?)\b/giu, "discreet", "grammar-confused-discreet", "Discreet means tactful; discrete means separate.", 1],
    [/\b(seek|seeks|sought|seeking)\s+(council)\b/giu, "counsel", "grammar-confused-counsel", "Counsel is advice; a council is an assembly.", 2],
    [/\b(city|town|parish|county|district|borough|student|works)\s+(counsel)\b/giu, "council", "grammar-confused-council", "A council is an assembly; counsel is advice.", 2],
    [/\b(moral|ethical|guiding|basic|core|general|key|first|fundamental|underlying|religious)\s+(principal)\b/giu, "principle", "grammar-confused-principle", "A principle is a rule; a principal heads a school.", 2],
    [/\b(school|college)\s+(principle)\b/giu, "principal", "grammar-confused-principal", "The principal heads a school; a principle is a rule.", 2],
    [/\b(stationery)\s+(bikes?|bicycles?|vehicles?|trains?|buses?|traffic|engines?|cars?)\b/giu, "stationary", "grammar-confused-stationary", "Stationary means not moving; stationery is writing paper.", 1],
    [/\b(stationary)\s+(cupboards?|supplies|orders?)\b/giu, "stationery", "grammar-confused-stationery", "Stationery is writing paper; stationary means not moving.", 1],
    [/\b(construction|building|web|website|internet|camp|campsite|caravan|heritage)\s+(sight)\b/giu, "site", "grammar-confused-site", "A site is a location; a sight is something seen.", 2],
    [/\b(straight\s+jacket)\b/giu, "straitjacket", "grammar-confused-strait", "A straitjacket restrains; straight means not bent.", 1],
    [/\b(apart\s+of)\b/giu, "a part of", "grammar-apart-of", "“Apart from” means except; “a part of” means belonging to.", 1],
    // The adjective reading ("everyday life") never has a verb or
    // this/that/it before it, so only those shapes flip to two words.
    [/\b(go|goes|went|do|does|did|run|runs|ran|walk|walks|walked|eat|eats|ate|meet|meets|met|rain|rains|happen|happens|occur|occurs|arrive|arrives|work|works|play|plays|live|lives|lived|shop|shops|study|studies|drive|drives|train|trains|swim|swims)((?:\s+[\p{L}']+){0,2}?)\s+(everyday)(?!-)(?=\s*(?:$|[.,!?;:])|\s+(?:to|and|but|or|nor|for|before|after|while|when|because|if|with|on|in|at|from)\b(?!-))/giu, "every day", "grammar-everyday", "“Every day” (each day) is two words; everyday is an adjective (“everyday life”).", 3],
    [/\b(this|that|it)\s+(everyday)(?!-)(?=\s*(?:$|[.,!?;:])|\s+(?:to|and|but|or|nor|for|before|after|while|when|because|if|with|on|in|at|from)\b(?!-))/giu, "every day", "grammar-everyday", "“Every day” (each day) is two words; everyday is an adjective (“everyday life”).", 2],
    [/\b(irregardless)\b/giu, "regardless", "grammar-confused-regardless", "“Regardless” is the standard form.", 1],
    // The literal ability-reading ("if you could care less, try harder")
    // keeps the phrase; everywhere else it is the “couldn’t” idiom.
    // The \b must sit *before* the lookbehinds: when the lookbehinds lead,
    // the engine tries a lookbehind at every position inside a long
    // non-matching run (a 32 KB whitespace paragraph took ~3.4s here and
    // dominated analyzeLocally), while \b fails first for free. The match
    // text and capture group are unchanged — verified case-for-case against
    // the previous pattern in tests/analysis-performance.test.mjs.
    [/\b(?<!\bif\s+you\s+)(?<!\bwhether\s+you\s+)(could)\s+care\s+less\b/giu, "couldn't", "grammar-idiom-care-less", "The idiom is “couldn’t care less” (caring is impossible), not “could care less”.", 1],
  ];
  // In a draft written entirely without letter case the writer has abandoned
  // apostrophes along with capitals, so suggesting one back ("its" ->
  // "it's", "your" -> "you're") is register noise: the same draft writes
  // "dont" and "i" without one. Letter-level confusions (their/there,
  // than/then) are still checked. See isUncasedDraft.
  const uncasedConfusion = isUncasedDraft(text);
  for (const [pattern, replacement, ruleId, explanation, groupIndex = 1] of patterns) {
    if (uncasedConfusion && (ruleId === "grammar-confused-its" || ruleId === "grammar-confused-your")) continue;
    for (const match of text.matchAll(pattern)) {
      const start = (match.index ?? 0);
      const original = match[groupIndex] ?? "";
      const wordStart = start + (match[0]?.indexOf(original) ?? 0);
      pushIssue(issues, makeIssue(ruleId, wordStart, wordStart + original.length, original, preserveCase(original, replacement), "grammar", "medium", "Check the commonly confused word", explanation, 0.78, preferences));
    }
  }
  return issues;
}

const REFLEXIVE_SUBJECTIVE: Record<string, string> = {
  myself: "I", yourself: "you", himself: "he", herself: "she", itself: "it",
  ourselves: "we", yourselves: "you", themselves: "they", oneself: "one",
};
const REFLEXIVE_OBJECTIVE: Record<string, string> = {
  myself: "me", yourself: "you", himself: "him", herself: "her", itself: "it",
  ourselves: "us", yourselves: "you", themselves: "them", oneself: "one",
};
const REFLEXIVE_ALTERNATION = Object.keys(REFLEXIVE_SUBJECTIVE).join("|");

// Auxiliaries and modals put a following either/neither phrase in subject
// position ("will either himself or James attend" needs "he"). They are
// listed explicitly because VERB_HINTS mixes them with lexical verbs, and a
// lexical verb in the same slot governs an object instead ("invited both
// myself" needs "me").
const SUBJECT_SLOT_AUX = new Set([
  "am", "be", "is", "are", "was", "were", "been", "being",
  "have", "has", "had", "do", "does", "did",
  "will", "would", "can", "could", "shall", "should", "may", "might", "must",
]);

// Base-form transitive verbs that VERB_HINTS does not carry but that govern
// an object slot the same way a preposition does ("contact either myself"
// needs "me", while "if either myself" needs "I").
const TRANSITIVE_GOVERNORS = new Set([
  "send", "give", "ask", "invite", "include", "contact", "email", "call",
  "bring", "take", "pass", "share", "forward", "cc", "notify", "let",
  "help", "see", "hear", "watch",
]);

/**
 * Whether the either/neither/both phrase starting at `keywordStart` sits in
 * an object slot (after a preposition or transitive verb: "to either
 * myself" → "me") or a subject slot ("if either myself" → "I").
 *
 * Defaults to subject: a conjunction, comma or clause boundary before the
 * keyword means nothing governs the phrase, and the reflexive is in subject
 * position by elimination.
 */
function reflexiveSlotCase(text: string, keywordStart: number): "subject" | "object" {
  const before = text.slice(0, keywordStart);
  if (PREPOSITION_BEFORE.test(before)) return "object";
  const previous = /([\p{L}']+)\s*$/u.exec(before)?.[1]?.toLocaleLowerCase();
  if (!previous || SUBJECT_SLOT_AUX.has(previous)) return "subject";
  if (VERB_HINTS.has(previous) || /(ed|ing)$/u.test(previous) || TRANSITIVE_GOVERNORS.has(previous)) return "object";
  return "subject";
}

const REFLEXIVE_NEXT_WORD_EXCLUDED = new Set([
  "and", "or", "nor", "the", "a", "an", "to", "of", "for", "with",
  "by", "from", "in", "on", "at", "as", "but", "if", "that",
]);

function reflexiveFollowedByVerb(text: string, reflexiveEnd: number): boolean {
  const next = /\s+([\p{L}']+)/u.exec(text.slice(reflexiveEnd))?.[1]?.toLocaleLowerCase();
  if (!next || REFLEXIVE_NEXT_WORD_EXCLUDED.has(next)) return false;
  return SUBJECT_SLOT_AUX.has(next)
    || VERB_HINTS.has(next)
    || /(ed|ing|es)$/u.test(next);
}

/**
 * A reflexive pronoun standing in for a plain personal pronoun.
 *
 * "Either myself or my colleague" and "myself will attend" are
 * hypercorrections: a reflexive needs its antecedent in the clause ("I
 * myself will attend", "he fixed it himself"), and without one the
 * subject slot takes "I" and the object slot "me". The emphatic uses
 * never match: they follow their antecedent mid-clause, while both patterns
 * here are anchored where no antecedent can stand — after either/neither/
 * both, or at a sentence boundary followed by a verb.
 *
 * Mid-clause coordination ("John and myself attended") is deliberately not
 * covered: telling a subject ("John and I") from an object ("for John and
 * me") there needs government analysis this rule does not attempt. A miss,
 * never a false positive.
 */
export function findReflexiveSubjects(text: string, preferences: StylePreferences) {
  const issues: WritingIssue[] = [];
  const push = (start: number, original: string, replacement: string, slot: "subject" | "object") => {
    pushIssue(issues, makeIssue("grammar-reflexive-subject", start, start + original.length, original, preserveCase(original, replacement), "grammar", "high", "Check the reflexive pronoun",
      slot === "subject"
        ? `“${original}” cannot be the subject of a clause on its own — the reflexive needs its antecedent (“I myself”). Use the subject pronoun “${replacement}” here.`
        : `After a preposition or verb the reflexive needs its antecedent in the clause. Use the object pronoun “${replacement}” here.`,
      0.9, preferences));
  };
  for (const match of text.matchAll(new RegExp(`\\b(either|neither|both)\\s+(${REFLEXIVE_ALTERNATION})\\s+(or|nor|and)\\b`, "giu"))) {
    const original = match[2] ?? "";
    const lower = original.toLocaleLowerCase();
    const slot = reflexiveSlotCase(text, match.index ?? 0);
    const replacement = (slot === "subject" ? REFLEXIVE_SUBJECTIVE : REFLEXIVE_OBJECTIVE)[lower] ?? original;
    const wordStart = (match.index ?? 0) + (match[0]?.indexOf(original) ?? 0);
    push(wordStart, original, replacement, slot);
  }
  for (const match of text.matchAll(new RegExp(`(^|[.!?]\\s+)(${REFLEXIVE_ALTERNATION})\\b`, "giu"))) {
    const original = match[2] ?? "";
    const start = (match.index ?? 0) + (match[1]?.length ?? 0);
    if (!reflexiveFollowedByVerb(text, start + original.length)) continue;
    const replacement = REFLEXIVE_SUBJECTIVE[original.toLocaleLowerCase()] ?? original;
    push(start, original, replacement, "subject");
  }
  return issues;
}

function articleFor(word: string) {
  const lower = word.toLocaleLowerCase();
  if (/^[A-Z]{2,}/u.test(word) && /^(?:u|uk|un|url|uuid|ui|usb|utc)/iu.test(word)) return "a";
  if (ARTICLE_AN_EXCEPTIONS.has(lower)) return "an";
  if (ARTICLE_A_SOUND_PREFIXES.test(lower)) return "a";
  return /^[aeiou]/u.test(lower) ? "an" : "a";
}

function nounLooksPlural(word: string) {
  const lower = word.toLocaleLowerCase();
  if (["children", "criteria", "media", "men", "people", "results", "women"].includes(lower)) return true;
  if (!lower.endsWith("s")) return false;
  return !/(?:analysis|basis|business|class|gas|glass|is|mathematics|news|physics|series|species|status|ss|us)$/u.test(lower);
}

/**
 * Whether the whole draft is written without letter case.
 *
 * Chat messages, quick notes and semi-formal messages are routinely typed
 * entirely in lower case. In that register the missing capital is not a slip:
 * there is no capital to be missing anywhere in the draft, so the choice is
 * consistent, and consistency is what tells a deliberate voice from an error.
 * Reporting every sentence of such a message (a four-sentence note produced
 * four findings, plus one for each "i") is the single noisiest class of false
 * positive we had on ordinary text, and it landed hardest in the extension,
 * whose main job is short messages on web forms.
 *
 * Two conditions keep this from becoming a blanket exemption.
 *
 * 1. A draft that contains *any* capital letter has casing in play, so a
 *    lower-case sentence in it is still a genuine inconsistency worth
 *    reporting. One capital word anywhere — a name, an acronym — switches the
 *    rules back on for the whole draft.
 *
 * 2. A register needs a body of text to exist. The calibration corpus pins the
 *    reported side: a four-word caseless fragment ("this draft is ready.") must
 *    still be flagged. Ten words leaves a deliberate margin above that — at
 *    ten words the writer has written a message, not an unfinished sentence —
 *    and the margin is what keeps this a rule about a body of text rather than
 *    a rule about one sentence.
 */
const UNCASED_REGISTER_MIN_WORDS = 10;

export function isUncasedDraft(text: string) {
  if (!text.trim()) return false;
  // The cheap test first: any capital letter in the draft makes it cased, which
  // is the common case and skips the word count entirely.
  if (/\p{Lu}/u.test(text)) return false;
  // Count only as far as the threshold. Splitting a long draft into words on
  // every keystroke was measurable work in the analysis loop, and the answer is
  // decided by the tenth word either way.
  const words = /\S+/gu;
  let count = 0;
  while (words.exec(text)) {
    count += 1;
    if (count >= UNCASED_REGISTER_MIN_WORDS) return true;
  }
  return false;
}

/**
 * Whether a determiner phrase starting at `position` is the object of a
 * preposition rather than the subject of its clause.
 *
 * "Costs attributable to the restructuring were met" was reported as an
 * agreement error because the pattern saw "the restructuring were". The real
 * subject is "Costs"; "the restructuring" is what the costs are attributable
 * to. Agreement cannot be judged from a noun that a preposition governs, so the
 * determiner patterns must skip those phrases.
 *
 * Words that can also open a clause — "as", "since", "until", "after" — are
 * deliberately absent: in "as the results are clear" the determiner phrase *is*
 * the subject, and skipping it would hide the agreement error the rule exists
 * to catch.
 */
const PREPOSITION_BEFORE = /(?:^|[^\p{L}])(?:about|above|across|against|along|among|around|at|behind|below|beneath|beside|between|beyond|by|despite|during|except|for|from|in|inside|into|near|of|off|on|onto|outside|over|past|per|through|throughout|to|toward|towards|under|upon|via|with|within|without)\s+$/iu;

function isPrepositionalObject(text: string, position: number) {
  return position > 0 && PREPOSITION_BEFORE.test(text.slice(0, position));
}

/**
 * Whether a verb sits in a hypothetical clause that takes the subjunctive.
 *
 * "If the aggregate were published" is correct English: after "if", "were"
 * applies to every person. Treating it as a plural verb disagreeing with a
 * singular subject reported a grammar error on correct writing, so the "were"
 * agreement fix is withheld inside those clauses.
 */
/**
 * The base form of a third-person singular lexical verb, or null when `word`
 * is not shaped like one.
 *
 * Consonant + "ies" takes "y" ("studies" -> "study") while vowel + "ies"
 * takes "ie" ("dies" -> "die"); sibilant and -o endings take "es"
 * ("watches" -> "watch", "goes" -> "go"); the rest drop a single "s"
 * except double-s endings ("class" is a noun, not "clas" + "s"). Inputs
 * shorter than four letters are never verb forms worth judging ("as", "is").
 */
function toBaseVerbForm(word: string): string | null {
  if (word.length < 4) return null;
  if (word.endsWith("ies")) {
    const stem = word.slice(0, -3);
    return /[aeiou]$/u.test(stem) ? `${stem}ie` : `${stem}y`;
  }
  if (/(?:s|x|z|ch|sh|o)es$/u.test(word)) return word.slice(0, -2);
  if (word.endsWith("s") && !word.endsWith("ss")) return word.slice(0, -1);
  return null;
}

/**
 * The third-person singular of a base-form lexical verb.
 *
 * Sibilant and -o endings take "es" ("pass" -> "passes", "go" ->
 * "goes"); a consonant + "y" takes "ies" ("study" -> "studies") while a
 * vowel + "y" just takes "s" ("play" -> "plays"); the rest take "s".
 */
function toThirdSingular(base: string): string {
  if (/(?:s|x|z|ch|sh|o)$/u.test(base)) return `${base}es`;
  if (/[^aeiou]y$/u.test(base)) return `${base.slice(0, -1)}ies`;
  return `${base}s`;
}

function inHypotheticalClause(text: string, position: number) {
  const boundaries = [".", "!", "?", "\n"].map((mark) => text.lastIndexOf(mark, position - 1));
  const clauseStart = Math.max(...boundaries) + 1;
  return /\b(?:if|wish|as though|as if|suppose|supposing)\b/iu.test(text.slice(clauseStart, position));
}

export function findPrecisionGrammarIssues(text: string, preferences: StylePreferences, document = parseDocument(text)) {
  const issues: WritingIssue[] = [];
  for (const match of text.matchAll(/\b(the|a|an|this|that|my|your)\s+\1\b/giu)) {
    const start = match.index ?? 0;
    const duplicate = match[1] ?? "";
    const duplicateStart = start + match[0].lastIndexOf(duplicate);
    pushIssue(issues, makeIssue("grammar-duplicate-determiner", duplicateStart, duplicateStart + duplicate.length, duplicate, "", "grammar", "high", "Repeated determiner", "Remove the duplicated determiner so the sentence reads cleanly.", 0.995, preferences));
  }
  for (const match of text.matchAll(/\b(a|an)\s+([\p{L}][\p{L}'’-]*)/giu)) {
    const article = (match[1] ?? "").toLocaleLowerCase();
    const expected = articleFor(match[2] ?? "");
    if (article === expected) continue;
    const start = (match.index ?? 0) + (match[0].toLocaleLowerCase().indexOf(article));
    pushIssue(issues, makeIssue("grammar-article-agreement", start, start + article.length, match[1] ?? article, preserveCase(match[1] ?? article, expected), "grammar", "medium", "Check the article", `Use “${expected}” before “${match[2]}” in this context.`, 0.9, preferences));
  }
  const agreementPatterns: Array<[RegExp, Record<string, string>]> = [
    [/\b(he|she|it)\s+(are|were|have|do)\b/giu, { are: "is", were: "was", have: "has", do: "does" }],
    [/\b(they|we|you)\s+(is|was|has|does)\b/giu, { is: "are", was: "were", has: "have", does: "do" }],
    [/\b(?:the|this|that|my|your|our|their)\s+([\p{L}][\p{L}'’-]*)\s+(is|was|has|does)\b/giu, { is: "are", was: "were", has: "have", does: "do" }],
    [/\b(?:the|this|that|my|your|our|their)\s+([\p{L}][\p{L}'’-]*)\s+(are|were|have|do)\b/giu, { are: "is", were: "was", have: "has", do: "does" }],
    [/\b(?:the|these|those)\s+(?:latest|final|overall|main|primary|key|new|old)\s+([\p{L}][\p{L}'’-]*)\s+(is|was|has|does|are|were|have|do)\b/giu, { is: "are", was: "were", has: "have", does: "do", are: "is", were: "was", have: "has", do: "does" }],
  ];
  for (const [pattern, replacements] of agreementPatterns) {
    for (const match of text.matchAll(pattern)) {
      const subject = match[1] ?? "";
      const verb = match[2] ?? "";
      // Only the determiner patterns can be thrown off by sentence structure;
      // "he/she/it" and "they/we/you" are unambiguous subjects.
      const determinerLed = /^(?:the|this|that|these|those|my|your|our|their)\b/iu.test(match[0]);
      // A personal pronoun after a determiner agrees with itself: "that it
      // is" and "that they are" are correct English, and the pronoun-led
      // patterns above already own the cases where they are wrong. Without
      // this, every relative clause with a pronoun subject was reported.
      // "I" is not exempt: no above pattern covers it, and "that I is"
      // is always wrong.
      const pronounSubject = ["he", "she", "it", "they", "we", "you"].includes(subject.toLocaleLowerCase());
      if (determinerLed && pronounSubject) continue;
      const subjectIsPlural = nounLooksPlural(subject);
      const pluralVerb = ["are", "were", "have", "do"].includes(verb.toLocaleLowerCase());
      const singularVerb = ["is", "was", "has", "does"].includes(verb.toLocaleLowerCase());
      if ((pluralVerb && subjectIsPlural) || (singularVerb && !subjectIsPlural && !pronounSubject)) continue;
      const start = (match.index ?? 0) + (match[0].lastIndexOf(verb));
      if (determinerLed && isPrepositionalObject(text, match.index ?? 0)) continue;
      if (verb.toLocaleLowerCase() === "were" && inHypotheticalClause(text, start)) continue;
      pushIssue(issues, makeIssue("grammar-subject-verb-agreement", start, start + verb.length, verb, preserveCase(verb, replacements[verb.toLocaleLowerCase()] ?? verb), "grammar", "high", "Check subject–verb agreement", "The verb should agree with the subject in number.", 0.94, preferences));
    }
  }
  // Auxiliary verbs end in -s too, but the patterns above own them: "The
  // results is" and "The results has" are already reported with the right
  // fix, so this loop only sees lexical verbs.
  const AUXILIARY_VERB_FORMS = new Set(["is", "are", "was", "were", "has", "have", "does", "do", "am"]);
  // Plural-looking nouns that are singular or number-ambiguous in ordinary
  // prose: academic fields take singular agreement ("statistics shows" is
  // correct for the discipline), and headquarters/means can be either, so a
  // precision rule declines to judge them.
  const AMBIGUOUS_NUMBER_NOUNS = /(?:headquarters|means|economics|statistics|politics|ethics|linguistics|classics)$/iu;
  for (const match of text.matchAll(/\b(?:the|this|that|my|your|our|their)\s+([\p{L}][\p{L}'’-]*)\s+([\p{L}]+s)\b/giu)) {
    const subject = match[1] ?? "";
    const verb = match[2] ?? "";
    const verbLower = verb.toLocaleLowerCase();
    if (AUXILIARY_VERB_FORMS.has(verbLower)) continue;
    if (!nounLooksPlural(subject) || AMBIGUOUS_NUMBER_NOUNS.test(subject)) continue;
    const base = toBaseVerbForm(verbLower);
    // The stripped form must be a known verb: without that, noun-noun
    // compounds ("the sales calls rang") and stray words ("the results as
    // presented") would be "corrected" into nonsense.
    if (!base || !VERB_HINTS.has(base)) continue;
    const start = (match.index ?? 0) + (match[0].lastIndexOf(verb));
    if (isPrepositionalObject(text, match.index ?? 0)) continue;
    pushIssue(issues, makeIssue("grammar-subject-verb-agreement", start, start + verb.length, verb, preserveCase(verb, base), "grammar", "high", "Check subject–verb agreement", "The verb should agree with the subject in number.", 0.9, preferences));
  }
  // Singular subject + base-form lexical verb ("The result show"). The mirror
  // image of the loop above: the subject must be singular-looking and the
  // word after it an unambiguous base-form verb. Every guard below is bought
  // with a real false positive the unguarded pattern reported during
  // development, so the rule stays miss-never-FP on correct prose.
  const BASE_FORM_VERBS = new Set([
    "make", "write", "keep", "use", "build", "show", "tell", "need", "want",
    "give", "take", "come", "run", "seem", "appear", "remain", "contain",
    "include", "require", "provide", "offer", "say", "get", "find", "follow",
    "help", "work", "play", "move", "turn", "start", "end", "mean", "leave",
    "change", "grow", "belong", "speak", "drive", "eat", "drink", "stand",
    "cover", "vary",
  ]);
  // Past tenses identical to the base form ("The report cost millions" is
  // the past tense, not an agreement error).
  const SAME_FORM_PAST_VERBS = new Set([
    "cost", "hit", "hurt", "cut", "put", "set", "shut", "split", "spread",
    "cast", "burst", "quit", "let", "read", "bid", "thrust",
  ]);
  // The subjunctive after a mandative governor ("demand the result show")
  // takes the base form even with a singular subject.
  const MANDATIVE_GOVERNORS = new Set([
    "demand", "suggest", "require", "request", "propose", "recommend", "insist",
    "ask", "order", "urge", "prefer", "advise", "move", "decree", "stipulate",
  ]);
  const MANDATIVE_NOUNS = new Set([
    "demand", "request", "requirement", "proposal", "recommendation",
    "insistence", "order", "preference",
  ]);
  // Subjects that are plural (or number-ambiguous) without ending in -s:
  // plural pronouns, generic plurals ("the rich get richer"), adjectives
  // used as plural nouns ("the poor show little interest"), ordinals used
  // collectively ("the first show courage"), and invariant nouns.
  const PLURAL_OR_AMBIGUOUS_SUBJECTS = new Set([
    "i", "you", "we", "they", "first", "second", "third", "fourth", "fifth",
    "last", "best", "worst", "rest", "most", "least", "following",
    "poor", "rich", "young", "old", "elderly", "unemployed", "homeless",
    "blind", "deaf", "disabled", "needy", "wealthy", "brave", "meek",
    "accused", "dead", "living", "missing", "wounded",
    "data", "media", "police", "sheep", "deer", "fish", "aircraft", "offspring",
  ]);
  // Participial adjectives in subject position ("the delivered work") are
  // adjectives, not subjects: the word after them is the head noun, which
  // this rule must not "correct". Genuine errors with an attributive
  // participle ("the detailed report cover …") are conceded as misses —
  // the participial shape is far more often correct business prose.
  const EN_PARTICIPLES = new Set([
    "broken", "chosen", "driven", "fallen", "forgotten", "frozen", "given",
    "hidden", "mistaken", "proven", "risen", "stolen", "taken", "written",
    "beaten", "bitten", "shaken", "torn", "worn", "sunken", "swollen",
  ]);
  // En-GB collective nouns take plural agreement ("Our team show promise"
  // is correct in London). In en-US the singular is required, so the rule
  // still fires there.
  const COLLECTIVE_NOUNS_GB = new Set([
    "team", "committee", "government", "family", "company", "jury", "audience",
    "staff", "crew", "council", "board", "parliament", "cabinet", "firm",
    "group", "class", "club", "party", "band", "orchestra", "choir", "troupe",
  ]);
  // Words after the candidate that prove it is a noun, not a verb: an
  // infinitive ("the right show to watch"), a coordinator ("show and prove"
  // needs two fixes, not a half-fix), an auxiliary ("the take was huge"),
  // or the head of a relative clause ("the one show I like").
  const NOUN_PROVING_FOLLOWERS = new Set([
    "to", "and", "or", "i", "you", "he", "she", "it", "we", "they",
    "who", "which", "whom", "whose", "that",
  ]);
  const verbLike = (word: string): boolean => {
    if (!word) return false;
    if (SUBJECT_SLOT_AUX.has(word) || BASE_FORM_VERBS.has(word)) return true;
    const base = toBaseVerbForm(word);
    return !!base && (VERB_HINTS.has(base) || BASE_FORM_VERBS.has(base));
  };
  for (const match of text.matchAll(/\b(the|this|that|my|your|our|their)\s+([\p{L}][\p{L}'’-]*)\s+([\p{L}]+)\b/giu)) {
    const subject = match[2] ?? "";
    const verb = match[3] ?? "";
    const subjectLower = subject.toLocaleLowerCase();
    const verbLower = verb.toLocaleLowerCase();
    if (!BASE_FORM_VERBS.has(verbLower) || SAME_FORM_PAST_VERBS.has(verbLower)) continue;
    if (PLURAL_OR_AMBIGUOUS_SUBJECTS.has(subjectLower)) continue;
    // A modal or auxiliary in subject position ("That would give us a day")
    // is the head of a verb phrase, not a subject the rule can judge.
    if (SUBJECT_SLOT_AUX.has(subjectLower)) continue;
    if (nounLooksPlural(subject) || AMBIGUOUS_NUMBER_NOUNS.test(subject)) continue;
    if (/ed$/u.test(subjectLower) || EN_PARTICIPLES.has(subjectLower)) continue;
    if (preferences.dialect !== "en-US" && COLLECTIVE_NOUNS_GB.has(subjectLower)) continue;
    const matchStart = match.index ?? 0;
    const beforeText = text.slice(0, matchStart);
    const previousWord = /([\p{L}]+)\s*$/u.exec(beforeText)?.[1]?.toLocaleLowerCase() ?? "";
    if (MANDATIVE_GOVERNORS.has(previousWord)) continue;
    if (previousWord === "that") {
      const governor = /([\p{L}]+)\s+that\s*$/u.exec(beforeText)?.[1]?.toLocaleLowerCase() ?? "";
      if (MANDATIVE_GOVERNORS.has(governor) || MANDATIVE_NOUNS.has(governor)) continue;
    }
    if (isPrepositionalObject(text, matchStart)) continue;
    const afterText = text.slice(matchStart + match[0].length);
    const afterMatch = /^\s*([\p{L}']+)([\s\S]*)$/u.exec(afterText);
    const nextWord = (afterMatch?.[1] ?? "").toLocaleLowerCase();
    if (NOUN_PROVING_FOLLOWERS.has(nextWord) || SUBJECT_SLOT_AUX.has(nextWord)) continue;
    // Noun-noun compounds where a word is verb-shaped: the candidate can be
    // the first modifier ("the show start times vary" — the later verb owns
    // the agreement) or the second noun ("the work offer stands" — the
    // -s verb right after it owns the predicate).
    const nextBase = toBaseVerbForm(nextWord);
    if (nextBase && (VERB_HINTS.has(nextBase) || BASE_FORM_VERBS.has(nextBase))) continue;
    if (nextWord.endsWith("s")) {
      const nextNextWord = /^\s*([\p{L}']+)/u.exec(afterMatch?.[2] ?? "")?.[1]?.toLocaleLowerCase() ?? "";
      if (verbLike(nextNextWord)) continue;
    }
    const start = matchStart + (match[0].lastIndexOf(verb));
    pushIssue(issues, makeIssue("grammar-subject-verb-agreement", start, start + verb.length, verb, preserveCase(verb, toThirdSingular(verbLower)), "grammar", "high", "Check subject–verb agreement", "The verb should agree with the subject in number.", 0.88, preferences));
  }
  // Comma splice before a demonstrative subject + be ("…, the other two
  // are …"). The comma joins two independent clauses; the fix starts a new
  // sentence. Narrow by construction: only this/that/these/those + a be
  // verb, and only when the segment before the comma contains a finite verb
  // — greetings and fragments ("Yes, this is fine") have none and are left
  // alone. A preceding colon properly introduces the clause, and "that is
  // to say" parentheticals are idiomatic, so both are excluded.
  const IRREGULAR_PAST_VERBS = new Set([
    "left", "went", "came", "saw", "took", "made", "got", "knew", "thought",
    "felt", "became", "brought", "began", "kept", "held", "wrote", "stood",
    "heard", "meant", "paid", "met", "ran", "sat", "spoke", "drove", "broke",
    "chose", "wore", "tore", "fell", "forgot", "gave", "hid", "rode", "rang",
    "rose", "sank", "sang", "shook", "shot", "slept", "slid", "stole", "stuck",
    "struck", "swore", "swept", "swung", "threw", "woke", "won", "lost",
    "sold", "sent", "spent", "built", "lent", "said",
  ]);
  const FINITE_VERB_BEFORE_COMMA = /\b(am|is|are|was|were|be|been|being|has|have|had|do|does|did|can|could|shall|should|will|would|may|might|must)\b|[\p{L}]ed\b/iu;
  // A message written entirely without letter case has no sentence
  // conventions either (the terminal-stop rule already treats it that way),
  // and comma splices are normal rhythm in that register — flagging them
  // corrects the register, not the writing.
  const skipCommaSplice = isUncasedDraft(text);
  for (const match of text.matchAll(/,\s*(this|that|these|those|the)\s+((?:[\p{L}'’-]+\s+){0,3}?)(is|are|was|were)\b/giu)) {
    if (skipCommaSplice) break;
    const demonstrative = match[1] ?? "";
    const middle = match[2] ?? "";
    const beVerb = (match[3] ?? "").toLocaleLowerCase();
    const commaPosition = match.index ?? 0;
    // "the" needs a subject phrase after it ("the other two are"); a bare
    // "the are" is not English, and the number must agree with a
    // demonstrative ("these is" belongs to the agreement rules, not this one).
    if (demonstrative === "the" && !middle.trim()) continue;
    const singularBe = ["is", "was"].includes(beVerb);
    const singularDem = ["this", "that"].includes(demonstrative.toLocaleLowerCase());
    if (demonstrative.toLocaleLowerCase() !== "the" && singularBe === !singularDem) continue;
    const afterClause = text.slice(commaPosition + match[0].length);
    if (/^\s*to\b/iu.test(afterClause)) continue;
    const boundaries = [".", "!", "?", ";", "\n", ":"].map((mark) => text.lastIndexOf(mark, commaPosition - 1));
    const clauseStart = Math.max(...boundaries) + 1;
    const beforeClause = text.slice(clauseStart, commaPosition);
    // A leading subordinator or preposition ("If the text changed, the
    // rewrite is rejected") makes the first half dependent, so the comma
    // joins it to its main clause correctly — there is no splice.
    if (/^\s*(if|when|because|although|though|while|whereas|since|as|unless|until|after|before|once|whether|where|even|lest|provided|supposing)\b/iu.test(beforeClause)) continue;
    const hasFiniteVerb = FINITE_VERB_BEFORE_COMMA.test(beforeClause)
      || beforeClause.split(/[^\p{L}']+/u).some((word) => IRREGULAR_PAST_VERBS.has(word.toLocaleLowerCase()));
    if (!hasFiniteVerb) continue;
    const demonstrativeStart = commaPosition + match[0].indexOf(demonstrative, 1);
    const demonstrativeEnd = demonstrativeStart + demonstrative.length;
    const capitalised = demonstrative.charAt(0).toLocaleUpperCase() + demonstrative.slice(1);
    pushIssue(issues, makeIssue("punctuation-comma-splice", commaPosition, demonstrativeEnd, text.slice(commaPosition, demonstrativeEnd), `. ${capitalised}`, "punctuation", "medium", "Possible comma splice", "Two complete sentences are joined by a comma. Start a new sentence here.", 0.8, preferences));
  }
  // Existential agreement ("There is three people", "There are a problem").
  // There is a dummy subject: the verb agrees with the noun phrase after it.
  // Only unambiguous shapes fire. The contracted "there's + plural" is
  // idiomatic in casual speech and deliberately left alone (locked by an
  // FP test); a bare "There is" has no such excuse. Mass and invariant
  // nouns (fish, politics) and "no" determiners are never judged.
  const EXISTENTIAL_PLURALS = new Set([
    "these", "those", "several", "many", "few", "both", "multiple",
    "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
    "eleven", "twelve",
  ]);
  for (const match of text.matchAll(/\b[Tt]here\s+(is)\s+([\p{L}'’-]+|\d+)/gu)) {
    const verb = match[1] ?? "";
    const followed = (match[2] ?? "").toLocaleLowerCase();
    const isDigitPlural = /^\d+$/u.test(followed) && Number.parseInt(followed, 10) >= 2;
    if (!isDigitPlural && !EXISTENTIAL_PLURALS.has(followed)
      && !(nounLooksPlural(followed) && !AMBIGUOUS_NUMBER_NOUNS.test(followed))) continue;
    const start = (match.index ?? 0) + (match[0].lastIndexOf(verb));
    pushIssue(issues, makeIssue("grammar-subject-verb-agreement", start, start + verb.length, verb, preserveCase(verb, "are"), "grammar", "high", "Check subject–verb agreement", "The verb should agree with the subject in number.", 0.92, preferences));
  }
  // "There are a lot of reasons" and "a few/great many" are correct, so
  // the a/an branch skips collective determiners; "one or two" takes the
  // plural by proximity, so that "one" is skipped too.
  const COLLECTIVE_AFTER_A = new Set([
    "lot", "number", "couple", "few", "many", "group", "series", "range",
    "total", "variety", "deal", "dozen", "hundred", "thousand", "million",
  ]);
  for (const match of text.matchAll(/\b[Tt]here\s+(are)\s+(a|an|one|each|every|this|that)\b/giu)) {
    const verb = match[1] ?? "";
    const determiner = (match[2] ?? "").toLocaleLowerCase();
    const afterDeterminer = /^\s+([\p{L}'’-]+)/u.exec(text.slice((match.index ?? 0) + match[0].length))?.[1]?.toLocaleLowerCase() ?? "";
    if ((determiner === "a" || determiner === "an") && COLLECTIVE_AFTER_A.has(afterDeterminer)) continue;
    if (determiner === "one" && afterDeterminer === "or") continue;
    const start = (match.index ?? 0) + (match[0].lastIndexOf(verb));
    pushIssue(issues, makeIssue("grammar-subject-verb-agreement", start, start + verb.length, verb, preserveCase(verb, "is"), "grammar", "high", "Check subject–verb agreement", "The verb should agree with the subject in number.", 0.92, preferences));
  }
  // The object of a preposition coordinated with "I" ("between you and I",
  // "he gave it to John and I"). A preposition always governs the objective
  // case, so the stranded "I" is corrected to "me" — always lowercase, since
  // a capitalised "I" never legitimately follows a coordinator here and
  // preserveCase would produce "Me". When a verb follows the "I" the
  // coordinator belongs to a new clause ("for work and I need a break"), so
  // verb-followers are left alone.
  const OBJECT_PREPOSITIONS = new Set([
    "between", "for", "with", "to", "from", "by", "of", "about", "against",
    "among", "around", "without", "toward", "towards", "upon", "via",
    "including", "except", "besides",
  ]);
  for (const match of text.matchAll(/\b([\p{L}]+)\s+((?:you|me|him|her|us|them|[\p{L}][\p{L}'’-]*)(?:\s*,\s*[\p{L}][\p{L}'’-]*)*\s+(?:and|or)\s+)+(I)\b/gu)) {
    if (!OBJECT_PREPOSITIONS.has((match[1] ?? "").toLocaleLowerCase())) continue;
    const pronoun = match[3] ?? "";
    if (pronoun !== "I") continue;
    const afterPronoun = /^\s*([\p{L}']+)/u.exec(text.slice((match.index ?? 0) + match[0].length))?.[1]?.toLocaleLowerCase() ?? "";
    if (verbLike(afterPronoun) || SUBJECT_SLOT_AUX.has(afterPronoun)) continue;
    const start = (match.index ?? 0) + match[0].length - 1;
    pushIssue(issues, makeIssue("grammar-object-pronoun", start, start + 1, "I", "me", "grammar", "high", "Check the pronoun case", "After a preposition, use “me” (“between you and me”), not “I”.", 0.9, preferences));
  }
  // Double comparatives and superlatives ("more better", "most biggest").
  // "More"/"most" never precede an already-inflected form, so a curated
  // set is enough — morphology alone would catch nouns like "water" and
  // "power". Hyphenated compounds ("best-sellers") are excluded.
  const DOUBLE_COMPARATIVES = new Set([
    "better", "best", "worse", "worst", "lesser", "least",
    "bigger", "biggest", "smaller", "smallest", "greater", "greatest",
    "higher", "highest", "lower", "lowest", "larger", "largest",
    "faster", "fastest", "stronger", "strongest", "longer", "longest",
    "newer", "newest", "older", "oldest", "younger", "youngest",
    "easier", "easiest", "happier", "happiest", "simpler", "simplest",
    "earliest", "latest", "taller", "tallest", "shorter", "shortest",
    "quicker", "quickest", "slower", "slowest", "sooner",
    "louder", "loudest", "quieter", "quietest", "brighter",
    "darker", "darkest", "warmer", "warmest", "colder", "coldest",
    "harder", "hardest", "deeper", "deepest", "closer", "closest",
    "wider", "widest", "cleaner", "cleanest", "cheaper", "cheapest",
    "safer", "safest", "nicer", "nicest", "poorer", "poorest",
    "richer", "richest",
  ]);
  for (const match of text.matchAll(/\b(more|most|less|least)\s+([\p{L}][\p{L}'’-]*)(?!-)/giu)) {
    const trigger = match[1] ?? "";
    const adjective = match[2] ?? "";
    if (!DOUBLE_COMPARATIVES.has(adjective.toLocaleLowerCase())) continue;
    const start = match.index ?? 0;
    pushIssue(issues, makeIssue("grammar-double-comparative", start, start + match[0].length, match[0], preserveCase(trigger, adjective), "grammar", "high", "Remove the double comparative", `“${adjective}” already compares; drop “${trigger.toLocaleLowerCase()}”.`, 0.9, preferences));
  }
  // Perfect forms take the past participle, never the simple past ("I have
  // went" -> "gone", "could have saw" -> "seen"). Only forms where past
  // and participle differ are listed, so correct writing ("have taken",
  // "have cut") never matches. Guarded readings: determiners before
  // tool-nouns ("have a saw"), bit-parts, lay members, dove-grey paint,
  // hyphenated compounds, and Titlecase proper nouns. "rose" is deliberately
  // absent: after have it is far more often a flower. "gotten" maps to
  // "got", the en-GB form.
  const HAVE_TO_PARTICIPLE: Record<string, string> = {
    went: "gone", came: "come", became: "become", overcame: "overcome",
    saw: "seen", took: "taken", mistook: "mistaken", undertook: "undertaken",
    shook: "shaken", stole: "stolen", spoke: "spoken", broke: "broken",
    chose: "chosen", drove: "driven", wrote: "written", rode: "ridden",
    tore: "torn", wore: "worn", swore: "sworn", bore: "borne", born: "borne",
    fell: "fallen", forgot: "forgotten", gave: "given", hid: "hidden",
    withdrew: "withdrawn", underwent: "undergone", overtook: "overtaken",
    ate: "eaten", drank: "drunk", swam: "swum", began: "begun", ran: "run",
    sang: "sung", rang: "rung", sank: "sunk", sprang: "sprung",
    stank: "stunk", shrank: "shrunk", blew: "blown", drew: "drawn",
    flew: "flown", froze: "frozen", grew: "grown", knew: "known",
    threw: "thrown", did: "done", woke: "woken", beat: "beaten",
    bit: "bitten", lay: "lain", dove: "dived", gotten: "got",
  };
  const HAVE_PAST_PATTERN = Object.keys(HAVE_TO_PARTICIPLE).sort((a, b) => b.length - a.length).join("|");
  // A determiner just before the verb ("have a saw") is the noun reading,
  // never the perfect tense.
  const DETERMINER_BEFORE_NOUN = /(?:^|[^\p{L}])(?:a|an|the|this|that|these|those|my|your|his|her|its|our|their|some|any|no|every|each|several|many|few|two|three|four|five|six|seven|eight|nine|ten|both|all|other|another|such|what|which|whose)\s+$/iu;
  const BIT_PART_FOLLOWERS = new Set(["part", "role", "parts", "roles"]);
  const LAY_MEMBER_FOLLOWERS = new Set(["member", "members", "person", "people", "reader", "readers"]);
  const isTitlecaseProperNoun = (word: string) => /^[A-Z][a-z]/u.test(word);
  const nextWordAfter = (position: number) => /^\s*([\p{L}']+)/u.exec(text.slice(position))?.[1]?.toLocaleLowerCase() ?? "";
  const pushHaveParticiple = (match: RegExpMatchArray) => {
    const past = match[1] ?? "";
    const pastLower = past.toLocaleLowerCase();
    const participle = HAVE_TO_PARTICIPLE[pastLower];
    if (!participle) return;
    if (isTitlecaseProperNoun(past)) return;
    const verbStart = (match.index ?? 0) + (match[0]?.lastIndexOf(past) ?? 0);
    if (text[verbStart + past.length] === "-") return;
    const before = text.slice(0, verbStart);
    if (["saw", "bit", "spoke", "drove", "bore", "beat", "lay", "dove"].includes(pastLower) && DETERMINER_BEFORE_NOUN.test(before)) return;
    const follower = nextWordAfter(verbStart + past.length);
    if (pastLower === "bit" && BIT_PART_FOLLOWERS.has(follower)) return;
    if (pastLower === "lay" && LAY_MEMBER_FOLLOWERS.has(follower)) return;
    if (pastLower === "dove" && (follower === "grey" || follower === "gray")) return;
    if (pastLower === "beat" && ["writer", "writers", "reporter", "reporters", "journalist", "journalists", "poet", "poets", "cop", "cops"].includes(follower)) return;
    if (pastLower === "fell" && ["walk", "walks", "walking", "runner", "runners", "running", "race", "races"].includes(follower)) return;
    if (pastLower === "spoke" && ["wheel", "wheels", "wrench", "wrenches"].includes(follower)) return;
    pushIssue(issues, makeIssue("grammar-verb-participle", verbStart, verbStart + past.length, past, preserveCase(past, participle), "grammar", "high", "Check the verb form", `After “have”, use the past participle (“have ${participle}”), not the simple past (“${pastLower}”).`, 0.9, preferences));
  };
  for (const match of text.matchAll(new RegExp(`\\b(?:have|has|had|having|haven't|hasn't|hadn't)(?:\\s+not\\b)?(?:\\s+[\\p{L}][\\p{L}'’-]*\\b)?(?:\\s+(?:already|never|ever|just|recently|always|often|sometimes|rarely|still)\\b){0,2}\\s+(${HAVE_PAST_PATTERN})\\b`, "giu"))) pushHaveParticiple(match);
  for (const match of text.matchAll(new RegExp(`\\b[\\p{L}]+(?:['’]ve|['’]s|['’]d)(?:\\s+not\\b)?(?:\\s+(?:already|never|ever|just|recently|always|often|sometimes|rarely|still)\\b){0,2}\\s+(${HAVE_PAST_PATTERN})\\b`, "giu"))) pushHaveParticiple(match);
  // After do/does/did the verb is the base form ("didn't went" ->
  // "didn't go"). Every key differs from its base, so correct writing
  // never matches; Titlecase guards proper nouns ("Did Rose call?").
  const DID_TO_BASE: Record<string, string> = {
    went: "go", came: "come", saw: "see", took: "take", made: "make",
    got: "get", knew: "know", thought: "think", felt: "feel",
    became: "become", brought: "bring", began: "begin", kept: "keep",
    held: "hold", wrote: "write", stood: "stand", heard: "hear",
    meant: "mean", paid: "pay", met: "meet", ran: "run", sat: "sit",
    spoke: "speak", drove: "drive", broke: "break", chose: "choose",
    wore: "wear", tore: "tear", fell: "fall", forgot: "forget",
    gave: "give", hid: "hide", rode: "ride", rang: "ring", rose: "rise",
    sank: "sink", sang: "sing", shook: "shake", shot: "shoot",
    slept: "sleep", slid: "slide", stole: "steal", stuck: "stick",
    struck: "strike", swore: "swear", swept: "sweep", swung: "swing",
    threw: "throw", woke: "wake", won: "win", lost: "lose", sold: "sell",
    sent: "send", spent: "spend", built: "build", lent: "lend",
    said: "say", did: "do", done: "do", had: "have",
    has: "have", was: "be", were: "be", been: "be", ate: "eat",
    drank: "drink", swam: "swim", blew: "blow", drew: "draw",
    flew: "fly", froze: "freeze", grew: "grow", withdrew: "withdraw",
    undertook: "undertake", mistook: "mistake", bore: "bear", bit: "bite",
    dug: "dig", found: "find", founded: "found",
    stung: "sting", strung: "string", flung: "fling",
    clung: "cling", slung: "sling", hung: "hang", wept: "weep",
    crept: "creep", dreamt: "dream", learnt: "learn", burnt: "burn",
    spoilt: "spoil", spelt: "spell", spilt: "spill", smelt: "smell",
    knelt: "kneel", dealt: "deal", shone: "shine", lit: "light",
    led: "lead", laid: "lay", lain: "lie", dove: "dive", pled: "plead",
    gotten: "get",
  };
  const DID_PAST_PATTERN = Object.keys(DID_TO_BASE).sort((a, b) => b.length - a.length).join("|");
  for (const match of text.matchAll(new RegExp(`\\b(?:do|does|did|don't|doesn't|didn't|don’t|doesn’t|didn’t)(?:\\s+not\\b)?(?:\\s+[\\p{L}][\\p{L}'’-]*\\b)?\\s+(${DID_PAST_PATTERN})\\b`, "giu"))) {
    const past = match[1] ?? "";
    const pastLower = past.toLocaleLowerCase();
    const base = DID_TO_BASE[pastLower];
    if (!base || isTitlecaseProperNoun(past)) continue;
    const verbStart = (match.index ?? 0) + (match[0]?.lastIndexOf(past) ?? 0);
    const didFollower = nextWordAfter(verbStart + past.length);
    if (pastLower === "bit" && BIT_PART_FOLLOWERS.has(didFollower)) continue;
    if (pastLower === "dove" && (didFollower === "grey" || didFollower === "gray")) continue;
    if (pastLower === "found" && ["objects", "items", "artefacts", "artifacts", "remains", "fossils"].includes(didFollower)) continue;
    if (pastLower === "saw" && ["through", "off", "apart", "up", "down"].includes(didFollower)) continue;
    pushIssue(issues, makeIssue("grammar-verb-base", verbStart, verbStart + past.length, past, preserveCase(past, base), "grammar", "high", "Check the verb form", `After “did”, use the base verb (“did ${base}”), not the past tense (“${pastLower}”).`, 0.9, preferences));
  }
  // A bare "seen" after a pronoun is nonstandard ("I seen" -> "I saw"):
  // the participle needs its auxiliary. Adjacency is the whole test — "I
  // have seen" and "rarely seen" never match because have (or an adverb)
  // stands between.
  for (const match of text.matchAll(/\b(i|you|he|she|it|we|they|who)\s+(seen)\b/giu)) {
    const pronoun = match[1] ?? "";
    const seen = match[2] ?? "";
    const start = (match.index ?? 0) + (match[0]?.lastIndexOf(seen) ?? 0);
    pushIssue(issues, makeIssue("grammar-verb-participle", start, start + seen.length, seen, preserveCase(seen, "saw"), "grammar", "high", "Check the verb form", `“Seen” needs “have” (“have seen”); on its own, use “saw” (“${pronoun} saw”).`, 0.9, preferences));
  }
  // Singular distributives take singular verbs ("each have" -> "has",
  // "everyone don't" -> "doesn't"). The verb list is closed: only plural
  // verb forms match, so correct singulars never fire. Guards: time
  // adverbials ("every day do your best"), reciprocals ("each other"),
  // plural middle nouns (a determiner error, not a verb error), neither/nor
  // inversion ("neither have I"), mandative subjunctives ("require each
  // have"), and hypothetical "were".
  const EACH_BASES = [
    "want", "need", "like", "love", "hate", "know", "think", "feel",
    "seem", "appear", "believe", "consider", "prefer", "remember",
    "forget", "try", "study", "carry", "worry", "hurry", "cry",
    "fly", "say", "pay", "play", "stay", "enjoy", "agree", "see",
    "make", "take", "come", "run", "get", "find", "follow", "help",
    "work", "move", "start", "end", "mean", "leave", "change",
    "grow", "belong", "speak", "drive", "eat", "drink", "stand",
    "cover", "vary", "require", "provide", "offer", "include",
    "contain", "remain", "show", "tell", "use", "keep", "write", "build",
  ];
  const EACH_VERB_PATTERN = ["haven't", "don't", "have", "are", "were", "do", ...EACH_BASES].join("|");
  const EACH_TIME_WORDS = new Set(["day", "days", "morning", "evening", "night", "week", "weeks", "month", "months", "year", "years", "time"]);
  // Base verbs that double as attributive nouns ("study group", "work
  // email", "think tank"). With no subject words between the keyword and
  // the verb, such a match may be a noun compound, so it only fires when
  // the follower proves a verb frame: a determiner, pronoun, preposition,
  // relative, adverb, another verb, or the end of the clause. Other verbs
  // (have, want, say) are never attributive nouns and always fire.
  const NOUNY_VERBS = new Set([
    "study", "work", "play", "show", "end", "change", "move", "drink",
    "run", "love", "like", "need", "think", "help", "start", "try",
    "cover", "take", "find", "drive", "stand", "offer", "keep", "use",
    "mean", "leave", "build", "stay", "pay", "tell", "fly", "cry", "worry",
  ]);
  const EACH_SAFE_FOLLOWERS = new Set([
    "a", "an", "the", "this", "that", "these", "those", "my", "your",
    "his", "her", "its", "our", "their", "no", "any", "some", "every",
    "each", "what", "which", "whose", "whom", "who", "to", "of", "in",
    "on", "for", "with", "about", "at", "by", "from", "into", "over",
    "after", "before", "than", "as", "against", "among", "between",
    "without", "toward", "towards", "under", "through", "and", "or",
    "but", "not", "never", "always", "often", "usually", "sometimes",
    "rarely", "still", "just", "already", "ever", "here", "there",
    "now", "then", "so", "too", "also", "hard", "fast", "well",
    "better", "best", "worse", "worst", "early", "late", "soon",
    "long", "far", "much", "more", "most", "less", "little",
    "clearly", "carefully", "quietly", "quickly", "slowly", "deeply",
    "highly", "fully", "truly", "really", "me", "you", "him", "us",
    "them", "it", "nothing", "something", "anything", "everything",
  ]);
  const EACH_TO_SINGULAR: Record<string, string> = { have: "has", are: "is", were: "was", do: "does", "don't": "doesn't", "haven't": "hasn't" };
  for (const match of text.matchAll(new RegExp(`\\b(each|everyone|everybody|anyone|anybody|someone|somebody|nobody|every\\s+one|no\\s+one|any\\s+one|either|neither)\\b((?:\\s+of\\b(?:\\s+(?:the\\b)?[\\p{L}']+){1,3})?)((?:\\s+[\\p{L}']+){0,2}?)\\s+(${EACH_VERB_PATTERN})\\b`, "giu"))) {
    const keyword = (match[1] ?? "").toLocaleLowerCase().replace(/\s+/gu, " ");
    const ofPhrase = match[2] ?? "";
    const middleWords = (match[3] ?? "").trim().split(/\s+/u).filter(Boolean).map((word) => word.toLocaleLowerCase());
    const verb = match[4] ?? "";
    const verbLower = verb.toLocaleLowerCase();
    if (middleWords.includes("other")) continue;
    // A modal or auxiliary between the keyword and the verb ("nobody could
    // say", "each will have") puts the verb in a verb phrase the
    // distributive does not govern, so there is no agreement to judge.
    if (middleWords.some((word) => SUBJECT_SLOT_AUX.has(word))) continue;
    if ((keyword === "each" || keyword === "every") && middleWords.some((word) => EACH_TIME_WORDS.has(word))) continue;
    const lastMiddle = middleWords[middleWords.length - 1] ?? "";
    if (lastMiddle && (nounLooksPlural(lastMiddle) || PLURAL_OR_AMBIGUOUS_SUBJECTS.has(lastMiddle) || AMBIGUOUS_NUMBER_NOUNS.test(lastMiddle))) continue;
    if ((keyword === "either" || keyword === "neither") && !ofPhrase && middleWords.length === 0 && ["have", "are", "were", "do"].includes(verbLower)
      && ["i", "you", "he", "she", "it", "we", "they"].includes(nextWordAfter((match.index ?? 0) + match[0].length))) continue;
    const tailWords = (text.slice(0, match.index ?? 0).toLocaleLowerCase().match(/[\p{L}']+/gu) ?? []).slice(-3);
    if (tailWords.some((word) => MANDATIVE_GOVERNORS.has(word) || MANDATIVE_NOUNS.has(word))) continue;
    const verbStart = (match.index ?? 0) + (match[0]?.lastIndexOf(verb) ?? 0);
    if (verbLower === "were" && inHypotheticalClause(text, verbStart)) continue;
    if (middleWords.length === 0 && NOUNY_VERBS.has(verbLower)) {
      const follower = nextWordAfter((match.index ?? 0) + match[0].length);
      if (follower && !EACH_SAFE_FOLLOWERS.has(follower) && !SUBJECT_SLOT_AUX.has(follower) && !verbLike(follower)) continue;
    }
    const fixed = EACH_TO_SINGULAR[verbLower] ?? toThirdSingular(verbLower);
    pushIssue(issues, makeIssue("grammar-subject-verb-agreement", verbStart, verbStart + verb.length, verb, preserveCase(verb, fixed), "grammar", "high", "Check subject–verb agreement", "The verb should agree with the subject in number.", 0.9, preferences));
  }
  // Determiner–noun number agreement in three shapes: demonstratives with
  // kind/sort/type ("these kind" -> "these kinds", "this kinds" ->
  // "this kind"), "a" with a plural-only noun ("a phenomena" ->
  // "a phenomenon"), and "one of the" with a singular ("one of the
  // reason" -> "reasons"). Each map is closed, so correct pairings never
  // match.
  for (const match of text.matchAll(/\b(these|those|this|that)\s+(kind|sort|type|kinds|sorts|types)\s+of\b/giu)) {
    const demonstrative = (match[1] ?? "").toLocaleLowerCase();
    const noun = match[2] ?? "";
    const nounLower = noun.toLocaleLowerCase();
    const pluralDemonstrative = demonstrative === "these" || demonstrative === "those";
    const pluralNoun = nounLower.endsWith("s");
    if (pluralDemonstrative === pluralNoun) continue;
    const fixed = pluralDemonstrative ? `${nounLower}s` : nounLower.slice(0, -1);
    const start = (match.index ?? 0) + (match[0]?.lastIndexOf(noun) ?? 0);
    pushIssue(issues, makeIssue("grammar-determiner-agreement", start, start + noun.length, noun, preserveCase(noun, fixed), "grammar", "high", "Check determiner–noun agreement", `“${demonstrative}” needs the ${pluralDemonstrative ? "plural" : "singular"} (“${pluralDemonstrative ? "these kinds" : "this kind"} of …”).`, 0.9, preferences));
  }
  const PLURAL_ONLY_TO_SINGULAR: Record<string, string> = {
    phenomena: "phenomenon", criteria: "criterion", theses: "thesis",
    analyses: "analysis", hypotheses: "hypothesis", parentheses: "parenthesis",
    strata: "stratum", oases: "oasis",
  };
  for (const match of text.matchAll(/\b(a|an)\s+(phenomena|criteria|theses|analyses|hypotheses|parentheses|strata|oases)\b/giu)) {
    const noun = match[2] ?? "";
    const fixed = PLURAL_ONLY_TO_SINGULAR[noun.toLocaleLowerCase()] ?? noun;
    const start = (match.index ?? 0) + (match[0]?.lastIndexOf(noun) ?? 0);
    pushIssue(issues, makeIssue("grammar-determiner-agreement", start, start + noun.length, noun, preserveCase(noun, fixed), "grammar", "high", "Check determiner–noun agreement", `“A” takes the singular (“a ${fixed.toLocaleLowerCase()}”), not the plural.`, 0.9, preferences));
  }
  const ONE_OF_THE_TO_PLURAL: Record<string, string> = {
    reason: "reasons", problem: "problems", issue: "issues", thing: "things",
    way: "ways", day: "days", week: "weeks", month: "months", year: "years",
    man: "men", woman: "women", child: "children", mistake: "mistakes",
    factor: "factors", cause: "causes", feature: "features", benefit: "benefits",
    risk: "risks", challenge: "challenges", question: "questions",
    book: "books", film: "films", song: "songs", student: "students",
    member: "members", employee: "employees", customer: "customers",
    company: "companies", city: "cities", country: "countries", place: "places",
    time: "times", part: "parts", aspect: "aspects",
  };
  for (const match of text.matchAll(/\bone\s+of\s+the\s+(reason|problem|issue|thing|way|day|week|month|year|man|woman|child|mistake|factor|cause|feature|benefit|risk|challenge|question|book|film|song|student|member|employee|customer|company|city|country|place|time|part|aspect)\b/giu)) {
    const noun = match[1] ?? "";
    const fixed = ONE_OF_THE_TO_PLURAL[noun.toLocaleLowerCase()] ?? noun;
    const start = (match.index ?? 0) + (match[0]?.lastIndexOf(noun) ?? 0);
    pushIssue(issues, makeIssue("grammar-determiner-agreement", start, start + noun.length, noun, preserveCase(noun, fixed), "grammar", "high", "Check determiner–noun agreement", `After “one of the”, use the plural (“one of the ${fixed.toLocaleLowerCase()}”).`, 0.9, preferences));
  }
  // In a caseless draft the writer has abandoned standard register along
  // with capitals ("me and jake left"), so correcting pronoun case there
  // corrects the voice, not the writing — the same doctrine that keeps
  // comma splices and your/its out of such drafts. The whom fix follows
  // the same rule.
  const registerVoiceFixesSkip = isUncasedDraft(text);
  // Formal "whom" after a preposition ("the person to who I spoke" ->
  // "whom"). A following apostrophe ("who's", "who'd") is never this
  // construction.
  for (const match of text.matchAll(/\b(to|for|with|by|from|of|about|on|upon|against|among|between|without|toward|towards|under|over)\s+(who)\b(?!['’])/giu)) {
    if (registerVoiceFixesSkip) break;
    const who = match[2] ?? "";
    const start = (match.index ?? 0) + (match[0]?.lastIndexOf(who) ?? 0);
    pushIssue(issues, makeIssue("grammar-object-pronoun", start, start + who.length, who, preserveCase(who, "whom"), "grammar", "high", "Check the pronoun case", "After a preposition, use “whom” (“to whom I spoke”) in formal writing, not “who”.", 0.88, preferences));
  }
  // The subject mirror of the between-you-and-I rule: "John and me went"
  // and clause-initial "Me and John went" take "I", as does the
  // hypercorrect "John and myself attended". Prepositional objects ("for
  // John and me, yesterday was hard") and transitive governors ("tell John
  // and me lies") are skipped by checking what stands before the name; a
  // verb must follow the pronoun, otherwise the phrase is a fragment.
  const SUBJECT_PRONOUN_GOVERNORS = new Set([
    ...TRANSITIVE_GOVERNORS, "tell", "told", "show", "showed", "teach",
    "taught", "offer", "offered", "promise", "promised", "pay", "paid",
    "wish", "grant", "granted",
  ]);
  const subjectNameIsGoverned = (nameStart: number) => {
    if (isPrepositionalObject(text, nameStart)) return true;
    const previousRaw = /([\p{L}']+)\s*$/u.exec(text.slice(0, nameStart))?.[1] ?? "";
    const previous = previousRaw.toLocaleLowerCase();
    if (!previous) return false;
    if (SUBJECT_SLOT_AUX.has(previous) || SUBJECT_PRONOUN_GOVERNORS.has(previous)) return true;
    if (/(ed|ing)$/u.test(previous)) return true;
    return verbLike(previous) && !nounLooksPlural(previous);
  };
  const followsVerb = (position: number) => {
    const next = nextWordAfter(position);
    return SUBJECT_SLOT_AUX.has(next) || verbLike(next) || IRREGULAR_PAST_VERBS.has(next);
  };
  for (const match of text.matchAll(/\b([\p{L}][\p{L}'’-]*)\s+and\s+(me)\b/giu)) {
    if (registerVoiceFixesSkip) break;
    const name = match[1] ?? "";
    const me = match[2] ?? "";
    const nameStart = (match.index ?? 0) + (match[0]?.indexOf(name) ?? 0);
    if (subjectNameIsGoverned(nameStart)) continue;
    if (!followsVerb((match.index ?? 0) + match[0].length)) continue;
    const meStart = (match.index ?? 0) + (match[0]?.lastIndexOf(me) ?? 0);
    pushIssue(issues, makeIssue("grammar-subject-pronoun", meStart, meStart + me.length, me, "I", "grammar", "high", "Check the pronoun case", `Use “I” as part of the subject (“${name} and I”), not “me”.`, 0.9, preferences));
  }
  for (const match of text.matchAll(/(^|[.!?…;:\n]\s*|[—–-]\s*)(me)\s+and\s+([\p{L}][\p{L}'’-]*)/giu)) {
    if (registerVoiceFixesSkip) break;
    const prefix = match[1] ?? "";
    const meStart = (match.index ?? 0) + prefix.length;
    const name = match[3] ?? "";
    const phraseEnd = (match.index ?? 0) + match[0].length;
    if (!followsVerb(phraseEnd) && !reflexiveFollowedByVerb(text, phraseEnd)) continue;
    const original = text.slice(meStart, phraseEnd);
    pushIssue(issues, makeIssue("grammar-subject-pronoun", meStart, phraseEnd, original, `${name} and I`, "grammar", "high", "Check the pronoun case", `Start with “${name} and I” as the subject, not “me”.`, 0.9, preferences));
  }
  for (const match of text.matchAll(/\b([\p{L}][\p{L}'’-]*)\s+and\s+(myself)\b/giu)) {
    if (registerVoiceFixesSkip) break;
    const nameStart = (match.index ?? 0) + (match[0]?.indexOf(match[1] ?? "") ?? 0);
    if (subjectNameIsGoverned(nameStart)) continue;
    const myself = match[2] ?? "";
    const myselfStart = (match.index ?? 0) + (match[0]?.lastIndexOf(myself) ?? 0);
    if (!followsVerb(myselfStart + myself.length) && !reflexiveFollowedByVerb(text, myselfStart + myself.length)) continue;
    pushIssue(issues, makeIssue("grammar-subject-pronoun", myselfStart, myselfStart + myself.length, myself, "I", "grammar", "high", "Check the pronoun case", `“Myself” needs its antecedent (“I myself”); as part of the subject, use “I”.`, 0.9, preferences));
  }
  for (const match of text.matchAll(/(^|[.!?…;:\n]\s*|[—–-]\s*)(myself)\s+and\s+([\p{L}][\p{L}'’-]*)/giu)) {
    if (registerVoiceFixesSkip) break;
    const prefix = match[1] ?? "";
    const myselfStart = (match.index ?? 0) + prefix.length;
    const name = match[3] ?? "";
    const phraseEnd = (match.index ?? 0) + match[0].length;
    if (!followsVerb(phraseEnd) && !reflexiveFollowedByVerb(text, phraseEnd)) continue;
    const original = text.slice(myselfStart, phraseEnd);
    pushIssue(issues, makeIssue("grammar-subject-pronoun", myselfStart, phraseEnd, original, `${name} and I`, "grammar", "high", "Check the pronoun case", `Start with “${name} and I” as the subject, not “myself”.`, 0.9, preferences));
  }
  // Redundant prepositions: "off of", "inside of", "outside of", and
  // "where is the station at". The where-pattern needs a verb in the
  // clause ("where the party at" is a different register, left alone) and
  // skips the idiom "where it's at". The removed space must be a plain
  // space, never a line break, so lines never join.
  for (const match of text.matchAll(/\b(off|inside|outside)\s+(of)\b/giu)) {
    const word = (match[1] ?? "").toLocaleLowerCase();
    const of = match[2] ?? "";
    const ofStart = (match.index ?? 0) + (match[0]?.lastIndexOf(of) ?? 0);
    if (text[ofStart - 1] !== " ") continue;
    pushIssue(issues, makeIssue("grammar-redundant-preposition", ofStart - 1, ofStart + of.length, text.slice(ofStart - 1, ofStart + of.length), "", "grammar", "high", "Remove the redundant word", `“Of” adds nothing after “${word}” (“${word} the table”, not “${word} of the table”).`, 0.88, preferences));
  }
  for (const match of text.matchAll(/\b[Ww]here\b([^?.!\n]{0,80}?)\s+(at)(?=\s*[?.!])/gu)) {
    const clause = match[1] ?? "";
    if (!/\b(is|are|was|were|be|been|do|does|did|have|has|had|can|could|will|would|shall|should|may|might|must)\b/i.test(clause)) continue;
    if (/(?:it's|it\s+is)\s*$/i.test(clause)) continue;
    const at = match[2] ?? "";
    const atStart = (match.index ?? 0) + (match[0]?.lastIndexOf(at) ?? 0);
    if (text[atStart - 1] !== " ") continue;
    pushIssue(issues, makeIssue("grammar-redundant-preposition", atStart - 1, atStart + at.length, text.slice(atStart - 1, atStart + at.length), "", "grammar", "high", "Remove the redundant word", `In “where” questions the “at” adds nothing (“Where is the station?”).`, 0.88, preferences));
  }
  // "The reason is because" doubles the explanation: reason already says
  // why, so the clause takes "that".
  for (const match of text.matchAll(/\breasons?\s+(is|are|was|were)\s+(because)\b/giu)) {
    const because = match[2] ?? "";
    const start = (match.index ?? 0) + (match[0]?.lastIndexOf(because) ?? 0);
    pushIssue(issues, makeIssue("grammar-reason-is-because", start, start + because.length, because, preserveCase(because, "that"), "grammar", "high", "Check the sentence structure", `Use “that” after “the reason is” (“the reason is that …”), not “because”.`, 0.88, preferences));
  }
  // Possessive pronouns never take an apostrophe ("its'" -> "its"). A
  // word that directly follows an opening quote ('its') is quoted speech —
  // writers quote a word to discuss it — not a typo, so it is left alone.
  // A genuine typo never abuts an opening quote.
  const POSSESSIVE_NO_APOSTROPHE: Record<string, string> = {
    "its'": "its", "your's": "yours", "our's": "ours", "their's": "theirs", "her's": "hers",
  };
  const QUOTE_CHARS = new Set(["'", "’", '"', "“", "”", "‘", "«", "»"]);
  for (const match of text.matchAll(/\b(its'|your's|our's|their's|her's)(?![\p{L}])/giu)) {
    const original = match[1] ?? "";
    const start = (match.index ?? 0) + (match[0]?.indexOf(original) ?? 0);
    const previousChar = text[start - 1] ?? "";
    if (QUOTE_CHARS.has(previousChar)) continue;
    const fixed = POSSESSIVE_NO_APOSTROPHE[original.toLocaleLowerCase()] ?? original;
    pushIssue(issues, makeIssue("grammar-possessive-apostrophe", start, start + original.length, original, preserveCase(original, fixed), "grammar", "high", "Check the apostrophe", `Possessive pronouns never take an apostrophe (“${fixed.toLocaleLowerCase()}”, not “${original.toLocaleLowerCase()}”).`, 0.95, preferences));
  }
  // Countable nouns take "fewer"/"many"/"number", not "less"/
  // "much"/"amount". The noun list is closed, mass nouns never match, and
  // the idiomatic frames ("less than five", "one less thing", "much
  // less", "a less ...") are skipped.
  const COUNTABLE_PLURALS = ["people", "children", "men", "women", "cars", "mistakes", "errors", "problems", "issues", "options", "choices", "things", "items", "cases", "members", "workers", "students", "pupils", "patients", "customers", "clients", "guests", "visitors", "words", "pages", "minutes", "hours", "days", "weeks", "months", "years", "deaths", "injuries", "accidents", "crimes", "jobs", "houses", "homes", "shops", "stores", "schools", "hospitals", "dogs", "cats", "birds", "trees", "flowers", "books", "films", "songs", "girls", "boys"];
  const COUNTABLE_PATTERN = COUNTABLE_PLURALS.join("|");
  for (const match of text.matchAll(new RegExp(`\\b(less)\\s+(${COUNTABLE_PATTERN})\\b`, "giu"))) {
    const less = match[1] ?? "";
    const before = text.slice(0, match.index ?? 0);
    if (/\b(?:one|much|a|an)\s+$/i.test(before)) continue;
    const afterLess = /^\s*([\p{L}']+)/u.exec(text.slice((match.index ?? 0) + less.length))?.[1]?.toLocaleLowerCase() ?? "";
    if (afterLess === "than" || afterLess === "of") continue;
    pushIssue(issues, makeIssue("grammar-fewer-less", match.index ?? 0, (match.index ?? 0) + less.length, less, preserveCase(less, "fewer"), "grammar", "high", "Check less vs fewer", `Use “fewer” with countable nouns (“fewer ${match[2]?.toLocaleLowerCase() ?? "items"}”); “less” is for uncountable amounts (“less money”).`, 0.9, preferences));
  }
  for (const match of text.matchAll(new RegExp(`\\b(amount)\\s+of\\s+(${COUNTABLE_PATTERN})\\b`, "giu"))) {
    const amount = match[1] ?? "";
    pushIssue(issues, makeIssue("grammar-amount-number", match.index ?? 0, (match.index ?? 0) + amount.length, amount, preserveCase(amount, "number"), "grammar", "high", "Check amount vs number", `Use “number” with countable nouns (“number of ${match[2]?.toLocaleLowerCase() ?? "items"}”); “amount” is for uncountables (“amount of money”).`, 0.9, preferences));
  }
  for (const match of text.matchAll(new RegExp(`\\b(much)\\s+(of\\s+)?(${COUNTABLE_PATTERN})\\b`, "giu"))) {
    const much = match[1] ?? "";
    const ofPart = match[2] ?? "";
    if (/\b(a|an)\b/i.test(ofPart)) continue;
    pushIssue(issues, makeIssue("grammar-many-much", match.index ?? 0, (match.index ?? 0) + much.length, much, preserveCase(much, "many"), "grammar", "high", "Check much vs many", `Use “many” with countable nouns (“many ${(match[3] ?? "items").toLocaleLowerCase()}”); “much” is for uncountables (“much time”).`, 0.9, preferences));
  }
  const UNCOUNTABLE_TO_SINGULAR: Record<string, string> = {
    informations: "information", advices: "advice", furnitures: "furniture", equipments: "equipment", luggages: "luggage",
  };
  for (const match of text.matchAll(/\b(many)\s+(informations|advices|furnitures|equipments|luggages)\b/giu)) {
    const many = match[1] ?? "";
    const noun = match[2] ?? "";
    const singular = UNCOUNTABLE_TO_SINGULAR[noun.toLocaleLowerCase()] ?? noun;
    pushIssue(issues, makeIssue("grammar-many-much", match.index ?? 0, (match.index ?? 0) + match[0].length, match[0], `${preserveCase(many, "much")} ${preserveCase(noun, singular)}`, "grammar", "high", "Check much vs many", `“${singular}” is uncountable: “much ${singular}”, not “many ${noun.toLocaleLowerCase()}”.`, 0.9, preferences));
  }
  const trimmed = text.trim();
  const lastSentence = document.sentences[document.sentences.length - 1];
  const lastToken = document.tokens[document.tokens.length - 1];
  // A message with no letter case has no convention for terminal stops either,
  // and its last line is usually a sign-off rather than a forgotten full stop.
  const uncased = isUncasedDraft(text);
  if (!uncased && trimmed && lastSentence && lastToken && lastSentence.tokens.length >= 4 && /[\p{L}\p{N})\]]$/u.test(trimmed) && /\s/u.test(lastSentence.text)) {
    const lastLower = lastToken.lower.split(/[’']/u)[0];
    const hasVerb = VERB_HINTS.has(lastLower) || lastSentence.tokens.some((token) => /(?:ed|ing|s)$/u.test(token.lower));
    if (hasVerb) pushIssue(issues, makeIssue("punctuation-missing-terminal", lastToken.start, lastToken.end, lastToken.value, `${lastToken.value}.`, "punctuation", "low", "Add terminal punctuation", "A complete sentence usually ends with punctuation.", 0.82, preferences));
  }
  return issues;
}

export function findPunctuation(text: string, preferences: StylePreferences) {
  const issues: WritingIssue[] = [];
  for (const match of text.matchAll(/ {2,}/g)) {
    const start = match.index ?? 0;
    // Leading spaces on a line are indentation, not a stray double space:
    // nested list items and indented code are both written that way on purpose.
    const lineStart = text.lastIndexOf("\n", start - 1) + 1;
    if (!text.slice(lineStart, start).trim()) continue;
    pushIssue(issues, makeIssue("punctuation-extra-space", start, start + match[0].length, match[0], " ", "punctuation", "low", "Extra space", "A single space keeps the document’s rhythm consistent.", 0.99, preferences));
  }
  // Anchored to a preceding non-space. Unanchored, `\s+` consumed a whole run of
  // whitespace and then gave it back one character at a time looking for a
  // punctuation mark that was not there, at every start position in the run —
  // roughly 1.5s on a 16 KB run of newlines, on the keystroke path. The
  // lookbehind makes the run only start where a word has just ended.
  for (const match of text.matchAll(/(?<=\S)\s+([,.;!?])/g)) {
    const start = match.index ?? 0;
    pushIssue(issues, makeIssue("punctuation-space-before", start, start + match[0].length, match[0], match[1] ?? "", "punctuation", "medium", "Space before punctuation", "Punctuation sits directly after the word before it.", 0.99, preferences));
  }
  for (const match of text.matchAll(/([!?.,])\1+/g)) {
    const start = match.index ?? 0;
    pushIssue(issues, makeIssue("punctuation-repeated", start, start + match[0].length, match[0], match[1] ?? "", "punctuation", "low", "Repeated punctuation", "One punctuation mark is enough unless the style intentionally calls for emphasis.", 0.98, preferences));
  }
  if (preferences.oxfordComma) {
    for (const match of text.matchAll(/\b([\p{L}]+,\s+[\p{L}]+)\s+(and|or)\s+([\p{L}]+)\b/giu)) {
      const conjunction = match[2] ?? "and";
      const conjunctionIndex = (match.index ?? 0) + match[0].lastIndexOf(` ${conjunction} `) + 1;
      pushIssue(issues, makeIssue("punctuation-oxford-comma", conjunctionIndex, conjunctionIndex + conjunction.length + 1, ` ${conjunction}`, `, ${conjunction}`, "punctuation", "low", "Consider the Oxford comma", "Your style profile prefers a comma before the final conjunction in a list.", 0.72, preferences));
    }
  }
  return issues;
}

/**
 * Words whose full stop does not end a sentence.
 *
 * Without this, "Mr. smith", "Dr. jones", "St. mary parish", "etc. the rest"
 * and "vs. the other option" were all reported as lowercase sentence starts,
 * at 0.99 confidence, counting against correctness.
 */
const SENTENCE_ABBREVIATIONS = new Set([
  "mr", "mrs", "ms", "dr", "prof", "sr", "jr", "st", "vs", "etc", "eg", "ie",
  "approx", "est", "dept", "univ", "vol", "ch", "pp", "fig", "no", "al",
  "inc", "ltd", "co", "corp", "ave", "blvd", "min", "max",
]);

function endsWithAbbreviation(text: string, stopIndex: number) {
  let start = stopIndex;
  while (start > 0 && /[\p{L}.]/u.test(text[start - 1])) start -= 1;
  return isAbbreviationWord(text.slice(start, stopIndex));
}

function isAbbreviationWord(word: string) {
  const normalised = word.toLowerCase().replace(/\./gu, "");
  return normalised.length > 0 && SENTENCE_ABBREVIATIONS.has(normalised);
}

export function findCapitalization(text: string, preferences: StylePreferences) {
  const issues: WritingIssue[] = [];
  // Uncased drafts get no capitalisation advice at all: see isUncasedDraft.
  if (isUncasedDraft(text)) return issues;
  for (const match of text.matchAll(/(^|[.!?]\s+)([a-z])/g)) {
    const prefix = match[1] ?? "";
    const start = (match.index ?? 0) + prefix.length;
    // "Mr. smith" and "etc. the rest" are correct as written. A full stop that
    // closes a known abbreviation is not a sentence boundary, and neither is
    // the very start of a draft that opens with one.
    const precededByAbbreviation = prefix && (match.index ?? 0) > 0 && endsWithAbbreviation(text, (match.index ?? 0) + prefix.length - 2);
    const opensWithAbbreviation = isAbbreviationWord(/^[\p{L}.]+/u.exec(text.slice(start))?.[0] ?? "");
    if (precededByAbbreviation || opensWithAbbreviation) continue;
    const original = match[2] ?? "";
    pushIssue(issues, makeIssue("capitalization-sentence-start", start, start + 1, original, original.toUpperCase(), "capitalization", "medium", "Start with a capital letter", "A new sentence usually begins with a capital letter, which makes the structure easier to scan.", 0.99, preferences));
  }
  for (const match of text.matchAll(/(^|[\s([{])i(?=[\s,.;!?)]|$)/g)) {
    const start = (match.index ?? 0) + (match[1]?.length ?? 0);
    pushIssue(issues, makeIssue("capitalization-pronoun-i", start, start + 1, "i", "I", "capitalization", "high", "Capitalise the pronoun I", "The first-person pronoun is conventionally capitalised in English.", 0.99, preferences));
  }
  return issues;
}
