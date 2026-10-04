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
/**
 * Map a range the provider returned inside a chunk back to document offsets.
 *
 * A chunk's `text` deliberately includes a context window on both sides of the
 * span it owns, so the model can see enough to judge a sentence in place. But
 * only `contentStartOffset..contentEndOffset` belongs to this chunk: the
 * neighbouring context is already owned by the adjacent chunk, and accepting a
 * finding reported there analyses the same words twice.
 *
 * Clamping to the owned span (rather than the wider sent span) is what makes
 * chunked analysis on a long document agree with a single-pass analysis. A
 * range that falls in the overlap is rejected and that chunk contributes
 * nothing for it, which is correct: the chunk that owns those words reports it.
 */
function mapRelativeRange(range, chunk, sourceText) {
    const start = chunk.startOffset + Math.floor(range.start);
    const end = chunk.startOffset + Math.floor(range.end);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start)
        return null;
    if (start < chunk.contentStartOffset || end > chunk.contentEndOffset)
        return null;
    if (start < chunk.startOffset || end > chunk.endOffset)
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

const clamp = (value) => Math.max(0, Math.min(100, Math.round(value)));
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
const DEFAULT_STYLE_PREFERENCES = {
    dialect: "en-GB",
    personalDictionary: [],
    names: [],
    ignoredWords: [],
    ignoredRuleIds: [],
    reducedRuleIds: [],
    preferredTerminology: {},
    oxfordComma: true,
    allowContractions: true,
    passiveVoiceSensitivity: "normal",
    preferredSentenceLength: "balanced",
    blockedWords: [],
};
function mergePreferences(options = {}) {
    return {
        ...DEFAULT_STYLE_PREFERENCES,
        ...options,
        personalDictionary: options.personalDictionary ?? DEFAULT_STYLE_PREFERENCES.personalDictionary,
        names: options.names ?? DEFAULT_STYLE_PREFERENCES.names,
        ignoredWords: options.ignoredWords ?? DEFAULT_STYLE_PREFERENCES.ignoredWords,
        ignoredRuleIds: options.ignoredRuleIds ?? DEFAULT_STYLE_PREFERENCES.ignoredRuleIds,
        reducedRuleIds: options.reducedRuleIds ?? DEFAULT_STYLE_PREFERENCES.reducedRuleIds,
        preferredTerminology: options.preferredTerminology ?? DEFAULT_STYLE_PREFERENCES.preferredTerminology,
        blockedWords: options.blockedWords ?? DEFAULT_STYLE_PREFERENCES.blockedWords,
    };
}
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
const TYPO_FIXES = {
    alot: "a lot",
    adn: "and",
    acheive: "achieve",
    adress: "address",
    arguement: "argument",
    becuase: "because",
    beleive: "believe",
    basicly: "basically",
    calender: "calendar",
    comming: "coming",
    couldnt: "couldn't",
    definately: "definitely",
    dont: "don't",
    equipement: "equipment",
    goverment: "government",
    enviroment: "environment",
    expecially: "especially",
    independant: "independent",
    maintainence: "maintenance",
    maintenence: "maintenance",
    occured: "occurred",
    occurence: "occurrence",
    priviledge: "privilege",
    publically: "publicly",
    recieve: "receive",
    receeve: "receive",
    reciever: "receiver",
    refered: "referred",
    reserch: "research",
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
ability able absence absolute absolutely abstract abundant accelerate acceptable access accident accompany accomplish achievement acknowledge acquire across action activate activity actual adapt adequate adjust administration admire admission adopt advance advantage advertise advice advise affect afford afraid agency agenda aggressive agriculture aircraft alarm album alcohol alert allocate allowance alter alternative ambitious analyse announcement annual anticipate anxiety apartment apparent appeal appearance application appoint appreciate approach appropriate approval argue arise arrangement arrival aspect assemble assess assessment assign assistance assumption assure atmosphere attach attempt attention attitude attorney attract attractive audience author authority automatic available average avoid awareness balance barrier basic basis battery beautiful behaviour belief belong benefit beside bicycle biology boundary branch bravery breathe brilliant budget calculate campaign candidate capability capacity capture category celebrate challenge champion channel chapter character charity chemical circumstance citizen clarify classic climate clinical combine comfortable command comment commercial communicate communication competition competitive complaint complete complex component compose composition compromise concentration concept conclude condition conference confidence confirm conflict connect consequence conservative consider consistent constant construct consumer contain contemporary content contract contribute convenient coordinate corporation creative crisis criterion crucial curious current customer damage database deadline debate decade decline dedicate defend define definite demonstrate deny department depend deposit derive destination detail detect determine device diagram digital dimension direction discover discussion display distance distinct distribute district diverse document duration dynamic earn editorial efficient element eliminate emerge emphasis emotional employ employee enable encounter encourage energy engine enhance enormous ensure enterprise entertain entire enthusiasm equivalent establish estimate ethics evaluate evidence exact examine exception exchange exclude execute exhibit expand expectation expense experience experiment expert export expose express extension external factor failure familiar fashion feature feedback festival fiction finance flexible flight flourish focus foreign formal foundation framework frequent function fundamental gain gallery gender generate generation generous geography global govern guidance habit handle hardware healthy hesitate highlight historical honest honour hospital household however hygiene ideal identify illustrate image imagination immediate implement implication importance impressive improve incentive incident include income indicate individual industry inevitable influence initial innovate inquiry insight inspect install instance instead institute integrate intelligence intend intense interact interest internal international interpret interrupt introduce invest investigate involve isolate issue item journey judge justice junior keyboard laboratory language launch layer legal legacy length lesson liberal library licence lifetime likely limit liquid literature locate logical loyalty maintain maintenance manage manner manual manufacture margin market material mature maximum measure mechanism media medicine mention mental method migrate minimum minor mission mobile moderate modern monitor motivate multiple mutual native natural nearby negotiate negative negotiate network neutral notice notion objective obtain obvious occasion official operate opportunity option ordinary organise outcome overall participate partner particular pattern perceive perform permission perspective phase physical policy position positive potential practice precise predict prefer prepare present previous primary principle privacy proceed process produce professional progress project promote propose protect psychology publish purchase pursue quality quarter question rapid rarely react realistic reason recommend recover reduce refer reflect region register regular reject release relevant reliable remain remove replace represent require residence resolve resource respond responsibility restrict retail reveal revise routine safety sample satisfy schedule scope secure segment select sensitive sequence separate serious significant similar simple sincere since single situation sketch solution source specific stable standard statement strategic strategy strengthen structure submit substantial succeed sufficient suggest support survey symbol technical technique technology temporary tension terminology terminal theme thorough thought throughout topic transform transition translate transport trend typical unique update useful valid value variable various vehicle version virtual visible vision visual volume volunteer warn whereas whole widely willing window within without wonder workflow worthy writing wrong youth
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
// Words that are valid English but were absent from the compact lexicon. Without
// them the fuzzy suggester "corrected" them to an edit-distance neighbour, which
// turned ordinary prose into a stream of false positives (web -> we, load -> lead).
const SPELLING_COMMON_GAP = `
web website websites app apps load loads loaded loading loading such where whereas pure purity size sizes sized logic
logical logic string strings grown grows grow stats stat lint linters retail retailer detail details detailed met
bit bits cut cuts hit hits teas tea peace peaceful witch witches breath breathe breathed retention retain retained
uncertain uncertainty evaluator evaluators evaluate evaluates evaluated balancer balancing balance balanced
store stores stored storage slow slower slowest fast faster fastest render renders rendered rendering renders
simply simple simply row rows remote remotely broad broadly narrow narrower national nationally send sends sent
sound sounds source sources serve serves served serve server servers client clients
sent send sense sense significant significantly
main mainly mainly plane planes plain plainly scale scales scope scopes
imply implies implied supply supplies supplied
whether whither weather whether
injection inject injected
distinct distinctly distinction
extract extracts extracted
construct constructs constructed
instruct instructs instructed instruction instructions
respect respects respected
inspect inspects inspected inspection
suspect suspects suspected
aspect aspects aspect
perspective perspectives
transport transports transported
important importance
register registers registered registration
remain remains remained
contain contains contained
maintain maintains maintained maintenance
obtain obtains obtained
retain retains retaining
certain certainty certainly
current currently currently
recent recently
present presence
presently
content contents contextual
context contexts contextual
consequently
according accordingly
acquire acquires acquired
require requires required requirement requirements
inquire inquires inquired inquiry inquiries
ensure ensures ensured
endure endures endured
cure cures cured
pure purely
during
above
below
across
along
around
behind
between
among
against
toward towards
upon
within
without
billion million thousand
plenty plenty
enough enough
nearly nearly
highly highly
widely widely
similarly similarly
usually usually
especially especially
particularly particularly
generally generally
recently
immediately immediately
previously previously
recently
currently currently
likely likely
unlike unlike
proper properly
properly
similar similarly
particular particularly
specific specifically
correct correctly
incorrect incorrectly
exact exactly
approximately approximately
accurately accurately
carefully carefully
easily easily
quickly quickly
quietly quietly
hardly hardly
barely barely
mostly mostly
largely largely
rarely rarely
seldom seldom
settings setting
score scores scoring scored
flow flows flowing flowed
analytics analytic
com coms
https https
url urls
html css json xml sql
localhost localhost
config configs
receiver receivers sender senders
written write writers writing
successful successfully success successes
responsibility responsibilities responsible
embarrass embarrasses embarrassed embarrassing
independent independently independence
especially
privilege privileges privileged
publicly public
definitely definite
accommodate accommodates accommodating
beginning begin begins
maintenance maintain maintains maintained
government governments
environment environments environmental
address addresses addressed
separate separates separated separation
tomorrow
calendar calendars
argument arguments
belief beliefs
receive receives received receiving
repeat repeats repeating repeated repeats
region regions regional
instance instances
traffic
healthy
finish finishes finished
grow grows growing grown
use uses used using
any anybody anything anywhere
top
tree
god
cat
raise raises raised raising
steep steeper
teen
`.trim().split(/\s+/u);
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
const FILLER_WORDS = new Set([
    "actually",
    "basically",
    "just",
    "really",
    "simply",
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
const WORD_PATTERN = /[\p{L}\p{N}]+(?:['’\-][\p{L}\p{N}]+)*/gu;
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
    const pattern = /[^.!?…\n]+(?:[.!?…]+(?=\s|$)|$)/gu;
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
const CODE_FENCE = /^(?:`{3,}|~{3,})/mu;
const INLINE_CODE = /`[^`\n]+`/gu;
const URL_PATTERN = /\bhttps?:\/\/[^\s>)\]]+/gu;
/** Spans the prose rules must not touch: code and literal URLs. */
function findProtectedSpans(text) {
    const spans = [];
    const lines = text.split("\n");
    let offset = 0;
    let fenceStart = null;
    let fenceMarker = "";
    for (const line of lines) {
        const fence = line.match(CODE_FENCE);
        if (fence) {
            const marker = fence[0][0] === "`" ? "`" : "~";
            if (fenceStart === null) {
                fenceStart = offset;
                fenceMarker = marker;
            }
            else if (marker === fenceMarker) {
                spans.push({ start: fenceStart, end: offset + line.length, kind: "code-fence" });
                fenceStart = null;
            }
        }
        offset += line.length + 1;
    }
    if (fenceStart !== null)
        spans.push({ start: fenceStart, end: text.length, kind: "code-fence" });
    for (const match of text.matchAll(INLINE_CODE)) {
        const start = match.index ?? 0;
        spans.push({ start, end: start + match[0].length, kind: "inline-code" });
    }
    for (const match of text.matchAll(URL_PATTERN)) {
        const start = match.index ?? 0;
        spans.push({ start, end: start + match[0].length, kind: "url" });
    }
    // Overlaps are possible (an inline code span inside a URL is nonsense but
    // cheap to merge), so collapse them into a minimal set.
    spans.sort((left, right) => left.start - right.start);
    const merged = [];
    for (const span of spans) {
        const last = merged[merged.length - 1];
        if (last && span.start <= last.end) {
            last.end = Math.max(last.end, span.end);
        }
        else {
            merged.push({ ...span });
        }
    }
    return merged;
}
function isInsideProtectedSpan(spans, start, end) {
    return spans.some((span) => start < span.end && end > span.start);
}
/**
 * True when a position sits inside a list item or blockquote line. Those are
 * structured content: a three-word bullet is a fragment only in the
 * grammatical sense, not something to nag about.
 */
function isStructuredLineStart(text, position) {
    const lineStart = text.lastIndexOf("\n", Math.max(0, position - 1)) + 1;
    return /^\s*(?:[-*+]|\d+[.)]|>)\s/u.test(text.slice(lineStart, lineStart + 12));
}
// Common English words, plurals, and technical vocabulary that the compact lexicon
// missed. Each entry prevents a false positive from the fuzzy spelling suggester.
const SPELLING_FREQUENCY = [...new Set([...SPELLING_CORE, ...SPELLING_UNICODE, ...SPELLING_COMMON, ...SPELLING_COMMON_EXTRA, ...SPELLING_COMMON_GAP, ...SPELLING_EXTENDED])];
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
// English derivational/inflectional suffixes. Stripping these lets the lexicon
// recognise a whole word family (retain -> retention, balance -> balancer) instead
// of treating the derived form as a misspelling of something else entirely.
const DERIVATIONAL_SUFFIXES = [
    "ational", "ization", "isation", "iveness", "fulness", "ousness",
    "ation", "ition", "ution", "ision", "usion", "ension",
    "ement", "ments", "ment", "ness", "ities", "ity", "ances", "ance", "ences", "ence",
    "ions", "ion", "ings", "ing", "ers", "er", "est", "ies", "ied", "ive", "able", "ible",
    "ally", "ily", "ly", "ors", "or", "es", "ed", "s",
];
// A stripped stem is usually a real English root, but some inflections drop a
// silent "e" ("place" -> "plac", "move" -> "mov"). Restore it so a real word
// family resolves to its root.
//
// The silent "e" is only restored after a consonant that cannot end an English
// syllable, plus a bare final "c" (where the "e" is what keeps it soft). Adding
// it unconditionally is what let "moved" reach "move" and "measured" reach
// "measure", and it also let "message" reach "mesage" and so match "receeve",
// silently suppressing a real typo.
function stemVariants(stem) {
    const variants = new Set();
    const add = (value) => { if (value.length >= 3)
        variants.add(value); };
    add(stem);
    if (/c$|[bdfglmnprstvz]$/u.test(stem))
        add(`${stem}e`);
    if (/(.)\1$/u.test(stem))
        add(stem.slice(0, -1));
    if (stem.endsWith("i"))
        add(`${stem.slice(0, -1)}y`);
    return [...variants];
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
    for (const suffix of DERIVATIONAL_SUFFIXES) {
        if (!lower.endsWith(suffix) || lower.length - suffix.length < 3)
            continue;
        for (const variant of stemVariants(lower.slice(0, -suffix.length)))
            add(variant);
    }
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
/**
 * True when `word` and `candidate` differ by a shape that is almost always a
 * typing mistake rather than a different word: an adjacent transposition, a
 * doubled letter, or a single inserted/deleted character.
 *
 * A plain single substitution is deliberately NOT accepted. "expected"/"respected",
 * "recording"/"according", and "observed"/"served" are all one edit apart, but
 * both words in each pair is correct English, so substituting them is always a
 * false positive. Real single-substitution typos ("seperate"/"separate",
 * "recieve"/"receive") are already covered by the explicit TYPO_FIXES table.
 */
function hasTypoShape(word, candidate) {
    if (!candidate || word === candidate)
        return false;
    const distance = boundedEditDistance(word, candidate, 2);
    if (distance > 2)
        return false;
    if (word.length === candidate.length) {
        // Only an adjacent transposition qualifies at equal length.
        const differences = [];
        for (let index = 0; index < word.length; index += 1) {
            if (word[index] !== candidate[index])
                differences.push(index);
        }
        if (differences.length !== 2 || differences[1] - differences[0] !== 1)
            return false;
        return word[differences[0]] === candidate[differences[1]]
            && word[differences[1]] === candidate[differences[0]];
    }
    // A single insertion or deletion. The surplus letter has to look like a slip
    // rather than a different word: dropping the first or last letter of a real
    // word is usually just a different word ("terror"/"error", "alive"/"live"),
    // so a plain edge deletion is rejected outright.
    if (Math.abs(word.length - candidate.length) === 1) {
        const shorter = word.length < candidate.length ? word : candidate;
        const longer = word.length < candidate.length ? candidate : word;
        if (longer.length < 4)
            return false;
        const edges = [longer.slice(1) === shorter, longer.slice(0, -1) === shorter];
        // A repeated letter is only a typo when the SURPLUS letter is the repeat, so
        // "letter" -> "leter" qualifies while "terror" -> "error" does not: there the
        // repeated "r" is not the letter that was removed.
        for (let index = 0; index < longer.length; index += 1) {
            if (longer.slice(0, index) + longer.slice(index + 1) !== shorter)
                continue;
            if (index > 0 && longer[index] === longer[index - 1])
                return true;
            if (index < longer.length - 1 && longer[index] === longer[index + 1])
                return true;
            // An internal removal needs a doubled letter elsewhere in the word to be
            // plausible; a lone missing letter is far more often a different word.
            if (!edges[0] && !edges[1] && /(.)\1/u.test(longer))
                return true;
        }
        return false;
    }
    return false;
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
            // A compact lexicon cannot know every real word, so the nearest candidate is
            // often a different word rather than a misspelling. Require a genuine typo
            // shape - a transposition, an omission, or a doubled/missing letter - so
            // "flow" and "scores" survive while "recieve" is still corrected.
            if (!hasTypoShape(lower, candidate))
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
        [/\b(its)\s+(?:almost|nearly|just|really|quite|very|so|pretty|already|finally|always|never|probably|definitely|simply|literally)\s+[\p{L}]+(?=\s+(?:to\b|and\b|but\b|or\b|because\b|though\b|although\b|so\b|then\b))/giu, "it's", "grammar-confused-its", "It’s means it is; its shows possession."],
        [/\b(its)\s+(ready|done|over|finished|fine|great|obvious|clear|unclear|impossible)(?=\s+(?:to\b|and\b|but\b|or\b|because\b)|[.,!?;:]|$)/giu, "it's", "grammar-confused-its", "It’s means it is; its shows possession."],
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
        // Every token capitalised or numeric is a name, label or heading ("Daniel",
        // "Roughly 1."), not a missing-verb fragment.
        const labelLike = sentence.tokens.length > 0 && sentence.tokens.every((token) => token.value[0] !== token.value[0].toLocaleLowerCase());
        if (sentence.tokens.length >= 1 && sentence.tokens.length <= 3 && !hasVerb && !labelLike && !/[!?]$/u.test(sentence.text)) {
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
        // Past participles only. A bare -en suffix is not evidence: "are often",
        // "is even" and "are open" are ordinary prose, and each one that fires
        // costs the writer's trust in every real passive that follows.
        const pattern = /\b(?:was|were|is|are|be|been|being)\s+(?:being\s+)?(?:\p{L}+ed|\p{L}*(?:aken|idden|iven|oken|olen|osen|rozen|ritten|roken|hosen|riven|oven|eaten|beaten|fallen|known|grown|shown|thrown|seen|gone|done|built|spent|sent|kept|left|lost|held|made|paid|said|sold|told|found|bound|ground|wound|lent|bent|felt|dealt|swept|crept))\b/giu;
        for (const match of text.matchAll(pattern)) {
            const start = match.index ?? 0;
            // Only offer the change where an actor is plausibly missing. Reporting
            // what happened ("the backlog was cleared") is correct, deliberate prose.
            const sentence = document.sentences.find((span) => start >= span.start && start < span.end);
            const textBefore = sentence ? sentence.text.slice(0, Math.max(0, start - sentence.start)) : text.slice(Math.max(0, start - 80), start);
            const hasExplicitActor = /\b(?:by\s+\p{L}+|(?:we|they|he|she|it|someone|the)\s+\w+\s+(?:made|built|created|fixed|found|wrote|sent))\s*$/iu.test(textBefore.trim());
            if (hasExplicitActor)
                continue;
            pushIssue(issues, makeIssue("style-passive-voice", start, start + match[0].length, match[0], "", "passive voice", passiveSensitivity === "strict" ? "medium" : "low", "Consider naming who acts", "This is a passive construction, so the reader cannot tell who is acting. If the actor matters, name them; if the focus on the result is deliberate, keep it.", passiveSensitivity === "strict" ? 0.8 : 0.62, preferences));
        }
    }
    return issues;
}
/**
 * Document-level structural analysis.
 *
 * Sentence rules fix sentences; this layer looks at how the document carries
 * its argument: repeated ideas, paragraphs that do not advance the piece,
 * claims without support, weak transitions, hedging, and a conclusion that
 * introduces something new.
 *
 * Every finding is deliberately conservative and tied to the exact passage.
 * These are editorial judgements, not errors: confidence stays below the
 * objective rules, and the advice names what the paragraph is doing rather
 * than issuing generic instruction like "improve the introduction".
 */
const MAX_STRUCTURAL_NOTES = 5;
const MIN_PARAGRAPH_WORDS = 15;
const STOP_WORDS = new Set([
    "the", "a", "an", "and", "or", "but", "if", "then", "than", "that", "this", "these", "those", "there", "here",
    "is", "are", "was", "were", "be", "been", "being", "am", "do", "does", "did", "have", "has", "had",
    "i", "you", "he", "she", "it", "we", "they", "me", "him", "her", "us", "them", "my", "your", "his", "its", "our", "their",
    "in", "on", "at", "to", "for", "of", "with", "from", "by", "as", "into", "about", "over", "after", "before",
    "not", "no", "so", "because", "while", "although", "though", "which", "who", "whom", "what", "when", "where", "how", "why",
    "will", "would", "can", "could", "should", "may", "might", "must", "shall", "also", "more", "most", "some", "any", "each", "every", "all", "both",
]);
const HEDGE_WORDS = new Set(["might", "maybe", "perhaps", "possibly", "somewhat", "arguably", "seemingly", "apparently", "fairly", "rather", "quite", "kind of", "sort of"]);
const CLAIM_MARKERS = new Set(["always", "never", "everyone", "nobody", "obviously", "clearly", "proves", "proven", "undeniably", "certainly", "best", "worst"]);
const SUPPORT_MARKERS = ["because", "since", "for example", "for instance", "evidence", "study", "data", "research", "according", "shows that", "means that", "therefore"];
function contentWords(paragraph) {
    return new Set(paragraph.tokens.map((token) => token.lower.split(/[’']/u)[0]).filter((word) => word.length > 3 && !STOP_WORDS.has(word)));
}
function jaccard(left, right) {
    if (left.size === 0 || right.size === 0)
        return 0;
    let shared = 0;
    for (const word of left)
        if (right.has(word))
            shared += 1;
    return shared / (left.size + right.size - shared);
}
function sharedTopicWords(left, right, limit = 3) {
    return [...left].filter((word) => right.has(word)).slice(0, limit);
}
function findGoalTerminology(text, goals, preferences, document = parseDocument(text)) {
    const issues = [];
    const forbidden = goals?.forbiddenTerminology ?? [];
    for (const term of forbidden) {
        const needle = term.trim();
        if (!needle)
            continue;
        const pattern = new RegExp(`\\b${needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "giu");
        for (const match of text.matchAll(pattern)) {
            const start = match.index ?? 0;
            pushIssue(issues, makeIssue("goal-forbidden-term", start, start + match[0].length, match[0], "", "consistency", "medium", "Term you asked to avoid", `Your goals forbid “${needle}”. Replace it with wording that fits the document.`, 0.9, preferences));
        }
    }
    const required = (goals?.requiredTerminology ?? []).map((term) => term.trim()).filter(Boolean);
    if (required.length > 0) {
        const lower = text.toLocaleLowerCase();
        const missing = required.filter((term) => !lower.includes(term.toLocaleLowerCase()));
        const anchor = document.paragraphs[0];
        if (missing.length > 0 && anchor) {
            pushIssue(issues, makeIssue("goal-missing-term", anchor.start, Math.min(anchor.end, anchor.start + 60), text.slice(anchor.start, Math.min(anchor.end, anchor.start + 60)), "", "consistency", "low", "Required terminology missing", `Your goals require ${missing.map((term) => `“${term}”`).join(", ")} somewhere in the draft; none of ${missing.length === 1 ? "it appears" : "them appear"} yet.`, 0.7, preferences));
        }
    }
    return issues;
}
function findDocumentStructure(text, preferences, goals, document = parseDocument(text)) {
    const issues = [];
    const paragraphs = document.paragraphs.filter((paragraph) => paragraph.tokens.length > 0);
    // Claim support and hedging are paragraph-local and hold even in a one-
    // paragraph document; the cross-paragraph checks run only from two up.
    if (paragraphs.length === 0)
        return issues;
    const audience = goals?.audience ?? "general";
    const intent = goals?.intent ?? "inform";
    const formalRegister = audience === "academic" || audience === "professional" || intent === "persuade";
    // 1. Repeated argument: a paragraph that substantially restates an earlier
    //    one without adding new material.
    const seenParagraphs = [];
    for (const paragraph of paragraphs) {
        if (issues.length >= MAX_STRUCTURAL_NOTES)
            break;
        if (paragraph.tokens.length < MIN_PARAGRAPH_WORDS)
            continue;
        const words = contentWords(paragraph);
        for (const previous of seenParagraphs) {
            const overlap = jaccard(words, previous.words);
            if (overlap >= 0.55) {
                const topic = sharedTopicWords(words, previous.words);
                pushIssue(issues, makeIssue("structure-note-repeated-idea", paragraph.start, Math.min(paragraph.end, paragraph.start + 90), text.slice(paragraph.start, Math.min(paragraph.end, paragraph.start + 90)), "", "fluency", "low", "Repeated idea", `What Draftwise noticed: this paragraph covers nearly the same ground as an earlier one${topic.length ? `, sharing ${topic.map((word) => `“${word}”`).join(" and ")}` : ""}. Why it may matter: readers who already read the earlier point lose momentum here. Consider either cutting this paragraph, or keeping only the sentence that adds new evidence or a new angle.`, 0.6, preferences));
                break;
            }
        }
        seenParagraphs.push({ paragraph, words });
    }
    // 2. Unsupported claim: strong claim language in a paragraph with no
    //    supporting marker anywhere in it.
    if (formalRegister) {
        for (const paragraph of paragraphs) {
            if (issues.length >= MAX_STRUCTURAL_NOTES)
                break;
            const lower = paragraph.text.toLocaleLowerCase();
            const claim = paragraph.tokens.find((token) => CLAIM_MARKERS.has(token.lower));
            if (!claim)
                continue;
            if (SUPPORT_MARKERS.some((marker) => lower.includes(marker)))
                continue;
            pushIssue(issues, makeIssue("structure-note-unsupported-claim", claim.start, claim.end, claim.value, "", "clarity", "low", "Claim without support", `What Draftwise noticed: this passage asserts that “${claim.value}” holds without saying why. Why it may matter: an unsupported claim is where a sceptical reader stops trusting the argument. Consider adding one sentence of evidence or a worked example right after this claim.`, 0.55, preferences));
        }
    }
    // 3. Excessive hedging: several hedges stacked in one paragraph weaken the
    //    point instead of qualifying it.
    if (formalRegister) {
        for (const paragraph of paragraphs) {
            if (issues.length >= MAX_STRUCTURAL_NOTES)
                break;
            const hedges = paragraph.tokens.filter((token) => HEDGE_WORDS.has(token.lower));
            if (hedges.length < 3)
                continue;
            pushIssue(issues, makeIssue("structure-note-hedging", hedges[0].start, hedges[0].end, hedges[0].value, "", "tone", "low", "Stacked hedges", `What Draftwise noticed: this passage qualifies itself ${hedges.length} times (“${hedges.slice(0, 3).map((token) => token.value).join("”, “")}”). Why it may matter: stacked hedges read as doubt rather than care, and weaken a point the writer may actually hold confidently. Consider keeping the single strongest qualifier and removing the rest.`, 0.55, preferences));
        }
    }
    // 4. Conclusion introducing a new idea: the closing paragraph is the first
    //    place a substantial topic word appears. Only meaningful when there is a
    //    body before it to conclude.
    const last = paragraphs[paragraphs.length - 1];
    if (paragraphs.length >= 2 && last && last.tokens.length >= 15 && (intent === "persuade" || intent === "inform")) {
        const earlierWords = new Set(paragraphs.slice(0, -1).flatMap((paragraph) => [...contentWords(paragraph)]));
        const newWords = [...contentWords(last)].filter((word) => !earlierWords.has(word));
        if (newWords.length >= 2) {
            pushIssue(issues, makeIssue("structure-note-conclusion-new-idea", last.start, Math.min(last.end, last.start + 90), text.slice(last.start, Math.min(last.end, last.start + 90)), "", "fluency", "low", "New idea in the conclusion", `What Draftwise noticed: the closing paragraph brings up ${newWords.slice(0, 2).map((word) => `“${word}”`).join(" and ")}, which appears nowhere earlier in the draft. Why it may matter: a conclusion that raises new material leaves the reader without a place to weigh it. Consider moving this point into the body, or closing instead by returning to what has already been argued.`, 0.55, preferences));
        }
    }
    // 5. Weak transition: a paragraph opening on a bare connector or dangling
    //    "This…" after a paragraph about something else.
    for (let index = 1; index < paragraphs.length && issues.length < MAX_STRUCTURAL_NOTES; index += 1) {
        const paragraph = paragraphs[index];
        const first = paragraph.tokens[0];
        if (!first)
            continue;
        const opener = paragraph.text.slice(0, 40);
        const startsWithThis = /^this\s+[\p{L}]+/iu.test(opener);
        const startsWithConnector = /^(also|and|but|so|then)\b/iu.test(opener);
        if (!startsWithThis && !(startsWithConnector && formalRegister))
            continue;
        const previousWords = contentWords(paragraphs[index - 1]);
        const currentWords = contentWords(paragraph);
        // A "This X" opener only misleads when X's topic is absent from the
        // previous paragraph: otherwise it is a perfectly good transition.
        const followWord = paragraph.tokens[1]?.lower ?? "";
        const bridging = previousWords.has(followWord) || jaccard(previousWords, currentWords) > 0.2;
        if (bridging)
            continue;
        pushIssue(issues, makeIssue("structure-note-weak-transition", first.start, paragraph.tokens[Math.min(2, paragraph.tokens.length - 1)].end, text.slice(first.start, paragraph.tokens[Math.min(2, paragraph.tokens.length - 1)].end), "", "fluency", "low", "Abrupt transition", `What Draftwise noticed: “${opener.trim().split(/\s+/u).slice(0, 3).join(" ")}…” opens on a subject the previous paragraph never introduced. Why it may matter: the reader has to guess the connection instead of following it. Consider naming the link in the first few words — what this paragraph is reacting to, or how it relates to the one above.`, 0.5, preferences));
    }
    return issues;
}
const OUTLINE_STOP_WORDS = new Set([
    "the", "a", "an", "and", "or", "but", "if", "then", "than", "that", "this", "these", "those", "there", "here",
    "is", "are", "was", "were", "be", "been", "being", "am", "do", "does", "did", "done", "have", "has", "had",
    "i", "you", "he", "she", "it", "we", "they", "me", "him", "her", "us", "them", "my", "your", "his", "its", "our", "their",
    "in", "on", "at", "to", "for", "of", "with", "from", "by", "as", "into", "about", "over", "after", "before",
    "not", "no", "so", "because", "while", "although", "though", "which", "who", "whom", "what", "when", "where", "how", "why",
    "will", "would", "can", "could", "should", "may", "might", "must", "shall", "also", "more", "most", "some", "any", "each", "every", "all", "both",
    "up", "out", "down", "off", "own", "same", "very", "just", "now", "only", "even", "still", "much", "many", "one", "two", "first", "last",
]);
const OPENING_CUES = ["however", "but", "yet", "nevertheless", "although", "though", "instead", "on the other hand", "meanwhile", "now"];
const CLOSING_CUES = ["overall", "in conclusion", "to conclude", "to sum up", "in summary", "finally", "ultimately", "in short", "therefore", "for these reasons"];
const TRANSITION_CUES = ["moreover", "furthermore", "in addition", "additionally", "similarly", "likewise", "consequently", "as a result", "for instance", "for example"];
/**
 * A conservative stem so inflections of one word count as one theme.
 *
 * The failure mode to avoid is worse than missing a match: "across" must never
 * become "acros", and "carefully" must not become "careful" while "detail"
 * stays "detail". Only endings that are unambiguous evidence of inflection are
 * removed, and never below three remaining characters, so no theme is ever
 * shorter than a real word fragment.
 */
function stem(word) {
    if (word.length <= 4)
        return word;
    let result = word;
    // -ss plurals and -es verb endings: boxes -> box, watches -> watch.
    if (/(?:sses|xes|zes|ches|shes)$/u.test(result))
        result = result.slice(0, -2);
    // -ies -> -y: studies -> study.
    else if (/ies$/u.test(result))
        result = `${result.slice(0, -3)}y`;
    // -ing only after a plausible stem, and only when something remains.
    else if (/ing$/u.test(result) && result.length >= 8)
        result = result.slice(0, -3);
    // -ed likewise.
    else if (/ed$/u.test(result) && result.length >= 6)
        result = result.slice(0, -2);
    // A plain plural -s, but never a genuine -ss word ("across", "analysis").
    else if (/s$/u.test(result) && !/(?:ss|us|is)$/u.test(result))
        result = result.slice(0, -1);
    return result.length >= 3 ? result : word;
}
function sectionTopic(words) {
    const counts = new Map();
    for (const raw of words) {
        const key = stem(raw);
        if (key.length < 4)
            continue;
        counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    let best = "";
    let bestCount = 0;
    for (const [term, count] of counts) {
        if (count > bestCount || (count === bestCount && term < best)) {
            best = term;
            bestCount = count;
        }
    }
    return bestCount >= 2 ? best : "";
}
/**
 * Split the draft into sections. Paragraphs are the writer's own unit of
 * thought, so sections are built from consecutive paragraphs rather than an
 * arbitrary character count: a section boundary should mean the argument moved.
 * A run of paragraphs is cut when the vocabulary turns over enough that the
 * writer is clearly onto something new.
 */
function buildSections(document, stats) {
    const paragraphs = document.paragraphs.filter((paragraph) => paragraph.tokens.length > 0);
    if (paragraphs.length === 0)
        return [];
    // Target a section roughly every 180 words, but never split a paragraph.
    const targetWords = 180;
    const groups = [];
    let current = [];
    let currentWords = 0;
    for (const paragraph of paragraphs) {
        current.push(paragraph);
        currentWords += paragraph.tokens.length;
        if (currentWords >= targetWords && paragraph.tokens.length < 120) {
            groups.push(current);
            current = [];
            currentWords = 0;
        }
    }
    if (current.length)
        groups.push(current);
    // Now merge adjacent groups that share too much vocabulary to be a real turn.
    const merged = [];
    for (const group of groups) {
        const words = new Set();
        for (const paragraph of group)
            for (const token of paragraph.tokens) {
                const word = token.lower;
                if (word.length > 4 && !OUTLINE_STOP_WORDS.has(word))
                    words.add(stem(word));
            }
        const previous = merged[merged.length - 1];
        if (previous && words.size && previous.words.size) {
            let shared = 0;
            for (const word of words)
                if (previous.words.has(word))
                    shared += 1;
            const overlap = shared / Math.max(1, Math.min(words.size, previous.words.size));
            if (overlap > 0.45) {
                previous.paragraphs.push(...group);
                for (const word of words)
                    previous.words.add(word);
                continue;
            }
        }
        merged.push({ paragraphs: group, words });
    }
    const totalStems = new Set();
    for (const group of merged)
        for (const word of group.words)
            totalStems.add(word);
    const sections = [];
    merged.forEach((group, index) => {
        const start = group.paragraphs[0].start;
        const end = group.paragraphs[group.paragraphs.length - 1].end;
        const sentences = document.sentences.filter((sentence) => sentence.start >= start && sentence.end <= end);
        const words = group.paragraphs.reduce((total, paragraph) => total + paragraph.tokens.length, 0);
        const tokens = group.paragraphs.flatMap((paragraph) => paragraph.tokens.map((token) => token.lower));
        let novelCount = 0;
        const seen = new Set();
        for (const token of tokens) {
            const word = stem(token);
            if (word.length < 4 || OUTLINE_STOP_WORDS.has(word))
                continue;
            if (!seen.has(word)) {
                seen.add(word);
                // Only credit a stem as new if it is new to the whole document, or
                // first appears here rather than being common everywhere.
                if (totalStems.has(word))
                    novelCount += 1;
            }
        }
        const novelty = seen.size ? Math.max(0, Math.min(1, novelCount / Math.max(6, seen.size))) : 0;
        const dominant = sentences.reduce((longest, sentence) => (sentence.tokens.length > longest.tokens.length ? sentence : longest), sentences[0]);
        sections.push({
            id: `section-${index}`,
            index,
            start,
            end,
            opening: (sentences[0]?.text ?? group.paragraphs[0].text).trim().slice(0, 140),
            topic: sectionTopic(tokens),
            dominantSentence: (dominant?.text ?? "").trim().slice(0, 180),
            words,
            sentences: sentences.length,
            novelty,
            filler: false,
            role: "development",
        });
    });
    // A section sandwiched between substantial neighbours that adds little new
    // vocabulary is doing little work. That is a real editorial observation and
    // one the writer cannot see, because locally every sentence looks fine.
    for (let index = 1; index < sections.length - 1; index += 1) {
        const section = sections[index];
        const before = sections[index - 1];
        const after = sections[index + 1];
        if (section.words >= 40 && section.novelty < 0.22 && before.novelty > section.novelty && after.novelty > section.novelty) {
            section.filler = true;
        }
    }
    if (stats.words > 0 && sections.length > 0) {
        const average = stats.words / sections.length;
        // A single section spanning most of the draft means no real structure yet.
        if (sections.length === 1 && average > 260)
            sections[0].filler = sections[0].filler && sections[0].novelty >= 0.2;
    }
    // Roles are assigned last: they depend on novelty and on the final section
    // count, both of which the filler pass above can change.
    for (const section of sections) {
        section.role = section.filler ? "supporting-detail" : roleFor(section, sections.length);
    }
    return sections;
}
/**
 * What a section is doing in the argument.
 *
 * Cheap, local, and useful: "your conclusion introduces a new term" only works
 * if the writer can tell which paragraph is the conclusion. Positions alone are
 * a weak signal, so the opening words and the section's novelty decide it.
 */
function roleFor(section, total) {
    if (total === 1)
        return "development";
    const opening = section.opening.toLocaleLowerCase();
    if (section.index === 0)
        return "opening";
    if (section.index === total - 1)
        return "closing";
    if (section.novelty >= 0.4 && TRANSITION_CUES.some((cue) => opening.includes(cue)))
        return "turn";
    if (section.novelty < 0.2)
        return "supporting-detail";
    return "development";
}
function firstWords(text, count) {
    return text.trim().split(/\s+/u).slice(0, count).join(" ");
}
/**
 * Build the whole-document reading: an outline, the draft's themes, where its
 * weight sits, and a small set of editorial notes that scale with the draft.
 */
function buildDocumentOutline(text, stats, document = parseDocument(text), options = {}) {
    const resolvedStats = stats;
    const sections = buildSections(document, resolvedStats ?? { words: document.tokens.length, sentences: document.sentences.length, paragraphs: document.paragraphs.length, sentenceLengths: document.sentenceLengths, paragraphLengths: document.paragraphLengths, readingTime: 0, characters: text.length, readability: 0, longSentences: 0, fillerWords: 0, passiveVoice: 0, passiveVoicePercentage: 0, averageSentenceLength: 0, longestSentence: "", vocabularyDiversity: 0, repeatedWords: [], repeatedPhrases: [], fillerWordFrequency: [], commonWords: [] });
    const notes = [];
    const goals = options.goals;
    const preferences = options.preferences;
    // --- Themes -----------------------------------------------------------
    const themeCounts = new Map();
    let themeTotal = 0;
    for (const token of document.tokens) {
        const word = token.lower;
        if (word.length <= 4 || OUTLINE_STOP_WORDS.has(word))
            continue;
        const key = stem(word);
        if (key.length < 4)
            continue;
        themeCounts.set(key, (themeCounts.get(key) ?? 0) + 1);
        themeTotal += 1;
    }
    const themes = [...themeCounts.entries()]
        .filter(([, count]) => count >= 2)
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, 6)
        .map(([term, count]) => ({ term, count, share: themeTotal ? count / themeTotal : 0 }));
    // --- Shape ------------------------------------------------------------
    const shape = sections.length === 0 ? "very-short"
        : resolvedStats && resolvedStats.words > 0 && resolvedStats.words < 90 ? "very-short"
            : sections.length === 1 ? (resolvedStats && resolvedStats.words > 400 ? "linear" : "single-idea")
                : sections.length >= 5 ? "sectioned"
                    : (resolvedStats && resolvedStats.paragraphs > sections.length * 3 ? "list-driven" : "linear");
    // --- Weight -----------------------------------------------------------
    const heaviest = sections.reduce((best, section) => (!best || section.words > best.words ? section : best), null);
    const focus = heaviest
        ? heaviest.topic
            ? `The draft spends most of its weight on “${heaviest.topic}”.`
            : `The heaviest part of the draft runs from ${firstWords(heaviest.opening, 6)}...`
        : "The draft is still very short.";
    // --- Editorial notes --------------------------------------------------
    if (sections.length >= 2) {
        // A hard structural turn: the writer changes their mind mid-draft without
        // signalling it. Worth more as the draft gets longer.
        const opener = firstWords(sections[0].opening, 12).toLocaleLowerCase();
        const last = sections[sections.length - 1];
        const closer = firstWords(last.opening, 12).toLocaleLowerCase();
        const openingTurns = OPENING_CUES.some((cue) => opener.includes(cue));
        const closingTurns = CLOSING_CUES.some((cue) => closer.includes(cue));
        if (openingTurns) {
            notes.push({
                id: "note-opening-turn",
                kind: "structure",
                title: "The draft opens on a contrast",
                detail: "The opening paragraph starts with a contrast (“however”, “but”, “although”) rather than stating the point directly. Readers meet the disagreement before they know what is being disagreed with.",
                suggestion: "Consider naming the point first, then the contrast. Many readers will not carry an unnamed disagreement into the next paragraph.",
                sectionIds: [sections[0].id],
                start: sections[0].start,
                end: sections[0].end,
                confidence: 0.5,
            });
        }
        if (closingTurns) {
            notes.push({
                id: "note-closing-summary",
                kind: "structure",
                title: "The ending summarises rather than lands",
                detail: "The closing section begins by summarising (“overall”, “in conclusion”). A summary is useful once the reader already agrees; it is less useful as the last thing they read.",
                suggestion: "Consider ending on the single most consequential point, or a concrete next step, and moving the summary one paragraph earlier.",
                sectionIds: [last.id],
                start: last.start,
                end: last.end,
                confidence: 0.5,
            });
        }
    }
    const fillerSections = sections.filter((section) => section.filler);
    if (fillerSections.length) {
        const worst = fillerSections[0];
        notes.push({
            id: "note-filler-section",
            kind: "balance",
            title: `${fillerSections.length === 1 ? "A section is" : `${fillerSections.length} sections are`} carrying little new ground`,
            detail: fillerSections.length === 1
                ? `The section beginning “${firstWords(worst.opening, 6)}”” mostly restates vocabulary from the sections around it. Nothing in it is wrong; it just does not add much that the neighbouring sections have not already said.`
                : `${fillerSections.length} sections mostly restate vocabulary from the sections around them. They read as effort without adding much the neighbouring sections have not already said.`,
            suggestion: "Consider cutting the shortest of them, or merging them into the section they restate. If they are there to reassure, keep one and let it be brief.",
            sectionIds: fillerSections.map((section) => section.id),
            start: worst.start,
            end: worst.end,
            confidence: 0.5,
        });
    }
    if (sections.length >= 4) {
        const longestSection = heaviest;
        if (longestSection) {
            const share = resolvedStats && resolvedStats.words > 0 ? longestSection.words / resolvedStats.words : 0;
            const median = [...sections].sort((a, b) => a.words - b.words)[Math.floor(sections.length / 2)].words;
            if (share > 0.45 && longestSection.words > median * 1.8) {
                notes.push({
                    id: "note-weight-imbalance",
                    kind: "balance",
                    title: "One section dominates the draft",
                    detail: `The section beginning “${firstWords(longestSection.opening, 6)}”” is about ${Math.round(share * 100)}% of the draft. The other sections are comparatively brief, so the piece reads as one long argument with a short frame around it.`,
                    suggestion: "Consider whether the surrounding sections should be expanded to match, or whether the dominant section should be split so its turns are visible.",
                    sectionIds: [longestSection.id],
                    start: longestSection.start,
                    end: longestSection.end,
                    confidence: 0.5,
                });
            }
        }
    }
    // --- Goal-aware notes -------------------------------------------------
    if (goals && resolvedStats) {
        const required = (goals.requiredTerminology ?? []).map((term) => term.trim()).filter(Boolean);
        if (required.length) {
            const lower = text.toLocaleLowerCase();
            const missing = required.filter((term) => !lower.includes(term.toLocaleLowerCase()));
            if (missing.length && document.paragraphs.length) {
                const anchor = sections[0] ?? { id: "document", start: document.paragraphs[0].start, end: document.paragraphs[0].end };
                notes.push({
                    id: "note-goal-missing-term",
                    kind: "goal",
                    title: `Your goals require ${missing.length === 1 ? "a term" : "terms"} the draft has not used`,
                    detail: `You asked for ${missing.map((term) => `“${term}”`).join(", ")} to appear somewhere. ${missing.length === 1 ? "It does not appear" : "None of them appear"} anywhere in the draft.`,
                    suggestion: "Either work the term into the relevant section, or remove it from your goals if it is no longer needed.",
                    sectionIds: [anchor.id],
                    start: anchor.start,
                    end: anchor.end,
                    confidence: 0.6,
                });
            }
        }
        const target = goals.targetLength;
        if (typeof target === "number" && target > 0 && resolvedStats.words > 0) {
            const ratio = resolvedStats.words / target;
            if (ratio >= 1.5 || ratio <= 0.6) {
                const direction = ratio > 1 ? "longer" : "shorter";
                const first = sections[0];
                notes.push({
                    id: "note-goal-length",
                    kind: "goal",
                    title: `The draft is ${direction === "longer" ? "well over" : "well under"} your target length`,
                    detail: `Your goal is about ${target.toLocaleString()} words; the draft is currently ${resolvedStats.words.toLocaleString()}. That is a note about shape, not a problem to fix on its own.`,
                    suggestion: direction === "longer"
                        ? "Consider whether the sections furthest from your core point are earning their length, or whether a point is being made twice in different words."
                        : "Consider whether the argument needs one more supporting section, or whether the target itself is still right.",
                    sectionIds: first ? [first.id] : [],
                    start: first?.start ?? 0,
                    end: first?.end ?? 0,
                    confidence: 0.5,
                });
            }
        }
        if (goals.intent === "persuade" && resolvedStats.sentences > 4) {
            const requestWords = /(?:\bshould\b|\bmust\b|\bneed(?:s|ed)? to\b|\brecommend\b|\bought-?in\b)/iu;
            const asked = document.sentences.filter((sentence) => requestWords.test(sentence.text)).length;
            if (asked === 0) {
                const first = sections[0];
                notes.push({
                    id: "note-goal-no-request",
                    kind: "goal",
                    title: "The draft never makes a request",
                    detail: `You set the intent to persuade, but no sentence asks the reader to do anything. A persuasive piece can be entirely reasonable and still leave the reader without a next step.`,
                    suggestion: "Consider closing with what you want the reader to do, said plainly. It does not need to be a command.",
                    sectionIds: first ? [first.id] : [],
                    start: first?.start ?? 0,
                    end: first?.end ?? 0,
                    confidence: 0.45,
                });
            }
        }
    }
    // --- Preference-aware note -------------------------------------------
    if (preferences && sections.length >= 3) {
        const contractions = document.tokens.filter((token) => /['”]/u.test(token.value)).length;
        if (!preferences.allowContractions && contractions > 0 && goals?.tone !== "casual") {
            const first = sections[0];
            notes.push({
                id: "note-pref-contractions",
                kind: "goal",
                title: "The register is looser than your style profile",
                detail: `Your profile prefers formal wording, and the draft contains ${contractions} contraction${contractions === 1 ? "" : "s"}. Individually each is small; together they set a tone.`,
                suggestion: "Decide deliberately: either loosen the profile, or tighten these where they do not carry voice.",
                sectionIds: first ? [first.id] : [],
                start: first?.start ?? 0,
                end: first?.end ?? 0,
                confidence: 0.45,
            });
        }
    }
    // --- Coverage note ----------------------------------------------------
    // Does the draft state a claim anywhere the reader can point to?
    if (resolvedStats && resolvedStats.sentences >= 6) {
        const claimCue = /(?:\bthe (?:aim|goal|purpose|question|problem) (?:of|is)\b|\bwe (?:aim|argue|set out)\b|\bthis (?:draft|essay|piece|document) (?:argues|considers|examines|explores)\b|\bthe question\b|\bin this (?:essay|piece|draft)\b)/iu;
        if (!claimCue.test(text)) {
            const first = sections[0];
            notes.push({
                id: "note-coverage-no-claim",
                kind: "coverage",
                title: "The draft never says what it is trying to do",
                detail: `Across ${resolvedStats.sentences} sentences, nothing states the aim, question, or claim the piece is working towards. Each section may be clear on its own, but the reader has to assemble the point themselves.`,
                suggestion: "Consider one sentence near the top naming what this draft sets out to do. It makes every later section easier to follow.",
                sectionIds: first ? [first.id] : [],
                start: first?.start ?? 0,
                end: first?.end ?? 0,
                confidence: 0.5,
            });
        }
    }
    // Order notes by position so the UI reads top-to-bottom.
    notes.sort((a, b) => a.start - b.start);
    return { sections, notes, themes, shape, focus };
}
/**
 * A one-line, honest description of how the draft is currently doing, derived
 * from the same signals the outline uses. No score, no judgement: a status the
 * writer can act on.
 */
function summariseDocument(outline, stats, goals) {
    const parts = [];
    const sectionCount = outline.sections.length;
    parts.push(sectionCount <= 1 ? "One continuous section" : `${sectionCount} sections`);
    if (outline.themes[0])
        parts.push(`centred on “${outline.themes[0].term}”`);
    if (outline.themes[1])
        parts.push(`with “${outline.themes[1].term}” recurring`);
    const filler = outline.sections.filter((section) => section.filler).length;
    if (filler)
        parts.push(`${filler} low-weight section${filler === 1 ? "" : "s"}`);
    if (goals)
        parts.push(`written for a ${goals.audience} audience to ${goals.intent}`);
    if (stats.longSentences > 0)
        parts.push(`${stats.longSentences} long sentence${stats.longSentences === 1 ? "" : "s"}`);
    return `${parts.join(", ")}.`;
}
/**
 * Goal-aware, contextual explanation.
 *
 * The rules produce correct but generic advice: "A more specific noun may help
 * the reader understand exactly what you mean." That sentence is true of every
 * vague word in every document, so it tells the writer nothing they can act on.
 *
 * The information needed to make it specific is already on the issue: which rule
 * fired, how confident the rule was, how much it matters, and why it ranked
 * where it did. This module turns that into language tied to *this* draft's
 * audience, intent, tone and register.
 *
 * It is pure, local, and deterministic. No provider call, no network, no
 * latency. This is the layer that keeps Draftwise useful with AI switched off.
 */
const AUDIENCE_NOUN = {
    general: "a general reader",
    academic: "an academic reader",
    professional: "a professional reader",
    technical: "a technical reader",
    casual: "a casual reader",
};
const INTENT_PHRASE = {
    inform: "inform the reader",
    explain: "explain this",
    persuade: "persuade the reader",
    describe: "describe this accurately",
    story: "carry the reader through the narrative",
};
const TONE_NOUN = {
    neutral: "a neutral voice",
    confident: "a confident voice",
    friendly: "a friendly voice",
    professional: "a professional voice",
    formal: "a formal voice",
    casual: "a casual voice",
};
/**
 * Why this finding is ranked where it is, in one sentence.
 *
 * The ranking already made a defensible decision from transparent inputs. This
 * surfaces that decision instead of leaving the writer to guess why an obvious
 * typo sits below an optional style note.
 */
function explainRanking(issue, goals) {
    const parts = [];
    const tierReason = issue.tier === "fix-first"
        ? "Treated as a likely mistake"
        : issue.tier === "improve"
            ? "Worth improving for this draft"
            : "Optional — take it only if it matches your intent";
    if (issue.confidence >= 0.9)
        parts.push("Draftwise is highly confident in this detection");
    else if (issue.confidence >= 0.75)
        parts.push("Reasonably confident");
    else
        parts.push(`Lower confidence (${Math.round(issue.confidence * 100)}%) — safe to ignore if the text is deliberate`);
    if (issue.reasonCodes.includes("register-dampened")) {
        parts.push(goals
            ? `Ranked lower because it matters less for ${AUDIENCE_NOUN[goals.audience]} in ${TONE_NOUN[goals.tone]}`
            : "Ranked lower because it matters less for this register");
    }
    if (issue.groupedCount > 0) {
        parts.push(`Same pattern appears ${issue.groupedCount} more time${issue.groupedCount === 1 ? "" : "s"} in the draft`);
    }
    return `${tierReason}. ${parts.join(". ")}.`;
}
/**
 * The goal-aware "why this matters here" line.
 *
 * Written per rule family so it says something true about the register the
 * writer actually chose, rather than restating the rule's own description.
 */
function explainRelevance(issue, goals) {
    if (!goals)
        return null;
    const audience = AUDIENCE_NOUN[goals.audience];
    const intent = INTENT_PHRASE[goals.intent];
    const tone = TONE_NOUN[goals.tone];
    const family = familyFor(issue.ruleId);
    switch (family) {
        case "spelling-lexicon":
            return goals.audience === "technical"
                ? `Technical drafts are read closely and corrected quickly. A wrong term here costs more than it would in a casual note.`
                : `Spelling is checked everywhere, but it is the one error no reader forgives silently.`;
        case "wordiness":
            return goals.intent === "persuade"
                ? `You are trying to ${intent}. Padding works against that: every hedge is a sentence the reader does not get back.`
                : goals.audience === "academic"
                    ? `Academic readers are tracking your argument. Thinner wording makes that argument easier to follow.`
                    : `Thinner wording makes the point faster without changing what you meant.`;
        case "clarity-vague-word":
            return goals.audience === "academic"
                ? `In academic writing the reader cannot evaluate a claim they cannot pin down. Naming the specific thing is usually the whole fix.`
                : goals.intent === "explain"
                    ? `You are trying to ${intent}. A vague noun leaves the reader guessing what you are describing.`
                    : `A specific noun tells the reader exactly what you mean instead of leaving them to work it out.`;
        case "style-passive-voice":
            return goals.audience === "professional"
                ? `In professional writing the actor usually matters: who decided, who owns it, who acts.`
                : goals.tone === "formal"
                    ? `Formal writing often keeps the passive for genuine reasons. Change it only where the actor matters.`
                    : `Passive voice hides who acts. Keep it when the result is genuinely the point, and name the actor when it is not.`;
        case "conciseness-filler":
            return goals.tone === "confident"
                ? `You set a ${tone}. Filler undercuts it — a confident sentence does not need “basically” to sound sure.`
                : goals.audience === "casual"
                    ? `In casual writing these words carry tone as much as padding. Leave them if they are doing that job.`
                    : `Filler words weaken emphasis. Every one of them spends the reader's attention for nothing.`;
        case "structure-long-sentence":
            return goals.intent === "story"
                ? `Narrative sentences can run long without losing the reader, but this one asks them to hold several ideas at once.`
                : goals.audience === "academic"
                    ? `Long sentences are the main thing that costs an academic reader your argument. Splitting this one is usually worth it.`
                    : `Long sentences ask the reader to hold several ideas at once. Splitting one is often easier than rewriting it.`;
        case "structure-fragment":
            return goals.intent === "story"
                ? `Fragments are normal in narrative prose. Keep this one if the rhythm is doing the work.`
                : `A sentence without a verb can read as a thought rather than a claim. Keep it only if that is deliberate.`;
        case "cliche":
            return goals.tone === "formal"
                ? `A familiar phrase can undercut a formal voice because the reader stops hearing your words.`
                : `Clichés are less precise than the concrete thing they stand in for.`;
        case "style-contractions":
            return goals.tone === "formal"
                ? `You set a ${tone}. Contractions read as informal in that register.`
                : `Your style profile prefers avoiding contractions.`;
        case "style-intensifier":
            return goals.tone === "confident"
                ? `An intensifier weakens a confident sentence. “Very good” is weaker than “good”.`
                : `Intensifiers add emphasis without adding meaning, and readers notice the gap.`;
        case "consistency-preferred-term":
            return `Consistency is what makes terminology usable. Your style guide already says which form you want.`;
        case "repetition-repeated-phrase":
            return goals.audience === "casual"
                ? `Repeating a short phrase is normal in casual writing. Keep it when it lands.`
                : `A repeated phrase reads as an accident unless it is deliberate emphasis.`;
        case "repetition-sentence-opening":
            return `Several nearby sentences start the same way, which flattens the rhythm.`;
        default:
            return `Worth weighing against your goal to ${intent} for ${audience}.`;
    }
}
/** Coarse grouping used to pick the right relevance sentence. */
function familyFor(ruleId) {
    if (ruleId.startsWith("wordiness-"))
        return "wordiness";
    if (ruleId.startsWith("style-cliche-"))
        return "cliche";
    if (ruleId.startsWith("spelling-"))
        return "spelling-lexicon";
    return ruleId;
}
/**
 * Build the full explanation a writer sees on a suggestion card.
 *
 * Ordering matters: what to do first, then why it matters here, then how
 * confident the ranking is. The base rule text is kept last because it is the
 * least specific part.
 */
function buildExplanation(issue, goals, preferences) {
    const relevance = explainRelevance(issue, goals);
    return {
        base: issue.explanation,
        ranking: explainRanking(issue, goals),
        relevance,
        action: buildAction(issue, goals, preferences),
    };
}
/**
 * A concrete next step. Every suggestion gets one, because “consider revising”
 * is not an action a writer can take between meetings.
 */
function buildAction(issue, goals, preferences) {
    const family = familyFor(issue.ruleId);
    if (family === "spelling-lexicon") {
        const inDictionary = preferences?.personalDictionary?.some((word) => word.toLocaleLowerCase() === issue.original.trim().toLocaleLowerCase());
        return inDictionary
            ? "It is in your personal dictionary, so this may be a false alarm — check the case and the surrounding word."
            : "Correct it, or add the word to your personal dictionary if the spelling is deliberate.";
    }
    if (family === "consistency-preferred-term") {
        return `Replace every occurrence with “${issue.replacement.trim()}”, then check the rest of the draft for the same choice.`;
    }
    if (issue.replacement && issue.replacement.trim() && issue.replacement !== issue.original) {
        return `Replace “${truncate(issue.original)}” with “${truncate(issue.replacement)}”.`;
    }
    if (family === "wordiness" || family === "conciseness-filler" || family === "clarity-vague-word") {
        return goals?.intent === "persuade"
            ? "Rewrite the sentence without it, then check the sentence still argues the same point."
            : "Rewrite the sentence without it. If the sentence stops meaning the same thing, keep the word.";
    }
    if (family === "structure-long-sentence") {
        return "Split it at the point where the sentence changes subject, and read the two halves on their own.";
    }
    if (family === "style-passive-voice") {
        return "Name the actor before the verb — or keep it, if the result really is the point.";
    }
    if (issue.groupedCount > 0) {
        return `Fix this one, then use “Replace all” on the group to catch the ${issue.groupedCount} other occurrence${issue.groupedCount === 1 ? "" : "s"}.`;
    }
    return "Read the sentence once more; keep it if the current wording is what you meant.";
}
function truncate(value, max = 48) {
    const trimmed = value.trim();
    return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max - 1)}…`;
}
const OBJECTIVE_CATEGORIES = new Set(["spelling", "grammar", "punctuation", "capitalization"]);
const STYLE_RULE_PREFIXES = ["style-", "punctuation-oxford-comma"];
/**
 * Base caps for a short draft. These are floors, not limits: the budget grows
 * with the document (see `densityCapsFor`) so a long draft is never starved of
 * its most important findings just because it is long.
 */
const SUGGESTION_DENSITY_CAPS = {
    "fix-first": 12,
    improve: 8,
    optional: 5,
};
/**
 * Per 1,000 words each tier is allowed this many displayed suggestions.
 *
 * The original product shipped absolute caps (12/8/5) for every document. That
 * made the assistant actively worse on long drafts: at a constant error rate a
 * 1,700-word document showed the writer exactly one suggestion and hid the
 * other 119 with no way to see them. Scaling the budget by length keeps the
 * list focused on a note while never hiding more than roughly this share of a
 * draft's findings.
 */
const SUGGESTION_DENSITY_PER_THOUSAND_WORDS = {
    "fix-first": 14,
    improve: 9,
    optional: 5,
};
/**
 * How many findings per rule family to show, scaled by document length. The
 * base numbers suit a short note; a long draft needs more instances of a real
 * problem to be actionable, otherwise the writer fixes one and hits three more.
 */
const PER_RULE_CAPS = {
    objective: 10,
    clarity: 5,
    style: 3,
};
/**
 * Scale a per-draft cap by document length. Short documents keep the tuned base
 * values; longer ones gain capacity roughly in step with their word count, with
 * a ceiling so an enormous document still presents a reviewable list.
 */
function scaleCap(base, words, perThousand, maxMultiple = 8) {
    if (!Number.isFinite(words) || words <= 0)
        return base;
    const multiple = Math.max(1, Math.min(maxMultiple, words / 250));
    return Math.min(Math.round(base * multiple), Math.max(base, Math.round((perThousand * words) / 1000)));
}
/** The tier caps appropriate to a document of this length. */
function densityCapsFor(words) {
    return {
        "fix-first": scaleCap(SUGGESTION_DENSITY_CAPS["fix-first"], words, SUGGESTION_DENSITY_PER_THOUSAND_WORDS["fix-first"]),
        improve: scaleCap(SUGGESTION_DENSITY_CAPS.improve, words, SUGGESTION_DENSITY_PER_THOUSAND_WORDS.improve),
        optional: scaleCap(SUGGESTION_DENSITY_CAPS.optional, words, SUGGESTION_DENSITY_PER_THOUSAND_WORDS.optional),
    };
}
/**
 * Per-rule caps appropriate to a document of this length. The base numbers suit
 * a short note; a long draft needs more instances of a real problem to be
 * actionable, otherwise the writer fixes one and hits three more. A high
 * ceiling is safe here because the same pattern still groups into one card with
 * a count, so the list stays compact while the writer learns the true scale.
 */
function perRuleCapsFor(words) {
    return {
        objective: scaleCap(PER_RULE_CAPS.objective, words, PER_RULE_CAPS.objective * 2.4, 10),
        clarity: scaleCap(PER_RULE_CAPS.clarity, words, PER_RULE_CAPS.clarity * 2.6, 12),
        style: scaleCap(PER_RULE_CAPS.style, words, PER_RULE_CAPS.style * 3.0, 14),
    };
}
const LOW_CONFIDENCE_STYLE_THRESHOLD = 0.7;
const REGISTER_MISMATCH_THRESHOLD = 0.35;
const NEAR_DISMISSAL_CHARS = 240;
function classifyIssueKind(issue) {
    if (STYLE_RULE_PREFIXES.some((prefix) => issue.ruleId.startsWith(prefix)))
        return "style";
    if (issue.category === "tone" || issue.category === "formality" || issue.category === "passive voice")
        return "style";
    if (OBJECTIVE_CATEGORIES.has(issue.category)) {
        return issue.ruleId === "dialect-spelling" ? "clarity" : "objective";
    }
    return "clarity";
}
/**
 * The advice a rule represents, in one key. Many findings share a cause:
 * every "wordiness-*" rule is the same kind of advice about tightening phrases,
 * so turning off that type turns the whole family off at once.
 */
function ruleFamily(ruleId) {
    if (ruleId.startsWith("wordiness-"))
        return "wordiness";
    if (ruleId.startsWith("style-cliche-"))
        return "cliche";
    if (ruleId.startsWith("grammar-confused-"))
        return "confused-word";
    return ruleId;
}
/**
 * How relevant the finding is to the register the writer selected. Casual
 * writing tolerates fragments and relaxed punctuation, academic writing prizes
 * precision over style nits, technical writing must not have valid terminology
 * corrected, and storytelling gets fewer prescriptive style corrections.
 */
function registerRelevance(issue, kind, goals) {
    const family = ruleFamily(issue.ruleId);
    const audience = goals?.audience ?? "general";
    const intent = goals?.intent ?? "inform";
    const tone = goals?.tone ?? "professional";
    if (kind === "objective") {
        if (audience === "casual" || tone === "casual") {
            if (family === "capitalization-sentence-start")
                return 0.25;
            if (family === "punctuation-missing-terminal")
                return 0.3;
            if (family === "punctuation-repeated")
                return 0.45;
        }
        if (audience === "technical" && family === "spelling-lexicon")
            return 0.55;
        return 1;
    }
    if (kind === "clarity") {
        if (family === "structure-fragment") {
            return audience === "casual" || tone === "casual" || intent === "story" ? 0.3 : 0.6;
        }
        if (family === "clarity-vague-word") {
            return audience === "academic" ? 1 : audience === "technical" ? 0.6 : audience === "casual" ? 0.55 : 0.8;
        }
        if (family === "wordiness") {
            return audience === "professional" || audience === "academic" ? 1 : audience === "casual" ? 0.6 : 0.85;
        }
        if (family === "structure-long-sentence") {
            return intent === "story" ? 0.5 : audience === "casual" ? 0.5 : 0.85;
        }
        if (family === "conciseness-filler") {
            // In casual writing and email, "just"/"basically" carry tone rather than
            // padding: flagging them there is nagging, not editing.
            return audience === "casual" || tone === "casual" ? 0.25 : intent === "story" ? 0.5 : 0.9;
        }
        return 0.85;
    }
    // Style findings are preferences. Registers that lean expressive get fewer of them.
    if (family === "style-passive-voice") {
        return audience === "academic" ? 0.55 : intent === "story" ? 0.5 : audience === "professional" ? 0.7 : 0.6;
    }
    if (family === "cliche")
        return audience === "academic" ? 0.7 : intent === "story" ? 0.5 : 0.65;
    if (family === "style-intensifier") {
        // "Very good" in a school assignment or casual message is voice, not noise.
        return audience === "casual" || tone === "casual" ? 0.3 : audience === "academic" ? 0.55 : 0.6;
    }
    if (family === "style-contractions")
        return tone === "formal" ? 0.9 : 0.5;
    if (family === "punctuation-oxford-comma")
        return audience === "casual" ? 0.35 : 0.6;
    return 0.65;
}
/**
 * Find the sentence containing a span without scanning every sentence.
 *
 * Sentence spans are ordered and non-overlapping, so a binary search turns the
 * old O(issues x sentences) scan into O(issues log sentences). On a long draft
 * with hundreds of findings that difference is the whole analysis budget.
 */
function findSentence(sentences, start, end) {
    if (sentences.length === 0)
        return undefined;
    let low = 0;
    let high = sentences.length - 1;
    while (low <= high) {
        const mid = (low + high) >> 1;
        const span = sentences[mid];
        if (end <= span.start)
            high = mid - 1;
        else if (start >= span.end)
            low = mid + 1;
        else
            return span;
    }
    // A span that straddles a boundary still belongs to the sentence it starts in.
    return start >= sentences[high]?.start ? sentences[high] : sentences[low];
}
function contextRelevance(issue, kind, goals, document) {
    let relevance = registerRelevance(issue, kind, goals);
    const sentence = findSentence(document.sentences, issue.start, issue.end);
    if (sentence && sentence.tokens.length <= 4 && kind !== "objective")
        relevance *= 0.85;
    return Math.max(0, Math.min(1, relevance));
}
function issueImpact(issue, kind, document) {
    const severity = issue.severity === "high" ? 0.9 : issue.severity === "medium" ? 0.6 : 0.35;
    const categoryWeight = kind === "objective" ? 1 : kind === "clarity" ? 0.8 : 0.45;
    let impact = severity * categoryWeight;
    if (ruleFamily(issue.ruleId) === "structure-long-sentence") {
        const sentence = findSentence(document.sentences, issue.start, issue.end);
        if (sentence)
            impact = Math.min(0.9, 0.3 + Math.max(0, sentence.tokens.length - 32) * 0.02);
    }
    return Math.max(0, Math.min(1, impact));
}
function assignTier(kind, issue, relevance, impact) {
    if (kind === "objective" && issue.confidence >= 0.9 && issue.severity !== "low")
        return "fix-first";
    if (kind === "style")
        return "optional";
    if (kind === "clarity" && relevance >= 0.55 && impact >= 0.45)
        return "improve";
    if (kind === "objective")
        return relevance >= 0.5 ? "fix-first" : "optional";
    return "optional";
}
function tierWeight(tier) {
    return tier === "fix-first" ? 3 : tier === "improve" ? 2 : 1;
}
function reasonCodesFor(kind, tier, issue, relevance) {
    const codes = [`kind:${kind}`, `tier:${tier}`];
    if (issue.confidence >= 0.9)
        codes.push("high-confidence");
    if (relevance < 0.6)
        codes.push("register-dampened");
    return codes;
}
function emptyReport() {
    return {
        rawCount: 0,
        displayedCount: 0,
        suppressedCount: 0,
        groupedCount: 0,
        byTier: { "fix-first": 0, improve: 0, optional: 0 },
        byCategory: {},
        suppressedByRule: [],
    };
}
function groupKey(issue) {
    return `${issue.ruleId}\u0000${issue.original.trim().toLocaleLowerCase()}`;
}
/**
 * Evaluate detected findings against context and return only what a writer
 * should see, ranked, with the noise accounted for in the report.
 */
function prioritiseSuggestions(issues, options = {}) {
    const document = options.document ?? parseDocument(options.text ?? issues.map((issue) => issue.original).join(" "));
    const preferences = options.preferences;
    const dismissed = [...(options.dismissed ?? [])];
    const noise = options.ruleDismissalCounts ?? {};
    const suppressed = [];
    const report = emptyReport();
    report.rawCount = issues.length;
    const ruleOff = new Set((preferences?.ignoredRuleIds ?? []).map((id) => ruleFamily(id)));
    const ruleReduced = new Set((preferences?.reducedRuleIds ?? []).map((id) => ruleFamily(id)));
    /**
     * Dismissals indexed by rule and by the normalised text they covered.
     *
     * The previous implementation compared every finding against every dismissal
     * on every pass. Writers accumulate dismissals over a session, and analysis
     * reruns on each edit, so this was quadratic in the two things that grow most
     * during a long writing session. Two indexes make it linear.
     */
    const dismissalByRule = new Map();
    const dismissalByText = new Map();
    for (const entry of dismissed) {
        const byRule = dismissalByRule.get(entry.ruleId);
        if (byRule)
            byRule.push(entry);
        else
            dismissalByRule.set(entry.ruleId, [entry]);
        const textKey = entry.original.trim().toLocaleLowerCase();
        const byText = dismissalByText.get(textKey);
        if (byText)
            byText.push(entry);
        else
            dismissalByText.set(textKey, [entry]);
    }
    const isDismissalNear = (issue) => {
        const exact = dismissalByRule.get(issue.ruleId);
        if (exact) {
            for (const entry of exact) {
                if (entry.start === issue.start && entry.end === issue.end && entry.original === issue.original)
                    return true;
            }
        }
        const similar = dismissalByText.get(issue.original.trim().toLocaleLowerCase());
        if (!similar)
            return false;
        for (const entry of similar) {
            if (issue.start >= entry.start - NEAR_DISMISSAL_CHARS && issue.start <= entry.end + NEAR_DISMISSAL_CHARS)
                return true;
        }
        return false;
    };
    const candidates = [];
    for (const issue of issues) {
        const kind = classifyIssueKind(issue);
        const family = ruleFamily(issue.ruleId);
        if (ruleOff.has(family)) {
            suppressed.push({ issue, reason: "rule-off" });
            continue;
        }
        const nearDismissal = isDismissalNear(issue);
        if (nearDismissal) {
            suppressed.push({ issue, reason: "near-dismissal" });
            continue;
        }
        const relevance = contextRelevance(issue, kind, options.goals, document);
        if (relevance < REGISTER_MISMATCH_THRESHOLD) {
            suppressed.push({ issue, reason: "register-mismatch" });
            continue;
        }
        const impact = issueImpact(issue, kind, document);
        if (kind !== "objective" && issue.confidence < LOW_CONFIDENCE_STYLE_THRESHOLD && impact < 0.5) {
            suppressed.push({ issue, reason: "low-confidence-style" });
            continue;
        }
        const tier = assignTier(kind, issue, relevance, impact);
        const noisePenalty = Math.min(1.5, (noise[issue.ruleId] ?? 0) * 0.35);
        const profileAdjustment = (options.rankAdjustments ?? [])
            .filter((adjustment) => adjustment.family === family)
            .reduce((total, adjustment) => total + adjustment.rankDelta, 0);
        const rank = tierWeight(tier) * 2 + issue.confidence * 2 + relevance * 1.5 + impact * 1.5 - noisePenalty + profileAdjustment;
        candidates.push({
            issue,
            kind,
            relevance,
            impact,
            tier,
            rank,
            reasonCodes: reasonCodesFor(kind, tier, issue, relevance),
            groupedIds: [],
            groupedCount: 0,
        });
    }
    // Fold repeated patterns into suggestions. The same rule on the same word is
    // one piece of advice, not one piece per occurrence — but on a long draft a
    // single card is not enough to work from, because the writer cannot find the
    // other 47 occurrences without a list. So a repeated pattern keeps its single
    // best instance *and* as many further instances as the draft has room for.
    // Each remaining instance still carries its own location and text, so it is a
    // real, jumpable suggestion rather than a number.
    const groups = new Map();
    for (const candidate of candidates) {
        const key = groupKey(candidate.issue);
        const bucket = groups.get(key);
        if (bucket)
            bucket.push(candidate);
        else
            groups.set(key, [candidate]);
    }
    const wordCount = document.tokens.length;
    // Each additional instance of a repeated pattern needs the same room in the
    // list as any other suggestion, so a long draft shows more of them rather
    // than hiding the pattern behind a single row.
    const repeatAllowance = Math.max(0, Math.min(12, Math.floor(wordCount / 180) - 1));
    const grouped = [];
    for (const bucket of groups.values()) {
        const [first, ...rest] = bucket.sort((left, right) => right.rank - left.rank);
        if (first.issue.ruleId === "spelling-common-typo" || first.issue.ruleId === "spelling-lexicon" || first.issue.ruleId === "consistency-preferred-term") {
            // Spelling and terminology findings are distinct locations of a genuine
            // mistake; each one is a separate fix, so keep them individually.
            grouped.push(...bucket.map((candidate) => ({ ...candidate })));
            continue;
        }
        const kept = rest.slice(0, repeatAllowance);
        const folded = rest.slice(repeatAllowance);
        const merged = {
            ...first,
            groupedIds: [...kept, ...folded].map((candidate) => candidate.issue.id),
            groupedCount: rest.length,
        };
        grouped.push(merged);
        // Kept instances stay visible in their own right.
        for (const candidate of kept) {
            grouped.push({ ...candidate, groupedCount: rest.length, groupedIds: [first.issue.id] });
        }
        for (const candidate of folded)
            suppressed.push({ issue: candidate.issue, reason: "repeated-pattern" });
        report.groupedCount += folded.length;
    }
    // A rule that keeps firing in one draft is offering the same advice again and
    // again. Show its strongest instances, then stop.
    grouped.sort((left, right) => right.rank - left.rank);
    const perRuleShown = new Map();
    const tierShown = { "fix-first": 0, improve: 0, optional: 0 };
    const displayed = [];
    const densityCaps = densityCapsFor(wordCount);
    const perRuleCaps = perRuleCapsFor(wordCount);
    // Index the profile adjustments once rather than re-filtering per candidate.
    const adjustmentsByFamily = new Map();
    for (const adjustment of options.rankAdjustments ?? []) {
        const bucket = adjustmentsByFamily.get(adjustment.family);
        if (bucket)
            bucket.push(adjustment);
        else
            adjustmentsByFamily.set(adjustment.family, [adjustment]);
    }
    const dampenedFamilies = new Set();
    for (const [family, adjustments] of adjustmentsByFamily) {
        if (adjustments.some((adjustment) => adjustment.rankDelta <= -0.8))
            dampenedFamilies.add(family);
    }
    for (const candidate of grouped) {
        const family = ruleFamily(candidate.issue.ruleId);
        // A family the writer repeatedly dismissed is dampened to one instance,
        // the same treatment as an explicit "Show fewer" — still visible, never nagging.
        const dampened = ruleReduced.has(family) || dampenedFamilies.has(family);
        const perRuleCap = dampened ? 1 : perRuleCaps[candidate.kind];
        const shown = perRuleShown.get(family) ?? 0;
        if (shown >= perRuleCap) {
            suppressed.push({ issue: candidate.issue, reason: dampened ? "rule-reduced" : "density-cap" });
            continue;
        }
        if (tierShown[candidate.tier] >= densityCaps[candidate.tier]) {
            suppressed.push({ issue: candidate.issue, reason: "density-cap" });
            continue;
        }
        perRuleShown.set(family, shown + 1);
        tierShown[candidate.tier] += 1;
        displayed.push({
            ...candidate.issue,
            tier: candidate.tier,
            kind: candidate.kind,
            rank: candidate.rank,
            contextRelevance: candidate.relevance,
            impact: candidate.impact,
            groupedCount: candidate.groupedCount,
            groupedIds: candidate.groupedIds,
            reasonCodes: candidate.reasonCodes,
        });
    }
    displayed.sort((left, right) => right.rank - left.rank || left.start - right.start);
    report.displayedCount = displayed.length;
    report.suppressedCount = suppressed.length;
    for (const issue of displayed) {
        report.byTier[issue.tier] += 1;
        report.byCategory[issue.category] = (report.byCategory[issue.category] ?? 0) + 1;
    }
    const ruleCounts = new Map();
    for (const entry of suppressed) {
        const counts = ruleCounts.get(entry.issue.ruleId) ?? { suppressed: 0, displayed: 0 };
        counts.suppressed += 1;
        ruleCounts.set(entry.issue.ruleId, counts);
    }
    for (const issue of displayed) {
        const counts = ruleCounts.get(issue.ruleId) ?? { suppressed: 0, displayed: 0 };
        counts.displayed += 1;
        ruleCounts.set(issue.ruleId, counts);
    }
    report.suppressedByRule = [...ruleCounts.entries()]
        .map(([ruleId, counts]) => ({ ruleId, ...counts }))
        .sort((left, right) => right.suppressed - left.suppressed || left.ruleId.localeCompare(right.ruleId));
    return { displayed, suppressed, report };
}
/**
 * Why a finding was held back, in the writer's own terms.
 *
 * Draftwise deliberately hides some findings so the list stays reviewable. That
 * trade is only honest if the writer can see what was hidden and why — a silent
 * omission reads as "there is nothing else wrong", which on a long draft is the
 * most misleading thing the product could say. These labels are returned with
 * the suppression data and rendered as an inspectable list.
 */
const SUPPRESSION_REASONS = {
    "rule-off": "You turned this check off",
    "rule-reduced": "You asked to see less of this",
    "density-cap": "More of this pattern than the list shows",
    "repeated-pattern": "The same pattern elsewhere in the draft",
    "register-mismatch": "Not relevant for your audience and tone",
    "near-dismissal": "You dismissed this one already",
    "low-confidence-style": "Low confidence for a style note",
};
/** A one-line summary of what was held back and the main reasons for it. */
function describeSuppression(report) {
    if (!report.suppressedCount)
        return "Nothing was held back: every finding is in the list.";
    const top = report.suppressedByRule
        .filter((entry) => entry.suppressed > 0)
        .slice(0, 3)
        .map((entry) => `${entry.suppressed} × ${entry.ruleId.replace(/^[a-z]+-/, "")}`);
    const grouped = report.groupedCount ? `${report.groupedCount} folded into a repeated pattern` : "";
    const parts = [`${report.suppressedCount} finding${report.suppressedCount === 1 ? "" : "s"} held back`];
    if (top.length)
        parts.push(`most often ${top.join(", ")}`);
    if (grouped)
        parts.push(grouped);
    return `${parts.join(" · ")}. Open “Hidden findings” to see each one.`;
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
    const passiveVoicePattern = /\b(?:was|were|is|are|be|been|being)\s+(?:being\s+)?[\p{L}]+(?:ed|en)\b/iu;
    const passiveVoice = [...text.matchAll(/\b(?:was|were|is|are|be|been|being)\s+(?:being\s+)?[\p{L}]+(?:ed|en)\b/giu)].length;
    const passiveVoiceSentences = sentences.filter((sentence) => passiveVoicePattern.test(sentence.text)).length;
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
        passiveVoicePercentage: sentences.length ? Math.round((passiveVoiceSentences / sentences.length) * 100) : 0,
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
function mergeWritingIssues(issues) {
    return mergeAnalysisIssues(issues);
}
function analyzeLocally(text, options = {}, goals) {
    const startedAt = analysisNow();
    const preferences = mergePreferences(options);
    const document = analyzeDocument(text);
    // Markdown-aware: code fences, inline code and URLs are machine text that
    // prose rules must not touch, and list items are structured content.
    const protectedSpans = findProtectedSpans(text);
    const rawIssues = mergeWritingIssues([
        ...findSpelling(text, preferences, document),
        ...findConfusedWords(text, preferences),
        ...findPrecisionGrammarIssues(text, preferences, document),
        ...findPunctuation(text, preferences),
        ...findCapitalization(text, preferences),
        ...findRepeatedWordsAndPhrases(text, preferences, document),
        ...findStyleIssues(text, preferences, document),
        ...findStructureIssues(text, preferences, document),
        ...findDocumentStructure(text, preferences, goals, document),
        ...findGoalTerminology(text, goals, preferences, document),
    ]);
    const issues = rawIssues.filter((issue) => {
        if (isInsideProtectedSpan(protectedSpans, issue.start, issue.end))
            return false;
        // Fragment and terminal-punctuation advice does not apply to bullets,
        // numbered steps or blockquotes: those are structured, not prose sentences.
        if (issue.ruleId === "structure-fragment" || issue.ruleId === "punctuation-missing-terminal") {
            return !isStructuredLineStart(text, issue.start);
        }
        return true;
    });
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
        return start >= 0 && end <= nextText.length && nextText.slice(start, end) === issue.original
            ? [{ ...issue, id: createIssueId(issue.ruleId, start, end, issue.original), start, end }]
            : [];
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
// Public surface preserved for the web app, the extension bundle, and the test suite.
// Document-level reasoning: an outline, themes, and editorial notes that scale
// with the draft. Entirely local - no provider, no network.
// NOTE: every re-export here must stay on a single line. The extension bundler
// strips re-exports with a line-anchored regex, so a multi-line `export type {`
// survives partially and emits a dangling CommonJS `exports` reference into the
// generated browser bundle.
// Goal-aware, contextual explanation. Local and deterministic.

return { WORD_PATTERN, analyzeDocument, analyzeLocally, analyzeLocallyIncremental, categoryColors, createAnalysisDiagnostics, detectChangedRange, getWritingStats, inferTone, mergeWritingIssues, parseDocument, prioritiseSuggestions, classifyIssueKind, ruleFamily, SUGGESTION_DENSITY_CAPS, scoreWriting, suggestSpelling, buildDocumentOutline, summariseDocument, buildExplanation, explainRanking, explainRelevance, buildAction, SUPPRESSION_REASONS, describeSuppression };
})();
globalThis.DraftwiseGrammar = DraftwiseGrammarModule;
})();
