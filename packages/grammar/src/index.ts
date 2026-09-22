import type {
  AnalysisScores,
  AnalysisDiagnostics,
  Dialect,
  FrequencyItem,
  IssueCategory,
  IssueSeverity,
  ScoreDimension,
  StylePreferences,
  WritingGoals,
  WritingIssue,
  WritingStats,
} from "../../types/src/index.js";
import { mergeAnalysisIssues } from "../../analysis/src/index.ts";

const DEFAULT_STYLE_PREFERENCES: StylePreferences = {
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

export const WORD_PATTERN = /[\p{L}\p{N}]+(?:['’\-][\p{L}\p{N}]+)*/gu;

const TYPO_FIXES: Record<string, string> = {
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
const SPELLING_FREQUENCY = [...new Set([...SPELLING_CORE, ...SPELLING_UNICODE, ...SPELLING_COMMON, ...SPELLING_COMMON_EXTRA, ...SPELLING_EXTENDED])];
const SPELLING_WORDS = new Set(SPELLING_FREQUENCY);
const SPELLING_RANK = new Map(SPELLING_FREQUENCY.map((word, index) => [word.toLocaleLowerCase(), index]));
const SPELLING_INDEX = new Map<number, string[]>();
SPELLING_FREQUENCY.forEach((word) => {
  const normalized = word.toLocaleLowerCase();
  const bucket = SPELLING_INDEX.get(normalized.length) ?? [];
  bucket.push(normalized);
  SPELLING_INDEX.set(normalized.length, bucket);
});
const SPELLING_CACHE = new Map<string, string | null>();

const CONTRACTIONS = new Set([
  "aren't", "can't", "couldn't", "didn't", "doesn't", "don't", "hadn't", "hasn't", "haven't", "he'd", "he'll", "he's",
  "i'd", "i'll", "i'm", "i've", "isn't", "it'd", "it'll", "it's", "let's", "mightn't", "mustn't", "shan't", "she'd",
  "she'll", "she's", "shouldn't", "that's", "there's", "they'd", "they'll", "they're", "they've", "wasn't", "we'd", "we'll",
  "we're", "we've", "weren't", "what's", "where's", "who's", "won't", "wouldn't", "you'd", "you'll", "you're", "you've",
]);

const ARTICLE_AN_EXCEPTIONS = new Set(["heir", "heirloom", "honest", "honestly", "honour", "honours", "honor", "hour", "hourly"]);
const ARTICLE_A_SOUND_PREFIXES = /^(?:euro|ewe|one|once|uni|use|user|usual|utensil|ubiquit|u[nr]i)/u;

const KEYBOARD_NEIGHBOURS: Record<string, string> = {
  a: "qwsz", b: "vghn", c: "xdfv", d: "serfcx", e: "wrsd", f: "drtgvc", g: "ftyhbv", h: "gyujnb", i: "ujk", j: "huikmn", k: "jiolm", l: "kop", m: "njk", n: "bhjm", o: "iklp", p: "ol", q: "wa", r: "edft", s: "awedxz", t: "rfgy", u: "yhji", v: "cfgb", w: "qase", x: "zsdc", y: "tugh", z: "asx",
};

const DIALECT_VARIANTS: Record<string, { "en-GB": string; "en-US": string }> = {
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

function contextualDialectReplacement(tokens: Token[], index: number, preferences: StylePreferences) {
  const word = tokens[index]?.lower;
  if (!word || !CONTEXTUAL_DIALECT_WORDS.has(word)) return undefined;
  const before = tokens.slice(Math.max(0, index - 3), index).map((token) => token.lower);
  const after = tokens.slice(index + 1, index + 3).map((token) => token.lower);
  const immediateBefore = before.at(-1);
  const nearby = new Set([...before, ...after]);
  const verbUse = Boolean(immediateBefore && DIALECT_VERB_CONTEXT.has(immediateBefore));
  const nounUse = Boolean(immediateBefore && DIALECT_NOUN_CONTEXT.has(immediateBefore))
    || before.some((value) => DIALECT_NOUN_CONTEXT.has(value));

  if (word === "license" && preferences.dialect === "en-GB") {
    if (verbUse) return undefined;
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
    if (nearby.has("software") || [...nearby].some((value) => PROGRAMME_COMPUTING_CONTEXT.has(value))) return undefined;
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

const WORDINESS: Array<[string, string]> = [
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

const CLICHES: Array<[string, string]> = [
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

export interface GrammarOptions extends Partial<StylePreferences> {
  dialect?: Dialect;
}

interface Token {
  value: string;
  lower: string;
  start: number;
  end: number;
}

interface SentenceSpan {
  text: string;
  start: number;
  end: number;
  tokens: Token[];
}

export interface ParsedDocument {
  text: string;
  tokens: Token[];
  sentences: SentenceSpan[];
  paragraphs: Array<{ text: string; start: number; end: number; tokens: Token[] }>;
  frequencies: Map<string, number>;
  sentenceLengths: number[];
  paragraphLengths: number[];
}

const clamp = (value: number) => Math.max(0, Math.min(100, Math.round(value)));

function mergePreferences(options: GrammarOptions = {}): StylePreferences {
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

function preserveCase(original: string, replacement: string) {
  if (!replacement) return replacement;
  if (original === original.toUpperCase()) return replacement.toUpperCase();
  if (original[0] === original[0]?.toUpperCase()) return replacement[0].toUpperCase() + replacement.slice(1);
  return replacement;
}

function issueTextFingerprint(text: string) {
  let hash = 2_166_136_261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0).toString(36);
}

function createIssueId(ruleId: string, start: number, end: number, original: string) {
  return `${ruleId}-${start}-${end}-${issueTextFingerprint(original)}`;
}

function boundedEditDistance(left: string, right: string, limit = 2) {
  if (Math.abs(left.length - right.length) > limit) return limit + 1;
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  let previousPrevious: number[] | null = null;
  for (let row = 1; row <= left.length; row += 1) {
    const current = [row];
    let rowMinimum = current[0];
    for (let column = 1; column <= right.length; column += 1) {
      const cost = left[row - 1] === right[column - 1] ? 0 : 1;
      const value = Math.min(
        current[column - 1] + 1,
        previous[column] + 1,
        previous[column - 1] + cost,
        previousPrevious && row > 1 && column > 1 && left[row - 1] === right[column - 2] && left[row - 2] === right[column - 1]
          ? previousPrevious[column - 2] + 1
          : limit + 1,
      );
      current[column] = value;
      rowMinimum = Math.min(rowMinimum, value);
    }
    if (rowMinimum > limit) return limit + 1;
    previousPrevious = previous;
    previous = current;
  }
  return previous[right.length];
}

function spellingKey(word: string, preferences: StylePreferences) {
  return `${preferences.dialect}:${word.toLocaleLowerCase()}`;
}

function dictionaryHas(word: string, preferences: StylePreferences) {
  const lower = word.toLocaleLowerCase().normalize("NFC");
  return SPELLING_WORDS.has(lower)
    || preferences.personalDictionary?.some((value) => value.toLocaleLowerCase().normalize("NFC") === lower)
    || preferences.names?.some((value) => value.toLocaleLowerCase().normalize("NFC") === lower);
}

function inflectionRoots(lower: string) {
  const roots = new Set<string>();
  const add = (value: string) => { if (value.length >= 3) roots.add(value); };
  if (lower.endsWith("ies")) add(`${lower.slice(0, -3)}y`);
  if (lower.endsWith("ves")) { add(`${lower.slice(0, -3)}f`); add(`${lower.slice(0, -3)}fe`); }
  if (lower.endsWith("es")) { add(lower.slice(0, -2)); add(lower.slice(0, -1)); }
  if (lower.endsWith("s")) add(lower.slice(0, -1));
  if (lower.endsWith("ied")) add(`${lower.slice(0, -3)}y`);
  if (lower.endsWith("ed")) {
    const root = lower.slice(0, -2);
    add(root); add(`${root}e`); if (/(.)\1$/u.test(root)) add(root.slice(0, -1));
  }
  if (lower.endsWith("ing")) {
    const root = lower.slice(0, -3);
    add(root); add(`${root}e`); if (/(.)\1$/u.test(root)) add(root.slice(0, -1));
  }
  if (lower.endsWith("er") || lower.endsWith("est")) add(lower.replace(/(?:er|est)$/u, ""));
  if (lower.endsWith("ly")) add(lower.slice(0, -2));
  return roots;
}

function isKnownSpelling(word: string, preferences: StylePreferences) {
  const lower = word.toLocaleLowerCase().normalize("NFC");
  const asciiContraction = lower.replaceAll("’", "'");
  if (dictionaryHas(lower, preferences) || CONTRACTIONS.has(asciiContraction)) return true;
  const possessive = lower.match(/^(.+?)(?:['’]s|s['’])$/u);
  if (possessive?.[1] && dictionaryHas(possessive[1], preferences)) return true;
  const parts = lower.split(/[’'-]/u).filter(Boolean);
  if (parts.length > 1 && parts.every((part) => part === "s" || dictionaryHas(part, preferences))) return true;
  return [...inflectionRoots(lower)].some((root) => dictionaryHas(root, preferences));
}

function keyboardPenalty(left: string, right: string) {
  let penalty = Math.abs(left.length - right.length);
  const shared = Math.min(left.length, right.length);
  for (let index = 0; index < shared; index += 1) {
    if (left[index] === right[index]) continue;
    if (!KEYBOARD_NEIGHBOURS[left[index]]?.includes(right[index] ?? "")) penalty += 1;
  }
  return penalty;
}

function dialectPenalty(word: string, preferences: StylePreferences) {
  for (const variants of Object.values(DIALECT_VARIANTS)) {
    if (word === variants[preferences.dialect]) return 0;
    if (word === variants[preferences.dialect === "en-GB" ? "en-US" : "en-GB"]) return 1;
  }
  return 0;
}

export function suggestSpelling(word: string, preferences: GrammarOptions = {}) {
  const merged = mergePreferences(preferences);
  const lower = word.toLocaleLowerCase().normalize("NFC");
  const key = spellingKey(word, merged);
  if (TYPO_FIXES[lower]) return TYPO_FIXES[lower];
  if (isKnownSpelling(word, merged) || /^[A-Z][\p{L}'’-]+$/u.test(word) || /^[A-Z]{2,}[\w-]*$/u.test(word)) {
    return null;
  }
  if (SPELLING_CACHE.has(key)) return SPELLING_CACHE.get(key) ?? null;
  if (lower.length < 3) return null;
  const maxDistance = lower.length >= 8 ? 2 : 1;
  const hasUnicode = /[^\p{ASCII}]/u.test(lower);
  let best: { word: string; distance: number; keyboard: number; dialect: number; rank: number } | null = null;
  for (let length = Math.max(1, lower.length - maxDistance); length <= lower.length + maxDistance; length += 1) {
    for (const candidate of SPELLING_INDEX.get(length) ?? []) {
      if (candidate === lower || (hasUnicode && !/[^\p{ASCII}]/u.test(candidate))) continue;
      const distance = boundedEditDistance(lower, candidate, maxDistance);
      if (distance > maxDistance) continue;
      const candidateScore = { word: candidate, distance, keyboard: keyboardPenalty(lower, candidate), dialect: dialectPenalty(candidate, merged), rank: SPELLING_RANK.get(candidate) ?? Number.MAX_SAFE_INTEGER };
      if (!best
        || candidateScore.distance < best.distance
        || (candidateScore.distance === best.distance && candidateScore.keyboard < best.keyboard)
        || (candidateScore.distance === best.distance && candidateScore.keyboard === best.keyboard && candidateScore.dialect < best.dialect)
        || (candidateScore.distance === best.distance && candidateScore.keyboard === best.keyboard && candidateScore.dialect === best.dialect && candidateScore.rank < best.rank)) best = candidateScore;
    }
  }
  const result = best?.word ?? null;
  SPELLING_CACHE.set(key, result);
  if (SPELLING_CACHE.size > 512) SPELLING_CACHE.delete(SPELLING_CACHE.keys().next().value as string);
  return result;
}

function tokensIn(text: string, offset = 0): Token[] {
  return [...text.matchAll(WORD_PATTERN)].map((match) => ({
    value: match[0],
    lower: match[0].toLocaleLowerCase(),
    start: offset + (match.index ?? 0),
    end: offset + (match.index ?? 0) + match[0].length,
  }));
}

function sentenceSpans(text: string, allTokens?: Token[]): SentenceSpan[] {
  const spans: SentenceSpan[] = [];
  const tokens = allTokens ?? tokensIn(text);
  let tokenIndex = 0;
  const pattern = /[^.!?…\n]+(?:[.!?…]+|$)/gu;
  for (const match of text.matchAll(pattern)) {
    const raw = match[0];
    const leading = raw.search(/\S/u);
    if (leading < 0) continue;
    const start = (match.index ?? 0) + leading;
    const value = raw.slice(leading).trim();
    if (!value) continue;
    const end = start + value.length;
    while (tokenIndex < tokens.length && tokens[tokenIndex].end <= start) tokenIndex += 1;
    const sentenceTokens: Token[] = [];
    while (tokenIndex < tokens.length && tokens[tokenIndex].start < end) {
      sentenceTokens.push(tokens[tokenIndex]);
      tokenIndex += 1;
    }
    spans.push({ text: value, start, end, tokens: sentenceTokens });
  }
  return spans;
}

export function parseDocument(text: string): ParsedDocument {
  const tokens = tokensIn(text);
  const sentences = sentenceSpans(text, tokens);
  const paragraphs: ParsedDocument["paragraphs"] = [];
  let cursor = 0;
  let tokenCursor = 0;
  for (const paragraph of text.split(/\n\s*\n/gu)) {
    const start = text.indexOf(paragraph, cursor);
    cursor = Math.max(cursor, start + paragraph.length);
    if (!paragraph.trim() || start < 0) continue;
    const end = start + paragraph.length;
    while (tokenCursor < tokens.length && tokens[tokenCursor].end <= start) tokenCursor += 1;
    const paragraphTokens: Token[] = [];
    while (tokenCursor < tokens.length && tokens[tokenCursor].end <= end) {
      paragraphTokens.push(tokens[tokenCursor]);
      tokenCursor += 1;
    }
    paragraphs.push({ text: paragraph, start, end, tokens: paragraphTokens });
  }
  const frequencies = new Map<string, number>();
  for (const token of tokens) frequencies.set(token.lower, (frequencies.get(token.lower) ?? 0) + 1);
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

export const analyzeDocument = parseDocument;

function shouldIgnore(ruleId: string, original: string, preferences: StylePreferences) {
  const lower = original.trim().toLocaleLowerCase();
  return preferences.ignoredRuleIds.includes(ruleId) || preferences.ignoredWords.some((word) => word.toLocaleLowerCase() === lower) || preferences.personalDictionary.some((word) => word.toLocaleLowerCase() === lower) || preferences.names?.some((word) => word.toLocaleLowerCase() === lower);
}

function makeIssue(
  ruleId: string,
  start: number,
  end: number,
  original: string,
  replacement: string,
  category: IssueCategory,
  severity: IssueSeverity,
  title: string,
  explanation: string,
  confidence: number,
  preferences: StylePreferences,
): WritingIssue | null {
  if (!original || end <= start || shouldIgnore(ruleId, original, preferences)) return null;
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

function pushIssue(target: WritingIssue[], value: WritingIssue | null) {
  if (value) target.push(value);
}

function findSpelling(text: string, preferences: StylePreferences, document = parseDocument(text)) {
  const issues: WritingIssue[] = [];
  for (const [tokenIndex, token] of document.tokens.entries()) {
    const typo = TYPO_FIXES[token.lower];
    const contextualReplacement = contextualDialectReplacement(document.tokens, tokenIndex, preferences);
    const dialect = !CONTEXTUAL_DIALECT_WORDS.has(token.lower)
      ? Object.entries(DIALECT_VARIANTS).find(([, variants]) =>
        token.lower === variants[preferences.dialect].toLocaleLowerCase() || token.lower === variants[preferences.dialect === "en-GB" ? "en-US" : "en-GB"].toLocaleLowerCase(),
      )
      : undefined;
    const dialectReplacement = contextualReplacement ?? (dialect && token.lower !== dialect[1][preferences.dialect].toLocaleLowerCase()
      ? dialect[1][preferences.dialect]
      : undefined);
    const lexicalReplacement = !dialectReplacement && !typo ? suggestSpelling(token.value, preferences) : undefined;
    const replacement = dialectReplacement ?? typo ?? lexicalReplacement;
    if (!replacement || replacement.toLocaleLowerCase() === token.lower) continue;
    pushIssue(issues, makeIssue(
      dialectReplacement ? "dialect-spelling" : typo ? "spelling-common-typo" : "spelling-lexicon",
      token.start,
      token.end,
      token.value,
      preserveCase(token.value, replacement),
      "spelling",
      dialectReplacement ? "low" : typo ? "high" : "medium",
      dialectReplacement ? `Use ${preferences.dialect === "en-GB" ? "British" : "US"} spelling` : `Spelling: ${preserveCase(token.value, replacement)}`,
      dialectReplacement
        ? `Your style profile uses ${preferences.dialect === "en-GB" ? "British" : "US"} English. Keep the dialect consistent across the document.`
        : `“${token.value}” is a common spelling slip. The suggested replacement is “${preserveCase(token.value, replacement)}”.`,
      dialectReplacement ? 0.86 : typo ? 0.99 : 0.88,
      preferences,
    ));
  }
  return issues;
}

function findConfusedWords(text: string, preferences: StylePreferences) {
  const issues: WritingIssue[] = [];
  const patterns: Array<[RegExp, string, string, string, number?]> = [
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

function findPrecisionGrammarIssues(text: string, preferences: StylePreferences, document = parseDocument(text)) {
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
      const subjectIsPlural = nounLooksPlural(subject);
      const pluralVerb = ["are", "were", "have", "do"].includes(verb.toLocaleLowerCase());
      const singularVerb = ["is", "was", "has", "does"].includes(verb.toLocaleLowerCase());
      if ((pluralVerb && subjectIsPlural) || (singularVerb && !subjectIsPlural && !["he", "she", "it", "they", "we", "you"].includes(subject.toLocaleLowerCase()))) continue;
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
    if (hasVerb) pushIssue(issues, makeIssue("punctuation-missing-terminal", lastToken.start, lastToken.end, lastToken.value, `${lastToken.value}.`, "punctuation", "low", "Add terminal punctuation", "A complete sentence usually ends with punctuation.", 0.82, preferences));
  }
  return issues;
}

function findPunctuation(text: string, preferences: StylePreferences) {
  const issues: WritingIssue[] = [];
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

function findCapitalization(text: string, preferences: StylePreferences) {
  const issues: WritingIssue[] = [];
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

function findRepeatedWordsAndPhrases(text: string, preferences: StylePreferences, document = parseDocument(text)) {
  const issues: WritingIssue[] = [];
  const tokens = document.tokens;
  for (let index = 1; index < tokens.length; index += 1) {
    const previous = tokens[index - 1];
    const current = tokens[index];
    if (previous.lower !== current.lower || previous.end > current.start + 1) continue;
    pushIssue(issues, makeIssue("repetition-adjacent-word", previous.start, current.end, text.slice(previous.start, current.end), previous.value, "repetition", "medium", "Repeated word", "This word appears twice in a row. Removing the repeat keeps the sentence moving.", 0.99, preferences));
  }
  for (let index = 0; index + 3 < tokens.length; index += 1) {
    const phrase = tokens.slice(index, index + 2);
    const next = tokens.slice(index + 2, index + 4);
    if (phrase[0].lower !== next[0].lower || phrase[1].lower !== next[1].lower) continue;
    if (phrase[1].end > next[0].start + 1) continue;
    pushIssue(issues, makeIssue("repetition-repeated-phrase", phrase[0].start, next[1].end, text.slice(phrase[0].start, next[1].end), text.slice(phrase[0].start, phrase[1].end), "repetition", "medium", "Repeated phrase", "This short phrase is repeated back-to-back. Keep it once unless the repetition is deliberate.", 0.98, preferences));
  }
  const openings = new Map<string, SentenceSpan>();
  for (const sentence of document.sentences) {
    const opening = sentence.tokens.slice(0, 2).map((token) => token.lower).join(" ");
    if (!opening || opening.length < 4) continue;
    const existing = openings.get(opening);
    if (existing && sentence.start - existing.end < 600) {
      const end = Math.min(sentence.end, sentence.start + sentence.tokens.slice(0, 2).reduce((total, token) => total + token.value.length, 0) + 1);
      pushIssue(issues, makeIssue("repetition-sentence-opening", sentence.start, end, text.slice(sentence.start, end), "", "repetition", "low", "Vary the sentence opening", "Several nearby sentences start the same way. Varying the openings can improve rhythm.", 0.76, preferences));
    } else {
      openings.set(opening, sentence);
    }
  }
  return issues;
}

function findStyleIssues(text: string, preferences: StylePreferences, document = parseDocument(text)) {
  const issues: WritingIssue[] = [];
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
    if (FILLER_WORDS.has(token.lower)) pushIssue(issues, makeIssue("conciseness-filler", token.start, token.end, token.value, "", "conciseness", "low", "Possible filler word", "Remove it if the sentence keeps its meaning without it.", 0.8, preferences));
    if (VAGUE_WORDS.has(token.lower)) pushIssue(issues, makeIssue("clarity-vague-word", token.start, token.end, token.value, "", "clarity", "low", "Vague wording", "A more specific noun may help the reader understand exactly what you mean.", 0.68, preferences));
    if (INTENSIFIERS.has(token.lower)) pushIssue(issues, makeIssue("style-intensifier", token.start, token.end, token.value, "", "tone", "low", "Check the intensifier", "This intensifier may add emphasis without adding much meaning.", 0.72, preferences));
  }
  for (const [blocked, preferred] of Object.entries(preferences.preferredTerminology)) {
    if (!blocked || !preferred) continue;
    const pattern = new RegExp(`\\b${blocked.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi");
    for (const match of text.matchAll(pattern)) {
      const start = match.index ?? 0;
      pushIssue(issues, makeIssue("consistency-preferred-term", start, start + match[0].length, match[0], preserveCase(match[0], preferred), "consistency", "medium", "Use your preferred term", `Your style guide prefers “${preferred}” for consistent terminology.`, 0.95, preferences));
    }
  }
  if (!preferences.allowContractions) {
    const contractions: Record<string, string> = { "can't": "cannot", "won't": "will not", "don't": "do not", "it's": "it is", "we're": "we are", "you've": "you have" };
    for (const token of document.tokens) {
      const replacement = contractions[token.lower];
      if (replacement) pushIssue(issues, makeIssue("style-contractions", token.start, token.end, token.value, preserveCase(token.value, replacement), "formality", "low", "Avoid contractions", "Your style profile prefers a more formal register.", 0.9, preferences));
    }
  }
  return issues;
}

function findStructureIssues(text: string, preferences: StylePreferences, document = parseDocument(text)) {
  const issues: WritingIssue[] = [];
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
    if (count > 150) pushIssue(issues, makeIssue("structure-long-paragraph", paragraph.start, paragraph.end, paragraph.text, "", "readability", "low", "Long paragraph", "A shorter paragraph can give the reader a useful pause.", 0.78, preferences));
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

function countSyllables(word: string) {
  const normalized = word.toLocaleLowerCase().replace(/(?:e|es|ed)$/u, "");
  return Math.max(1, (normalized.match(/[aeiouy]{1,2}/gu) ?? []).length);
}

function frequency(values: string[], limit = 8): FrequencyItem[] {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()]
    .filter(([, count]) => count > 1)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([value, count]) => ({ value, count }));
}

export function getWritingStats(text: string, document = parseDocument(text)): WritingStats {
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
  const longest = sentences.reduce((current, sentence) => sentence.tokens.length > current.tokens.length ? sentence : current, { text: "", start: 0, end: 0, tokens: [] } as SentenceSpan);
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

export function inferTone(text: string, document = parseDocument(text)): string[] {
  const words = document.tokens.map((token) => token.lower);
  const confident = words.filter((word) => ["clear", "strong", "will", "can", "decisive", "proven"].includes(word)).length;
  const cautious = words.filter((word) => ["might", "maybe", "perhaps", "could", "possibly", "uncertain"].includes(word)).length;
  const direct = words.filter((word) => ["we", "you", "your", "our"].includes(word)).length;
  const tone: string[] = [];
  if (confident > cautious) tone.push("confident");
  if (cautious > 0) tone.push("thoughtful");
  if (direct > 0) tone.push("direct");
  if (text.includes("!")) tone.push("energetic");
  return [...new Set(tone)].slice(0, 3).length ? [...new Set(tone)].slice(0, 3) : ["neutral"];
}

function scoreContribution(score: number, summary: string, signals: string[]): { score: number; summary: string; signals: string[] } {
  return { score, summary, signals: signals.slice(0, 4) };
}

function weightedIssuePenalty(issues: WritingIssue[], categories: IssueCategory[], scale: number) {
  const categorySet = new Set(categories);
  return issues.reduce((total, issue) => {
    if (!categorySet.has(issue.category)) return total;
    const severity = issue.severity === "high" ? 1.8 : issue.severity === "medium" ? 1.1 : 0.45;
    const confidence = Number.isFinite(issue.confidence) ? Math.max(0, Math.min(1, issue.confidence)) : 0.5;
    return total + severity * confidence * scale;
  }, 0);
}

function goalAlignmentEstimate(text: string, stats: WritingStats, goals?: WritingGoals, document = parseDocument(text)) {
  if (!goals || !stats.words) return goals ? 60 : 0;
  const lower = text.toLocaleLowerCase();
  const words = document.tokens.map((token) => token.lower);
  const markerScore = (markers: string[]) => markers.reduce((count, marker) => count + (lower.includes(marker) ? 1 : 0), 0);
  const audienceMarkers: Record<WritingGoals["audience"], string[]> = {
    academic: ["research", "evidence", "study", "analysis", "method", "findings", "citation"],
    professional: ["project", "client", "team", "recommend", "next step", "deliver", "decision"],
    technical: ["system", "data", "api", "function", "configuration", "implementation", "test", "code"],
    casual: ["you", "we", "feel", "really", "thanks", "can't", "won't"],
    general: ["because", "example", "help", "important", "should", "can"],
  };
  const intentMarkers: Record<WritingGoals["intent"], string[]> = {
    inform: ["is", "are", "fact", "according", "includes"],
    explain: ["because", "means", "example", "how", "why", "therefore"],
    persuade: ["should", "recommend", "benefit", "need", "best", "must"],
    describe: ["looks", "contains", "shows", "appears", "located", "includes"],
    story: ["then", "suddenly", "before", "after", "felt", "said", "walked"],
  };
  const toneMarkers: Record<WritingGoals["tone"], string[]> = {
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
  const sentenceMidpoint: Record<WritingGoals["audience"], number> = { academic: 24, professional: 18, technical: 20, casual: 13, general: 17 };
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

function engagementEstimate(text: string, stats: WritingStats, document = parseDocument(text)) {
  if (!stats.words) return 0;
  const words = document.tokens.map((token) => token.lower);
  const directWords = words.filter((word) => ["you", "your", "we", "our", "us"].includes(word)).length;
  const directness = Math.min(15, (directWords / Math.max(1, stats.words)) * 100);
  const sentenceVariety = Math.min(10, new Set(stats.sentenceLengths).size * 1.5);
  const questions = (text.match(/[?]/gu) ?? []).length;
  const activeSignal = Math.max(0, 8 - stats.passiveVoicePercentage * 0.08);
  const repetitionPenalty = Math.min(12, stats.repeatedWords.length * 1.5);
  return clamp(54 + directness + Math.min(15, stats.vocabularyDiversity * 24) + sentenceVariety + Math.min(8, questions * 2) + activeSignal - repetitionPenalty);
}

export function scoreWriting(stats: WritingStats, issues: WritingIssue[], goals?: WritingGoals, text = "", document?: ParsedDocument): AnalysisScores {
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
  const breakdown: Record<ScoreDimension, { score: number; summary: string; signals: string[] }> = {
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

export function mergeWritingIssues(issues: WritingIssue[]): WritingIssue[] {
  return mergeAnalysisIssues(issues);
}

export function analyzeLocally(text: string, options: GrammarOptions = {}, goals?: WritingGoals) {
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

function expandLocalContext(text: string, start: number, end: number, contextWindow = 320) {
  const roughStart = Math.max(0, start - contextWindow);
  const roughEnd = Math.min(text.length, end + contextWindow);
  const leftMatches = [...text.slice(0, roughStart).matchAll(/(?:[.!?…]\s+|\n\s*)/gu)];
  const left = leftMatches[leftMatches.length - 1];
  const safeStart = left && left.index !== undefined ? left.index + left[0].length : roughStart;
  const right = text.slice(roughEnd).match(/[.!?…](?:\s|$)|\n\s*/u);
  const safeEnd = right?.index !== undefined ? roughEnd + right.index + right[0].length : roughEnd;
  return { start: Math.min(safeStart, start), end: Math.max(Math.min(text.length, safeEnd), end) };
}

export function detectChangedRange(previousText: string, nextText: string) {
  if (previousText === nextText) return null;
  let start = 0;
  while (start < previousText.length && start < nextText.length && previousText.charCodeAt(start) === nextText.charCodeAt(start)) start += 1;
  let previousEnd = previousText.length;
  let end = nextText.length;
  while (previousEnd > start && end > start && previousText.charCodeAt(previousEnd - 1) === nextText.charCodeAt(end - 1)) {
    previousEnd -= 1;
    end -= 1;
  }
  return { start, end, previousEnd };
}

export function analyzeLocallyIncremental(
  previousText: string,
  nextText: string,
  previousIssues: WritingIssue[],
  changedRange: { start: number; end: number; previousEnd: number } | null,
  options: GrammarOptions = {},
  goals?: WritingGoals,
) {
  if (!changedRange || previousText === nextText) return analyzeLocally(nextText, options, goals);
  const startedAt = analysisNow();
  const previousRegion = expandLocalContext(previousText, changedRange.start, changedRange.previousEnd);
  const nextRegion = expandLocalContext(nextText, changedRange.start, changedRange.end);
  const delta = nextText.length - previousText.length;
  const retained = previousIssues.filter((issue) => issue.source === "local").flatMap((issue) => {
    if (issue.start < previousRegion.end && issue.end > previousRegion.start) return [];
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

export const categoryColors: Record<IssueCategory, string> = {
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
