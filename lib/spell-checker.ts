/**
 * Advanced Client-Side Spell Checker
 * Uses dictionary matching and pattern detection
 */

export interface SpellingError {
  offset: number;
  length: number;
  word: string;
  suggestions: string[];
}

interface Dictionary {
  words: Set<string>;
  patterns: RegExp[];
}

let builtInDictionary: Set<string> | null = null;
const COMMON_WORDS = [
  'the', 'be', 'to', 'of', 'and', 'a', 'in', 'that', 'have', 'i',
  'it', 'for', 'not', 'on', 'with', 'he', 'as', 'you', 'do', 'at',
  'this', 'but', 'his', 'by', 'from', 'they', 'we', 'say', 'her', 'she',
  'or', 'an', 'will', 'my', 'one', 'all', 'would', 'there', 'their', 'what',
  'so', 'up', 'out', 'if', 'about', 'who', 'get', 'which', 'go', 'me'
];

// Common English word dictionary (truncated for demo)
const ENGLISH_DICTIONARY_WORDS = new Set([
  ...COMMON_WORDS,
  'able', 'able-bodied', 'aboard', 'about', 'above', 'abreast', 'abroad',
  'absent', 'absolute', 'across', 'act', 'action', 'active', 'actual',
  'ad', 'address', 'advance', 'advantage', 'advice', 'advertise', 'affair',
  'after', 'afternoon', 'again', 'against', 'agency', 'agent', 'ago',
  'agree', 'agreement', 'ahead', 'aid', 'aim', 'air', 'aircraft', 'airport',
  'alarm', 'album', 'alike', 'alive', 'allow', 'almost', 'alone', 'along',
  'already', 'also', 'always', 'am', 'among', 'amount', 'an', 'ancient',
  'and', 'angle', 'angry', 'animal', 'another', 'answer', 'any', 'anybody',
  'anymore', 'anyone', 'anything', 'anyway', 'anywhere', 'apart', 'apparent',
  'appear', 'appearance', 'apply', 'appoint', 'appointment', 'approve',
  'area', 'argue', 'argument', 'around', 'arrive', 'arrow', 'art', 'article',
  'aside', 'ask', 'aspect', 'ass', 'assume', 'assumption', 'at', 'atom',
  'attend', 'attention', 'authority', 'automatic', 'autumn', 'avail',
  'availability', 'average', 'avoid', 'award', 'aware', 'away', 'baby',
  'back', 'background', 'bad', 'bag', 'bake', 'ball', 'bank', 'bar', 'base',
  'basic', 'basis', 'basket', 'bath', 'battery', 'battle', 'be', 'beam',
  'bean', 'bear', 'beat', 'beautiful', 'beauty', 'bed', 'bedroom', 'bee',
  'before', 'behind', 'believe', 'bell', 'belong', 'below', 'belt', 'bench',
  'bend', 'beneath', 'benefit', 'beside', 'best', 'bet', 'better', 'between',
  'beyond', 'bicycle', 'big', 'bill', 'bird', 'birth', 'birthday', 'bit',
  'bite', 'black', 'blade', 'blame', 'blanket', 'blind', 'block', 'blood',
  'blow', 'blue', 'board', 'boat', 'body', 'bold', 'bone', 'book', 'boom',
  'boot', 'border', 'born', 'borrow', 'boss', 'both', 'bother', 'bottle',
  'bottom', 'bounce', 'box', 'boy', 'bracket', 'brain', 'branch', 'brand',
  'brave', 'bread', 'break', 'breakfast', 'breast', 'breath', 'brick',
  'bridge', 'brief', 'bright', 'bring', 'broad', 'broke', 'broken', 'brother',
  'brown', 'brush', 'bucket', 'building', 'bull', 'burst', 'bury', 'bus',
  'bush', 'business', 'busy', 'butt', 'buy', 'buyer', 'by', 'cabin', 'cabinet',
  'cage', 'cake', 'call', 'calm', 'camera', 'camp', 'campaign', 'can', 'cancel',
  'cap', 'capital', 'captain', 'car', 'card', 'care', 'career', 'carpet', 'carry',
  'cart', 'case', 'cash', 'cat', 'catch', 'cause', 'cell', 'center', 'central',
  'century', 'certain', 'chair', 'chance', 'change', 'channel', 'chapter',
  'character', 'charge', 'chart', 'check', 'cheek', 'cheese', 'chef', 'chemical',
  'chest', 'chief', 'child', 'children', 'chip', 'circle', 'citizen', 'city',
  'civil', 'claim', 'class', 'clean', 'clear', 'clerk', 'click', 'client',
  'climate', 'climb', 'clock', 'close', 'cloth', 'cloud', 'club', 'coach',
  'coal', 'coast', 'coat', 'code', 'coffee', 'coin', 'cold', 'collect',
  'college', 'color', 'column', 'combination', 'combine', 'come', 'comfort',
  'command', 'comment', 'commit', 'committee', 'common', 'company', 'compare',
  'compass', 'complete', 'complex', 'composition', 'computer', 'concept',
  'concern', 'condition', 'conference', 'conflict', 'connect', 'connection',
  'consider', 'consist', 'constant', 'construction', 'contain', 'contemporary',
  'content', 'contest', 'context', 'continual', 'continue', 'contract',
  'contrast', 'contribute', 'conversation', 'cook', 'cookie', 'copy', 'core',
  'corner', 'cost', 'costume', 'couple', 'course', 'court', 'cousin', 'cover',
  'cow', 'crack', 'craft', 'crash', 'crazy', 'cream', 'create', 'credit',
  'crew', 'crime', 'crisis', 'critic', 'crop', 'cross', 'crowd', 'crown',
  'cry', 'culture', 'cup', 'cure', 'current', 'customer', 'cut', 'cycle',
  'dad', 'damage', 'dance', 'danger', 'daring', 'dark', 'date', 'daughter',
  'day', 'dead', 'deal', 'dear', 'death', 'debate', 'debt', 'decade', 'decide',
  'decision', 'deck', 'declare', 'decorate', 'decrease', 'deep', 'deer', 'defeat',
  'deficit', 'define', 'definite', 'degree', 'delay', 'delete', 'deliver',
  'demand', 'defense', 'deficit', 'delay', 'delight', 'delivery', 'department',
  'democracy', 'describe', 'desert', 'design', 'desire', 'desk', 'destroy',
  'detail', 'detective', 'determine', 'develop', 'development', 'diagram',
  'diamond', 'dictionary', 'difference', 'difficult', 'difficulty', 'digest',
  'dimension', 'dinner', 'direct', 'director', 'dirt', 'dirty', 'disable',
  'disaster', 'discover', 'discuss', 'discussion', 'disease', 'dish', 'dismiss',
  'display', 'distance', 'distraction', 'divide', 'doctor', 'document', 'dog',
  'doll', 'door', 'double', 'doubt', 'down', 'dozen', 'draft', 'drag', 'drain',
  'drink', 'drive', 'driver', 'drop', 'drug', 'dry', 'duck', 'due', 'during',
  'dust', 'duty', 'ear', 'early', 'earn', 'earth', 'east', 'easily', 'easy',
  'eat', 'echo', 'economic', 'economy', 'edge', 'editor', 'educate', 'effect',
  'effort', 'egg', 'eight', 'either', 'electricity', 'element', 'elephant',
  'email', 'embarrass', 'employ', 'employee', 'employer', 'empty', 'enable',
  'end', 'enemy', 'energy', 'engage', 'engine', 'engineer', 'enjoy', 'enough',
  'enter', 'entire', 'entrance', 'envy', 'equal', 'equipment', 'escape',
  'especially', 'estate', 'estimate', 'even', 'evening', 'event', 'ever',
  'every', 'everyone', 'everything', 'evidence', 'exact', 'exam', 'examine',
  'example', 'excellent', 'except', 'exchange', 'excitement', 'excuse',
  'exercise', 'exist', 'expect', 'expense', 'experience', 'experiment',
  'expert', 'explain', 'explore', 'express', 'expression', 'extend', 'extension',
  'extent', 'external', 'extremely', 'eye', 'face', 'fact', 'factor', 'factory',
  'fail', 'fall', 'familiar', 'family', 'famous', 'fan', 'fantasy', 'far',
  'farm', 'farmer', 'fast', 'fat', 'father', 'fault', 'favor', 'favorite',
  'fear', 'feature', 'feather', 'fee', 'feed', 'feel', 'feedback', 'female',
  'few', 'field', 'fight', 'figure', 'fill', 'film', 'final', 'finish', 'fire',
  'fish', 'fit', 'five', 'fix', 'flat', 'flight', 'floor', 'flow', 'flower',
  'fly', 'focus', 'fold', 'follow', 'food', 'foot', 'football', 'for', 'force',
  'forecast', 'forget', 'form', 'formal', 'former', 'fortnight', 'forward',
  'found', 'fraction', 'frame', 'free', 'freedom', 'freeze', 'french', 'fresh',
  'friend', 'from', 'front', 'fruit', 'fuel', 'fun', 'funny', 'future', 'gain',
  'game', 'gang', 'gap', 'garage', 'garden', 'gas', 'gate', 'gather', 'gay',
  'gear', 'general', 'generate', 'genius', 'gentle', 'gentleman', 'giant', 'girl',
  'give', 'glad', 'glass', 'global', 'glory', 'go', 'goal', 'god', 'gold',
  'good', 'government', 'grade', 'grand', 'grant', 'grass', 'great', 'green',
  'ground', 'group', 'grow', 'growth', 'guess', 'guide', 'guitar', 'gun', 'guy',
  'habit', 'hair', 'half', 'hall', 'hand', 'handle', 'hang', 'happen', 'happy',
  'hard', 'harsh', 'hat', 'hate', 'head', 'health', 'hear', 'heart', 'heat',
  'heavy', 'height', 'hello', 'help', 'hide', 'high', 'him', 'his', 'history',
  'hit', 'hold', 'hole', 'holiday', 'home', 'hope', 'horse', 'hospital', 'hot',
  'hotel', 'hour', 'house', 'housing', 'huge', 'human', 'humor', 'hunt',
  'hurricane', 'hurt', 'husband', 'hypnosis', 'ice', 'idea', 'ideal', 'identify',
  'identity', 'ignore', 'ill', 'image', 'imagine', 'impact', 'import', 'impose',
  'impossible', 'impress', 'impression', 'improve', 'incident', 'include',
  'income', 'increase', 'indeed', 'independent', 'indicate', 'individual',
  'industry', 'influence', 'inform', 'information', 'initial', 'injury',
  'innocent', 'innovation', 'input', 'insert', 'inside', 'insist', 'inspect',
  'install', 'instance', 'instead', 'institution', 'instruction', 'instrument',
  'insurance', 'intelligent', 'interest', 'interior', 'international', 'into',
  'introduce', 'invent', 'investigation', 'invitation', 'invite', 'iron',
  'island', 'issue', 'italian', 'item', 'its', 'itself', 'jacket', 'jam',
  'jealous', 'jewel', 'join', 'joint', 'journey', 'judge', 'juice', 'jump',
  'junior', 'just', 'keen', 'keep', 'key', 'kick', 'kid', 'kill', 'kind',
  'king', 'kiss', 'kitchen', 'knee', 'know', 'knowledge', 'lab', 'label',
  'laboratory', 'lack', 'lady', 'lake', 'lamp', 'land', 'language', 'large',
  'last', 'late', 'later', 'laugh', 'lawyer', 'lay', 'lead', 'leader',
  'leadership', 'league', 'leap', 'learn', 'least', 'leave', 'lecture', 'legal',
  'legend', 'lemon', 'lend', 'length', 'less', 'lesson', 'let', 'letter',
  'level', 'library', 'lie', 'life', 'lift', 'light', 'like', 'limit',
  'linen', 'link', 'lion', 'lip', 'list', 'listen', 'little', 'live', 'living',
  'load', 'loan', 'local', 'location', 'lock', 'log', 'lonely', 'long', 'look',
  'loose', 'lord', 'lose', 'loss', 'lost', 'lot', 'loud', 'love', 'low',
  'luck', 'machine', 'magazine', 'magic', 'mail', 'main', 'major', 'make',
  'male', 'man', 'manage', 'manager', 'manner', 'many', 'map', 'mark', 'market',
  'marriage', 'married', 'mass', 'master', 'match', 'mathematics', 'matter',
  'may', 'meal', 'mean', 'meaning', 'means', 'measure', 'meat', 'medical',
  'medicine', 'meet', 'meeting', 'member', 'membership', 'memory', 'mention',
  'menu', 'mere', 'mess', 'message', 'metal', 'meter', 'method', 'middle',
  'might', 'mile', 'milk', 'mill', 'mind', 'mine', 'minister', 'minor',
  'minute', 'mirror', 'miss', 'mistake', 'mix', 'mobile', 'mode', 'model',
  'modern', 'modest', 'moment', 'money', 'month', 'mood', 'moon', 'more',
  'morning', 'most', 'mother', 'motivation', 'motor', 'mountain', 'mouse',
  'mouth', 'move', 'movement', 'movie', 'muscle', 'museum', 'music', 'must',
  'nail', 'name', 'nation', 'national', 'native', 'natural', 'nature', 'near',
  'neat', 'necessary', 'neck', 'need', 'needle', 'negotiate', 'neighbor',
  'neighborhood', 'negative', 'neither', 'nerve', 'nest', 'net', 'network',
  'news', 'newspaper', 'next', 'nice', 'night', 'nine', 'no', 'nod', 'noise',
  'none', 'nor', 'normal', 'north', 'nose', 'not', 'note', 'nothing', 'notice',
  'novel', 'now', 'number', 'nurse', 'object', 'observe', 'obtain', 'occasion',
  'occur', 'occupation', 'ocean', 'of', 'off', 'offer', 'office', 'officer',
  'official', 'often', 'oil', 'old', 'on', 'once', 'one', 'only', 'onto',
  'open', 'operate', 'operation', 'opinion', 'opportunity', 'oppose', 'option',
  'or', 'orange', 'order', 'ordinary', 'organic', 'organization', 'original',
  'other', 'ought', 'our', 'ours', 'outer', 'town', 'oven', 'over', 'own',
  'owner', 'pace', 'pack', 'package', 'page', 'pain', 'paint', 'painting',
  'pair', 'palm', 'pan', 'paper', 'parliament', 'part', 'particular', 'partly',
  'partner', 'party', 'pass', 'past', 'path', 'patient', 'pattern', 'pause',
  'pay', 'payment', 'peace', 'peak', 'pear', 'pen', 'penalty', 'pencil',
  'people', 'per', 'percent', 'perfect', 'perform', 'performance', 'perhaps',
  'period', 'permission', 'permit', 'person', 'personal', 'perspective', 'phone',
  'photo', 'phrase', 'physical', 'pick', 'picture', 'pie', 'piece', 'pin',
  'pipe', 'pitch', 'place', 'plan', 'plane', 'planet', 'plant', 'plastic',
  'plate', 'platform', 'play', 'player', 'pleasant', 'please', 'pleasure',
  'plenty', 'plot', 'pocket', 'poem', 'poet', 'point', 'pole', 'police',
  'policy', 'political', 'politics', 'pollution', 'pool', 'poor', 'pop',
  'popular', 'port', 'position', 'positive', 'possess', 'possibility',
  'possibly', 'post', 'pot', 'potato', 'pound', 'power', 'practical', 'practice',
  'praise', 'pray', 'preach', 'precious', 'prefer', 'prepare', 'present',
  'president', 'pressure', 'pretty', 'prevent', 'previous', 'price', 'print',
  'prison', 'private', 'prize', 'problem', 'procedure', 'process', 'produce',
  'product', 'production', 'profession', 'professional', 'professor', 'profit',
  'program', 'progress', 'project', 'promise', 'promotion', 'proof', 'proper',
  'property', 'proposal', 'prosecute', 'protect', 'protein', 'protest',
  'provide', 'public', 'pull', 'pump', 'punch', 'punish', 'purchase', 'pure',
  'purple', 'purpose', 'push', 'put', 'push', 'quality', 'quarter', 'queen',
  'question', 'quick', 'quiet', 'quit', 'quite', 'quote', 'race', 'radio',
  'rain', 'raise', 'range', 'rank', 'rapid', 'rare', 'rate', 'rather', 'raw',
  'reach', 'read', 'ready', 'real', 'really', 'reason', 'receive', 'recent',
  'record', 'red', 'reduce', 'refer', 'reflect', 'reform', 'refrigerator',
  'refuse', 'regard', 'regret', 'regular', 'reject', 'relate', 'relation',
  'relationship', 'relative', 'relief', 'religion', 'rely', 'remain', 'remark',
  'remember', 'remind', 'remote', 'remove', 'rent', 'repair', 'repeat',
  'replace', 'reply', 'report', 'represent', 'require', 'research', 'reserve',
  'resign', 'resist', 'resolve', 'resource', 'respect', 'respond', 'response',
  'rest', 'restaurant', 'restore', 'restrict', 'result', 'resume', 'retail',
  'retain', 'retreat', 'return', 'review', 'revolution', 'rhythm', 'rice',
  'rich', 'ride', 'ring', 'rise', 'risk', 'river', 'road', 'rob', 'rock',
  'role', 'roll', 'roof', 'room', 'root', 'rope', 'rose', 'rotten', 'round',
  'route', 'row', 'royal', 'rub', 'rule', 'rush', 'sad', 'safe', 'safety',
  'sail', 'salad', 'salary', 'sale', 'salt', 'same', 'sample', 'sand',
  'satellite', 'satisfy', 'scale', 'scene', 'scheme', 'school', 'science',
  'scientist', 'score', 'screen', 'script', 'sea', 'seal', 'search', 'season',
  'seat', 'second', 'secret', 'secretary', 'section', 'sector', 'secure',
  'security', 'see', 'seed', 'seek', 'seem', 'sell', 'send', 'senior',
  'sense', 'sentence', 'separate', 'series', 'serious', 'servant', 'serve',
  'service', 'set', 'settle', 'seven', 'several', 'severe', 'sex', 'shade',
  'shadow', 'shake', 'shall', 'shape', 'share', 'sharp', 'she', 'sheet',
  'shelf', 'shell', 'shelter', 'shine', 'ship', 'shirt', 'shoe', 'shop',
  'shore', 'short', 'shot', 'should', 'shoulder', 'show', 'shut', 'sick',
  'side', 'sign', 'signal', 'silence', 'silk', 'silver', 'simple', 'since',
  'sing', 'single', 'sink', 'sir', 'sister', 'sit', 'site', 'situation',
  'six', 'size', 'skill', 'skin', 'skirt', 'sky', 'sleep', 'slide', 'slip',
  'slope', 'slow', 'small', 'smell', 'smile', 'smoke', 'smooth', 'snake',
  'snow', 'soap', 'social', 'society', 'soft', 'software', 'soil', 'soldier',
  'solid', 'solution', 'solve', 'some', 'somebody', 'someone', 'something',
  'sometimes', 'somewhere', 'son', 'song', 'soon', 'sort', 'sound', 'soup',
  'source', 'south', 'space', 'spare', 'speak', 'speaker', 'special', 'species',
  'specific', 'speech', 'speed', 'spend', 'spirit', 'spite', 'split', 'spoke',
  'sport', 'spot', 'spread', 'spring', 'square', 'stable', 'staff', 'stage',
  'stair', 'stamp', 'stand', 'standard', 'star', 'start', 'state', 'station',
  'stay', 'steal', 'steam', 'step', 'stick', 'still', 'stomach', 'stone',
  'stop', 'store', 'storm', 'story', 'straight', 'strange', 'stranger',
  'strategy', 'street', 'stretch', 'strict', 'strike', 'string', 'strip',
  'stroke', 'strong', 'structure', 'student', 'studio', 'study', 'stuff',
  'stupid', 'style', 'subject', 'submit', 'subscribe', 'substance', 'succeed',
  'success', 'such', 'sudden', 'suffer', 'sugar', 'suggest', 'suit', 'summer',
  'sun', 'sunday', 'support', 'suppose', 'sure', 'surface', 'surprise',
  'survey', 'survival', 'suspect', 'swim', 'swing', 'switch', 'symbol', 'system',
  'table', 'tail', 'take', 'tale', 'talk', 'tall', 'tank', 'tape', 'target',
  'task', 'taste', 'tax', 'tea', 'teach', 'teacher', 'team', 'tech', 'tell',
  'temperature', 'temples', 'tendency', 'tennis', 'tension', 'tent', 'term',
  'terms', 'terrible', 'test', 'text', 'than', 'thank', 'that', 'the',
  'theater', 'their', 'them', 'theme', 'themselves', 'then', 'theory', 'there',
  'these', 'they', 'thick', 'thin', 'thing', 'think', 'third', 'thirsty',
  'this', 'those', 'though', 'thought', 'thousand', 'thread', 'threat',
  'threaten', 'three', 'throat', 'through', 'throw', 'thumb', 'thus', 'tick',
  'ticket', 'tide', 'tiger', 'tight', 'tile', 'till', 'time', 'tin', 'tiny',
  'tip', 'tire', 'tired', 'title', 'to', 'today', 'toe', 'together', 'tomato',
  'tomorrow', 'tone', 'tongue', 'tonight', 'too', 'tool', 'tooth', 'top',
  'topic', 'total', 'touch', 'tough', 'tour', 'tourist', 'toward', 'town',
  'toy', 'trace', 'track', 'trade', 'tradition', 'traffic', 'tragedy', 'trail',
  'train', 'trainer', 'training', 'translate', 'transmission', 'transport',
  'trap', 'travel', 'tray', 'treat', 'tree', 'trend', 'trial', 'tribe', 'trick',
  'trip', 'troop', 'trouble', 'truck', 'true', 'trust', 'truth', 'try', 'tube',
  'Tuesday', 'tune', 'turn', 'twelve', 'twenty', 'twice', 'two', 'type',
  'typical', 'ugly', 'umbrella', 'uncle', 'under', 'undertake', 'uniform',
  'union', 'unit', 'university', 'unless', 'until', 'up', 'upon', 'upper',
  'us', 'use', 'used', 'useful', 'user', 'usual', 'vacation', 'valley', 'valuable',
  'value', 'van', 'various', 'vast', 'vegetable', 'vehicle', 'venture', 'version',
  'victim', 'view', 'village', 'violin', 'virtual', 'visit', 'visitor', 'voice',
  'volume', 'vote', 'wage', 'wait', 'wake', 'walk', 'wall', 'war', 'warm',
  'warn', 'wash', 'waste', 'watch', 'water', 'wave', 'way', 'we', 'weak',
  'wealth', 'weapon', 'wear', 'weather', 'web', 'wedding', 'week', 'weekday',
  'weekend', 'weigh', 'weight', 'welcome', 'well', 'west', 'wet', 'what',
  'wheel', 'when', 'where', 'whether', 'which', 'while', 'white', 'whole',
  'whom', 'whose', 'why', 'wide', 'wife', 'wild', 'will', 'win', 'wind',
  'window', 'wine', 'wing', 'winner', 'winter', 'wire', 'wish', 'wise',
  'wit', 'with', 'within', 'without', 'wolf', 'woman', 'women', 'won',
  'wonder', 'wood', 'word', 'work', 'worker', 'working', 'world', 'worry',
  'worth', 'wrap', 'write', 'writer', 'writing', 'wrong', 'yard', 'year',
  'yellow', 'yes', 'yesterday', 'yet', 'you', 'young', 'your', 'yourself',
  'youth', 'zero', 'zone'
]);

