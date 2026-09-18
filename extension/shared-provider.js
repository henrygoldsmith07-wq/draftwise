(() => {
const DraftwiseGrammarModule = (() => {

const DEFAULT_STYLE_PREFERENCES = {
    dialect: "en-GB",
    personalDictionary: [],
    ignoredWords: [],
    ignoredRuleIds: [],
    preferredTerminology: {},
    oxfordComma: true,
    allowContractions: true,
    passiveVoiceSensitivity: "normal",
    preferredSentenceLength: "balanced",
    blockedWords: [],
};
const WORD_PATTERN = /[\p{L}\p{N}]+(?:['’\-][\p{L}\p{N}]+)*/gu;
const TYPO_FIXES = {
    alot: "a lot",
    definately: "definitely",
    enviroment: "environment",
    occured: "occurred",
    recieve: "receive",
    seperate: "separate",
    thier: "their",
    untill: "until",
    wich: "which",
    youve: "you've",
    isnt: "isn't",
    cant: "can't",
    doesnt: "doesn't",
    shouldnt: "shouldn't",
    repeatd: "repeated",
    writting: "writing",
    accomodate: "accommodate",
    begining: "beginning",
    commited: "committed",
    embarass: "embarrass",
    independant: "independent",
    responsability: "responsibility",
    succesful: "successful",
    tommorrow: "tomorrow",
    writen: "written",
};
const DIALECT_VARIANTS = {
    analyze: { "en-GB": "analyse", "en-US": "analyze" },
    analyzed: { "en-GB": "analysed", "en-US": "analyzed" },
    analyzing: { "en-GB": "analysing", "en-US": "analyzing" },
    center: { "en-GB": "centre", "en-US": "center" },
    color: { "en-GB": "colour", "en-US": "color" },
    favor: { "en-GB": "favour", "en-US": "favor" },
    organize: { "en-GB": "organise", "en-US": "organize" },
    organized: { "en-GB": "organised", "en-US": "organized" },
    organization: { "en-GB": "organisation", "en-US": "organization" },
    recognize: { "en-GB": "recognise", "en-US": "recognize" },
    traveled: { "en-GB": "travelled", "en-US": "traveled" },
    behavior: { "en-GB": "behaviour", "en-US": "behavior" },
    license: { "en-GB": "licence", "en-US": "license" },
};
const FILLER_WORDS = new Set([
    "actually",
    "basically",
    "just",
    "really",
    "quite",
    "very",
    "perhaps",
    "simply",
    "somewhat",
    "clearly",
    "obviously",
]);
const WORDINESS = [
    ["in order to", "to"],
    ["at this point in time", "now"],
    ["due to the fact that", "because"],
    ["a number of", "many"],
    ["in the event that", "if"],
    ["for the purpose of", "to"],
    ["in close proximity to", "near"],
    ["make a decision", "decide"],
    ["come to a conclusion", "conclude"],
];
const CLICHES = [
    ["at the end of the day", "ultimately"],
    ["think outside the box", "think creatively"],
    ["low-hanging fruit", "easy opportunities"],
    ["moving forward", "next"],
    ["game changer", "major improvement"],
];
const VAGUE_WORDS = new Set(["thing", "things", "stuff", "somehow", "various", "aspects", "interesting"]);
const INTENSIFIERS = new Set(["very", "extremely", "incredibly", "totally", "absolutely", "highly"]);
const VERB_HINTS = new Set([
    "be", "is", "are", "was", "were", "have", "has", "had", "do", "does", "did", "make", "write", "keep",
    "use", "build", "show", "tell", "need", "want", "can", "should", "will", "may", "might", "could",
]);
const COMMON_WORDS = new Set([
    "a", "an", "and", "are", "as", "at", "be", "by", "for", "from", "has", "have", "in", "is", "it",
    "of", "on", "or", "that", "the", "this", "to", "was", "were", "with", "you", "your", "we", "our",
]);
const clamp = (value) => Math.max(0, Math.min(100, Math.round(value)));
function mergePreferences(options = {}) {
    return {
        ...DEFAULT_STYLE_PREFERENCES,
        ...options,
        personalDictionary: options.personalDictionary ?? DEFAULT_STYLE_PREFERENCES.personalDictionary,
        ignoredWords: options.ignoredWords ?? DEFAULT_STYLE_PREFERENCES.ignoredWords,
        ignoredRuleIds: options.ignoredRuleIds ?? DEFAULT_STYLE_PREFERENCES.ignoredRuleIds,
        preferredTerminology: options.preferredTerminology ?? DEFAULT_STYLE_PREFERENCES.preferredTerminology,
        blockedWords: options.blockedWords ?? DEFAULT_STYLE_PREFERENCES.blockedWords,
    };
}
function preserveCase(original, replacement) {
    if (!replacement)
        return replacement;
    if (original === original.toUpperCase())
        return replacement.toUpperCase();
    if (original[0] === original[0]?.toUpperCase())
        return replacement[0].toUpperCase() + replacement.slice(1);
    return replacement;
}
function tokensIn(text, offset = 0) {
    return [...text.matchAll(WORD_PATTERN)].map((match) => ({
        value: match[0],
        lower: match[0].toLocaleLowerCase(),
        start: offset + (match.index ?? 0),
        end: offset + (match.index ?? 0) + match[0].length,
    }));
}
function sentenceSpans(text) {
    const spans = [];
    const pattern = /[^.!?…\n]+(?:[.!?…]+|$)/gu;
    for (const match of text.matchAll(pattern)) {
        const raw = match[0];
        const leading = raw.search(/\S/u);
        if (leading < 0)
            continue;
        const start = (match.index ?? 0) + leading;
        const value = raw.slice(leading).trim();
        if (!value)
            continue;
        const end = start + value.length;
        spans.push({ text: value, start, end, tokens: tokensIn(value, start) });
    }
    return spans;
}
function shouldIgnore(ruleId, original, preferences) {
    const lower = original.trim().toLocaleLowerCase();
    return preferences.ignoredRuleIds.includes(ruleId) || preferences.ignoredWords.some((word) => word.toLocaleLowerCase() === lower) || preferences.personalDictionary.some((word) => word.toLocaleLowerCase() === lower);
}
function makeIssue(ruleId, start, end, original, replacement, category, severity, title, explanation, confidence, preferences) {
    if (!original || end <= start || shouldIgnore(ruleId, original, preferences))
        return null;
    return {
        id: `${ruleId}-${start}-${end}`,
        ruleId,
        start,
        end,
        original,
        replacement,
        category,
        severity,
        confidence: Math.max(0, Math.min(1, confidence)),
        title,
        explanation,
        source: "local",
    };
}
function pushIssue(target, value) {
    if (value)
        target.push(value);
}
function findSpelling(text, preferences) {
    const issues = [];
    for (const token of tokensIn(text)) {
        const typo = TYPO_FIXES[token.lower];
        const dialect = Object.entries(DIALECT_VARIANTS).find(([, variants]) => token.lower === variants[preferences.dialect].toLocaleLowerCase() || token.lower === variants[preferences.dialect === "en-GB" ? "en-US" : "en-GB"].toLocaleLowerCase());
        const dialectReplacement = dialect && token.lower !== dialect[1][preferences.dialect].toLocaleLowerCase()
            ? dialect[1][preferences.dialect]
            : undefined;
        const replacement = dialectReplacement ?? typo;
        if (!replacement || replacement.toLocaleLowerCase() === token.lower)
            continue;
        pushIssue(issues, makeIssue(dialectReplacement ? "dialect-spelling" : "spelling-common-typo", token.start, token.end, token.value, preserveCase(token.value, replacement), "spelling", dialectReplacement ? "low" : "high", dialectReplacement ? `Use ${preferences.dialect === "en-GB" ? "British" : "US"} spelling` : `Spelling: ${preserveCase(token.value, replacement)}`, dialectReplacement
            ? `Your style profile uses ${preferences.dialect === "en-GB" ? "British" : "US"} English. Keep the dialect consistent across the document.`
            : `“${token.value}” is a common spelling slip. The suggested replacement is “${preserveCase(token.value, replacement)}”.`, dialectReplacement ? 0.86 : 0.99, preferences));
    }
    return issues;
}
function findConfusedWords(text, preferences) {
    const issues = [];
    const patterns = [
        [/\b(your)\s+(welcome|going|right|sure)\b/giu, "you're", "grammar-confused-your", "Your is possessive; you’re means you are."],
        [/\b(its)\s+(a|an|not|been|going)\b/giu, "it's", "grammar-confused-its", "It’s means it is; its shows possession."],
        [/\b(their)\s+(is|are|was|were)\b/giu, "there", "grammar-confused-their", "There points to a place or introduces a statement."],
    ];
    for (const [pattern, replacement, ruleId, explanation] of patterns) {
        for (const match of text.matchAll(pattern)) {
            const start = (match.index ?? 0);
            const original = match[1] ?? "";
            const wordStart = start;
            pushIssue(issues, makeIssue(ruleId, wordStart, wordStart + original.length, original, preserveCase(original, replacement), "grammar", "medium", "Check the commonly confused word", explanation, 0.78, preferences));
        }
    }
    return issues;
}
function findPunctuation(text, preferences) {
    const issues = [];
    for (const match of text.matchAll(/ {2,}/g)) {
        const start = match.index ?? 0;
        pushIssue(issues, makeIssue("punctuation-extra-space", start, start + match[0].length, match[0], " ", "punctuation", "low", "Extra space", "A single space keeps the document’s rhythm consistent.", 0.99, preferences));
    }
    for (const match of text.matchAll(/\s+([,.;!?])/g)) {
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
function findCapitalization(text, preferences) {
    const issues = [];
    for (const match of text.matchAll(/(^|[.!?]\s+)([a-z])/g)) {
        const start = (match.index ?? 0) + (match[1]?.length ?? 0);
        const original = match[2] ?? "";
        pushIssue(issues, makeIssue("capitalization-sentence-start", start, start + 1, original, original.toUpperCase(), "capitalization", "medium", "Start with a capital letter", "A new sentence usually begins with a capital letter, which makes the structure easier to scan.", 0.99, preferences));
    }
    for (const match of text.matchAll(/(^|[\s([{])i(?=[\s,.;!?)]|$)/g)) {
        const start = (match.index ?? 0) + (match[1]?.length ?? 0);
        pushIssue(issues, makeIssue("capitalization-pronoun-i", start, start + 1, "i", "I", "capitalization", "high", "Capitalise the pronoun I", "The first-person pronoun is conventionally capitalised in English.", 0.99, preferences));
    }
    return issues;
}
function findRepeatedWordsAndPhrases(text, preferences) {
    const issues = [];
    const tokens = tokensIn(text);
    for (let index = 1; index < tokens.length; index += 1) {
        const previous = tokens[index - 1];
        const current = tokens[index];
        if (previous.lower !== current.lower || previous.end > current.start + 1)
            continue;
        pushIssue(issues, makeIssue("repetition-adjacent-word", previous.start, current.end, text.slice(previous.start, current.end), previous.value, "repetition", "medium", "Repeated word", "This word appears twice in a row. Removing the repeat keeps the sentence moving.", 0.99, preferences));
    }
    for (let index = 0; index + 3 < tokens.length; index += 1) {
        const phrase = tokens.slice(index, index + 2);
        const next = tokens.slice(index + 2, index + 4);
        if (phrase[0].lower !== next[0].lower || phrase[1].lower !== next[1].lower)
            continue;
        if (phrase[1].end > next[0].start + 1)
            continue;
        pushIssue(issues, makeIssue("repetition-repeated-phrase", phrase[0].start, next[1].end, text.slice(phrase[0].start, next[1].end), text.slice(phrase[0].start, phrase[1].end), "repetition", "medium", "Repeated phrase", "This short phrase is repeated back-to-back. Keep it once unless the repetition is deliberate.", 0.98, preferences));
    }
    const openings = new Map();
    for (const sentence of sentenceSpans(text)) {
        const opening = sentence.tokens.slice(0, 2).map((token) => token.lower).join(" ");
        if (!opening || opening.length < 4)
            continue;
        const existing = openings.get(opening);
        if (existing && sentence.start - existing.end < 600) {
            const end = Math.min(sentence.end, sentence.start + sentence.tokens.slice(0, 2).reduce((total, token) => total + token.value.length, 0) + 1);
            pushIssue(issues, makeIssue("repetition-sentence-opening", sentence.start, end, text.slice(sentence.start, end), "", "repetition", "low", "Vary the sentence opening", "Several nearby sentences start the same way. Varying the openings can improve rhythm.", 0.76, preferences));
        }
        else {
            openings.set(opening, sentence);
        }
    }
    return issues;
}
function findStyleIssues(text, preferences) {
    const issues = [];
    for (const [phrase, replacement] of WORDINESS) {
        const pattern = new RegExp(`\\b${phrase.replace(/ /g, "\\s+")}\\b`, "gi");
        for (const match of text.matchAll(pattern)) {
            const start = match.index ?? 0;
            pushIssue(issues, makeIssue(`wordiness-${phrase.replace(/ /g, "-")}`, start, start + match[0].length, match[0], preserveCase(match[0], replacement), "conciseness", "low", "Tighten this phrase", `“${phrase}” can usually be expressed more directly as “${replacement}”.`, 0.9, preferences));
        }
    }
    for (const [phrase, replacement] of CLICHES) {
        const pattern = new RegExp(`\\b${phrase.replace(/ /g, "\\s+")}\\b`, "gi");
        for (const match of text.matchAll(pattern)) {
            const start = match.index ?? 0;
            pushIssue(issues, makeIssue(`style-cliche-${phrase.replace(/ /g, "-")}`, start, start + match[0].length, match[0], replacement, "word choice", "low", "Possible cliché", "This familiar phrase may be less precise than a concrete alternative.", 0.72, preferences));
        }
    }
    for (const token of tokensIn(text)) {
        if (FILLER_WORDS.has(token.lower))
            pushIssue(issues, makeIssue("conciseness-filler", token.start, token.end, token.value, "", "conciseness", "low", "Possible filler word", "Remove it if the sentence keeps its meaning without it.", 0.8, preferences));
        if (VAGUE_WORDS.has(token.lower))
            pushIssue(issues, makeIssue("clarity-vague-word", token.start, token.end, token.value, "", "clarity", "low", "Vague wording", "A more specific noun may help the reader understand exactly what you mean.", 0.68, preferences));
        if (INTENSIFIERS.has(token.lower))
            pushIssue(issues, makeIssue("style-intensifier", token.start, token.end, token.value, "", "tone", "low", "Check the intensifier", "This intensifier may add emphasis without adding much meaning.", 0.72, preferences));
    }
    for (const [blocked, preferred] of Object.entries(preferences.preferredTerminology)) {
        if (!blocked || !preferred)
            continue;
        const pattern = new RegExp(`\\b${blocked.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi");
        for (const match of text.matchAll(pattern)) {
            const start = match.index ?? 0;
            pushIssue(issues, makeIssue("consistency-preferred-term", start, start + match[0].length, match[0], preserveCase(match[0], preferred), "consistency", "medium", "Use your preferred term", `Your style guide prefers “${preferred}” for consistent terminology.`, 0.95, preferences));
        }
    }
    if (!preferences.allowContractions) {
        const contractions = { "can't": "cannot", "won't": "will not", "don't": "do not", "it's": "it is", "we're": "we are", "you've": "you have" };
        for (const token of tokensIn(text)) {
            const replacement = contractions[token.lower];
            if (replacement)
                pushIssue(issues, makeIssue("style-contractions", token.start, token.end, token.value, preserveCase(token.value, replacement), "formality", "low", "Avoid contractions", "Your style profile prefers a more formal register.", 0.9, preferences));
        }
    }
    return issues;
}
function findStructureIssues(text, preferences) {
    const issues = [];
    const sentences = sentenceSpans(text);
    const sentenceLimit = preferences.preferredSentenceLength === "short" ? 22 : preferences.preferredSentenceLength === "long" ? 45 : 32;
    for (const sentence of sentences) {
        if (sentence.tokens.length > sentenceLimit) {
            pushIssue(issues, makeIssue("structure-long-sentence", sentence.start, sentence.end, sentence.text, "", "sentence structure", "low", "Long sentence", `This sentence has ${sentence.tokens.length} words. Consider splitting it if the ideas compete for attention.`, 0.84, preferences));
        }
        const hasVerb = sentence.tokens.some((token) => VERB_HINTS.has(token.lower) || /(?:ed|ing|s)$/u.test(token.lower));
        if (sentence.tokens.length >= 1 && sentence.tokens.length <= 3 && !hasVerb && !/[!?]$/u.test(sentence.text)) {
            pushIssue(issues, makeIssue("structure-fragment", sentence.start, sentence.end, sentence.text, "", "sentence structure", "low", "Possible sentence fragment", "This short sentence may be missing a verb. Keep it if the fragment is intentional.", 0.65, preferences));
        }
    }
    const paragraphs = text.split(/\n\s*\n/gu);
    let cursor = 0;
    for (const paragraph of paragraphs) {
        const start = text.indexOf(paragraph, cursor);
        cursor = Math.max(cursor, start + paragraph.length);
        const count = tokensIn(paragraph).length;
        if (count > 150)
            pushIssue(issues, makeIssue("structure-long-paragraph", start, start + paragraph.length, paragraph, "", "readability", "low", "Long paragraph", "A shorter paragraph can give the reader a useful pause.", 0.78, preferences));
    }
    const passiveSensitivity = preferences.passiveVoiceSensitivity;
    if (passiveSensitivity !== "off") {
        const pattern = /\b(?:was|were|is|are|be|been|being)\s+(?:being\s+)?[\p{L}]+(?:ed|en)\b/giu;
        for (const match of text.matchAll(pattern)) {
            const start = match.index ?? 0;
            pushIssue(issues, makeIssue("style-passive-voice", start, start + match[0].length, match[0], "", "passive voice", passiveSensitivity === "strict" ? "medium" : "low", "Try active voice", "Active voice often makes the actor and the action clearer. Keep this suggestion only when it matches your intent.", passiveSensitivity === "strict" ? 0.86 : 0.7, preferences));
        }
    }
    return issues;
}
function countSyllables(word) {
    const normalized = word.toLocaleLowerCase().replace(/(?:e|es|ed)$/u, "");
    return Math.max(1, (normalized.match(/[aeiouy]{1,2}/gu) ?? []).length);
}
function frequency(values, limit = 8) {
    const counts = new Map();
    for (const value of values)
        counts.set(value, (counts.get(value) ?? 0) + 1);
    return [...counts.entries()]
        .filter(([, count]) => count > 1)
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, limit)
        .map(([value, count]) => ({ value, count }));
}
function getWritingStats(text) {
    const tokens = tokensIn(text);
    const sentences = sentenceSpans(text);
    const paragraphs = text.trim() ? text.split(/\n\s*\n/gu).filter((paragraph) => paragraph.trim()).length : 0;
    const sentenceLengths = sentences.map((sentence) => sentence.tokens.length);
    const paragraphLengths = text.split(/\n\s*\n/gu).filter((paragraph) => paragraph.trim()).map((paragraph) => tokensIn(paragraph).length);
    const words = tokens.length;
    const syllables = tokens.reduce((total, token) => total + countSyllables(token.value), 0);
    const readability = words && sentences.length
        ? clamp(206.835 - 1.015 * (words / sentences.length) - 84.6 * (syllables / words))
        : 0;
    const sentenceWordValues = sentences.flatMap((sentence) => sentence.tokens.map((token) => token.lower));
    const repeatedWords = frequency(sentenceWordValues.filter((word) => !COMMON_WORDS.has(word)));
    const repeatedPhrases = frequency(sentences.flatMap((sentence) => sentence.tokens.slice(0, -1).map((token, index) => `${token.lower} ${sentence.tokens[index + 1].lower}`)));
    const fillerWordFrequency = frequency(sentenceWordValues.filter((word) => FILLER_WORDS.has(word)));
    const commonWords = frequency(sentenceWordValues.filter((word) => COMMON_WORDS.has(word))).slice(0, 8);
    const longest = sentences.reduce((current, sentence) => sentence.tokens.length > current.tokens.length ? sentence : current, { text: "", start: 0, end: 0, tokens: [] });
    const passiveVoice = [...text.matchAll(/\b(?:was|were|is|are|be|been|being)\s+(?:being\s+)?[\p{L}]+(?:ed|en)\b/giu)].length;
    return {
        words,
        characters: text.length,
        sentences: sentences.length,
        paragraphs,
        readingTime: words ? Math.max(1, Math.ceil(words / 200)) : 0,
        readability,
        longSentences: sentenceLengths.filter((length) => length > 32).length,
        fillerWords: sentenceWordValues.filter((word) => FILLER_WORDS.has(word)).length,
        passiveVoice,
        passiveVoicePercentage: sentences.length ? Math.round((passiveVoice / sentences.length) * 100) : 0,
        averageSentenceLength: sentenceLengths.length ? Math.round((words / sentenceLengths.length) * 10) / 10 : 0,
        longestSentence: longest.text,
        sentenceLengths,
        paragraphLengths,
        vocabularyDiversity: words ? Math.round((new Set(sentenceWordValues).size / words) * 100) / 100 : 0,
        repeatedWords,
        repeatedPhrases,
        fillerWordFrequency,
        commonWords,
    };
}
function inferTone(text) {
    const words = tokensIn(text).map((token) => token.lower);
    const confident = words.filter((word) => ["clear", "strong", "will", "can", "decisive", "proven"].includes(word)).length;
    const cautious = words.filter((word) => ["might", "maybe", "perhaps", "could", "possibly", "uncertain"].includes(word)).length;
    const direct = words.filter((word) => ["we", "you", "your", "our"].includes(word)).length;
    const tone = [];
    if (confident > cautious)
        tone.push("confident");
    if (cautious > 0)
        tone.push("thoughtful");
    if (direct > 0)
        tone.push("direct");
    if (text.includes("!"))
        tone.push("energetic");
    return [...new Set(tone)].slice(0, 3).length ? [...new Set(tone)].slice(0, 3) : ["neutral"];
}
function scoreContribution(score, summary, signals) {
    return { score, summary, signals: signals.slice(0, 4) };
}
function scoreWriting(stats, issues, goals) {
    const high = issues.filter((item) => item.severity === "high").length;
    const medium = issues.filter((item) => item.severity === "medium").length;
    const low = issues.filter((item) => item.severity === "low").length;
    const correctness = clamp(100 - high * 10 - medium * 4 - low * 1.2);
    const clarity = clamp(96 - stats.longSentences * 4 - stats.passiveVoice * 3 - issues.filter((item) => item.category === "clarity").length * 3);
    const conciseness = clamp(96 - stats.fillerWords * 3 - issues.filter((item) => item.category === "conciseness").length * 2 - Math.max(0, stats.words - 260) / 12);
    const readability = clamp(stats.readability || (stats.words ? 65 : 0));
    const engagement = clamp(70 + (inferTone(stats.longestSentence).includes("confident") ? 12 : 0) + Math.min(12, stats.vocabularyDiversity * 20));
    const consistency = clamp(100 - issues.filter((item) => item.category === "consistency" || item.category === "spelling").length * 4 - stats.repeatedWords.length * 2);
    const goalAlignment = goals ? clamp(84 - (goals.tone === "formal" && stats.fillerWords > 0 ? 8 : 0) - (goals.audience === "academic" && stats.passiveVoice > 3 ? 3 : 0)) : 84;
    const breakdown = {
        correctness: scoreContribution(correctness, "Based on actionable grammar, spelling, and punctuation findings.", [`${high} high-confidence high-impact issue${high === 1 ? "" : "s"}`, `${medium} medium-severity issue${medium === 1 ? "" : "s"}`]),
        clarity: scoreContribution(clarity, "Reflects sentence structure, clarity suggestions, passive voice, and long sentences.", [`${stats.longSentences} long sentence${stats.longSentences === 1 ? "" : "s"}`, `${stats.passiveVoicePercentage}% passive-voice estimate`]),
        conciseness: scoreContribution(conciseness, "Reflects filler words, wordiness, and document length signals.", [`${stats.fillerWords} filler-word finding${stats.fillerWords === 1 ? "" : "s"}`, `${stats.words} words`]),
        readability: scoreContribution(readability, "A transparent Flesch-style estimate, not an objective measure of quality.", [`Average sentence length: ${stats.averageSentenceLength || 0} words`, `Vocabulary diversity: ${Math.round(stats.vocabularyDiversity * 100)}%`]),
        engagement: scoreContribution(engagement, "A lightweight signal based on directness and vocabulary variety.", [inferTone(stats.longestSentence).join(", ") || "neutral tone signal"]),
        consistency: scoreContribution(consistency, "Reflects repeated terms, dialect consistency, and terminology findings.", [`${stats.repeatedWords.length} repeated vocabulary pattern${stats.repeatedWords.length === 1 ? "" : "s"}`]),
        goalAlignment: scoreContribution(goalAlignment, "A best-effort guide using the selected audience and tone; it is not a verdict.", [goals ? `${goals.audience} audience` : "No goal selected", goals ? `${goals.tone} tone` : "Neutral baseline"]),
    };
    const overall = clamp(correctness * 0.28 + clarity * 0.16 + conciseness * 0.14 + readability * 0.14 + engagement * 0.1 + consistency * 0.1 + goalAlignment * 0.08);
    return { correctness, clarity, conciseness, readability, engagement, consistency, goalAlignment, overall, grammar: correctness, breakdown };
}
function mergeWritingIssues(issues) {
    const sorted = [...issues]
        .filter((item) => item.start >= 0 && item.end > item.start && item.original.length > 0)
        .sort((a, b) => a.start - b.start || b.end - a.end || b.confidence - a.confidence);
    const result = [];
    for (const candidate of sorted) {
        const same = result.findIndex((item) => item.start === candidate.start && item.end === candidate.end && item.original.toLocaleLowerCase() === candidate.original.toLocaleLowerCase());
        if (same >= 0) {
            if (candidate.source === "ai" && result[same].source === "local" && candidate.confidence > result[same].confidence)
                result[same] = candidate;
            continue;
        }
        const overlap = result.findIndex((item) => candidate.start < item.end && candidate.end > item.start);
        if (overlap >= 0) {
            const existing = result[overlap];
            const candidateRank = (candidate.severity === "high" ? 3 : candidate.severity === "medium" ? 2 : 1) + candidate.confidence;
            const existingRank = (existing.severity === "high" ? 3 : existing.severity === "medium" ? 2 : 1) + existing.confidence;
            if (candidateRank > existingRank)
                result[overlap] = candidate;
            continue;
        }
        result.push(candidate);
    }
    return result.sort((a, b) => a.start - b.start || a.end - b.end);
}
function analyzeLocally(text, options = {}, goals) {
    const preferences = mergePreferences(options);
    const issues = mergeWritingIssues([
        ...findSpelling(text, preferences),
        ...findConfusedWords(text, preferences),
        ...findPunctuation(text, preferences),
        ...findCapitalization(text, preferences),
        ...findRepeatedWordsAndPhrases(text, preferences),
        ...findStyleIssues(text, preferences),
        ...findStructureIssues(text, preferences),
    ]);
    const stats = getWritingStats(text);
    return { issues, tone: inferTone(text), stats, scores: scoreWriting(stats, issues, goals) };
}
const categoryColors = {
    spelling: "#e25d70",
    grammar: "#ef9f55",
    punctuation: "#8b78e6",
    clarity: "#4a9a9d",
    conciseness: "#d8944a",
    "word choice": "#3e87c7",
    repetition: "#d46191",
    tone: "#7b6fd2",
    formality: "#4e879c",
    readability: "#4e879c",
    fluency: "#4e879c",
    "passive voice": "#b5794e",
    "sentence structure": "#7a9d5e",
    consistency: "#6a8f68",
    capitalization: "#bf7a42",
};

return { analyzeLocally, getWritingStats };
})();
const DraftwiseAnalysisModule = (() => {

const DEFAULT_MAX_CHARS = 8_000;
const DEFAULT_CONTEXT_WINDOW = 320;
function detectChangedRange(previousText, nextText) {
    if (previousText === nextText)
        return null;
    let start = 0;
    while (start < previousText.length &&
        start < nextText.length &&
        previousText.charCodeAt(start) === nextText.charCodeAt(start)) {
        start += 1;
    }
    let previousEnd = previousText.length;
    let end = nextText.length;
    while (previousEnd > start &&
        end > start &&
        previousText.charCodeAt(previousEnd - 1) === nextText.charCodeAt(end - 1)) {
        previousEnd -= 1;
        end -= 1;
    }
    return { start, end, previousEnd };
}
function moveToBoundary(text, offset, direction) {
    if (direction === "left") {
        const match = text.slice(0, offset).search(/\s+[^\s]*$/u);
        return match >= 0 ? match : offset;
    }
    const match = text.slice(offset).search(/\s/u);
    return match >= 0 ? offset + match : offset;
}
function expandRangeToContext(text, range, contextWindow = DEFAULT_CONTEXT_WINDOW) {
    const start = Math.max(0, moveToBoundary(text, Math.max(0, range.start - contextWindow), "left"));
    const end = Math.min(text.length, moveToBoundary(text, Math.min(text.length, range.end + contextWindow), "right"));
    return { ...range, start, end };
}
function createAnalysisChunks(text, options = {}) {
    if (!text)
        return [];
    const maxChars = Math.max(500, options.maxChars ?? DEFAULT_MAX_CHARS);
    const contextWindow = Math.max(0, options.contextWindow ?? DEFAULT_CONTEXT_WINDOW);
    const requestedStart = Math.max(0, Math.min(text.length, options.startOffset ?? 0));
    const requestedEnd = Math.max(requestedStart, Math.min(text.length, options.endOffset ?? text.length));
    const chunks = [];
    let contentStart = requestedStart;
    while (contentStart < requestedEnd) {
        let contentEnd = Math.min(requestedEnd, contentStart + maxChars);
        if (contentEnd < requestedEnd) {
            const boundary = moveToBoundary(text, contentEnd, "left");
            if (boundary > contentStart + Math.floor(maxChars * 0.55))
                contentEnd = boundary;
        }
        if (contentEnd <= contentStart)
            contentEnd = Math.min(requestedEnd, contentStart + maxChars);
        const startOffset = Math.max(requestedStart, contentStart - contextWindow);
        const endOffset = Math.min(requestedEnd, contentEnd + contextWindow);
        chunks.push({
            id: `chunk-${contentStart}-${contentEnd}`,
            text: text.slice(startOffset, endOffset),
            startOffset,
            endOffset,
            contentStartOffset: contentStart,
            contentEndOffset: contentEnd,
        });
        contentStart = contentEnd;
    }
    return chunks;
}
function mapRelativeRange(range, chunk, sourceText) {
    const start = chunk.startOffset + Math.floor(range.start);
    const end = chunk.startOffset + Math.floor(range.end);
    if (start < chunk.startOffset || end > chunk.endOffset || end <= start)
        return null;
    const original = sourceText.slice(start, end);
    if (!original || original !== range.original)
        return null;
    return { start, end, original };
}
function mapChunkIssue(issue, chunk, sourceText) {
    const mapped = mapRelativeRange(issue, chunk, sourceText);
    if (!mapped)
        return null;
    return { ...issue, ...mapped, chunkId: chunk.id };
}
function issueRank(issue) {
    const severity = issue.severity === "high" ? 3 : issue.severity === "medium" ? 2 : 1;
    const source = issue.source === "local" ? 0.1 : 0;
    return severity + issue.confidence + source;
}
function mergeAnalysisIssues(issues) {
    const candidates = issues
        .filter((item) => Number.isFinite(item.start) && Number.isFinite(item.end))
        .filter((item) => item.start >= 0 && item.end > item.start && item.original.length > 0)
        .map((item) => ({ ...item, confidence: Math.max(0, Math.min(1, item.confidence ?? 0.5)) }))
        .sort((a, b) => a.start - b.start || b.end - a.end || issueRank(b) - issueRank(a));
    const deduped = [];
    const keys = new Set();
    for (const candidate of candidates) {
        const key = `${candidate.start}:${candidate.end}:${candidate.original.toLocaleLowerCase()}:${candidate.replacement.toLocaleLowerCase()}`;
        const existingIndex = deduped.findIndex((item) => item.start === candidate.start &&
            item.end === candidate.end &&
            item.original.toLocaleLowerCase() === candidate.original.toLocaleLowerCase());
        if (existingIndex >= 0) {
            if (issueRank(candidate) > issueRank(deduped[existingIndex]))
                deduped[existingIndex] = candidate;
            continue;
        }
        if (keys.has(key))
            continue;
        const overlapIndex = deduped.findIndex((item) => candidate.start < item.end && candidate.end > item.start);
        if (overlapIndex >= 0) {
            if (issueRank(candidate) > issueRank(deduped[overlapIndex]))
                deduped[overlapIndex] = candidate;
            continue;
        }
        keys.add(key);
        deduped.push(candidate);
    }
    return deduped.sort((a, b) => a.start - b.start || a.end - b.end);
}
class LruCache {
    values = new Map();
    limit;
    constructor(limit = 32) {
        this.limit = limit;
    }
    get(key) {
        const value = this.values.get(key);
        if (value !== undefined) {
            this.values.delete(key);
            this.values.set(key, value);
        }
        return value;
    }
    set(key, value) {
        this.values.delete(key);
        this.values.set(key, value);
        while (this.values.size > this.limit)
            this.values.delete(this.values.keys().next().value);
    }
    clear() {
        this.values.clear();
    }
    get size() {
        return this.values.size;
    }
}
function createAnalysisCacheKey(text, settingsKey, range) {
    const rangeKey = range ? `${range.start}:${range.end}:${range.previousEnd}` : "full";
    return `${settingsKey}:${rangeKey}:${text}`;
}

return { createAnalysisChunks, expandRangeToContext, mapChunkIssue, mergeAnalysisIssues };
})();
const DraftwiseProviderModule = (() => {
const { createAnalysisChunks, expandRangeToContext, mapChunkIssue, mergeAnalysisIssues } = DraftwiseAnalysisModule;
const { analyzeLocally, getWritingStats, inferTone, scoreWriting } = DraftwiseGrammarModule;

"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.analyzeWithProvider = analyzeWithProvider;
exports.rewriteWithProvider = rewriteWithProvider;
const CATEGORY_ALIASES = {
    style: "clarity",
    wordiness: "conciseness",
    capitalization: "capitalization",
    "sentence structure": "sentence structure",
    "passive voice": "passive voice",
    grammar: "grammar",
    spelling: "spelling",
    punctuation: "punctuation",
    clarity: "clarity",
    conciseness: "conciseness",
    "word choice": "word choice",
    repetition: "repetition",
    tone: "tone",
    formality: "formality",
    readability: "readability",
    fluency: "fluency",
    consistency: "consistency",
};
const VALID_SEVERITIES = new Set(["low", "medium", "high"]);
function isRecord(value) {
    return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
function parseProviderPayload(value) {
    const parsed = parseJsonContent(value);
    if (!isRecord(parsed))
        return null;
    const rawIssues = Array.isArray(parsed.issues) ? parsed.issues : [];
    const issues = rawIssues.flatMap((raw) => {
        if (!isRecord(raw) || typeof raw.start !== "number" || typeof raw.end !== "number" || typeof raw.original !== "string" || typeof raw.category !== "string" || typeof raw.severity !== "string")
            return [];
        return [{
                start: raw.start,
                end: raw.end,
                original: raw.original,
                replacement: typeof raw.replacement === "string" ? raw.replacement : "",
                category: raw.category,
                severity: raw.severity,
                confidence: typeof raw.confidence === "number" ? raw.confidence : undefined,
                title: typeof raw.title === "string" ? raw.title : "Writing suggestion",
                explanation: typeof raw.explanation === "string" ? raw.explanation : "Review this change before applying it.",
                ruleId: typeof raw.ruleId === "string" ? raw.ruleId : undefined,
            }];
    });
    const rawScores = isRecord(parsed.scores) ? parsed.scores : {};
    const scores = Object.fromEntries(Object.entries(rawScores).filter(([, score]) => typeof score === "number"));
    return { issues, tone: Array.isArray(parsed.tone) ? parsed.tone.filter((tone) => typeof tone === "string") : [], scores };
}
class ProviderError extends Error {
    code;
    status;
    constructor(code, message, status) {
        super(message);
        this.code = code;
        this.status = status;
        this.name = "ProviderError";
    }
}
function estimateTokens(text) {
    return Math.ceil(text.length / 4);
}
function parseCustomHeaders(value) {
    try {
        const parsed = JSON.parse(value || "{}");
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
            return {};
        return Object.fromEntries(Object.entries(parsed)
            .filter(([key, item]) => typeof item === "string" && key.length < 80 && !/^(authorization|cookie|host|content-length)$/iu.test(key))
            .map(([key, item]) => [key, String(item).slice(0, 500)]));
    }
    catch {
        return {};
    }
}
function validateProviderUrl(baseUrl) {
    let parsed;
    try {
        parsed = new URL(baseUrl.trim());
    }
    catch {
        throw new ProviderError("invalid-url", "Enter a valid provider URL, including https://.");
    }
    const localHost = ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname);
    if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && localHost)) {
        throw new ProviderError("insecure-url", "Use HTTPS for provider URLs. HTTP is allowed only for localhost development.");
    }
    return parsed;
}
function endpointFor(baseUrl) {
    const parsed = validateProviderUrl(baseUrl);
    const path = parsed.pathname.replace(/\/$/u, "");
    parsed.pathname = path.endsWith("/chat/completions") ? path : `${path}/chat/completions`;
    return parsed.toString();
}
function parseJsonContent(value) {
    if (typeof value !== "string")
        return value;
    const cleaned = value.trim().replace(/^```(?:json)?\s*/iu, "").replace(/\s*```$/u, "");
    try {
        return JSON.parse(cleaned);
    }
    catch {
        const start = cleaned.indexOf("{");
        const end = cleaned.lastIndexOf("}");
        if (start >= 0 && end > start) {
            try {
                return JSON.parse(cleaned.slice(start, end + 1));
            }
            catch {
                return null;
            }
        }
        return null;
    }
}
function contentFromPayload(payload) {
    const value = payload;
    const content = value?.choices?.[0]?.message?.content;
    if (Array.isArray(content))
        return content.map((part) => typeof part === "string" ? part : part.text ?? "").join("");
    return content ?? null;
}
function providerErrorForStatus(status) {
    if (status === 401 || status === 403)
        return new ProviderError("unauthorized", "The provider rejected this API key.", status);
    if (status === 404)
        return new ProviderError("invalid-model", "The provider could not find this model or endpoint.", status);
    if (status === 429)
        return new ProviderError("rate-limited", "The provider is rate-limiting requests. Try again in a moment.", status);
    return new ProviderError("unknown", `The provider returned an error (${status}).`, status);
}
async function requestProvider(settings, messages, signal) {
    if (!settings.apiKey.trim())
        throw new ProviderError("missing-key", "Add an API key in Settings to enable AI suggestions.");
    if (!settings.model.trim())
        throw new ProviderError("invalid-model", "Add a model ID in Settings before enabling AI.");
    const endpoint = endpointFor(settings.baseUrl);
    const timeoutController = new AbortController();
    const timeout = setTimeout(() => timeoutController.abort(), 25_000);
    const cancel = () => timeoutController.abort();
    signal?.addEventListener("abort", cancel, { once: true });
    const call = async (includeResponseFormat) => {
        const response = await fetch(endpoint, {
            method: "POST",
            signal: timeoutController.signal,
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${settings.apiKey.trim()}`,
                ...parseCustomHeaders(settings.customHeaders),
            },
            body: JSON.stringify({
                model: settings.model.trim(),
                temperature: Math.max(0, Math.min(1, settings.temperature)),
                max_tokens: Math.max(100, Math.min(4000, settings.maxTokens)),
                ...(includeResponseFormat ? { response_format: { type: "json_object" } } : {}),
                messages,
            }),
        });
        if (!response.ok) {
            const responseText = await response.text().catch(() => "");
            if (includeResponseFormat && response.status === 400 && /response_format|json_object|unsupported/iu.test(responseText))
                return call(false);
            throw providerErrorForStatus(response.status);
        }
        let payload;
        try {
            payload = await response.json();
        }
        catch {
            throw new ProviderError("invalid-json", "The provider returned a response that was not valid JSON.");
        }
        return contentFromPayload(payload);
    };
    try {
        return await call(true);
    }
    catch (error) {
        if (error instanceof ProviderError)
            throw error;
        if (signal?.aborted)
            throw error;
        if (error instanceof DOMException && error.name === "AbortError")
            throw new ProviderError("timeout", "The provider took too long to respond.");
        if (error instanceof TypeError)
            throw new ProviderError("network", "The provider could not be reached. Check the URL and browser network permissions.");
        throw new ProviderError("unknown", "The provider request failed. Local analysis is still available.");
    }
    finally {
        clearTimeout(timeout);
        signal?.removeEventListener("abort", cancel);
    }
}
function buildGoalsContext(goals, preferences) {
    return [
        `Audience: ${goals.audience}.`,
        `Intent: ${goals.intent}.`,
        `Desired tone: ${goals.tone}.`,
        `Dialect: ${preferences?.dialect ?? "en-GB"}.`,
        `Contractions: ${preferences?.allowContractions === false ? "avoid" : "allowed"}.`,
    ].join(" ");
}
function analysisPrompt(chunk, goals, preferences) {
    return `You are Draftwise, a careful writing editor. Return JSON only. ${buildGoalsContext(goals, preferences)}
Preserve meaning, facts, names, numbers, URLs, and quoted text. Suggest only high-confidence, useful changes. Never silently rewrite the whole passage.
This is chunk ${chunk.id}. Return ranges relative to the text below, not the full document. Every original must exactly match its range. Use one of these stable categories: spelling, grammar, punctuation, clarity, conciseness, word choice, repetition, tone, formality, readability, fluency, passive voice, sentence structure, consistency, capitalization. Include confidence from 0 to 1 and a ruleId.
JSON shape: {"issues":[{"start":0,"end":4,"original":"text","replacement":"Text","category":"grammar","severity":"medium","confidence":0.9,"ruleId":"grammar-example","title":"Short title","explanation":"Plain explanation."}],"tone":["direct"]}

Text for ${chunk.id}:
${chunk.text}`;
}
function normaliseCategory(value) {
    return CATEGORY_ALIASES[value.toLocaleLowerCase().trim()] ?? null;
}
function parseAnalysisIssues(value, sourceText, chunkId) {
    const parsed = parseProviderPayload(value);
    if (!parsed)
        return [];
    return parsed.issues.flatMap((candidate, index) => {
        const start = Math.max(0, Math.floor(candidate.start));
        const end = Math.min(sourceText.length, Math.floor(candidate.end));
        const category = normaliseCategory(candidate.category);
        const severity = candidate.severity.toLocaleLowerCase();
        if (!category || !VALID_SEVERITIES.has(severity) || end <= start)
            return [];
        const original = sourceText.slice(start, end);
        if (!original || original !== candidate.original)
            return [];
        const confidence = Math.max(0, Math.min(1, candidate.confidence ?? 0.72));
        return [{
                id: `ai-${chunkId ?? "full"}-${start}-${end}-${index}`,
                ruleId: candidate.ruleId?.slice(0, 80) || "ai-suggestion",
                chunkId,
                start,
                end,
                original,
                replacement: candidate.replacement.slice(0, 1000),
                category,
                severity,
                confidence,
                title: candidate.title.slice(0, 120),
                explanation: candidate.explanation.slice(0, 500),
                source: "ai",
            }];
    });
}
function parseAnalysisResponse(value, sourceText, options = {}) {
    const parsed = parseProviderPayload(value);
    if (!parsed)
        return null;
    const local = analyzeLocally(sourceText, options.preferences, options.goals);
    const aiIssues = parseAnalysisIssues(value, sourceText);
    const issues = mergeAnalysisIssues([...local.issues, ...aiIssues]);
    const stats = getWritingStats(sourceText);
    const scores = scoreWriting(stats, issues, options.goals);
    return {
        analysedText: sourceText,
        issues,
        tone: parsed.tone.length ? parsed.tone.slice(0, 4) : inferTone(sourceText),
        scores,
        stats,
        source: aiIssues.length ? "local+ai" : "local",
    };
}
async function analyzeWithProvider(text, goals, settings, options = {}) {
    const preferences = options.preferences;
    const local = analyzeLocally(text, preferences, goals);
    const changed = options.changedRange && text.length > options.changedRange.start
        ? expandRangeToContext(text, options.changedRange, options.contextWindow ?? 320)
        : null;
    const chunks = createAnalysisChunks(text, {
        maxChars: options.maxChunkChars ?? 8_000,
        contextWindow: options.contextWindow ?? 320,
        startOffset: changed?.start,
        endOffset: changed?.end,
    });
    if (!chunks.length)
        return { ...local, analysedText: text, source: "local" };
    const settled = await Promise.allSettled(chunks.map((chunk) => requestProvider(settings, [
        { role: "system", content: "You are a privacy-first writing assistant. Do not return HTML, markdown, or secrets." },
        { role: "user", content: analysisPrompt(chunk, goals, preferences) },
    ], options.signal)));
    const responses = settled.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
    if (!responses.length) {
        const firstFailure = settled.find((result) => result.status === "rejected");
        if (firstFailure)
            throw firstFailure.reason;
    }
    const aiIssues = responses.flatMap((response, index) => {
        const chunk = chunks[index];
        return parseAnalysisIssues(response, chunk.text, chunk.id)
            .map((issue) => mapChunkIssue(issue, chunk, text))
            .filter((issue) => Boolean(issue));
    });
    const issues = mergeAnalysisIssues([...local.issues, ...aiIssues]);
    const stats = getWritingStats(text);
    return {
        ...local,
        analysedText: text,
        issues,
        scores: scoreWriting(stats, issues, goals),
        stats,
        source: aiIssues.length ? "local+ai" : "local",
        changedRange: options.changedRange ?? undefined,
    };
}
function localRewrite(text, instruction) {
    const lower = instruction.toLocaleLowerCase();
    let result = text.replace(/\s{2,}/gu, " ").trim();
    if (lower.includes("shorten") || lower.includes("concise")) {
        result = result.replace(/\b(?:actually|basically|just|really|quite|very|perhaps|simply)\b\s*/giu, "").replace(/\bin order to\b/giu, "to").replace(/\bat this point in time\b/giu, "now");
    }
    if (lower.includes("formal") || lower.includes("professional") || lower.includes("academic"))
        result = result.replace(/\bcan't\b/giu, "cannot").replace(/\bwon't\b/giu, "will not").replace(/\bget\b/giu, "receive");
    if (lower.includes("casual") || lower.includes("friendly"))
        result = result.replace(/\bcannot\b/giu, "can't").replace(/\bwill not\b/giu, "won't");
    if (lower.includes("confident"))
        result = result.replace(/\b(might|maybe|perhaps|could)\b/giu, "can");
    if (lower.includes("simplify"))
        result = result.replace(/\butilize\b/giu, "use").replace(/\bapproximately\b/giu, "about");
    return result || text;
}
function protectedTokens(text) {
    return [...text.matchAll(/https?:\/\/\S+|\b\d[\d,.%]*\b/gu)].map((match) => match[0]);
}
function validateRewrite(original, replacement) {
    if (!replacement.trim())
        throw new ProviderError("invalid-json", "The provider returned an empty rewrite. Nothing was changed.");
    if (/<[^>]+>/u.test(replacement))
        throw new ProviderError("invalid-json", "The provider returned markup. Nothing was changed.");
    for (const token of protectedTokens(original))
        if (!replacement.includes(token))
            throw new ProviderError("invalid-json", "The rewrite changed a URL or number. Nothing was changed.");
    return replacement.trim();
}
async function rewriteWithProvider(request, settings, signal) {
    if (!settings.apiKey.trim())
        return { replacement: localRewrite(request.text, request.instruction), explanation: "Local rewrite: AI is off, so your text stayed on this device.", source: "local" };
    const response = await requestProvider(settings, [
        { role: "system", content: `You are a careful writing partner. Return JSON only with {"replacement":"...","explanation":"..."}. ${buildGoalsContext(request.goals, request.preferences)} Preserve meaning, facts, names, numbers, URLs, and quoted text. Do not add HTML or markdown.` },
        { role: "user", content: `Instruction: ${request.instruction}\n\nText to rewrite:\n${request.text}` },
    ], signal);
    const parsed = parseJsonContent(response);
    if (!isRecord(parsed) || typeof parsed.replacement !== "string" || !parsed.replacement.trim())
        throw new ProviderError("invalid-json", "The provider returned an invalid rewrite. Nothing was changed.");
    const explanation = typeof parsed.explanation === "string" ? parsed.explanation : "";
    return { replacement: validateRewrite(request.text, parsed.replacement), explanation: explanation.slice(0, 500), source: "ai" };
}

return { analyzeWithProvider, ProviderError };
})();
globalThis.DraftwiseProvider = DraftwiseProviderModule;
})();
