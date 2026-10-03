
export const TYPO_FIXES : Record<string, string> = {
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
export const SPELLING_CORE  = `
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
export const SPELLING_EXTENDED  = `
ability able absence absolute absolutely abstract abundant accelerate acceptable access accident accompany accomplish achievement acknowledge acquire across action activate activity actual adapt adequate adjust administration admire admission adopt advance advantage advertise advice advise affect afford afraid agency agenda aggressive agriculture aircraft alarm album alcohol alert allocate allowance alter alternative ambitious analyse announcement annual anticipate anxiety apartment apparent appeal appearance application appoint appreciate approach appropriate approval argue arise arrangement arrival aspect assemble assess assessment assign assistance assumption assure atmosphere attach attempt attention attitude attorney attract attractive audience author authority automatic available average avoid awareness balance barrier basic basis battery beautiful behaviour belief belong benefit beside bicycle biology boundary branch bravery breathe brilliant budget calculate campaign candidate capability capacity capture category celebrate challenge champion channel chapter character charity chemical circumstance citizen clarify classic climate clinical combine comfortable command comment commercial communicate communication competition competitive complaint complete complex component compose composition compromise concentration concept conclude condition conference confidence confirm conflict connect consequence conservative consider consistent constant construct consumer contain contemporary content contract contribute convenient coordinate corporation creative crisis criterion crucial curious current customer damage database deadline debate decade decline dedicate defend define definite demonstrate deny department depend deposit derive destination detail detect determine device diagram digital dimension direction discover discussion display distance distinct distribute district diverse document duration dynamic earn editorial efficient element eliminate emerge emphasis emotional employ employee enable encounter encourage energy engine enhance enormous ensure enterprise entertain entire enthusiasm equivalent establish estimate ethics evaluate evidence exact examine exception exchange exclude execute exhibit expand expectation expense experience experiment expert export expose express extension external factor failure familiar fashion feature feedback festival fiction finance flexible flight flourish focus foreign formal foundation framework frequent function fundamental gain gallery gender generate generation generous geography global govern guidance habit handle hardware healthy hesitate highlight historical honest honour hospital household however hygiene ideal identify illustrate image imagination immediate implement implication importance impressive improve incentive incident include income indicate individual industry inevitable influence initial innovate inquiry insight inspect install instance instead institute integrate intelligence intend intense interact interest internal international interpret interrupt introduce invest investigate involve isolate issue item journey judge justice junior keyboard laboratory language launch layer legal legacy length lesson liberal library licence lifetime likely limit liquid literature locate logical loyalty maintain maintenance manage manner manual manufacture margin market material mature maximum measure mechanism media medicine mention mental method migrate minimum minor mission mobile moderate modern monitor motivate multiple mutual native natural nearby negotiate negative negotiate network neutral notice notion objective obtain obvious occasion official operate opportunity option ordinary organise outcome overall participate partner particular pattern perceive perform permission perspective phase physical policy position positive potential practice precise predict prefer prepare present previous primary principle privacy proceed process produce professional progress project promote propose protect psychology publish purchase pursue quality quarter question rapid rarely react realistic reason recommend recover reduce refer reflect region register regular reject release relevant reliable remain remove replace represent require residence resolve resource respond responsibility restrict retail reveal revise routine safety sample satisfy schedule scope secure segment select sensitive sequence separate serious significant similar simple sincere since single situation sketch solution source specific stable standard statement strategic strategy strengthen structure submit substantial succeed sufficient suggest support survey symbol technical technique technology temporary tension terminology terminal theme thorough thought throughout topic transform transition translate transport trend typical unique update useful valid value variable various vehicle version virtual visible vision visual volume volunteer warn whereas whole widely willing window within without wonder workflow worthy writing wrong youth
`.trim().split(/\s+/u);

export const SPELLING_COMMON  = `
above across again against almost already always among another anyone anything appear around ask away become before behind below between both call called country customer enough event example effect experience family far few final find following full future great help has history important including interface interfaces later least loose lunch main matter matters message much must need never next note often once open original others own plan possible practical probably question rather reason real recent right same saw send several something sometimes specific step still sure task team tell than though through today under user users usually value was why yet are aspects act box changer close contact being
`.trim().split(/\s+/u);
export const SPELLING_COMMON_EXTRA  = [
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

export const SPELLING_UNICODE  = `
café naïve résumé fiancée jalapeño façade coöperate déjà touché protégé über voilà mañana señor São München Zürich Łódź Αθήνα Москва 東京 北京
`.trim().split(/\s+/u);

// Words that are valid English but were absent from the compact lexicon. Without
// them the fuzzy suggester "corrected" them to an edit-distance neighbour, which
// turned ordinary prose into a stream of false positives (web -> we, load -> lead).
export const SPELLING_COMMON_GAP  = `
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

export const CONTRACTIONS  = new Set([
  "aren't", "can't", "couldn't", "didn't", "doesn't", "don't", "hadn't", "hasn't", "haven't", "he'd", "he'll", "he's",
  "i'd", "i'll", "i'm", "i've", "isn't", "it'd", "it'll", "it's", "let's", "mightn't", "mustn't", "shan't", "she'd",
  "she'll", "she's", "shouldn't", "that's", "there's", "they'd", "they'll", "they're", "they've", "wasn't", "we'd", "we'll",
  "we're", "we've", "weren't", "what's", "where's", "who's", "won't", "wouldn't", "you'd", "you'll", "you're", "you've",
]);

export const ARTICLE_AN_EXCEPTIONS  = new Set(["heir", "heirloom", "honest", "honestly", "honour", "honours", "honor", "hour", "hourly"]);
export const ARTICLE_A_SOUND_PREFIXES  = /^(?:euro|ewe|one|once|uni|use|user|usual|utensil|ubiquit|u[nr]i)/u;

export const KEYBOARD_NEIGHBOURS : Record<string, string> = {
  a: "qwsz", b: "vghn", c: "xdfv", d: "serfcx", e: "wrsd", f: "drtgvc", g: "ftyhbv", h: "gyujnb", i: "ujk", j: "huikmn", k: "jiolm", l: "kop", m: "njk", n: "bhjm", o: "iklp", p: "ol", q: "wa", r: "edft", s: "awedxz", t: "rfgy", u: "yhji", v: "cfgb", w: "qase", x: "zsdc", y: "tugh", z: "asx",
};

export const DIALECT_VARIANTS : Record<string, { "en-GB": string; "en-US": string }> = {
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

export const CONTEXTUAL_DIALECT_WORDS  = new Set(["license", "licence", "practice", "practise", "program", "programme"]);
export const DIALECT_VERB_CONTEXT  = new Set(["i", "you", "we", "they", "he", "she", "it", "to", "will", "would", "can", "could", "may", "might", "must", "should", "shall"]);
export const DIALECT_NOUN_CONTEXT  = new Set(["a", "an", "the", "my", "your", "our", "their", "this", "that", "driving", "software", "business", "professional", "commercial", "export", "operating", "training", "television", "tv", "radio", "loyalty", "rehabilitation", "education", "educational", "arts", "concert", "event"]);
export const PROGRAMME_COMPUTING_CONTEXT  = new Set(["computer", "software", "code", "coding", "programming", "developer", "application", "app", "script", "source", "compile", "compiler", "debug", "debugging", "api", "machine", "algorithm", "database", "terminal", "runtime", "python", "javascript"]);
export const PROGRAMME_NON_COMPUTING_CONTEXT  = new Set(["training", "television", "tv", "radio", "loyalty", "rehabilitation", "education", "educational", "arts", "concert", "event", "theatre"]);

export const FILLER_WORDS  = new Set([
  "actually",
  "basically",
  "just",
  "really",
  "simply",
]);

export const WORDINESS : Array<[string, string]> = [
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

export const CLICHES : Array<[string, string]> = [
  ["at the end of the day", "ultimately"],
  ["think outside the box", "think creatively"],
  ["low-hanging fruit", "easy opportunities"],
  ["moving forward", "next"],
  ["game changer", "major improvement"],
];

export const VAGUE_WORDS  = new Set(["thing", "things", "stuff", "somehow", "various", "aspects"]);
export const INTENSIFIERS  = new Set(["very", "extremely", "incredibly", "totally", "absolutely", "highly"]);

export const VERB_HINTS  = new Set([
  "be", "is", "are", "was", "were", "have", "has", "had", "do", "does", "did", "make", "write", "keep",
  "use", "build", "show", "tell", "need", "want", "can", "should", "will", "may", "might", "could",
]);

export const COMMON_WORDS  = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "for", "from", "has", "have", "in", "is", "it",
  "of", "on", "or", "that", "the", "this", "to", "was", "were", "with", "you", "your", "we", "our",
]);