/**
 * Initialize built-in dictionary
 */
export function initDictionary(): void {
  if (!builtInDictionary) {
    builtInDictionary = new Set(ENGLISH_DICTIONARY_WORDS);
    
    // Add common misspellings that should be valid
    builtInDictionary.add('colour'); // British spelling
    builtInDictionary.add('favor'); // US variant
    builtInDictionary.add('metre'); // UK spelling
    builtInDictionary.add('centre'); // UK spelling
    
    console.log(`Dictionary initialized with ${builtInDictionary.size} words`);
  }
}

/**
 * Check spelling in text
 */
export function checkSpelling(text: string): SpellingError[] {
  initDictionary();
  
  const errors: SpellingError[] = [];
  const wordsWithPositions = extractWordsWithPositions(text);
  
  for (const { word, position } of wordsWithPositions) {
    if (word.length < 2) continue; // Skip very short words
    
    const lowerWord = word.toLowerCase();
    
    if (!builtInDictionary?.has(lowerWord)) {
      // Generate suggestions using edit distance
      const suggestions = generateSuggestions(lowerWord);
      
      if (suggestions.length > 0) {
        errors.push({
          offset: position,
          length: word.length,
          word: word,
          suggestions: suggestions.slice(0, 5) // Top 5 suggestions
        });
      }
    }
  }
  
  return errors;
}

