(() => {
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
function expandToSafeBoundary(text, start, end, contextWindow) {
    const roughStart = Math.max(0, start - contextWindow);
    const roughEnd = Math.min(text.length, end + contextWindow);
    const leftMatches = [...text.slice(0, roughStart).matchAll(/(?:[.!?…]\s+|\n\s*)/gu)];
    const left = leftMatches[leftMatches.length - 1];
    const safeStart = left && left.index !== undefined ? left.index + left[0].length : roughStart;
    const rightMatch = text.slice(roughEnd).match(/[.!?…](?:\s|$)|\n\s*/u);
    const safeEnd = rightMatch?.index !== undefined
        ? Math.min(text.length, roughEnd + rightMatch.index + rightMatch[0].length)
        : roughEnd;
    return { start: Math.min(safeStart, start), end: Math.max(safeEnd, end) };
}
function getIncrementalAnalysisRanges(previousText, nextText, changedRange, contextWindow = DEFAULT_CONTEXT_WINDOW) {
    const previous = expandToSafeBoundary(previousText, changedRange.start, changedRange.previousEnd, contextWindow);
    const next = expandToSafeBoundary(nextText, changedRange.start, changedRange.end, contextWindow);
    return { previous, next, delta: nextText.length - previousText.length };
}
function retainUnaffectedIssues(previousIssues, ranges, nextText) {
    return previousIssues.flatMap((issue) => {
        if (issue.start < ranges.previous.end && issue.end > ranges.previous.start)
            return [];
        const shift = issue.start >= ranges.previous.end ? ranges.delta : 0;
        const start = issue.start + shift;
        const end = issue.end + shift;
        if (start < 0 || end > nextText.length || nextText.slice(start, end) !== issue.original)
            return [];
        return [{ ...issue, start, end }];
    });
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
    const confidence = Number.isFinite(issue.confidence) ? issue.confidence : 0.5;
    return severity + confidence + source;
}
function intervalKeyComesBefore(left, right) {
    return left.issue.start < right.issue.start
        || (left.issue.start === right.issue.start && (left.issue.end < right.issue.end
            || (left.issue.end === right.issue.end && left.sequence < right.sequence)));
}
function intervalPriority(sequence) {
    let value = (sequence + 1) | 0;
    value ^= value << 13;
    value ^= value >>> 17;
    value ^= value << 5;
    return value >>> 0;
}
function intervalMaxEnd(node) {
    return node?.maxEnd ?? Number.NEGATIVE_INFINITY;
}
function refreshIntervalNode(node) {
    node.maxEnd = Math.max(node.entry.issue.end, intervalMaxEnd(node.left), intervalMaxEnd(node.right));
}
function rotateIntervalRight(node) {
    const next = node.left;
    if (!next)
        return node;
    node.left = next.right;
    next.right = node;
    refreshIntervalNode(node);
    refreshIntervalNode(next);
    return next;
}
function rotateIntervalLeft(node) {
    const next = node.right;
    if (!next)
        return node;
    node.right = next.left;
    next.left = node;
    refreshIntervalNode(node);
    refreshIntervalNode(next);
    return next;
}
function insertIntervalNode(root, node) {
    if (!root)
        return node;
    if (intervalKeyComesBefore(node.entry, root.entry)) {
        root.left = insertIntervalNode(root.left, node);
        if (root.left.priority < root.priority)
            return rotateIntervalRight(root);
    }
    else {
        root.right = insertIntervalNode(root.right, node);
        if (root.right.priority < root.priority)
            return rotateIntervalLeft(root);
    }
    refreshIntervalNode(root);
    return root;
}
function collectOverlappingIntervals(node, start, end, output) {
    if (!node || node.maxEnd <= start)
        return;
    if (node.left)
        collectOverlappingIntervals(node.left, start, end, output);
    if (node.entry.issue.start < end && node.entry.issue.end > start && node.entry.active && !node.entry.removed)
        output.push(node.entry);
    if (node.entry.issue.start < end)
        collectOverlappingIntervals(node.right, start, end, output);
}
function mergeAnalysisIssues(issues) {
    const candidates = issues
        .filter((item) => Number.isFinite(item.start) && Number.isFinite(item.end))
        .filter((item) => item.start >= 0 && item.end > item.start && item.original.length > 0)
        .map((item) => ({ ...item, confidence: Math.max(0, Math.min(1, item.confidence ?? 0.5)) }))
        .sort((a, b) => a.start - b.start || b.end - a.end || issueRank(b) - issueRank(a));
    const entries = [];
    const exact = new Map();
    let intervalTree = null;
    const isLive = (entry) => entry.active && !entry.removed;
    const deactivate = (entry, remove) => {
        entry.active = false;
        entry.removed ||= remove;
        const key = `${entry.issue.start}:${entry.issue.end}:${entry.issue.original.toLocaleLowerCase()}`;
        if (exact.get(key) === entry && remove)
            exact.delete(key);
    };
    for (const [sequence, candidate] of candidates.entries()) {
        const overlapping = [];
        collectOverlappingIntervals(intervalTree, candidate.start, candidate.end, overlapping);
        const key = `${candidate.start}:${candidate.end}:${candidate.original.toLocaleLowerCase()}`;
        const existingExact = exact.get(key);
        if (existingExact && isLive(existingExact)) {
            if (issueRank(candidate) > existingExact.rank) {
                deactivate(existingExact, true);
            }
            else {
                continue;
            }
        }
        const liveOverlapping = overlapping.filter(isLive);
        const bestOverlap = liveOverlapping.reduce((best, entry) => !best || entry.rank > best.rank ? entry : best, null);
        if (bestOverlap) {
            if (issueRank(candidate) <= bestOverlap.rank)
                continue;
            for (const entry of liveOverlapping)
                deactivate(entry, true);
        }
        const entry = { issue: candidate, rank: issueRank(candidate), active: true, removed: false, sequence };
        entries.push(entry);
        exact.set(key, entry);
        intervalTree = insertIntervalNode(intervalTree, { entry, priority: intervalPriority(sequence), maxEnd: candidate.end, left: null, right: null });
    }
    return entries
        .filter((entry) => !entry.removed)
        .map((entry) => entry.issue)
        .sort((a, b) => a.start - b.start || a.end - b.end);
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
function fingerprintText(text) {
    let first = 2_166_136_261;
    let second = 2_654_435_761;
    for (let index = 0; index < text.length; index += 1) {
        const code = text.charCodeAt(index);
        first = Math.imul(first ^ code, 16_777_619);
        second = Math.imul(second ^ (code + ((index & 255) << 8)), 2_246_822_519);
    }
    return `${text.length}-${(first >>> 0).toString(16)}-${(second >>> 0).toString(16)}`;
}
function createAnalysisCacheKey(text, settingsKey, range) {
    const rangeKey = range ? `${range.start}:${range.end}:${range.previousEnd}` : "full";
    return `${settingsKey}:${rangeKey}:text-${fingerprintText(text)}`;
}
function stableSerialize(value) {
    if (value === null || typeof value !== "object")
        return JSON.stringify(value);
    if (Array.isArray(value))
        return `[${value.map((item) => stableSerialize(item)).join(",")}]`;
    return `{${Object.keys(value)
        .sort()
        .filter((key) => value[key] !== undefined && !/^(?:api[-_]?key|authorization|access[-_]?token|secret|password|token)$/iu.test(key))
        .map((key) => `${JSON.stringify(key)}:${stableSerialize(value[key])}`)
        .join(",")}}`;
}
/** Deterministic, non-secret fingerprint for analysis settings. */
function createAnalysisSettingsFingerprint(settings) {
    const serialised = stableSerialize(settings);
    let hash = 2_166_136_261;
    for (let index = 0; index < serialised.length; index += 1) {
        hash ^= serialised.charCodeAt(index);
        hash = Math.imul(hash, 16_777_619);
    }
    return `settings-${(hash >>> 0).toString(16)}-${serialised.length}`;
}

return { createAnalysisChunks, expandRangeToContext, mapChunkIssue, mergeAnalysisIssues };
})();
const DraftwiseGrammarModule = (() => {
const { mergeAnalysisIssues } = DraftwiseAnalysisModule;

const DEFAULT_STYLE_PREFERENCES = {
    dialect: "en-GB",
    personalDictionary: [],
    names: [],
    ignoredWords: [],
    ignoredRuleIds: [],
    preferredTerminology: {},
    oxfordComma: true,
    allowContractions: true,
    passiveVoiceSensitivity: "normal",
    preferredSentenceLength: "balanced",
    blockedWords: [],
};
function analysisNow() {
    return typeof performance !== "undefined" && typeof performance.now === "function" ? performance.now() : Date.now();
}
function diagnosticsEnabled() {
    const runtime = globalThis;
    if (runtime.DraftwiseDebug === true)
        return true;
    return typeof process !== "undefined" && process.env?.NODE_ENV !== "production";
}
function createAnalysisDiagnostics(issueCount, startedAt, engine, details = {}) {
    if (!diagnosticsEnabled())
        return undefined;
    return {
        processingMs: Math.max(0, Math.round((analysisNow() - startedAt) * 100) / 100),
        issueCount,
        engine,
        ...details,
    };
}
const WORD_PATTERN = /[\p{L}\p{N}]+(?:['’\-][\p{L}\p{N}]+)*/gu;
const TYPO_FIXES = {
    alot: "a lot",
    adn: "and",
    acheive: "achieve",
    adress: "address",
    arguement: "argument",
    becuase: "because",
    beleive: "believe",
    calender: "calendar",
    comming: "coming",
    couldnt: "couldn't",
    definately: "definitely",
    dont: "don't",
    goverment: "government",
    enviroment: "environment",
    expecially: "especially",
    independant: "independent",
    maintenence: "maintenance",
    occured: "occurred",
    occurence: "occurrence",
    priviledge: "privilege",
    publically: "publicly",
    recieve: "receive",
    reciever: "receiver",
    refered: "referred",
    seperate: "separate",
    sucess: "success",
    succesful: "successful",
    teh: "the",
    thier: "their",
    tommorow: "tomorrow",
    untill: "until",
    youre: "you're",
    theyre: "they're",
    wasnt: "wasn't",
    writng: "writing",
    wich: "which",
    youve: "you've",
    isnt: "isn't",
    cant: "can't",
    doesnt: "doesn't",
    shouldnt: "shouldn't",
    repeatd: "repeated",
    repeatdly: "repeatedly",
    seperately: "separately",
    writting: "writing",
    accomodate: "accommodate",
    begining: "beginning",
    commited: "committed",
    embarass: "embarrass",
    responsability: "responsibility",
    tommorrow: "tomorrow",
    writen: "written",
};
// Keep the common lexicon inline so the web app and extension share exactly the same
// local checker. The core list is ordered by frequency; the extended list adds useful
// vocabulary without shipping a multi-megabyte general-purpose dictionary.
const SPELLING_CORE = `
the be to of and a in that have I it is for not on with he as you do at this but his by from they we say her she or an will my one all would there their what so up out if about who get which go me when make made can like time no just him know take people into year your good some could them see other than then now look only come its over think also back after use two how our work first well way even new want because these give day most us
thing man world life hand part child eye woman place week case point government company number group problem fact home water room mother area money story month lot right study book job word business issue side kind head house service friend power hour game line end member law car city community name president team minute idea kid body information nothing ago lead social understand whether watch together follow parent stop face anything create late speak read level allow add start change offer remember love help move live believe hold bring happen write provide sit stand lose pay meet include continue set learn turn start show hear play run might should mean keep let begin seem help talk receive
research evidence analysis method methodology result results finding findings data theory sample study academic article paper source citation references conclusion argument explain explanation question answer describe description compare contrast therefore however while although because process system model example report review draft edit writing writer reader sentence paragraph heading title grammar spelling punctuation clarity concise concise clarity simple direct formal professional general technical audience intent tone quality accurate correct safe private local device browser extension application software code package function variable service provider endpoint request response network timeout error test tests benchmark build release project repository version dependency documentation security privacy permission origin host domain field input form textarea content
api key token access authentication authorization credential password secret private username login account pin otp cvv cvc card payment currency percent percentage date email url link filename identifier id uuid ticket reference model version openai anthropic google gemini claude llama
useful helpful careful thoughtful clear strong confident friendly neutral casual formal active passive readable readability engagement consistency terminology preference preferred dictionary ignore ignored names contractions apostrophe hyphen unicode technical vocabulary frequency candidate distance rank
analyse analysed analysing centre colour favour organise organised organisation recognise travelled behaviour licence
analyze analyzed analyzing center color favor organize organized organization recognize traveled behavior license
javascript typescript python java rust go html css json xml sql api sdk npm node react nextjs browser chrome firefox cloudflare worker workers github git commit branch pull request continuous integration deploy deployment server client frontend backend database storage cache worker queue
quick brown fox jumps lazy dog hello thanks please welcome ready carefully interesting draftwise assistant improve improvement suggestion suggestions accept dismiss rewrite rewrites alternative alternatives document documents text words word you're we're they're don't can't won't isn't it's that's couldn't wouldn't shouldn't
`.trim().split(/\s+/u);
const SPELLING_EXTENDED = `
ability able absence absolute absolutely abstract abundant accelerate acceptable access accident accompany accomplish achievement acknowledge acquire across action activate activity actual adapt adequate adjust administration admire admission adopt advance advantage advertise advice advise affect afford afraid agency agenda aggressive agriculture aircraft alarm album alcohol alert allocate allowance alter alternative ambitious analyse announcement annual anticipate anxiety apartment apparent appeal appearance application appoint appreciate approach appropriate approval argue arise arrangement arrival aspect assemble assess assessment assign assistance assumption assure atmosphere attach attempt attention attitude attorney attract attractive audience author authority automatic available average avoid awareness balance barrier basic basis battery beautiful behaviour belief belong benefit beside bicycle biology boundary branch bravery breathe brilliant budget calculate campaign candidate capability capacity capture category celebrate challenge champion channel chapter character charity chemical circumstance citizen clarify classic climate clinical combine comfortable command comment commercial communicate communication competition competitive complaint complete complex component compose composition compromise concentration concept conclude condition conference confidence confirm conflict connect consequence conservative consider consistent constant construct consumer contain contemporary content contract contribute convenient coordinate corporation creative crisis criterion crucial curious current customer damage database deadline debate decade decline dedicate defend define definite demonstrate deny department depend deposit derive destination detail detect determine device diagram digital dimension direction discover discussion display distance distinct distribute district diverse document duration dynamic earn editorial efficient element eliminate emerge emphasis emotional employ employee enable encounter encourage energy engine enhance enormous ensure enterprise entertain entire enthusiasm equivalent establish estimate ethics evaluate evidence exact examine exception exchange exclude execute exhibit expand expectation expense experience experiment expert expose express extension external factor failure familiar fashion feature feedback festival fiction finance flexible flight flourish focus foreign formal foundation framework frequent function fundamental gain gallery gender generate generation generous geography global govern guidance habit handle hardware healthy hesitate highlight historical honest honour hospital household however hygiene ideal identify illustrate image imagination immediate implement implication importance impressive improve incentive incident include income indicate individual industry inevitable influence initial innovate inquiry insight inspect install instance instead institute integrate intelligence intend intense interact interest internal international interpret interrupt introduce invest investigate involve isolate issue item journey judge justice junior keyboard laboratory language launch layer legal legacy length lesson liberal library licence lifetime likely limit liquid literature locate logical loyalty maintain maintenance manage manner manual manufacture margin market material mature maximum measure mechanism media medicine mention mental method migrate minimum minor mission mobile moderate modern monitor motivate multiple mutual native natural nearby negotiate negative negotiate network neutral notice notion objective obtain obvious occasion official operate opportunity option ordinary organise outcome overall participate partner particular pattern perceive perform permission perspective phase physical policy position positive potential practice precise predict prefer prepare present previous primary principle privacy proceed process produce professional progress project promote propose protect psychology publish purchase pursue quality quarter question rapid rarely react realistic reason recommend recover reduce refer reflect region register regular reject release relevant reliable remain remove replace represent require residence resolve resource respond responsibility restrict retail reveal revise routine safety sample satisfy schedule scope secure segment select sensitive sequence separate serious significant similar simple sincere since single situation sketch solution source specific stable standard statement strategic strategy strengthen structure submit substantial succeed sufficient suggest support survey symbol technical technique technology temporary tension terminology terminal theme thorough thought throughout topic transform transition translate transport trend typical unique update useful valid value variable various vehicle version virtual visible vision visual volume volunteer warn whereas whole widely willing window within without wonder workflow worthy writing wrong youth
`.trim().split(/\s+/u);
const SPELLING_COMMON = `
above across again against almost already always among another anyone anything appear around ask away become before behind below between both call called country customer enough event example effect experience family far few final find following full future great help has history important including interface interfaces later least loose lunch main matter matters message much must need never next note often once open original others own plan possible practical probably question rather reason real recent right same saw send several something sometimes specific step still sure task team tell than though through today under user users usually value was why yet are aspects act box changer close contact being
`.trim().split(/\s+/u);
const SPELLING_COMMON_EXTRA = [
    "stay",
    "calm", "context", "aim", "term", "discussing", "serves", "three", "causal", "table", "participants",
    "were", "interval", "strength", "specifies", "experimental", "held", "coverage", "here", "manager",
    "proposal", "cost", "consultant", "approved", "analyst", "director", "approves", "log", "coordinator",
    "participant", "site", "obsolete", "preview", "optional", "routing", "mode", "raw", "hook", "practise",
    "eight", "map", "traveller", "season", "match", "more", "series", "merge", "acceptance",
    "age", "built", "cautious", "care", "circulate", "classify", "cover", "directory", "exposure", "four", "last",
    "lake", "left", "marked", "median", "near", "nine", "old", "plain", "plate", "plot", "preserved", "product",
    "rate", "rain", "readings", "reaction", "reproduce", "reserves", "rest", "retain", "road", "scan", "scheduler", "send",
    "along", "began", "bell", "boat", "bread", "coat", "done", "each", "gave", "hill", "light", "list", "long", "loop", "may",
    "became", "clean", "meal", "normal", "operator", "pace", "page", "park", "preserves", "reach", "recovery", "space", "stale", "state", "stone", "style", "train", "wall", "wind",
    "specified", "taken", "ten", "tide", "tour", "transfer", "warm",
];
const SPELLING_UNICODE = `
café naïve résumé fiancée jalapeño façade coöperate déjà touché protégé über voilà mañana señor São München Zürich Łódź Αθήνα Москва 東京 北京
`.trim().split(/\s+/u);
const SPELLING_FREQUENCY = [...new Set([...SPELLING_CORE, ...SPELLING_UNICODE, ...SPELLING_COMMON, ...SPELLING_COMMON_EXTRA, ...SPELLING_EXTENDED])];
const SPELLING_WORDS = new Set(SPELLING_FREQUENCY);
const SPELLING_RANK = new Map(SPELLING_FREQUENCY.map((word, index) => [word.toLocaleLowerCase(), index]));
const SPELLING_INDEX = new Map();
SPELLING_FREQUENCY.forEach((word) => {
    const normalized = word.toLocaleLowerCase();
    const bucket = SPELLING_INDEX.get(normalized.length) ?? [];
    bucket.push(normalized);
    SPELLING_INDEX.set(normalized.length, bucket);
});
const SPELLING_CACHE = new Map();
const CONTRACTIONS = new Set([
    "aren't", "can't", "couldn't", "didn't", "doesn't", "don't", "hadn't", "hasn't", "haven't", "he'd", "he'll", "he's",
    "i'd", "i'll", "i'm", "i've", "isn't", "it'd", "it'll", "it's", "let's", "mightn't", "mustn't", "shan't", "she'd",
    "she'll", "she's", "shouldn't", "that's", "there's", "they'd", "they'll", "they're", "they've", "wasn't", "we'd", "we'll",
    "we're", "we've", "weren't", "what's", "where's", "who's", "won't", "wouldn't", "you'd", "you'll", "you're", "you've",
]);
const ARTICLE_AN_EXCEPTIONS = new Set(["heir", "heirloom", "honest", "honestly", "honour", "honours", "honor", "hour", "hourly"]);
const ARTICLE_A_SOUND_PREFIXES = /^(?:euro|ewe|one|once|uni|use|user|usual|utensil|ubiquit|u[nr]i)/u;
const KEYBOARD_NEIGHBOURS = {
    a: "qwsz", b: "vghn", c: "xdfv", d: "serfcx", e: "wrsd", f: "drtgvc", g: "ftyhbv", h: "gyujnb", i: "ujk", j: "huikmn", k: "jiolm", l: "kop", m: "njk", n: "bhjm", o: "iklp", p: "ol", q: "wa", r: "edft", s: "awedxz", t: "rfgy", u: "yhji", v: "cfgb", w: "qase", x: "zsdc", y: "tugh", z: "asx",
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
    catalogue: { "en-GB": "catalogue", "en-US": "catalog" },
    cancelled: { "en-GB": "cancelled", "en-US": "canceled" },
    defence: { "en-GB": "defence", "en-US": "defense" },
    favourite: { "en-GB": "favourite", "en-US": "favorite" },
    fulfil: { "en-GB": "fulfil", "en-US": "fulfill" },
    labelled: { "en-GB": "labelled", "en-US": "labeled" },
    metre: { "en-GB": "metre", "en-US": "meter" },
    practise: { "en-GB": "practise", "en-US": "practice" },
    programme: { "en-GB": "programme", "en-US": "program" },
    theatre: { "en-GB": "theatre", "en-US": "theater" },
    travelling: { "en-GB": "travelling", "en-US": "traveling" },
    optimise: { "en-GB": "optimise", "en-US": "optimize" },
    prioritise: { "en-GB": "prioritise", "en-US": "prioritize" },
    specialise: { "en-GB": "specialise", "en-US": "specialize" },
};
const CONTEXTUAL_DIALECT_WORDS = new Set(["license", "licence", "practice", "practise", "program", "programme"]);
const DIALECT_VERB_CONTEXT = new Set(["i", "you", "we", "they", "he", "she", "it", "to", "will", "would", "can", "could", "may", "might", "must", "should", "shall"]);
const DIALECT_NOUN_CONTEXT = new Set(["a", "an", "the", "my", "your", "our", "their", "this", "that", "driving", "software", "business", "professional", "commercial", "export", "operating", "training", "television", "tv", "radio", "loyalty", "rehabilitation", "education", "educational", "arts", "concert", "event"]);
const PROGRAMME_COMPUTING_CONTEXT = new Set(["computer", "software", "code", "coding", "programming", "developer", "application", "app", "script", "source", "compile", "compiler", "debug", "debugging", "api", "machine", "algorithm", "database", "terminal", "runtime", "python", "javascript"]);
const PROGRAMME_NON_COMPUTING_CONTEXT = new Set(["training", "television", "tv", "radio", "loyalty", "rehabilitation", "education", "educational", "arts", "concert", "event", "theatre"]);
function contextualDialectReplacement(tokens, index, preferences) {
    const word = tokens[index]?.lower;
    if (!word || !CONTEXTUAL_DIALECT_WORDS.has(word))
        return undefined;
    const before = tokens.slice(Math.max(0, index - 3), index).map((token) => token.lower);
    const after = tokens.slice(index + 1, index + 3).map((token) => token.lower);
    const immediateBefore = before.at(-1);
    const nearby = new Set([...before, ...after]);
    const verbUse = Boolean(immediateBefore && DIALECT_VERB_CONTEXT.has(immediateBefore));
    const nounUse = Boolean(immediateBefore && DIALECT_NOUN_CONTEXT.has(immediateBefore))
        || before.some((value) => DIALECT_NOUN_CONTEXT.has(value));
    if (word === "license" && preferences.dialect === "en-GB") {
        if (verbUse)
            return undefined;
        return nounUse ? "licence" : undefined;
    }
    if (word === "licence" && preferences.dialect === "en-US") {
        return verbUse || nounUse ? "license" : undefined;
    }
    if (word === "practice" && preferences.dialect === "en-GB") {
        return verbUse ? "practise" : undefined;
    }
    if (word === "practise" && preferences.dialect === "en-US") {
        return verbUse || nounUse ? "practice" : undefined;
    }
    if (word === "program" && preferences.dialect === "en-GB") {
        if (nearby.has("software") || [...nearby].some((value) => PROGRAMME_COMPUTING_CONTEXT.has(value)))
            return undefined;
        return [...nearby].some((value) => PROGRAMME_NON_COMPUTING_CONTEXT.has(value)) || nounUse ? "programme" : undefined;
    }
    if (word === "programme" && preferences.dialect === "en-US") {
        return [...nearby].some((value) => PROGRAMME_NON_COMPUTING_CONTEXT.has(value) || PROGRAMME_COMPUTING_CONTEXT.has(value)) || nounUse ? "program" : undefined;
    }
    return undefined;
}
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
    ["made a decision", "decided"],
    ["come to a conclusion", "conclude"],
];
const CLICHES = [
    ["at the end of the day", "ultimately"],
    ["think outside the box", "think creatively"],
    ["low-hanging fruit", "easy opportunities"],
    ["moving forward", "next"],
    ["game changer", "major improvement"],
];
const VAGUE_WORDS = new Set(["thing", "things", "stuff", "somehow", "various", "aspects"]);
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
        names: options.names ?? DEFAULT_STYLE_PREFERENCES.names,
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
function issueTextFingerprint(text) {
    let hash = 2_166_136_261;
    for (let index = 0; index < text.length; index += 1) {
        hash ^= text.charCodeAt(index);
        hash = Math.imul(hash, 16_777_619);
    }
    return (hash >>> 0).toString(36);
}
function createIssueId(ruleId, start, end, original) {
    return `${ruleId}-${start}-${end}-${issueTextFingerprint(original)}`;
}
function boundedEditDistance(left, right, limit = 2) {
    if (Math.abs(left.length - right.length) > limit)
        return limit + 1;
    let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
    let previousPrevious = null;
    for (let row = 1; row <= left.length; row += 1) {
        const current = [row];
        let rowMinimum = current[0];
        for (let column = 1; column <= right.length; column += 1) {
            const cost = left[row - 1] === right[column - 1] ? 0 : 1;
            const value = Math.min(current[column - 1] + 1, previous[column] + 1, previous[column - 1] + cost, previousPrevious && row > 1 && column > 1 && left[row - 1] === right[column - 2] && left[row - 2] === right[column - 1]
                ? previousPrevious[column - 2] + 1
                : limit + 1);
            current[column] = value;
            rowMinimum = Math.min(rowMinimum, value);
        }
        if (rowMinimum > limit)
            return limit + 1;
        previousPrevious = previous;
        previous = current;
    }
    return previous[right.length];
}
function spellingKey(word, preferences) {
    return `${preferences.dialect}:${word.toLocaleLowerCase()}`;
}
function dictionaryHas(word, preferences) {
    const lower = word.toLocaleLowerCase().normalize("NFC");
    return SPELLING_WORDS.has(lower)
        || preferences.personalDictionary?.some((value) => value.toLocaleLowerCase().normalize("NFC") === lower)
        || preferences.names?.some((value) => value.toLocaleLowerCase().normalize("NFC") === lower);
}
function inflectionRoots(lower) {
    const roots = new Set();
    const add = (value) => { if (value.length >= 3)
        roots.add(value); };
    if (lower.endsWith("ies"))
        add(`${lower.slice(0, -3)}y`);
    if (lower.endsWith("ves")) {
        add(`${lower.slice(0, -3)}f`);
        add(`${lower.slice(0, -3)}fe`);
    }
    if (lower.endsWith("es")) {
        add(lower.slice(0, -2));
        add(lower.slice(0, -1));
    }
    if (lower.endsWith("s"))
        add(lower.slice(0, -1));
    if (lower.endsWith("ied"))
        add(`${lower.slice(0, -3)}y`);
    if (lower.endsWith("ed")) {
        const root = lower.slice(0, -2);
        add(root);
        add(`${root}e`);
        if (/(.)\1$/u.test(root))
            add(root.slice(0, -1));
    }
    if (lower.endsWith("ing")) {
        const root = lower.slice(0, -3);
        add(root);
        add(`${root}e`);
        if (/(.)\1$/u.test(root))
            add(root.slice(0, -1));
    }
    if (lower.endsWith("er") || lower.endsWith("est"))
        add(lower.replace(/(?:er|est)$/u, ""));
    if (lower.endsWith("ly"))
        add(lower.slice(0, -2));
    return roots;
}
function isKnownSpelling(word, preferences) {
    const lower = word.toLocaleLowerCase().normalize("NFC");
    const asciiContraction = lower.replaceAll("’", "'");
    if (dictionaryHas(lower, preferences) || CONTRACTIONS.has(asciiContraction))
        return true;
    const possessive = lower.match(/^(.+?)(?:['’]s|s['’])$/u);
    if (possessive?.[1] && dictionaryHas(possessive[1], preferences))
        return true;
    const parts = lower.split(/[’'-]/u).filter(Boolean);
    if (parts.length > 1 && parts.every((part) => part === "s" || dictionaryHas(part, preferences)))
        return true;
    return [...inflectionRoots(lower)].some((root) => dictionaryHas(root, preferences));
}
function keyboardPenalty(left, right) {
    let penalty = Math.abs(left.length - right.length);
    const shared = Math.min(left.length, right.length);
    for (let index = 0; index < shared; index += 1) {
        if (left[index] === right[index])
            continue;
        if (!KEYBOARD_NEIGHBOURS[left[index]]?.includes(right[index] ?? ""))
            penalty += 1;
    }
    return penalty;
}
function dialectPenalty(word, preferences) {
    for (const variants of Object.values(DIALECT_VARIANTS)) {
        if (word === variants[preferences.dialect])
            return 0;
        if (word === variants[preferences.dialect === "en-GB" ? "en-US" : "en-GB"])
            return 1;
    }
    return 0;
}
function suggestSpelling(word, preferences = {}) {
    const merged = mergePreferences(preferences);
    const lower = word.toLocaleLowerCase().normalize("NFC");
    const key = spellingKey(word, merged);
    if (TYPO_FIXES[lower])
        return TYPO_FIXES[lower];
    if (isKnownSpelling(word, merged) || /^[A-Z][\p{L}'’-]+$/u.test(word) || /^[A-Z]{2,}[\w-]*$/u.test(word)) {
        return null;
    }
    if (SPELLING_CACHE.has(key))
        return SPELLING_CACHE.get(key) ?? null;
    if (lower.length < 3)
        return null;
    const maxDistance = lower.length >= 8 ? 2 : 1;
    const hasUnicode = /[^\p{ASCII}]/u.test(lower);
    let best = null;
    for (let length = Math.max(1, lower.length - maxDistance); length <= lower.length + maxDistance; length += 1) {
        for (const candidate of SPELLING_INDEX.get(length) ?? []) {
            if (candidate === lower || (hasUnicode && !/[^\p{ASCII}]/u.test(candidate)))
                continue;
            const distance = boundedEditDistance(lower, candidate, maxDistance);
            if (distance > maxDistance)
                continue;
            const candidateScore = { word: candidate, distance, keyboard: keyboardPenalty(lower, candidate), dialect: dialectPenalty(candidate, merged), rank: SPELLING_RANK.get(candidate) ?? Number.MAX_SAFE_INTEGER };
            if (!best
                || candidateScore.distance < best.distance
                || (candidateScore.distance === best.distance && candidateScore.keyboard < best.keyboard)
                || (candidateScore.distance === best.distance && candidateScore.keyboard === best.keyboard && candidateScore.dialect < best.dialect)
                || (candidateScore.distance === best.distance && candidateScore.keyboard === best.keyboard && candidateScore.dialect === best.dialect && candidateScore.rank < best.rank))
                best = candidateScore;
        }
    }
    const result = best?.word ?? null;
    SPELLING_CACHE.set(key, result);
    if (SPELLING_CACHE.size > 512)
        SPELLING_CACHE.delete(SPELLING_CACHE.keys().next().value);
    return result;
}
function tokensIn(text, offset = 0) {
    return [...text.matchAll(WORD_PATTERN)].map((match) => ({
        value: match[0],
        lower: match[0].toLocaleLowerCase(),
        start: offset + (match.index ?? 0),
        end: offset + (match.index ?? 0) + match[0].length,
    }));
}
function sentenceSpans(text, allTokens) {
    const spans = [];
    const tokens = allTokens ?? tokensIn(text);
    let tokenIndex = 0;
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
        while (tokenIndex < tokens.length && tokens[tokenIndex].end <= start)
            tokenIndex += 1;
        const sentenceTokens = [];
        while (tokenIndex < tokens.length && tokens[tokenIndex].start < end) {
            sentenceTokens.push(tokens[tokenIndex]);
            tokenIndex += 1;
        }
        spans.push({ text: value, start, end, tokens: sentenceTokens });
    }
    return spans;
}
function parseDocument(text) {
    const tokens = tokensIn(text);
    const sentences = sentenceSpans(text, tokens);
    const paragraphs = [];
    let cursor = 0;
    let tokenCursor = 0;
    for (const paragraph of text.split(/\n\s*\n/gu)) {
        const start = text.indexOf(paragraph, cursor);
        cursor = Math.max(cursor, start + paragraph.length);
        if (!paragraph.trim() || start < 0)
            continue;
        const end = start + paragraph.length;
        while (tokenCursor < tokens.length && tokens[tokenCursor].end <= start)
            tokenCursor += 1;
        const paragraphTokens = [];
        while (tokenCursor < tokens.length && tokens[tokenCursor].end <= end) {
            paragraphTokens.push(tokens[tokenCursor]);
            tokenCursor += 1;
        }
        paragraphs.push({ text: paragraph, start, end, tokens: paragraphTokens });
    }
    const frequencies = new Map();
    for (const token of tokens)
        frequencies.set(token.lower, (frequencies.get(token.lower) ?? 0) + 1);
    return {
        text,
        tokens,
        sentences,
        paragraphs,
        frequencies,
        sentenceLengths: sentences.map((sentence) => sentence.tokens.length),
        paragraphLengths: paragraphs.map((paragraph) => paragraph.tokens.length),
    };
}
const analyzeDocument = parseDocument;
function shouldIgnore(ruleId, original, preferences) {
    const lower = original.trim().toLocaleLowerCase();
    return preferences.ignoredRuleIds.includes(ruleId) || preferences.ignoredWords.some((word) => word.toLocaleLowerCase() === lower) || preferences.personalDictionary.some((word) => word.toLocaleLowerCase() === lower) || preferences.names?.some((word) => word.toLocaleLowerCase() === lower);
}
function makeIssue(ruleId, start, end, original, replacement, category, severity, title, explanation, confidence, preferences) {
    if (!original || end <= start || shouldIgnore(ruleId, original, preferences))
        return null;
    return {
        id: createIssueId(ruleId, start, end, original),
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
function findSpelling(text, preferences, document = parseDocument(text)) {
    const issues = [];
    for (const [tokenIndex, token] of document.tokens.entries()) {
        const typo = TYPO_FIXES[token.lower];
        const contextualReplacement = contextualDialectReplacement(document.tokens, tokenIndex, preferences);
        const dialect = !CONTEXTUAL_DIALECT_WORDS.has(token.lower)
            ? Object.entries(DIALECT_VARIANTS).find(([, variants]) => token.lower === variants[preferences.dialect].toLocaleLowerCase() || token.lower === variants[preferences.dialect === "en-GB" ? "en-US" : "en-GB"].toLocaleLowerCase())
            : undefined;
        const dialectReplacement = contextualReplacement ?? (dialect && token.lower !== dialect[1][preferences.dialect].toLocaleLowerCase()
            ? dialect[1][preferences.dialect]
            : undefined);
        const lexicalReplacement = !dialectReplacement && !typo ? suggestSpelling(token.value, preferences) : undefined;
        const replacement = dialectReplacement ?? typo ?? lexicalReplacement;
        if (!replacement || replacement.toLocaleLowerCase() === token.lower)
            continue;
        pushIssue(issues, makeIssue(dialectReplacement ? "dialect-spelling" : typo ? "spelling-common-typo" : "spelling-lexicon", token.start, token.end, token.value, preserveCase(token.value, replacement), "spelling", dialectReplacement ? "low" : typo ? "high" : "medium", dialectReplacement ? `Use ${preferences.dialect === "en-GB" ? "British" : "US"} spelling` : `Spelling: ${preserveCase(token.value, replacement)}`, dialectReplacement
            ? `Your style profile uses ${preferences.dialect === "en-GB" ? "British" : "US"} English. Keep the dialect consistent across the document.`
            : `“${token.value}” is a common spelling slip. The suggested replacement is “${preserveCase(token.value, replacement)}”.`, dialectReplacement ? 0.86 : typo ? 0.99 : 0.88, preferences));
    }
    return issues;
}
function findConfusedWords(text, preferences) {
    const issues = [];
    const patterns = [
        [/\b(your)\s+(welcome|going|right|sure)\b/giu, "you're", "grammar-confused-your", "Your is possessive; you’re means you are."],
        [/\b(its)\s+(a|an|not|been|going)\b/giu, "it's", "grammar-confused-its", "It’s means it is; its shows possession."],
        [/\b(their)\s+(is|are|was|were|has|have|a|an|not)\b/giu, "there", "grammar-confused-their", "There points to a place or introduces a statement."],
        [/\b(there)\s+(own|idea|ideas|team|house|car|name|responsibility)\b/giu, "their", "grammar-confused-there", "Their shows possession; there points to a place or introduces a statement."],
        [/\b(better|worse|more|less|rather|different)\s+(then)\b/giu, "than", "grammar-confused-than", "Than compares; then describes time or sequence.", 2],
        [/\b(an?|the|this|that)\s+(affect)\b/giu, "effect", "grammar-confused-affect", "Effect is usually the noun for a result; affect is usually the verb.", 2],
        [/\b(to|will|can|may|might|could|does|did)\s+(effect)\b/giu, "affect", "grammar-confused-effect", "Affect is usually the verb meaning to influence; effect is usually the noun.", 2],
        [/\b(to)\s+(much|many|late|long|loud|quiet|far|quickly)\b/giu, "too", "grammar-confused-too", "Too means excessively or also; to usually introduces a destination or verb.", 1],
        [/\b(too)\s+(the|a|an|my|your|our|their)\b/giu, "to", "grammar-confused-to", "To usually introduces a destination or verb; too means excessively or also.", 1],
        [/\b(to)\s+(advice)\b/giu, "advise", "grammar-confused-advice", "Advise is the verb; advice is the noun.", 1],
        [/\b(some|good|useful|professional)\s+(advise)\b/giu, "advice", "grammar-confused-advise", "Advice is the noun; advise is the verb.", 2],
        [/\b(to|will|can|may|might|could)\s+(loose)\b/giu, "lose", "grammar-confused-loose", "Lose means misplace or fail to win; loose means not tight.", 2],
    ];
    for (const [pattern, replacement, ruleId, explanation, groupIndex = 1] of patterns) {
        for (const match of text.matchAll(pattern)) {
            const start = (match.index ?? 0);
            const original = match[groupIndex] ?? "";
            const wordStart = start + (match[0]?.indexOf(original) ?? 0);
            pushIssue(issues, makeIssue(ruleId, wordStart, wordStart + original.length, original, preserveCase(original, replacement), "grammar", "medium", "Check the commonly confused word", explanation, 0.78, preferences));
        }
    }
    return issues;
}
function articleFor(word) {
    const lower = word.toLocaleLowerCase();
    if (/^[A-Z]{2,}/u.test(word) && /^(?:u|uk|un|url|uuid|ui|usb|utc)/iu.test(word))
        return "a";
    if (ARTICLE_AN_EXCEPTIONS.has(lower))
        return "an";
    if (ARTICLE_A_SOUND_PREFIXES.test(lower))
        return "a";
    return /^[aeiou]/u.test(lower) ? "an" : "a";
}
function nounLooksPlural(word) {
    const lower = word.toLocaleLowerCase();
    if (["children", "criteria", "media", "men", "people", "results", "women"].includes(lower))
        return true;
    if (!lower.endsWith("s"))
        return false;
    return !/(?:analysis|basis|business|class|gas|glass|is|mathematics|news|physics|series|species|status|ss|us)$/u.test(lower);
}
function findPrecisionGrammarIssues(text, preferences, document = parseDocument(text)) {
    const issues = [];
    for (const match of text.matchAll(/\b(the|a|an|this|that|my|your)\s+\1\b/giu)) {
        const start = match.index ?? 0;
        const duplicate = match[1] ?? "";
        const duplicateStart = start + match[0].lastIndexOf(duplicate);
        pushIssue(issues, makeIssue("grammar-duplicate-determiner", duplicateStart, duplicateStart + duplicate.length, duplicate, "", "grammar", "high", "Repeated determiner", "Remove the duplicated determiner so the sentence reads cleanly.", 0.995, preferences));
    }
    for (const match of text.matchAll(/\b(a|an)\s+([\p{L}][\p{L}'’-]*)/giu)) {
        const article = (match[1] ?? "").toLocaleLowerCase();
        const expected = articleFor(match[2] ?? "");
        if (article === expected)
            continue;
        const start = (match.index ?? 0) + (match[0].toLocaleLowerCase().indexOf(article));
        pushIssue(issues, makeIssue("grammar-article-agreement", start, start + article.length, match[1] ?? article, preserveCase(match[1] ?? article, expected), "grammar", "medium", "Check the article", `Use “${expected}” before “${match[2]}” in this context.`, 0.9, preferences));
    }
    const agreementPatterns = [
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
            const subjectIsPlural = nounLooksPlural(subject);
            const pluralVerb = ["are", "were", "have", "do"].includes(verb.toLocaleLowerCase());
            const singularVerb = ["is", "was", "has", "does"].includes(verb.toLocaleLowerCase());
            if ((pluralVerb && subjectIsPlural) || (singularVerb && !subjectIsPlural && !["he", "she", "it", "they", "we", "you"].includes(subject.toLocaleLowerCase())))
                continue;
            const start = (match.index ?? 0) + (match[0].lastIndexOf(verb));
            pushIssue(issues, makeIssue("grammar-subject-verb-agreement", start, start + verb.length, verb, preserveCase(verb, replacements[verb.toLocaleLowerCase()] ?? verb), "grammar", "high", "Check subject–verb agreement", "The verb should agree with the subject in number.", 0.94, preferences));
        }
    }
    const trimmed = text.trim();
    const lastSentence = document.sentences[document.sentences.length - 1];
    const lastToken = document.tokens[document.tokens.length - 1];
    if (trimmed && lastSentence && lastToken && lastSentence.tokens.length >= 4 && /[\p{L}\p{N})\]]$/u.test(trimmed) && /\s/u.test(lastSentence.text)) {
        const lastLower = lastToken.lower.split(/[’']/u)[0];
        const hasVerb = VERB_HINTS.has(lastLower) || lastSentence.tokens.some((token) => /(?:ed|ing|s)$/u.test(token.lower));
        if (hasVerb)
            pushIssue(issues, makeIssue("punctuation-missing-terminal", lastToken.start, lastToken.end, lastToken.value, `${lastToken.value}.`, "punctuation", "low", "Add terminal punctuation", "A complete sentence usually ends with punctuation.", 0.82, preferences));
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
function findRepeatedWordsAndPhrases(text, preferences, document = parseDocument(text)) {
    const issues = [];
    const tokens = document.tokens;
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
    for (const sentence of document.sentences) {
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
function findStyleIssues(text, preferences, document = parseDocument(text)) {
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
    for (const token of document.tokens) {
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
        for (const token of document.tokens) {
            const replacement = contractions[token.lower];
            if (replacement)
                pushIssue(issues, makeIssue("style-contractions", token.start, token.end, token.value, preserveCase(token.value, replacement), "formality", "low", "Avoid contractions", "Your style profile prefers a more formal register.", 0.9, preferences));
        }
    }
    return issues;
}
function findStructureIssues(text, preferences, document = parseDocument(text)) {
    const issues = [];
    const sentences = document.sentences;
    const sentenceLimit = preferences.preferredSentenceLength === "short" ? 22 : preferences.preferredSentenceLength === "long" ? 45 : 32;
    for (const sentence of sentences) {
        if (sentence.tokens.length > sentenceLimit) {
            pushIssue(issues, makeIssue("structure-long-sentence", sentence.start, sentence.end, sentence.text, "", "sentence structure", "low", "Long sentence", `This sentence has ${sentence.tokens.length} words. Consider splitting it if the ideas compete for attention.`, 0.84, preferences));
        }
        const hasVerb = sentence.tokens.some((token) => {
            const base = token.lower.split(/[’']/u)[0];
            return VERB_HINTS.has(token.lower) || VERB_HINTS.has(base) || /(?:ed|ing|s)$/u.test(token.lower);
        });
        if (sentence.tokens.length >= 1 && sentence.tokens.length <= 3 && !hasVerb && !/[!?]$/u.test(sentence.text)) {
            pushIssue(issues, makeIssue("structure-fragment", sentence.start, sentence.end, sentence.text, "", "sentence structure", "low", "Possible sentence fragment", "This short sentence may be missing a verb. Keep it if the fragment is intentional.", 0.65, preferences));
        }
    }
    for (const paragraph of document.paragraphs) {
        const count = paragraph.tokens.length;
        if (count > 150)
            pushIssue(issues, makeIssue("structure-long-paragraph", paragraph.start, paragraph.end, paragraph.text, "", "readability", "low", "Long paragraph", "A shorter paragraph can give the reader a useful pause.", 0.78, preferences));
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
function getWritingStats(text, document = parseDocument(text)) {
    const tokens = document.tokens;
    const sentences = document.sentences;
    const paragraphs = document.paragraphs.length;
    const sentenceLengths = document.sentenceLengths;
    const paragraphLengths = document.paragraphLengths;
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
function inferTone(text, document = parseDocument(text)) {
    const words = document.tokens.map((token) => token.lower);
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
function weightedIssuePenalty(issues, categories, scale) {
    const categorySet = new Set(categories);
    return issues.reduce((total, issue) => {
        if (!categorySet.has(issue.category))
            return total;
        const severity = issue.severity === "high" ? 1.8 : issue.severity === "medium" ? 1.1 : 0.45;
        const confidence = Number.isFinite(issue.confidence) ? Math.max(0, Math.min(1, issue.confidence)) : 0.5;
        return total + severity * confidence * scale;
    }, 0);
}
function goalAlignmentEstimate(text, stats, goals, document = parseDocument(text)) {
    if (!goals || !stats.words)
        return goals ? 60 : 0;
    const lower = text.toLocaleLowerCase();
    const words = document.tokens.map((token) => token.lower);
    const markerScore = (markers) => markers.reduce((count, marker) => count + (lower.includes(marker) ? 1 : 0), 0);
    const audienceMarkers = {
        academic: ["research", "evidence", "study", "analysis", "method", "findings", "citation"],
        professional: ["project", "client", "team", "recommend", "next step", "deliver", "decision"],
        technical: ["system", "data", "api", "function", "configuration", "implementation", "test", "code"],
        casual: ["you", "we", "feel", "really", "thanks", "can't", "won't"],
        general: ["because", "example", "help", "important", "should", "can"],
    };
    const intentMarkers = {
        inform: ["is", "are", "fact", "according", "includes"],
        explain: ["because", "means", "example", "how", "why", "therefore"],
        persuade: ["should", "recommend", "benefit", "need", "best", "must"],
        describe: ["looks", "contains", "shows", "appears", "located", "includes"],
        story: ["then", "suddenly", "before", "after", "felt", "said", "walked"],
    };
    const toneMarkers = {
        neutral: ["may", "can", "typically", "usually"],
        confident: ["will", "can", "proven", "clear", "recommend"],
        friendly: ["you", "we", "help", "thanks", "please"],
        professional: ["recommend", "project", "review", "next step", "available"],
        formal: ["therefore", "however", "shall", "regarding", "accordingly"],
        casual: ["really", "just", "we", "you", "can't", "won't"],
    };
    const evidenceMarkers = ["evidence", "data", "source", "citation", "finding", "result", "research"];
    const explanationMarkers = ["because", "means", "example", "how", "why", "therefore", "explain"];
    const persuasionMarkers = ["should", "recommend", "benefit", "need", "best", "must", "support"];
    const narrativeMarkers = ["then", "suddenly", "before", "after", "felt", "said", "walked", "story"];
    const terminology = new Set(["api", "system", "data", "method", "model", "function", "configuration", "implementation", "test", "code", "evidence", "citation"]);
    const audience = Math.min(24, markerScore(audienceMarkers[goals.audience]) * 4);
    const intentMarkersForGoal = goals.intent === "inform" ? intentMarkers.inform.concat(evidenceMarkers) : goals.intent === "explain" ? intentMarkers.explain.concat(explanationMarkers) : goals.intent === "persuade" ? intentMarkers.persuade.concat(persuasionMarkers) : goals.intent === "story" ? intentMarkers.story.concat(narrativeMarkers) : intentMarkers.describe;
    const intent = Math.min(24, markerScore(intentMarkersForGoal) * 3.2);
    const tone = Math.min(24, markerScore(toneMarkers[goals.tone]) * 4);
    const sentenceMidpoint = { academic: 24, professional: 18, technical: 20, casual: 13, general: 17 };
    const sentenceFit = Math.max(0, 10 - Math.abs(stats.averageSentenceLength - sentenceMidpoint[goals.audience]) * 0.55);
    const terminologyDensity = words.filter((word) => terminology.has(word)).length / Math.max(1, words.length);
    const terminologyFit = goals.audience === "technical" ? Math.min(7, terminologyDensity * 100) : goals.audience === "academic" ? Math.min(5, terminologyDensity * 65) : Math.max(0, 3 - terminologyDensity * 12);
    const directWords = words.filter((word) => ["you", "your", "we", "our", "us"].includes(word)).length;
    const directness = directWords / Math.max(1, words.length);
    const directAddressFit = ["casual", "general"].includes(goals.audience) || ["friendly", "casual"].includes(goals.tone) ? Math.min(6, directness * 100) : Math.max(0, 3 - directness * 8);
    const contractionCount = words.filter((word) => word.includes("'") || word.includes("’")).length;
    const contractionFit = ["casual", "friendly"].includes(goals.tone) ? Math.min(4, contractionCount * 0.8) : ["formal", "professional"].includes(goals.tone) ? Math.max(-5, -contractionCount * 0.8) : 0;
    const formalityPenalty = goals.tone === "formal" && stats.fillerWords ? Math.min(12, stats.fillerWords * 2) : 0;
    return clamp(42 + audience + intent + tone + sentenceFit + terminologyFit + directAddressFit + contractionFit - formalityPenalty);
}
function engagementEstimate(text, stats, document = parseDocument(text)) {
    if (!stats.words)
        return 0;
    const words = document.tokens.map((token) => token.lower);
    const directWords = words.filter((word) => ["you", "your", "we", "our", "us"].includes(word)).length;
    const directness = Math.min(15, (directWords / Math.max(1, stats.words)) * 100);
    const sentenceVariety = Math.min(10, new Set(stats.sentenceLengths).size * 1.5);
    const questions = (text.match(/[?]/gu) ?? []).length;
    const activeSignal = Math.max(0, 8 - stats.passiveVoicePercentage * 0.08);
    const repetitionPenalty = Math.min(12, stats.repeatedWords.length * 1.5);
    return clamp(54 + directness + Math.min(15, stats.vocabularyDiversity * 24) + sentenceVariety + Math.min(8, questions * 2) + activeSignal - repetitionPenalty);
}
function scoreWriting(stats, issues, goals, text = "", document) {
    const high = issues.filter((item) => item.severity === "high").length;
    const medium = issues.filter((item) => item.severity === "medium").length;
    const hasText = stats.words > 0;
    const correctness = hasText ? clamp(100 - weightedIssuePenalty(issues, ["spelling", "grammar", "punctuation", "capitalization"], 7.5)) : 0;
    const clarity = hasText ? clamp(96 - weightedIssuePenalty(issues, ["clarity", "sentence structure", "passive voice"], 4.2) - Math.max(0, stats.averageSentenceLength - 24) * 1.3 - stats.passiveVoicePercentage * 0.12) : 0;
    const conciseness = hasText ? clamp(98 - weightedIssuePenalty(issues, ["conciseness", "repetition", "word choice"], 3.2) - (stats.fillerWords / Math.max(1, stats.words)) * 180) : 0;
    const readabilityBase = Number.isFinite(stats.readability) ? stats.readability : (hasText ? 65 : 0);
    const readability = hasText ? clamp(readabilityBase) : 0;
    const analysedDocument = document ?? parseDocument(text);
    const engagement = engagementEstimate(text, stats, analysedDocument);
    const consistency = hasText ? clamp(100 - weightedIssuePenalty(issues, ["consistency", "spelling", "capitalization"], 4.5) - Math.min(20, stats.repeatedWords.length * 1.4)) : 0;
    const goalAlignment = goalAlignmentEstimate(text, stats, goals, analysedDocument);
    const directWords = analysedDocument.tokens.filter((token) => ["you", "your", "we", "our", "us"].includes(token.lower)).length;
    const breakdown = {
        correctness: scoreContribution(correctness, "Based on confidence-weighted grammar, spelling, punctuation, and capitalization findings.", [`${high} high-confidence high-impact issue${high === 1 ? "" : "s"}`, `${medium} medium-severity issue${medium === 1 ? "" : "s"}`]),
        clarity: scoreContribution(clarity, "Reflects sentence structure, vague wording, passive voice, and sentence length.", [`${stats.longSentences} long sentence${stats.longSentences === 1 ? "" : "s"}`, `${stats.passiveVoicePercentage}% passive-voice estimate`]),
        conciseness: scoreContribution(conciseness, "Reflects filler words, wordiness, redundant phrases, and repetition; document length alone is not penalised.", [`${stats.fillerWords} filler-word finding${stats.fillerWords === 1 ? "" : "s"}`, `${stats.repeatedPhrases.length} repeated phrase pattern${stats.repeatedPhrases.length === 1 ? "" : "s"}`]),
        readability: scoreContribution(readability, "A transparent Flesch-style estimate, not an objective measure of quality.", [`Average sentence length: ${stats.averageSentenceLength || 0} words`, `Vocabulary diversity: ${Math.round(stats.vocabularyDiversity * 100)}%`]),
        engagement: scoreContribution(engagement, "An estimate from whole-document directness, sentence variety, vocabulary variety, questions, and active-voice signals.", [`${Math.round((directWords / Math.max(1, stats.words)) * 100)}% direct-address words`, `${new Set(stats.sentenceLengths).size} sentence-length patterns`]),
        consistency: scoreContribution(consistency, "Reflects dialect, preferred terminology, capitalization, spelling variants, and repeated vocabulary patterns.", [`${stats.repeatedWords.length} repeated vocabulary pattern${stats.repeatedWords.length === 1 ? "" : "s"}`, `${issues.filter((item) => item.category === "consistency").length} terminology finding${issues.filter((item) => item.category === "consistency").length === 1 ? "" : "s"}`]),
        goalAlignment: scoreContribution(goalAlignment, "A best-effort estimate using audience, intent, tone, sentence length, terminology, direct address, and evidence signals; it is not an objective judgement.", [goals ? `${goals.audience} audience` : "No goal selected", goals ? `${goals.intent} intent` : "No intent selected", goals ? `${goals.tone} tone` : "Neutral baseline", `Average sentence: ${stats.averageSentenceLength || 0} words`]),
    };
    const overall = hasText ? clamp(correctness * 0.29 + clarity * 0.17 + conciseness * 0.14 + readability * 0.12 + engagement * 0.1 + consistency * 0.1 + goalAlignment * 0.08) : 0;
    return { correctness, clarity, conciseness, readability, engagement, consistency, goalAlignment, overall, grammar: correctness, breakdown };
}
function mergeWritingIssues(issues) {
    return mergeAnalysisIssues(issues);
}
function analyzeLocally(text, options = {}, goals) {
    const startedAt = analysisNow();
    const preferences = mergePreferences(options);
    const document = analyzeDocument(text);
    const issues = mergeWritingIssues([
        ...findSpelling(text, preferences, document),
        ...findConfusedWords(text, preferences),
        ...findPrecisionGrammarIssues(text, preferences, document),
        ...findPunctuation(text, preferences),
        ...findCapitalization(text, preferences),
        ...findRepeatedWordsAndPhrases(text, preferences, document),
        ...findStyleIssues(text, preferences, document),
        ...findStructureIssues(text, preferences, document),
    ]);
    const stats = getWritingStats(text, document);
    const diagnostics = createAnalysisDiagnostics(issues.length, startedAt, "local");
    return { issues, tone: inferTone(text, document), stats, scores: scoreWriting(stats, issues, goals, text, document), ...(diagnostics ? { diagnostics } : {}) };
}
function expandLocalContext(text, start, end, contextWindow = 320) {
    const roughStart = Math.max(0, start - contextWindow);
    const roughEnd = Math.min(text.length, end + contextWindow);
    const leftMatches = [...text.slice(0, roughStart).matchAll(/(?:[.!?…]\s+|\n\s*)/gu)];
    const left = leftMatches[leftMatches.length - 1];
    const safeStart = left && left.index !== undefined ? left.index + left[0].length : roughStart;
    const right = text.slice(roughEnd).match(/[.!?…](?:\s|$)|\n\s*/u);
    const safeEnd = right?.index !== undefined ? roughEnd + right.index + right[0].length : roughEnd;
    return { start: Math.min(safeStart, start), end: Math.max(Math.min(text.length, safeEnd), end) };
}
function detectChangedRange(previousText, nextText) {
    if (previousText === nextText)
        return null;
    let start = 0;
    while (start < previousText.length && start < nextText.length && previousText.charCodeAt(start) === nextText.charCodeAt(start))
        start += 1;
    let previousEnd = previousText.length;
    let end = nextText.length;
    while (previousEnd > start && end > start && previousText.charCodeAt(previousEnd - 1) === nextText.charCodeAt(end - 1)) {
        previousEnd -= 1;
        end -= 1;
    }
    return { start, end, previousEnd };
}
function analyzeLocallyIncremental(previousText, nextText, previousIssues, changedRange, options = {}, goals) {
    if (!changedRange || previousText === nextText)
        return analyzeLocally(nextText, options, goals);
    const startedAt = analysisNow();
    const previousRegion = expandLocalContext(previousText, changedRange.start, changedRange.previousEnd);
    const nextRegion = expandLocalContext(nextText, changedRange.start, changedRange.end);
    const delta = nextText.length - previousText.length;
    const retained = previousIssues.filter((issue) => issue.source === "local").flatMap((issue) => {
        if (issue.start < previousRegion.end && issue.end > previousRegion.start)
            return [];
        const shift = issue.start >= previousRegion.end ? delta : 0;
        const start = issue.start + shift;
        const end = issue.end + shift;
        return start >= 0 && end <= nextText.length && nextText.slice(start, end) === issue.original ? [{ ...issue, start, end }] : [];
    });
    const region = analyzeLocally(nextText.slice(nextRegion.start, nextRegion.end), options, goals);
    const recalculated = region.issues.map((issue) => ({
        ...issue,
        id: createIssueId(issue.ruleId, issue.start + nextRegion.start, issue.end + nextRegion.start, issue.original),
        start: issue.start + nextRegion.start,
        end: issue.end + nextRegion.start,
    }));
    const issues = mergeWritingIssues([...retained, ...recalculated]);
    const document = analyzeDocument(nextText);
    const stats = getWritingStats(nextText, document);
    const diagnostics = createAnalysisDiagnostics(issues.length, startedAt, "incremental");
    return { issues, tone: inferTone(nextText, document), stats, scores: scoreWriting(stats, issues, goals, nextText, document), ...(diagnostics ? { diagnostics } : {}) };
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

return { analyzeLocally, analyzeLocallyIncremental, detectChangedRange, getWritingStats };
})();
const DraftwiseProviderModule = (() => {
const { createAnalysisChunks, expandRangeToContext, mapChunkIssue, mergeAnalysisIssues } = DraftwiseAnalysisModule;
const { analyzeLocally, getWritingStats, inferTone, scoreWriting } = DraftwiseGrammarModule;

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
const MAX_PROVIDER_RESPONSE_CHARS = 2_000_000;
function providerAnalysisNow() {
    return typeof performance !== "undefined" && typeof performance.now === "function" ? performance.now() : Date.now();
}
function isRecord(value) {
    return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
function parseProviderPayload(value) {
    const parsed = parseJsonContent(value);
    if (!isRecord(parsed) || !Array.isArray(parsed.issues))
        return null;
    const rawIssues = parsed.issues;
    const issues = rawIssues.flatMap((raw) => {
        if (!isRecord(raw) || typeof raw.start !== "number" || !Number.isFinite(raw.start) || typeof raw.end !== "number" || !Number.isFinite(raw.end) || typeof raw.original !== "string" || typeof raw.category !== "string" || typeof raw.severity !== "string")
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
    const scores = Object.fromEntries(Object.entries(rawScores).filter(([, score]) => typeof score === "number" && Number.isFinite(score)));
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
            .filter(([key, item]) => typeof item === "string" && key.length < 80 && !/^(authorization|cookie|host|content-length|set-cookie|proxy-authorization|proxy-authenticate|x-api-key)$/iu.test(key))
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
    if (parsed.username || parsed.password || parsed.hash) {
        throw new ProviderError("invalid-url", "Provider URLs cannot contain credentials or fragments.");
    }
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
    if (!isRecord(payload) || !Array.isArray(payload.choices) || payload.choices.length === 0)
        return null;
    const first = payload.choices[0];
    if (!isRecord(first) || !isRecord(first.message))
        return null;
    const content = first.message.content;
    if (Array.isArray(content)) {
        return content.flatMap((part) => {
            if (typeof part === "string")
                return [part];
            if (isRecord(part) && typeof part.text === "string")
                return [part.text];
            return [];
        }).join("");
    }
    return typeof content === "string" ? content : null;
}
function validateProviderContent(content, kind) {
    if (!content?.trim())
        throw new ProviderError("invalid-json", "The provider returned no usable model content.");
    const parsed = parseJsonContent(content);
    if (!isRecord(parsed))
        throw new ProviderError("invalid-json", "The provider returned model content that was not valid JSON.");
    if (kind === "analysis" && (!Array.isArray(parsed.issues) || !Array.isArray(parsed.tone))) {
        throw new ProviderError("invalid-json", "The provider returned an invalid Draftwise analysis.");
    }
    if (kind === "rewrite" && (typeof parsed.replacement !== "string" || !parsed.replacement.trim())) {
        throw new ProviderError("invalid-json", "The provider returned an invalid Draftwise rewrite.");
    }
    return content;
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
function isRetryableStatus(status, service) {
    return service === "classifier"
        ? [429, 502, 503, 504].includes(status)
        : [429, 500, 502, 503, 504].includes(status);
}
function isAbortError(error) {
    return error instanceof DOMException && error.name === "AbortError";
}
function abortError() {
    return typeof DOMException === "undefined"
        ? Object.assign(new Error("The request was aborted."), { name: "AbortError" })
        : new DOMException("The request was aborted.", "AbortError");
}
function retryAfterMs(response, attempt) {
    const value = response.headers.get("retry-after")?.trim();
    if (value) {
        const seconds = Number(value);
        if (Number.isFinite(seconds))
            return Math.max(0, Math.min(5_000, seconds * 1_000));
        const timestamp = Date.parse(value);
        if (Number.isFinite(timestamp))
            return Math.max(0, Math.min(5_000, timestamp - Date.now()));
    }
    return Math.min(1_500, 100 * (2 ** attempt));
}
function waitForRetry(delayMs, signal) {
    if (signal?.aborted)
        return Promise.reject(abortError());
    return new Promise((resolve, reject) => {
        const cancel = () => {
            clearTimeout(timer);
            signal?.removeEventListener("abort", cancel);
            reject(abortError());
        };
        const timer = setTimeout(() => {
            signal?.removeEventListener("abort", cancel);
            resolve();
        }, delayMs);
        signal?.addEventListener("abort", cancel, { once: true });
    });
}
async function fetchWithRetry(request, options) {
    const maxRetries = Math.max(0, Math.min(3, Math.floor(options.maxRetries ?? 2)));
    let attempt = 0;
    while (true) {
        if (options.signal?.aborted)
            throw abortError();
        try {
            options.onRequest?.();
            const response = await request();
            if (!isRetryableStatus(response.status, options.service) || attempt >= maxRetries)
                return response;
            const delayMs = retryAfterMs(response, attempt);
            options.onRetry?.({ service: options.service, attempt: attempt + 1, delayMs });
            await waitForRetry(delayMs, options.signal);
            attempt += 1;
        }
        catch (error) {
            if (options.signal?.aborted || isAbortError(error) || attempt >= maxRetries || !(error instanceof TypeError))
                throw error;
            const delayMs = Math.min(1_500, 100 * (2 ** attempt));
            options.onRetry?.({ service: options.service, attempt: attempt + 1, delayMs });
            await waitForRetry(delayMs, options.signal);
            attempt += 1;
        }
    }
}
async function requestProvider(settings, messages, signal, timeoutMs = 25_000, options = {}) {
    if (!settings.apiKey.trim())
        throw new ProviderError("missing-key", "Add an API key in Settings to enable AI suggestions.");
    const model = settings.model.trim();
    if (!model || model.length > 200 || /[\u0000-\u001f]/u.test(model))
        throw new ProviderError("invalid-model", "Add a valid model ID in Settings before enabling AI.");
    const endpoint = endpointFor(settings.baseUrl);
    const timeoutController = new AbortController();
    const timeout = setTimeout(() => timeoutController.abort(), Math.max(1_000, timeoutMs));
    const cancel = () => timeoutController.abort();
    signal?.addEventListener("abort", cancel, { once: true });
    const call = async (includeResponseFormat) => {
        const response = await fetchWithRetry(() => fetch(endpoint, {
            method: "POST",
            signal: timeoutController.signal,
            headers: {
                "Content-Type": "application/json",
                Authorization: "Bearer " + settings.apiKey.trim(),
                ...parseCustomHeaders(settings.customHeaders),
            },
            body: JSON.stringify({
                model,
                temperature: Math.max(0, Math.min(1, settings.temperature)),
                max_tokens: Math.max(100, Math.min(4000, settings.maxTokens)),
                ...(includeResponseFormat ? { response_format: { type: "json_object" } } : {}),
                messages,
            }),
        }), { service: "provider", signal: timeoutController.signal, onRequest: options.onRequest, onRetry: options.onRetry });
        if (!response.ok) {
            const responseText = await response.text().catch(() => "");
            if (includeResponseFormat && response.status === 400 && /response_format|json_object|unsupported/iu.test(responseText))
                return call(false);
            throw providerErrorForStatus(response.status);
        }
        const declaredLength = Number(response.headers.get("content-length") || 0);
        if (declaredLength > MAX_PROVIDER_RESPONSE_CHARS)
            throw new ProviderError("invalid-json", "The provider response was too large to process safely.");
        let responseText;
        try {
            responseText = await response.text();
        }
        catch {
            throw new ProviderError("invalid-json", "The provider returned a response that was not valid JSON.");
        }
        if (responseText.length > MAX_PROVIDER_RESPONSE_CHARS)
            throw new ProviderError("invalid-json", "The provider response was too large to process safely.");
        let payload;
        try {
            payload = JSON.parse(responseText);
        }
        catch {
            throw new ProviderError("invalid-json", "The provider returned a response that was not valid JSON.");
        }
        return validateProviderContent(contentFromPayload(payload), options.responseKind ?? "analysis");
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
            throw new ProviderError("cors", "The provider could not be reached. This may be a CORS or network permission issue.");
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
function aiIssueFingerprint(ruleId, original, replacement) {
    const value = `${ruleId}\u001f${original}\u001f${replacement}`;
    let hash = 2_166_136_261;
    for (let index = 0; index < value.length; index += 1) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 16_777_619);
    }
    return (hash >>> 0).toString(36);
}
function parseAnalysisIssues(value, sourceText, chunkId) {
    const parsed = parseProviderPayload(value);
    if (!parsed)
        return [];
    return parsed.issues.flatMap((candidate) => {
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
        const ruleId = candidate.ruleId?.slice(0, 80) || "ai-suggestion";
        const replacement = candidate.replacement.slice(0, 1000);
        return [{
                id: `ai-${chunkId ?? "full"}-${start}-${end}-${aiIssueFingerprint(ruleId, original, replacement)}`,
                ruleId,
                chunkId,
                start,
                end,
                original,
                replacement,
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
    const startedAt = providerAnalysisNow();
    const parsed = parseProviderPayload(value);
    if (!parsed)
        return null;
    const local = analyzeLocally(sourceText, options.preferences, options.goals);
    const aiIssues = parseAnalysisIssues(value, sourceText);
    const issues = mergeAnalysisIssues([...local.issues, ...aiIssues]);
    const stats = getWritingStats(sourceText);
    const scores = scoreWriting(stats, issues, options.goals, sourceText);
    const diagnostics = createAnalysisDiagnostics(issues.length, startedAt, "provider");
    return {
        analysedText: sourceText,
        issues,
        tone: parsed.tone.length ? parsed.tone.slice(0, 4) : inferTone(sourceText),
        scores,
        stats,
        source: "local+ai",
        ...(diagnostics ? { diagnostics } : {}),
    };
}
const PROVIDER_CONCURRENCY = 3;
const MAX_AI_CHUNKS_PER_ANALYSIS = 10;
const MAX_AI_CHARS_PER_ANALYSIS = 50_000;
async function mapWithConcurrency(items, worker, options = {}) {
    if (!items.length)
        return [];
    const results = new Array(items.length);
    const concurrency = Math.max(1, Math.min(items.length, Math.floor(options.concurrency ?? PROVIDER_CONCURRENCY)));
    let nextIndex = 0;
    const runWorker = async () => {
        while (true) {
            const index = nextIndex;
            nextIndex += 1;
            if (index >= items.length)
                return;
            if (options.signal?.aborted)
                throw abortError();
            try {
                results[index] = { status: "fulfilled", value: await worker(items[index], index) };
            }
            catch (reason) {
                results[index] = { status: "rejected", reason };
            }
        }
    };
    const workerResults = await Promise.allSettled(Array.from({ length: concurrency }, () => runWorker()));
    if (options.signal?.aborted)
        throw abortError();
    const workerFailure = workerResults.find((result) => result.status === "rejected");
    if (workerFailure)
        throw workerFailure.reason;
    return results;
}
function createProviderRequestMetrics() {
    return { requests: 0, httpRequests: 0, estimatedInputTokens: 0, estimatedOutputTokens: 0, retries: 0, retryDelayMs: 0 };
}
function recordProviderRequest(metrics, settings, messages) {
    metrics.requests += 1;
    metrics.estimatedInputTokens += estimateTokens(messages.map((message) => message.content).join("\n"));
    metrics.estimatedOutputTokens += Math.max(100, Math.min(4_000, settings.maxTokens));
}
function providerRequestObservers(metrics) {
    return {
        onRequest: () => { metrics.httpRequests += 1; },
        onRetry: (observation) => {
            metrics.retries += 1;
            metrics.retryDelayMs += observation.delayMs;
        },
    };
}
function providerDiagnostics(metrics) {
    return {
        providerRequests: metrics.requests,
        providerHttpRequests: metrics.httpRequests,
        estimatedProviderInputTokens: metrics.estimatedInputTokens,
        estimatedProviderOutputTokens: metrics.estimatedOutputTokens,
        providerRetries: metrics.retries,
        providerRetryDelayMs: metrics.retryDelayMs,
    };
}
function triageDiagnostics(metrics, providerMetrics) {
    return {
        ...providerDiagnostics(providerMetrics),
        classifierRetries: metrics.classifierRetries,
        classifierRetryDelayMs: metrics.classifierRetryDelayMs,
    };
}
function selectProviderWorkload(chunks, options) {
    const maxChunks = Math.max(0, Math.floor(options.maxAiChunks ?? MAX_AI_CHUNKS_PER_ANALYSIS));
    const maxChars = Math.max(0, Math.floor(options.maxAiChars ?? MAX_AI_CHARS_PER_ANALYSIS));
    const decisions = new Map((options.triageDecisions ?? []).map((decision) => [decision.chunkId, decision]));
    const ranked = chunks
        .map((chunk, index) => ({
        chunk,
        index,
        changed: Boolean(options.changedRange && chunk.contentStartOffset < options.changedRange.end && chunk.contentEndOffset > options.changedRange.start),
        semanticPriority: decisions.get(chunk.id)?.decision === "ai-needed" ? 2 : decisions.get(chunk.id)?.decision === "uncertain" ? 1 : 0,
        confidence: decisions.get(chunk.id)?.confidence ?? 0,
    }))
        .sort((left, right) => Number(right.changed) - Number(left.changed)
        || right.semanticPriority - left.semanticPriority
        || right.confidence - left.confidence
        || left.index - right.index);
    const selected = [];
    let characters = 0;
    for (const item of ranked) {
        if (selected.length >= maxChunks || characters + item.chunk.text.length > maxChars)
            continue;
        selected.push(item.chunk);
        characters += item.chunk.text.length;
    }
    selected.sort((left, right) => chunks.indexOf(left) - chunks.indexOf(right));
    return {
        selected,
        skipped: Math.max(0, chunks.length - selected.length),
    };
}
async function analyzeWithProvider(text, goals, settings, options = {}) {
    const startedAt = providerAnalysisNow();
    const preferences = options.preferences;
    const local = options.localAnalysis ?? analyzeLocally(text, preferences, goals);
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
    const workload = selectProviderWorkload(chunks, options);
    const providerMetrics = createProviderRequestMetrics();
    if (!workload.selected.length) {
        const diagnostics = createAnalysisDiagnostics(local.issues.length, startedAt, "provider", providerDiagnostics(providerMetrics));
        return {
            ...local,
            analysedText: text,
            source: "local",
            changedRange: options.changedRange ?? undefined,
            aiCoverage: { requestedChunks: chunks.length, attemptedChunks: 0, successfulChunks: 0, failedChunks: 0, skippedChunks: workload.skipped },
            ...(diagnostics ? { diagnostics } : {}),
        };
    }
    const settled = await mapWithConcurrency(workload.selected, async (chunk) => {
        const messages = [
            { role: "system", content: "You are a privacy-first writing assistant. Do not return HTML, markdown, or secrets." },
            { role: "user", content: analysisPrompt(chunk, goals, preferences) },
        ];
        recordProviderRequest(providerMetrics, settings, messages);
        return {
            chunk,
            response: await requestProvider(settings, messages, options.signal, options.timeoutMs, providerRequestObservers(providerMetrics)),
        };
    }, { concurrency: options.providerConcurrency, signal: options.signal });
    const successful = settled.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
    const failed = settled.filter((result) => result.status === "rejected").length;
    if (!successful.length) {
        const firstFailure = settled.find((result) => result.status === "rejected");
        if (firstFailure && !(firstFailure.reason instanceof ProviderError && firstFailure.reason.code === "invalid-json"))
            throw firstFailure.reason;
    }
    const aiIssues = successful.flatMap(({ chunk, response }) => {
        return parseAnalysisIssues(response, chunk.text, chunk.id)
            .map((issue) => mapChunkIssue(issue, chunk, text))
            .filter((issue) => Boolean(issue));
    });
    const issues = mergeAnalysisIssues([...local.issues, ...aiIssues]);
    const stats = getWritingStats(text);
    const diagnostics = createAnalysisDiagnostics(issues.length, startedAt, "provider");
    return {
        ...local,
        analysedText: text,
        issues,
        scores: scoreWriting(stats, issues, goals, text),
        stats,
        source: successful.length ? "local+ai" : "local",
        changedRange: options.changedRange ?? undefined,
        aiCoverage: {
            requestedChunks: chunks.length,
            attemptedChunks: workload.selected.length,
            successfulChunks: successful.length,
            failedChunks: failed,
            skippedChunks: workload.skipped,
        },
        ...(diagnostics ? { diagnostics: { ...diagnostics, ...providerDiagnostics(providerMetrics) } } : {}),
    };
}
function localRewrite(text, instruction) {
    const lower = instruction.toLocaleLowerCase();
    let result = text;
    if (lower.includes("shorten") || lower.includes("concise")) {
        result = result
            .replace(/\bin order to\b/giu, "to")
            .replace(/\bat this point in time\b/giu, "now")
            .replace(/\bdue to the fact that\b/giu, "because")
            .replace(/\bin the event that\b/giu, "if");
    }
    if (lower.includes("formal") || lower.includes("professional") || lower.includes("academic")) {
        result = result
            .replace(/\bcan't\b/giu, "cannot")
            .replace(/\bwon't\b/giu, "will not")
            .replace(/\bdon't\b/giu, "do not")
            .replace(/\bdoesn't\b/giu, "does not")
            .replace(/\bdidn't\b/giu, "did not")
            .replace(/\bisn't\b/giu, "is not")
            .replace(/\baren't\b/giu, "are not")
            .replace(/\bwasn't\b/giu, "was not")
            .replace(/\bweren't\b/giu, "were not")
            .replace(/\bcouldn't\b/giu, "could not")
            .replace(/\bwouldn't\b/giu, "would not")
            .replace(/\bshouldn't\b/giu, "should not");
    }
    if (lower.includes("casual") || lower.includes("friendly")) {
        result = result
            .replace(/\bcannot\b/giu, "can't")
            .replace(/\bwill not\b/giu, "won't")
            .replace(/\bdo not\b/giu, "don't")
            .replace(/\bdoes not\b/giu, "doesn't")
            .replace(/\bis not\b/giu, "isn't")
            .replace(/\bare not\b/giu, "aren't");
    }
    if (lower.includes("simplify")) {
        result = result
            .replace(/\butilize\b/giu, "use")
            .replace(/\bcommence\b/giu, "start")
            .replace(/\bpurchase\b/giu, "buy")
            .replace(/\bassist\b/giu, "help");
    }
    return result || text;
}
function protectedTokenCounts(text) {
    const patterns = [
        /https?:\/\/[^\s)]+/giu,
        /\b[\w.+-]+@[\w.-]+\.[a-z]{2,}\b/giu,
        /\b(?:\d{1,4}[/-]\d{1,2}[/-]\d{1,4}|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{1,2}(?:,\s*|\s+)\d{2,4}|\d{1,2}\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{2,4})\b/giu,
        /(?:[$€£¥]\s?\d[\d,.]*|\b\d[\d,.]*\s?(?:usd|eur|gbp|jpy)\b)/giu,
        /\b\d[\d,.]*%/gu,
        /\b(?:id|ticket|case|ref(?:erence)?)[#\s:-]*[a-z0-9][a-z0-9_-]{2,}\b/giu,
        /\b[A-Z][A-Z0-9]{1,}(?:-[A-Z0-9]+)+\b/g,
        /\b[0-9a-f]{8}-[0-9a-f-]{27,}\b/giu,
        /\b(?:gpt|claude|gemini|llama|model|v)\s*[-_.]?\d[\w.-]*/giu,
        /\b[\w.-]+\.(?:pdf|docx?|csv|xlsx?|json|ts|tsx|js|jsx|md|png|jpe?g|gif)\b/giu,
        /[“"'](?:[^“"']|[“"']{1,2})+[”"']/gu,
        /\b\d[\d,.]*\b/gu,
    ];
    const counts = new Map();
    for (const pattern of patterns) {
        for (const match of text.matchAll(pattern)) {
            const token = match[0];
            counts.set(token, (counts.get(token) ?? 0) + 1);
        }
    }
    return counts;
}
function hasExactProtectedTokenMultiset(original, replacement) {
    const originalTokens = protectedTokenCounts(original);
    const replacementTokens = protectedTokenCounts(replacement);
    if (originalTokens.size !== replacementTokens.size)
        return false;
    for (const [token, count] of originalTokens) {
        if (replacementTokens.get(token) !== count)
            return false;
    }
    return true;
}
function explicitlyAllowsProtectedChanges(request) {
    if (request.allowProtectedChanges)
        return true;
    return /\b(?:change|update|replace|adjust|convert|reformat|correct)\b[\s\S]{0,80}\b(?:number|date|percentage|percent|currency|url|email|id|identifier|quote|filename|model|version|value)s?\b/iu.test(request.instruction);
}
function preserveBoundaryWhitespace(original, replacement) {
    const leading = original.match(/^\s*/u)?.[0] ?? "";
    const trailing = original.match(/\s*$/u)?.[0] ?? "";
    return `${leading}${replacement.trim()}${trailing}`;
}
function validateRewrite(original, replacement, allowProtectedChanges = false) {
    if (!replacement.trim())
        throw new ProviderError("invalid-json", "The provider returned an empty rewrite. Nothing was changed.");
    if (/<[^>]+>/u.test(replacement))
        throw new ProviderError("invalid-json", "The provider returned markup. Nothing was changed.");
    if (!allowProtectedChanges && !hasExactProtectedTokenMultiset(original, replacement)) {
        throw new ProviderError("invalid-json", "The rewrite changed, removed, duplicated, or introduced a protected URL, value, identifier, or quoted passage. Nothing was changed.");
    }
    return preserveBoundaryWhitespace(original, replacement);
}
async function rewriteWithProvider(request, settings, signal) {
    if (!settings.apiKey.trim())
        return { replacement: localRewrite(request.text, request.instruction), alternatives: [], explanation: "Local rewrite: AI is off, so your text stayed on this device.", source: "local" };
    const response = await requestProvider(settings, [
        { role: "system", content: `You are a careful writing partner. Return JSON only with {"replacement":"...","alternatives":["..."],"explanation":"..."}. Include up to two genuinely different alternatives when useful. ${buildGoalsContext(request.goals, request.preferences)} Preserve meaning, facts, names, numbers, URLs, dates, identifiers, filenames, and quoted text. Do not add HTML or markdown.` },
        { role: "user", content: `Instruction: ${request.instruction}\n\nText to rewrite:\n${request.text}` },
    ], signal, 25_000, { responseKind: "rewrite" });
    const parsed = parseJsonContent(response);
    if (!isRecord(parsed) || typeof parsed.replacement !== "string" || !parsed.replacement.trim())
        throw new ProviderError("invalid-json", "The provider returned an invalid rewrite. Nothing was changed.");
    const explanation = typeof parsed.explanation === "string" ? parsed.explanation : "";
    const allowProtectedChanges = explicitlyAllowsProtectedChanges(request);
    const replacement = validateRewrite(request.text, parsed.replacement, allowProtectedChanges);
    const alternatives = Array.isArray(parsed.alternatives)
        ? parsed.alternatives
            .filter((alternative) => typeof alternative === "string" && Boolean(alternative.trim()) && alternative.trim() !== replacement)
            .slice(0, 2)
            .flatMap((alternative) => {
            try {
                return [validateRewrite(request.text, alternative, allowProtectedChanges)];
            }
            catch {
                return [];
            }
        })
        : [];
    return { replacement, alternatives, explanation: explanation.slice(0, 500), source: "ai" };
}
// ---------------------------------------------------------------------------
// classifier.dev triage: cheap gate before expensive provider calls.
// Local rules always run first. Only unresolved/ambiguous chunks are sent to
// classifier.dev, and only `ai-needed` chunks proceed to the provider.
// classifier.dev never rewrites user text; it returns decisions only.
// ---------------------------------------------------------------------------
const TRIAGE_TAXONOMY = [
    "correctness",
    "clarity",
    "conciseness",
    "engagement",
    "tone",
    "consistency",
    "structure",
    "word-choice",
    "style",
    "other",
];
const DEFAULT_CLASSIFIER_SETTINGS_VALUE = {
    baseUrl: "https://classifier.dev",
    uncertainPolicy: "provider",
    timeoutMs: 8_000,
    maxExcerptChars: 500,
};
const CLASSIFIER_MAX_EXCERPT_CHARS = 500;
const CLASSIFIER_MAX_BATCH_CHUNKS = 100;
const CLASSIFIER_BATCH_SIZES = [5, 10, 25, 50, 100];
const TRIAGE_LABEL_FORMULATIONS = {
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
};
const TRIAGE_LABEL_FORMULATION_ID = "semantic-v2";
const CLASSIFIER_TRIAGE_LABELS = TRIAGE_LABEL_FORMULATIONS[TRIAGE_LABEL_FORMULATION_ID];
const TRIAGE_CONFIDENCE_THRESHOLDS = {
    aiNeeded: 0.75,
    locallySufficient: 0.80,
};
class ClassifierError extends Error {
    code;
    status;
    constructor(code, message, status) {
        super(message);
        this.code = code;
        this.status = status;
        this.name = "ClassifierError";
    }
}
function validateClassifierUrl(baseUrl) {
    let parsed;
    try {
        parsed = new URL(String(baseUrl || "").trim());
    }
    catch {
        throw new ClassifierError("invalid-url", "Enter a valid classifier URL, including https://.");
    }
    const localHost = ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname);
    if (parsed.username || parsed.password || parsed.hash) {
        throw new ClassifierError("invalid-url", "Classifier URLs cannot contain credentials or fragments.");
    }
    if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && localHost)) {
        throw new ClassifierError("insecure-url", "Use HTTPS for classifier URLs. HTTP is allowed only for localhost development.");
    }
    return parsed;
}
function endpointForClassifier(baseUrl) {
    const parsed = validateClassifierUrl(baseUrl);
    const path = parsed.pathname.replace(/\/+$/u, "");
    if (path.endsWith("/classify"))
        parsed.pathname = path;
    else if (path.endsWith("/v1"))
        parsed.pathname = path + "/classify";
    else
        parsed.pathname = path + "/v1/classify";
    return parsed.toString();
}
function classifierErrorForStatus(status) {
    if (status === 401 || status === 403)
        return new ClassifierError("unauthorized", "The classifier rejected this API key.", status);
    if (status === 400)
        return new ClassifierError("invalid-request", "The classifier rejected the request shape or labels.", status);
    if (status === 404)
        return new ClassifierError("invalid-url", "The classifier endpoint was not found.", status);
    if (status === 429)
        return new ClassifierError("rate-limited", "The classifier is rate-limiting requests. Local checks remain available.", status);
    if (status >= 500)
        return new ClassifierError("network", "The classifier service is temporarily unavailable.", status);
    return new ClassifierError("unknown", `The classifier returned an error (${status}).`, status);
}
const LOCAL_TO_TRIAGE = {
    spelling: "correctness",
    grammar: "correctness",
    punctuation: "correctness",
    capitalization: "correctness",
    clarity: "clarity",
    conciseness: "conciseness",
    repetition: "conciseness",
    tone: "tone",
    consistency: "consistency",
    "sentence structure": "structure",
    readability: "structure",
    "word choice": "word-choice",
    formality: "style",
    fluency: "style",
    "passive voice": "style",
};
function mapLocalCategoryToTriage(category) {
    return LOCAL_TO_TRIAGE[category] ?? "other";
}
function normaliseTriageCategory(value) {
    const raw = String(value ?? "").toLocaleLowerCase().trim().replace(/_/gu, "-").replace(/\s+/gu, "-");
    const aliases = {
        "correctness": "correctness",
        "grammar": "correctness",
        "spelling": "correctness",
        "clarity": "clarity",
        "conciseness": "conciseness",
        "concise": "conciseness",
        "engagement": "engagement",
        "tone": "tone",
        "consistency": "consistency",
        "structure": "structure",
        "sentence-structure": "structure",
        "word-choice": "word-choice",
        "wordchoice": "word-choice",
        "word": "word-choice",
        "style": "style",
        "other": "other",
        "unknown": "other",
        "": "other",
    };
    return aliases[raw] ?? "other";
}
function normaliseTriageDecision(value) {
    const raw = String(value ?? "").toLocaleLowerCase().trim().replace(/[\s_]+/gu, "-");
    if (["ai-needed", "ai-needed ", "need-ai", "needs-ai", "ai", "needs-review", "requires-ai"].includes(raw))
        return "ai-needed";
    if (["locally-sufficient", "locally-sufficient ", "local", "sufficient", "local-only", "no-ai"].includes(raw))
        return "locally-sufficient";
    if (["uncertain", "unsure", "unknown", "other", "fallback"].includes(raw))
        return "uncertain";
    return null;
}
/** Minimise transmitted text: truncate to a word boundary and redact structured tokens. */
function redactExcerptForClassifier(text) {
    return String(text || "")
        .replace(/https?:\/\/[^\s<>"']+/giu, "[url]")
        .replace(/\b[\w.+-]+@[\w.-]+\.[a-z]{2,}\b/giu, "[email]")
        .replace(/["“'](?:sk[-_][A-Za-z0-9_-]{8,}|[A-Za-z0-9+/=_-]{24,})["”']/gu, "[quoted-secret]")
        .replace(/\b(?:sk|pk|ghp|xox[baprs])[-_][A-Za-z0-9_-]{8,}\b/gu, "[token]")
        .replace(/\b(?:api[_ -]?key|access[_ -]?token|secret|password)\s*[:=]\s*["']?[A-Za-z0-9_./+=:-]{6,}["']?/giu, "[secret]")
        .replace(/\b(?:GPT|Claude|Gemini|Llama|OpenAI)\s*[-_ ]?\d+[A-Za-z]?(?:\.\d+){0,3}(?:[-_][A-Za-z0-9]+)?\b/giu, "[model]")
        .replace(/\b[\w.-]+\.(?:pdf|docx?|xlsx?|csv|tsv|json|xml|md|png|jpe?g|zip|tar|gz)\b/giu, "[filename]")
        .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/giu, "[uuid]")
        .replace(/\b(?:v|version|release)[-_]?\d+(?:\.\d+){0,3}\b/giu, "[version]")
        .replace(/\b(?:id|ticket|ref(?:erence)?|case|order|invoice|account|request)[\s:#=-]+(?=[A-Za-z0-9_/-]*[0-9_-][A-Za-z0-9_/-]*\b)[A-Za-z0-9][A-Za-z0-9_/-]{2,}\b/giu, "[identifier]")
        .replace(/\b[A-Z]{2,}(?:[-_][A-Z0-9]{2,})+\b/gu, "[identifier]")
        .replace(/(?:£|\$|€|¥|₹)\s?\d{1,3}(?:,\d{3})*(?:\.\d+)?|\b\d+(?:[.,]\d+)?\s?(?:USD|GBP|EUR|JPY)\b/giu, "[currency]")
        .replace(/\b\d+(?:[.,]\d+)?\s?%/gu, "[percentage]")
        .replace(/\b(?:\d{4}-\d{2}-\d{2}|\d{1,2}\s+(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{4}|(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2},\s+\d{4})\b/giu, "[date]")
        .replace(/\b(?:\+?\d[\d().\s-]{7,}\d)\b/gu, "[phone]")
        .replace(/\b\d{6,}\b/gu, "[number]");
}
function buildClassifierExcerpt(chunkText, maxChars = CLASSIFIER_MAX_EXCERPT_CHARS) {
    const redacted = redactExcerptForClassifier(chunkText).trim();
    const limit = Math.max(80, Math.min(2_000, maxChars));
    if (redacted.length <= limit)
        return redacted;
    const sliced = redacted.slice(0, limit);
    const boundary = sliced.search(/\s[^\s]*$/u);
    return (boundary > limit * 0.6 ? sliced.slice(0, boundary) : sliced).trim();
}
const VAGUE_OR_FILLER_PATTERN = /\b(thing|things|stuff|somehow|various|aspects|actually|basically|just|really|quite|very|perhaps|simply|somewhat|obviously|extremely|incredibly|totally|absolutely)\b/iu;
const WORDINESS_PATTERN = /\b(in order to|at this point in time|due to the fact that|a number of|in the event that|for the purpose of|in close proximity to|make a decision|made a decision|come to a conclusion|at the end of the day|think outside the box|low-hanging fruit|moving forward|game changer)\b/iu;
const PASSIVE_PATTERN = /\b(?:was|were|is|are|be|been|being)\s+(?:being\s+)?[\p{L}]+(?:ed|en)\b/iu;
const HEDGE_PATTERN = /\b(might|maybe|perhaps|possibly|uncertain|sort of|kind of)\b/iu;
const SHORT_AMBIGUITY_PATTERN = /\b(clear|ready|complete|completed|approved|reviewed|recorded|stored|available|open|done|fine|good)\b/iu;
const LEGAL_REVIEW_PATTERN = /\b(subject to|shall|attached schedule|agreed period|retain evidence|supplier)\b/iu;
const ABSOLUTE_TONE_PATTERN = /\b(without exception|completely and irreversibly|entire project will fail|best .* ever)\b/iu;
const SEMANTIC_REVIEW_PATTERN = /\b(?:not made explicit|harder to distinguish|does not explain|doesn't explain|without explaining|decision rule|may not know what action|no indication|does not distinguish|wrong mental model|combined meaning|without (?:signalling|signaling)|what the [^.!?]{0,60} meant|unsure whether|could reasonably assume|could interpret|could change [^.!?]{0,60} conclusion|change in recommendation|how [^.!?]{0,60} relate|without variation|direct address|same [^.!?]{0,60} different)\b/iu;
const PROTECTED_TOKEN_PATTERN = /https?:\/\/|[\w.+-]+@[\w.-]+\.[a-z]{2,}|\b[\w.-]+\.(?:pdf|docx?|xlsx?|csv|tsv|json|xml|md|png|jpe?g|zip|tar|gz)\b|(?:\u00a3|\$|\u20ac|\u00a5|\u20b9)\s?\d|\b\d+(?:[.,]\d+)?\s?%/iu;
function hasSemanticReviewSignal(text) {
    const value = String(text || "");
    if (SEMANTIC_REVIEW_PATTERN.test(value) || LEGAL_REVIEW_PATTERN.test(value) || ABSOLUTE_TONE_PATTERN.test(value))
        return true;
    const hasDiscourse = /\b(?:but|although|yet|however|while|without|so that|even though|rather than|which)\b/iu.test(value);
    const hasMeaningSignal = /\b(?:meaning|relationship|distinguish|explain|assume|interpret|conclusion|claims|recommendation|cause|importance|relate|variation)\b/iu.test(value);
    return hasDiscourse && hasMeaningSignal;
}
function collectChunkSignals(chunkText, issuesInChunk) {
    const sentences = String(chunkText || "").split(/(?<=[.!?…])\s+|\n+/u);
    const hasLongSentence = sentences.some((sentence) => sentence.trim().split(/\s+/u).filter(Boolean).length > 32);
    const hasVagueOrFiller = VAGUE_OR_FILLER_PATTERN.test(chunkText) || WORDINESS_PATTERN.test(chunkText) || HEDGE_PATTERN.test(chunkText);
    const hasPassiveOrWordiness = PASSIVE_PATTERN.test(chunkText) || WORDINESS_PATTERN.test(chunkText);
    return {
        localIssueCount: issuesInChunk.length,
        localCategories: [...new Set(issuesInChunk.map((issue) => issue.category))],
        hasLongSentence,
        hasVagueOrFiller,
        hasPassiveOrWordiness,
    };
}
function goalSupportsEngagementReview(goals) {
    return goals?.intent === "persuade" || goals?.audience === "casual" || goals?.tone === "friendly";
}
function goalAllowsPassiveConstruction(goals) {
    if (!goals || goals.audience === "casual" || goals.tone === "casual" || goals.intent === "persuade")
        return false;
    return ["academic", "professional", "technical"].includes(goals.audience) || goals.intent === "describe";
}
function inferTriageCategories(chunkText, issuesInChunk, goals) {
    const mapped = issuesInChunk.map((issue) => mapLocalCategoryToTriage(issue.category));
    const signals = collectChunkSignals(chunkText, issuesInChunk);
    const extra = [];
    if (signals.hasLongSentence)
        extra.push("structure");
    if (signals.hasVagueOrFiller)
        extra.push("clarity");
    if (signals.hasPassiveOrWordiness)
        extra.push("style");
    if (issuesInChunk.length === 0 && chunkText.trim().split(/\s+/u).length > 25 && goalSupportsEngagementReview(goals))
        extra.push("engagement");
    if (HEDGE_PATTERN.test(chunkText))
        extra.push("tone");
    if (issuesInChunk.filter((issue) => issue.ruleId === "dialect-spelling").length >= 2)
        extra.push("consistency");
    const merged = [...new Set([...mapped, ...extra])];
    return merged.length ? merged.slice(0, 4) : ["other"];
}
/** Local-first heuristic: decide whether a chunk is unresolved/ambiguous and may need AI. */
function isChunkUnresolved(chunkText, issuesInChunk, goals) {
    const text = String(chunkText || "");
    const trimmed = text.trim();
    const categories = inferTriageCategories(text, issuesInChunk, goals);
    const semanticReviewSignal = hasSemanticReviewSignal(text);
    const hasDialectConflict = issuesInChunk.filter((issue) => issue.ruleId === "dialect-spelling").length >= 2;
    const shortCorrectionOnly = issuesInChunk.length > 0
        && issuesInChunk.every((issue) => ["spelling", "grammar", "punctuation", "capitalization"].includes(issue.category))
        && issuesInChunk.every((issue) => Number.isFinite(issue.confidence) && (issue.confidence ?? 0) >= 0.8);
    if (/^clean so far\.?$/iu.test(trimmed)) {
        return { unresolved: false, reasons: ["explicit-clean-status"], categories: [] };
    }
    if (PROTECTED_TOKEN_PATTERN.test(text)) {
        return { unresolved: true, reasons: ["protected-token-review"], categories: categories.length ? categories : ["other"] };
    }
    if (hasDialectConflict) {
        return { unresolved: true, reasons: ["dialect-consistency-review"], categories: [...new Set([...categories, "consistency"])] };
    }
    if (trimmed.length < 20) {
        const wordCount = trimmed.split(/\s+/u).filter(Boolean).length;
        if (shortCorrectionOnly) {
            return { unresolved: false, reasons: ["short-correction-only-local"], categories: [] };
        }
        if (issuesInChunk.length || (trimmed.match(/[.!?]/gu) ?? []).length >= 2 || (wordCount <= 5 && SHORT_AMBIGUITY_PATTERN.test(trimmed))) {
            return { unresolved: true, reasons: ["short-fragment"], categories: ["structure"] };
        }
        return { unresolved: false, reasons: ["too-short"], categories: [] };
    }
    const signals = collectChunkSignals(text, issuesInChunk);
    const wordCount = trimmed.split(/\s+/u).filter(Boolean).length;
    if (shortCorrectionOnly && wordCount <= 5) {
        return { unresolved: false, reasons: ["short-correction-only-local"], categories: [] };
    }
    if (wordCount <= 5 && SHORT_AMBIGUITY_PATTERN.test(trimmed)) {
        return { unresolved: true, reasons: ["short-fragment"], categories: ["structure"] };
    }
    if (!issuesInChunk.length) {
        if (semanticReviewSignal) {
            return { unresolved: true, reasons: ["semantic-ambiguity-signals"], categories: categories.length ? categories : ["clarity"] };
        }
        if (signals.hasLongSentence || signals.hasVagueOrFiller || signals.hasPassiveOrWordiness) {
            return { unresolved: true, reasons: ["no-local-issues-but-ambiguous-signals"], categories };
        }
        const words = wordCount;
        if (words > 40 || /[;:—–]/.test(trimmed) || HEDGE_PATTERN.test(trimmed)) {
            return { unresolved: true, reasons: ["long-or-nuanced-clean-text"], categories };
        }
        // Low-engagement clean text: longer, no direct address, no questions.
        // Needs AI for engagement/structure even when local finds nothing.
        if (words > 25 && goalSupportsEngagementReview(goals) && !/\b(you|we|our|your|us|\?)\b/iu.test(trimmed)) {
            return { unresolved: true, reasons: ["low-engagement-clean-text"], categories: categories.length ? categories : ["engagement"] };
        }
        return { unresolved: false, reasons: ["clean"], categories: [] };
    }
    const correctnessOnly = issuesInChunk.every((issue) => ["spelling", "grammar", "punctuation", "capitalization"].includes(issue.category));
    const correctnessConfidenceSafe = issuesInChunk.every((issue) => Number.isFinite(issue.confidence) && (issue.confidence ?? 0) >= 0.8);
    const passiveOnlyOrCorrectness = issuesInChunk.every((issue) => ["spelling", "grammar", "punctuation", "capitalization", "passive voice"].includes(issue.category));
    if (semanticReviewSignal) {
        return { unresolved: true, reasons: ["semantic-ambiguity-signals"], categories };
    }
    if (goalAllowsPassiveConstruction(goals)
        && passiveOnlyOrCorrectness
        && issuesInChunk.some((issue) => issue.category === "passive voice")
        && !signals.hasLongSentence
        && !signals.hasVagueOrFiller) {
        return { unresolved: false, reasons: ["goal-aligned-passive"], categories: [] };
    }
    const hasLowConfidence = issuesInChunk.some((issue) => !Number.isFinite(issue.confidence) || issue.confidence < 0.85);
    if (correctnessOnly && correctnessConfidenceSafe && !signals.hasLongSentence && !signals.hasVagueOrFiller && !signals.hasPassiveOrWordiness) {
        return { unresolved: false, reasons: ["correction-only-local-confidence"], categories: [] };
    }
    if (hasLowConfidence) {
        return { unresolved: true, reasons: ["low-confidence-local"], categories };
    }
    const needsDepth = issuesInChunk.some((issue) => ["clarity", "tone", "consistency", "sentence structure", "readability", "fluency", "word choice", "formality"].includes(issue.category));
    if (needsDepth) {
        return { unresolved: true, reasons: ["needs-semantic-depth"], categories };
    }
    if (signals.hasLongSentence || signals.hasVagueOrFiller || signals.hasPassiveOrWordiness) {
        const onlyHighConfidenceCorrectness = issuesInChunk.every((issue) => ["spelling", "grammar", "punctuation", "capitalization"].includes(issue.category) && (issue.confidence ?? 0) >= 0.9);
        if (!onlyHighConfidenceCorrectness) {
            return { unresolved: true, reasons: ["ambiguous-signals-with-style-issues"], categories };
        }
        // High-confidence correctness-only issues with ambiguous signals can still
        // benefit from a tone/structure check, but local fixes suffice for the
        // immediate pass. Keep locally sufficient to avoid extra cloud calls.
        return { unresolved: false, reasons: ["high-confidence-correctness-only"], categories: [] };
    }
    const onlyHighConfidenceCorrectness = issuesInChunk.every((issue) => ["spelling", "grammar", "punctuation", "capitalization"].includes(issue.category) && (issue.confidence ?? 0) >= 0.9);
    if (onlyHighConfidenceCorrectness) {
        return { unresolved: false, reasons: ["high-confidence-correctness-only"], categories: [] };
    }
    return { unresolved: true, reasons: ["mixed-issues"], categories };
}
function selectTriageCandidates(chunks, localIssues, goals) {
    return chunks.map((chunk) => {
        const issues = localIssues.filter((issue) => issue.start < chunk.endOffset && issue.end > chunk.startOffset);
        return { chunk, issues, assessment: isChunkUnresolved(chunk.text, issues, goals) };
    });
}
function buildClassifierInputs(candidates, maxExcerptChars = CLASSIFIER_MAX_EXCERPT_CHARS) {
    return candidates
        .filter((candidate) => candidate.assessment.unresolved)
        .map((candidate) => {
        const signals = collectChunkSignals(candidate.chunk.text, candidate.issues);
        return {
            chunkId: candidate.chunk.id,
            excerpt: buildClassifierExcerpt(candidate.chunk.text, maxExcerptChars),
            startOffset: candidate.chunk.startOffset,
            endOffset: candidate.chunk.endOffset,
            signals: {
                localIssueCount: signals.localIssueCount,
                localCategories: signals.localCategories,
                hasLongSentence: signals.hasLongSentence,
                hasVagueOrFiller: signals.hasVagueOrFiller,
                hasPassiveOrWordiness: signals.hasPassiveOrWordiness,
            },
            categories: candidate.assessment.categories,
        };
    });
}
function normaliseClassifierLabel(value) {
    return value.trim().toLocaleLowerCase().replace(/\s+/gu, " ");
}
function getTriageLabels(formulationId = TRIAGE_LABEL_FORMULATION_ID) {
    return TRIAGE_LABEL_FORMULATIONS[formulationId] ?? CLASSIFIER_TRIAGE_LABELS;
}
function isKnownClassifierLabel(value, labels = CLASSIFIER_TRIAGE_LABELS) {
    const normalised = normaliseClassifierLabel(value);
    return labels.some((label) => normaliseClassifierLabel(label) === normalised);
}
function mapClassifierLabel(label, confidence, labels = CLASSIFIER_TRIAGE_LABELS, thresholds = TRIAGE_CONFIDENCE_THRESHOLDS) {
    const normalised = normaliseClassifierLabel(label);
    const localLabel = normaliseClassifierLabel(labels[0]);
    const aiLabel = normaliseClassifierLabel(labels[1]);
    if (normalised === localLabel && confidence >= thresholds.locallySufficient)
        return "locally-sufficient";
    if (normalised === aiLabel && confidence >= thresholds.aiNeeded)
        return "ai-needed";
    return "uncertain";
}
/**
 * Validate the classifier.dev response contract. Results are deliberately
 * paired by response order: classifier.dev returns one result per input and
 * does not know Draftwise chunk IDs.
 */
function parseClassifierDecisions(value, expectedInputs, labels = CLASSIFIER_TRIAGE_LABELS, thresholds = TRIAGE_CONFIDENCE_THRESHOLDS) {
    const rawList = isRecord(value) && Array.isArray(value.results)
        ? value.results
        : Array.isArray(value)
            ? value
            : [];
    return rawList.slice(0, expectedInputs.length).map((raw, index) => {
        if (!isRecord(raw) || typeof raw.label !== "string")
            return null;
        const confidenceRaw = raw.confidence;
        if (typeof confidenceRaw !== "number" || !Number.isFinite(confidenceRaw))
            return null;
        const confidence = Math.max(0, Math.min(1, confidenceRaw));
        const label = raw.label.trim();
        if (!label)
            return null;
        const input = expectedInputs[index];
        const decision = mapClassifierLabel(label, confidence, labels, thresholds);
        return {
            chunkId: input.chunkId,
            decision,
            label,
            categories: input.categories.length ? input.categories : ["other"],
            confidence,
            reason: ("classifier.dev label: " + label).slice(0, 300),
            fallback: !isKnownClassifierLabel(label, labels),
        };
    });
}
async function requestClassifierDecisions(inputs, settings, options = {}) {
    if (!inputs.length)
        return [];
    const endpoint = endpointForClassifier(settings.baseUrl);
    const labels = getTriageLabels(options.labelFormulationId);
    const timeoutMs = Math.max(1_000, Math.min(30_000, options.timeoutMs ?? settings.timeoutMs ?? 8_000));
    const timeoutController = new AbortController();
    const timeout = setTimeout(() => timeoutController.abort(), timeoutMs);
    const cancel = () => timeoutController.abort();
    options.signal?.addEventListener("abort", cancel, { once: true });
    try {
        const headers = { "Content-Type": "application/json" };
        const apiKey = settings.apiKey?.trim();
        if (apiKey)
            headers.Authorization = "Bearer " + apiKey;
        const response = await fetchWithRetry(() => fetch(endpoint, {
            method: "POST",
            signal: timeoutController.signal,
            headers,
            body: JSON.stringify({
                inputs: inputs.map((input) => input.excerpt),
                labels,
                instructions: "Choose exactly one label for each input. Return results in the same order as inputs. Do not rewrite or quote the input.",
            }),
        }), { service: "classifier", signal: timeoutController.signal, onRequest: options.onRequest, onRetry: options.onRetry });
        if (!response.ok)
            throw classifierErrorForStatus(response.status);
        const declaredLength = Number(response.headers.get("content-length") || 0);
        if (declaredLength > 500_000)
            throw new ClassifierError("invalid-json", "The classifier response was too large.");
        let responseText;
        try {
            responseText = await response.text();
        }
        catch {
            throw new ClassifierError("invalid-json", "The classifier returned an unreadable response.");
        }
        if (responseText.length > 500_000)
            throw new ClassifierError("invalid-json", "The classifier response was too large.");
        let payload;
        try {
            payload = JSON.parse(responseText);
        }
        catch {
            throw new ClassifierError("invalid-json", "The classifier returned invalid JSON.");
        }
        const parsed = parseClassifierDecisions(payload, inputs, labels, options.thresholds);
        return parsed.length < inputs.length
            ? [...parsed, ...Array.from({ length: inputs.length - parsed.length }, () => null)]
            : parsed;
    }
    catch (error) {
        if (error instanceof ClassifierError)
            throw error;
        if (options.signal?.aborted)
            throw error;
        if (error instanceof DOMException && error.name === "AbortError")
            throw new ClassifierError("timeout", "The classifier took too long to respond.");
        if (error instanceof TypeError)
            throw new ClassifierError("cors", "The classifier could not be reached.");
        throw new ClassifierError("unknown", "The classifier request failed.");
    }
    finally {
        clearTimeout(timeout);
        options.signal?.removeEventListener("abort", cancel);
    }
}
function fallbackDecision(input, reason) {
    return {
        chunkId: input.chunkId,
        decision: "ai-needed",
        categories: input.categories.length ? input.categories : ["other"],
        confidence: 0.65,
        reason: reason.slice(0, 300),
        fallback: true,
    };
}
function buildTriageMetrics(chunks, decisions, candidateChunks, uncertainPolicy, classifierRequests, classifiedChunks, classifierFailures, omittedClassifierResults, providerRequests = 0, providerHttpRequests = providerRequests, classifierHttpRequests = classifierRequests, classifierRetries = 0, classifierRetryDelayMs = 0) {
    const providerChunks = decisions.filter((decision) => decision.decision === "ai-needed" || (decision.decision === "uncertain" && uncertainPolicy === "provider")).length;
    const decisionCount = decisions.length;
    const confidentLocalChunks = decisions.filter((decision) => decision.decision === "locally-sufficient").length;
    const confidentAiChunks = decisions.filter((decision) => decision.decision === "ai-needed" && !decision.fallback).length;
    const uncertainChunks = decisions.filter((decision) => decision.decision === "uncertain").length;
    const fallbackChunks = decisions.filter((decision) => decision.fallback).length;
    return {
        candidateChunks,
        classifierRequests,
        classifierHttpRequests,
        classifiedChunks,
        locallySufficientChunks: confidentLocalChunks,
        aiNeededChunks: decisions.filter((decision) => decision.decision === "ai-needed").length,
        uncertainChunks,
        classifierFailures,
        omittedClassifierResults,
        providerRequests,
        providerHttpRequests,
        providerChunks,
        avoidedProviderChunks: Math.max(0, chunks.length - providerChunks),
        confidentLocalRate: decisionCount ? confidentLocalChunks / decisionCount : 0,
        confidentAiRate: decisionCount ? confidentAiChunks / decisionCount : 0,
        uncertainRate: decisionCount ? uncertainChunks / decisionCount : 0,
        fallbackRate: decisionCount ? fallbackChunks / decisionCount : 0,
        actualProviderAvoidanceRate: chunks.length ? Math.max(0, chunks.length - providerChunks) / chunks.length : 1,
        classifierRetries,
        classifierRetryDelayMs,
    };
}
/** Local-first triage: local rules, optional classifier.dev gate, then provider only when policy allows. */
async function triageChunks(chunks, localIssues, options = {}) {
    const assessed = selectTriageCandidates(chunks, localIssues, options.goals);
    const locallySufficient = assessed.filter((item) => !item.assessment.unresolved);
    const inputs = buildClassifierInputs(assessed, options.maxExcerptChars ?? CLASSIFIER_MAX_EXCERPT_CHARS);
    const decisions = locallySufficient.map((item) => ({
        chunkId: item.chunk.id,
        decision: "locally-sufficient",
        categories: [],
        confidence: 0.9,
        reason: "locally sufficient: " + (item.assessment.reasons.join(",") || "clean"),
    }));
    if (!inputs.length) {
        return {
            decisions,
            candidateCount: 0,
            metrics: buildTriageMetrics(chunks, decisions, 0, options.uncertainPolicy ?? "provider", 0, 0, 0, 0),
        };
    }
    const classifier = options.classifier;
    if (!classifier?.baseUrl?.trim()) {
        // No classifier endpoint is configured: unresolved candidates are sent to the provider.
        for (const input of inputs) {
            decisions.push({
                chunkId: input.chunkId,
                decision: "ai-needed",
                categories: input.categories,
                confidence: 0.65,
                reason: "heuristic unresolved; classifier unavailable",
                fallback: true,
            });
        }
        return {
            decisions,
            candidateCount: inputs.length,
            metrics: buildTriageMetrics(chunks, decisions, inputs.length, options.uncertainPolicy ?? "provider", 0, 0, 0, 0),
        };
    }
    const inputBatches = [];
    const batchSize = Math.max(1, Math.min(CLASSIFIER_MAX_BATCH_CHUNKS, Math.floor(options.classifierBatchSize ?? CLASSIFIER_MAX_BATCH_CHUNKS)));
    for (let offset = 0; offset < inputs.length; offset += batchSize) {
        inputBatches.push(inputs.slice(offset, offset + batchSize));
    }
    let classifierRequests = 0;
    let classifierHttpRequests = 0;
    let classifierRetries = 0;
    let classifierRetryDelayMs = 0;
    try {
        const results = [];
        for (const inputBatch of inputBatches) {
            classifierRequests += 1;
            results.push(...await requestClassifierDecisions(inputBatch, classifier, {
                signal: options.signal,
                timeoutMs: options.timeoutMs ?? classifier.timeoutMs,
                labelFormulationId: options.labelFormulationId,
                thresholds: options.thresholds,
                onRequest: () => { classifierHttpRequests += 1; },
                onRetry: (observation) => {
                    classifierRetries += 1;
                    classifierRetryDelayMs += observation.delayMs;
                },
            }));
        }
        let omittedClassifierResults = 0;
        for (let index = 0; index < inputs.length; index += 1) {
            const input = inputs[index];
            const found = results[index];
            if (found)
                decisions.push(found);
            else {
                omittedClassifierResults += 1;
                decisions.push(fallbackDecision(input, "classifier omitted a result; provider review required"));
            }
        }
        return {
            decisions,
            candidateCount: inputs.length,
            metrics: buildTriageMetrics(chunks, decisions, inputs.length, options.uncertainPolicy ?? "provider", classifierRequests, results.filter((result) => result !== null).length, 0, omittedClassifierResults, 0, 0, classifierHttpRequests, classifierRetries, classifierRetryDelayMs),
        };
    }
    catch (error) {
        if (options.signal?.aborted)
            throw error;
        // A classifier outage is observable and never silently downgrades the unresolved work.
        for (const input of inputs) {
            const message = error instanceof ClassifierError ? error.message : "classifier unavailable";
            const code = error instanceof ClassifierError ? " [" + error.code + "]" : "";
            decisions.push(fallbackDecision(input, "classifier failure" + code + ": " + message + "; provider review required"));
        }
        return {
            decisions,
            candidateCount: inputs.length,
            metrics: buildTriageMetrics(chunks, decisions, inputs.length, options.uncertainPolicy ?? "provider", classifierRequests, 0, 1, 0, 0, 0, classifierHttpRequests, classifierRetries, classifierRetryDelayMs),
        };
    }
}
function filterChunksForProvider(chunks, decisions, uncertainPolicy = "provider") {
    const byId = new Map(decisions.map((decision) => [decision.chunkId, decision]));
    return chunks.filter((chunk) => {
        const decision = byId.get(chunk.id);
        if (!decision)
            return false;
        if (decision.decision === "ai-needed")
            return true;
        if (decision.decision === "uncertain" && uncertainPolicy === "provider")
            return true;
        return false;
    });
}
/**
 * Triaged provider analysis: local first, classifier.dev gate, expensive AI only when required.
 * Preserves incremental ranges via chunk ids and absolute offset mapping.
 */
async function analyzeWithTriage(text, goals, settings, options = {}) {
    const startedAt = providerAnalysisNow();
    const preferences = options.preferences;
    const local = options.localAnalysis ?? analyzeLocally(text, preferences, goals);
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
    const triageEnabled = options.triageEnabled !== false;
    if (!triageEnabled) {
        return analyzeWithProvider(text, goals, settings, options);
    }
    const uncertainPolicy = options.uncertainPolicy ?? options.classifier?.uncertainPolicy ?? "provider";
    const triage = await triageChunks(chunks, local.issues, {
        signal: options.signal,
        classifier: options.classifier ?? null,
        uncertainPolicy,
        labelFormulationId: options.labelFormulationId,
        thresholds: options.triageThresholds,
        goals,
        classifierBatchSize: options.classifierBatchSize,
        maxExcerptChars: options.classifier?.maxExcerptChars,
        timeoutMs: options.classifierTimeoutMs ?? options.classifier?.timeoutMs,
    });
    const aiChunks = filterChunksForProvider(chunks, triage.decisions, uncertainPolicy);
    const providerMetrics = createProviderRequestMetrics();
    if (!aiChunks.length) {
        const stats = getWritingStats(text);
        const diagnostics = createAnalysisDiagnostics(local.issues.length, startedAt, "provider", triageDiagnostics(triage.metrics, providerMetrics));
        return {
            ...local,
            analysedText: text,
            issues: mergeAnalysisIssues([...local.issues]),
            scores: scoreWriting(stats, local.issues, goals, text),
            stats,
            source: "local",
            changedRange: options.changedRange ?? undefined,
            triage: {
                decisions: triage.decisions,
                metrics: triage.metrics,
                coverage: { candidateChunks: triage.candidateCount, providerChunks: 0, skippedDueToLimit: 0 },
            },
            aiCoverage: { requestedChunks: 0, attemptedChunks: 0, successfulChunks: 0, failedChunks: 0, skippedChunks: 0 },
            ...(diagnostics ? { diagnostics } : {}),
        };
    }
    const workload = selectProviderWorkload(aiChunks, { ...options, triageDecisions: triage.decisions });
    if (!workload.selected.length) {
        const stats = getWritingStats(text);
        const diagnostics = createAnalysisDiagnostics(local.issues.length, startedAt, "provider", triageDiagnostics(triage.metrics, providerMetrics));
        return {
            ...local,
            analysedText: text,
            issues: mergeAnalysisIssues([...local.issues]),
            scores: scoreWriting(stats, local.issues, goals, text),
            stats,
            source: "local",
            changedRange: options.changedRange ?? undefined,
            triage: {
                decisions: triage.decisions,
                metrics: {
                    ...triage.metrics,
                    providerRequests: 0,
                    providerHttpRequests: 0,
                    providerChunks: 0,
                    avoidedProviderChunks: Math.max(0, chunks.length),
                    actualProviderAvoidanceRate: chunks.length ? 1 : 1,
                },
                coverage: { candidateChunks: triage.candidateCount, providerChunks: 0, skippedDueToLimit: workload.skipped },
            },
            aiCoverage: { requestedChunks: aiChunks.length, attemptedChunks: 0, successfulChunks: 0, failedChunks: 0, skippedChunks: workload.skipped },
            ...(diagnostics ? { diagnostics } : {}),
        };
    }
    const settled = await mapWithConcurrency(workload.selected, async (chunk) => {
        const messages = [
            { role: "system", content: "You are a privacy-first writing assistant. Do not return HTML, markdown, or secrets." },
            { role: "user", content: analysisPrompt(chunk, goals, preferences) },
        ];
        recordProviderRequest(providerMetrics, settings, messages);
        return {
            chunk,
            response: await requestProvider(settings, messages, options.signal, options.timeoutMs, providerRequestObservers(providerMetrics)),
        };
    }, { concurrency: options.providerConcurrency, signal: options.signal });
    const successful = settled.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
    const failed = settled.filter((result) => result.status === "rejected").length;
    if (!successful.length) {
        const firstFailure = settled.find((result) => result.status === "rejected");
        if (firstFailure && !(firstFailure.reason instanceof ProviderError && firstFailure.reason.code === "invalid-json"))
            throw firstFailure.reason;
    }
    const aiIssues = successful.flatMap(({ chunk, response }) => {
        return parseAnalysisIssues(response, chunk.text, chunk.id)
            .map((issue) => mapChunkIssue(issue, chunk, text))
            .filter((issue) => Boolean(issue));
    });
    const issues = mergeAnalysisIssues([...local.issues, ...aiIssues]);
    const stats = getWritingStats(text);
    const diagnostics = createAnalysisDiagnostics(issues.length, startedAt, "provider", triageDiagnostics(triage.metrics, providerMetrics));
    return {
        ...local,
        analysedText: text,
        issues,
        scores: scoreWriting(stats, issues, goals, text),
        stats,
        source: successful.length ? "local+ai" : "local",
        changedRange: options.changedRange ?? undefined,
        triage: {
            decisions: triage.decisions,
            metrics: {
                ...triage.metrics,
                providerRequests: workload.selected.length,
                providerHttpRequests: providerMetrics.httpRequests,
                providerChunks: workload.selected.length,
                avoidedProviderChunks: Math.max(0, chunks.length - workload.selected.length),
                actualProviderAvoidanceRate: chunks.length ? Math.max(0, chunks.length - workload.selected.length) / chunks.length : 1,
            },
            coverage: { candidateChunks: triage.candidateCount, providerChunks: workload.selected.length, skippedDueToLimit: workload.skipped },
        },
        aiCoverage: {
            requestedChunks: aiChunks.length,
            attemptedChunks: workload.selected.length,
            successfulChunks: successful.length,
            failedChunks: failed,
            skippedChunks: workload.skipped,
        },
        ...(diagnostics ? { diagnostics } : {}),
    };
}

return { analyzeWithProvider, analyzeWithTriage, triageChunks, parseClassifierDecisions, isChunkUnresolved, buildClassifierExcerpt, validateClassifierUrl, ClassifierError, ProviderError };
})();
globalThis.DraftwiseProvider = DraftwiseProviderModule;
})();