/**
 * Extract words with their positions in text
 */
function extractWordsWithPositions(text: string): Array<{
  word: string;
  position: number;
}> {
  const results: Array<{ word: string; position: number }> = [];
  let currentPosition = 0;
  
  // Match words (letters, numbers, underscores)
  const wordRegex = /\b[\w']+\b/g;
  let match;
  
  while ((match = wordRegex.exec(text)) !== null) {
    const startPos = match.index;
    const endPos = startPos + match[0].length;
    
    results.push({
      word: match[0],
      position: currentPosition + startPos
    });
    
    currentPosition = endPos;
  }
  
  return results;
}

/**
 * Generate spelling suggestions using edit distance
 */
function generateSuggestions(word: string, maxSuggestions = 5): string[] {
  const candidates = [...builtInDictionary || []];
  
  // Score candidates by edit distance
  const scored = candidates.map(candidate => ({
    candidate,
    distance: calculateLevenshteinDistance(word, candidate)
  }));
  
  // Filter close matches (distance <= 2)
  const closeMatches = scored
    .filter(item => item.distance <= 2 && item.distance > 0)
    .sort((a, b) => a.distance - b.distance);
  
  // Return top suggestions
  return closeMatches.slice(0, maxSuggestions).map(m => m.candidate);
}

/**
 * Calculate Levenshtein edit distance between two strings
 */
function calculateLevenshteinDistance(str1: string, str2: string): number {
  const matrix = [];
  
  for (let i = 0; i <= str2.length; i++) {
    matrix[i] = [i];
  }
  
  for (let j = 0; j <= str1.length; j++) {
    matrix[0][j] = j;
  }
  
  for (let i = 1; i <= str2.length; i++) {
    for (let j = 1; j <= str1.length; j++) {
      if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substitution
          Math.min(
            matrix[i][j - 1] + 1, // insertion
            matrix[i - 1][j] + 1   // deletion
          )
        );
      }
    }
  }
  
  return matrix[str2.length][str1.length];
}

/**
 * Quick spell check for single word
 */
export function isWordValid(word: string): boolean {
  initDictionary();
  const lower = word.toLowerCase();
  
  // Valid variations
  if (lower === 'colour' || lower === 'color') return true;
  if (lower === 'favour' || lower === 'favor') return true;
  if (lower === 'metre' || lower === 'meter') return true;
  if (lower === 'centre' || lower === 'center') return true;
  
  return builtInDictionary?.has(lower) ?? false;
}

/**
 * Get dictionary statistics
 */
export function getDictionaryStats(): {
  size: number;
  recentChecks: number;
  lastCheck: Date;
} {
  initDictionary();
  
  return {
    size: builtInDictionary?.size || 0,
    recentChecks: 0,
    lastCheck: new Date()
  };
}
