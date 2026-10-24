import assert from "node:assert/strict";
import test from "node:test";
import { analyzeLocally } from "../packages/grammar/src/index.ts";

const rule = (text, ruleId) => analyzeLocally(text, { dialect: "en-GB" }).issues.filter((issue) => issue.ruleId === ruleId);

test("existential there agrees with the noun phrase after it", () => {
  const plural = rule("There is three people waiting outside.", "grammar-subject-verb-agreement");
  assert.equal(plural.length, 1);
  assert.equal(plural[0].replacement, "are");
  const singular = rule("There are a problem with the server.", "grammar-subject-verb-agreement");
  assert.equal(singular.length, 1);
  assert.equal(singular[0].replacement, "is");
  assert.equal(rule("There is 2 problems here.", "grammar-subject-verb-agreement").length, 1);
});

test("existential edge cases stay silent", () => {
  // Contracted there's + plural is idiomatic casual speech, not an error to nag about.
  assert.deepEqual(rule("There's three people coming to the meeting.", "grammar-subject-verb-agreement"), []);
  assert.deepEqual(rule("There are a lot of reasons to stay.", "grammar-subject-verb-agreement"), []);
  assert.deepEqual(rule("There are one or two issues left.", "grammar-subject-verb-agreement"), []);
  assert.deepEqual(rule("There are a few good options.", "grammar-subject-verb-agreement"), []);
  assert.deepEqual(rule("There is fish in the pond.", "grammar-subject-verb-agreement"), []);
  assert.deepEqual(rule("There is politics in every office.", "grammar-subject-verb-agreement"), []);
  assert.deepEqual(rule("There is a problem with the server.", "grammar-subject-verb-agreement"), []);
  assert.deepEqual(rule("There are problems with the server.", "grammar-subject-verb-agreement"), []);
});

test("modal + of is corrected to have", () => {
  for (const text of ["You should of called yesterday.", "We could of won.", "She would of agreed.", "They might of left."]) {
    const issues = rule(text, "grammar-confused-of");
    assert.equal(issues.length, 1, text);
    assert.equal(issues[0].original, "of");
    assert.equal(issues[0].replacement, "have");
  }
  assert.deepEqual(rule("Hard work is a must of modern life.", "grammar-confused-of"), []);
  assert.deepEqual(rule("You should have called yesterday.", "grammar-confused-of"), []);
});

test("prepositional and-I is corrected to and-me", () => {
  const between = rule("Between you and I, this plan is risky.", "grammar-object-pronoun");
  assert.equal(between.length, 1);
  assert.equal(between[0].original, "I");
  assert.equal(between[0].replacement, "me");
  assert.equal(rule("He gave it to John and I yesterday.", "grammar-object-pronoun").length, 1);
  assert.equal(rule("Everyone except you and I agreed.", "grammar-object-pronoun").length, 1);
});

test("subject-position and-I and new clauses stay silent", () => {
  assert.deepEqual(rule("You and I went home early.", "grammar-object-pronoun"), []);
  assert.deepEqual(rule("John and I finished the report.", "grammar-object-pronoun"), []);
  assert.deepEqual(rule("For work and I need a break.", "grammar-object-pronoun"), []);
  assert.deepEqual(rule("With courage and I will succeed.", "grammar-object-pronoun"), []);
});

test("double comparatives collapse to the single form", () => {
  for (const [text, fixed] of [["It was more better than before.", "better"], ["This is the most biggest challenge.", "biggest"], ["She is less happier now.", "happier"], ["The least worst option wins.", "worst"]]) {
    const issues = rule(text, "grammar-double-comparative");
    assert.equal(issues.length, 1, text);
    assert.ok(issues[0].replacement.toLowerCase().includes(fixed), text);
  }
});

test("lookalikes of double comparatives stay silent", () => {
  assert.deepEqual(rule("Our store has more best-sellers this year.", "grammar-double-comparative"), []);
  assert.deepEqual(rule("A more careful analysis helps everyone.", "grammar-double-comparative"), []);
  assert.deepEqual(rule("She is the most wanted actor.", "grammar-double-comparative"), []);
  assert.deepEqual(rule("The more the better.", "grammar-double-comparative"), []);
});
test("perfect forms take the past participle", () => {
  for (const [text, fixed] of [["I have went home.", "gone"], ["She has took the train.", "taken"], ["They had ate already.", "eaten"], ["You could have saw the signs.", "seen"], ["Have you saw the news?", "seen"], ["He has not drank water.", "drunk"], ["They have ran daily.", "run"], ["She has forgot the keys.", "forgotten"]]) {
    const issues = rule(text, "grammar-verb-participle");
    assert.equal(issues.length, 1, text);
    assert.equal(issues[0].replacement.toLowerCase(), fixed, text);
  }
});

test("noun readings after have stay silent", () => {
  assert.deepEqual(rule("I have a saw for cutting logs.", "grammar-verb-participle"), []);
  assert.deepEqual(rule("The garden has rose bushes.", "grammar-verb-participle"), []);
  assert.deepEqual(rule("They have bit parts in films.", "grammar-verb-participle"), []);
  assert.deepEqual(rule("We have lay members on the board.", "grammar-verb-participle"), []);
  assert.deepEqual(rule("They have beat reporters with them.", "grammar-verb-participle"), []);
  assert.deepEqual(rule("We organise fell walks every month.", "grammar-verb-participle"), []);
});

test("did takes the base verb", () => {
  for (const [text, fixed] of [["He didn't went there.", "go"], ["Did she took the bus?", "take"], ["They did not done the work.", "do"], ["Didn't they went home?", "go"]]) {
    const issues = rule(text, "grammar-verb-base");
    assert.equal(issues.length, 1, text);
    assert.equal(issues[0].replacement.toLowerCase(), fixed, text);
  }
  assert.deepEqual(rule("Did Rose call yesterday?", "grammar-verb-base"), []);
  assert.deepEqual(rule("Did left luggage arrive?", "grammar-verb-base"), []);
  assert.deepEqual(rule("Did you saw through the plank?", "grammar-verb-base"), []);
});

test("bare seen takes saw", () => {
  const issues = rule("I seen him yesterday.", "grammar-verb-participle");
  assert.equal(issues.length, 1);
  assert.equal(issues[0].replacement, "saw");
  assert.deepEqual(rule("I have seen it already.", "grammar-verb-participle"), []);
});

test("singular distributives take singular verbs", () => {
  for (const text of ["Each have a theory.", "Everyone have a role.", "Neither of them have a clue."]) {
    const issues = rule(text, "grammar-subject-verb-agreement");
    assert.equal(issues.length, 1, text);
    assert.equal(issues[0].replacement.toLowerCase(), "has", text);
  }
  assert.deepEqual(rule("Neither have I.", "grammar-subject-verb-agreement"), []);
  assert.deepEqual(rule("They require each have a ticket.", "grammar-subject-verb-agreement"), []);
  assert.deepEqual(rule("The report presents results for each study group.", "grammar-subject-verb-agreement"), []);
});

test("determiner phrases agree in number", () => {
  const kind = rule("These kind of errors persist.", "grammar-determiner-agreement");
  assert.equal(kind.length, 1);
  assert.equal(kind[0].replacement, "kinds");
  const phen = rule("A phenomena occurred.", "grammar-determiner-agreement");
  assert.equal(phen.length, 1);
  assert.equal(phen[0].replacement, "phenomenon");
  const one = rule("One of the reason is cost.", "grammar-determiner-agreement");
  assert.equal(one.length, 1);
  assert.equal(one[0].replacement, "reasons");
  assert.deepEqual(rule("This kind of error persists.", "grammar-determiner-agreement"), []);
  assert.deepEqual(rule("These kinds of errors persist.", "grammar-determiner-agreement"), []);
});

test("whom follows prepositions", () => {
  const issues = rule("The person to who I spoke.", "grammar-object-pronoun");
  assert.equal(issues.length, 1);
  assert.equal(issues[0].replacement, "whom");
  assert.deepEqual(rule("To whom it may concern.", "grammar-object-pronoun"), []);
});

test("subjects use I, objects use me", () => {
  for (const text of ["John and me went home.", "Me and John went home.", "John and myself attended."]) {
    assert.equal(rule(text, "grammar-subject-pronoun").length, 1, text);
  }
  assert.deepEqual(rule("For John and me, yesterday was hard.", "grammar-subject-pronoun"), []);
  assert.deepEqual(rule("Give it to John and me tomorrow.", "grammar-subject-pronoun"), []);
});

test("redundant prepositions drop out", () => {
  assert.equal(rule("Get off of the table.", "grammar-redundant-preposition").length, 1);
  assert.equal(rule("Where is the station at?", "grammar-redundant-preposition").length, 1);
  assert.deepEqual(rule("The event is off.", "grammar-redundant-preposition"), []);
  assert.deepEqual(rule("Where the party at?", "grammar-redundant-preposition"), []);
  assert.deepEqual(rule("That is where it's at.", "grammar-redundant-preposition"), []);
});

test("reason takes that, possessives take no apostrophe", () => {
  assert.equal(rule("The reason is because I said so.", "grammar-reason-is-because").length, 1);
  assert.equal(rule("Its' broken.", "grammar-possessive-apostrophe").length, 1);
  assert.deepEqual(rule("The reason is that costs rose.", "grammar-reason-is-because"), []);
  assert.deepEqual(rule("She said 'its' twice.", "grammar-possessive-apostrophe"), []);
});

test("countables take fewer, many and number", () => {
  assert.equal(rule("Less people attended.", "grammar-fewer-less").length, 1);
  assert.equal(rule("The amount of people grew.", "grammar-amount-number").length, 1);
  assert.equal(rule("Much problems remain.", "grammar-many-much").length, 1);
  assert.deepEqual(rule("Less than five people came.", "grammar-fewer-less"), []);
  assert.deepEqual(rule("One less meeting to attend.", "grammar-fewer-less"), []);
  assert.deepEqual(rule("Much money changed hands.", "grammar-many-much"), []);
});

test("everyday splits except as an adjective", () => {
  assert.equal(rule("We walk there everyday.", "grammar-everyday").length, 1);
  assert.deepEqual(rule("Everyday life is busy.", "grammar-everyday"), []);
  assert.deepEqual(rule("We value everyday kindness.", "grammar-everyday"), []);
});
test("idiom homophones resolve to the idiom", () => {
  for (const [text, ruleId, fixed] of [
    ["Bare with me.", "grammar-confused-bare", "Bear"], ["Tow the line.", "grammar-confused-toe", "Toe"],
    ["It peak my interest.", "grammar-confused-pique", "piqued"], ["It did not phase her.", "grammar-confused-faze", "faze"],
    ["They hone in on targets.", "grammar-confused-home", "home in on"], ["It was deep seeded.", "grammar-confused-seated", "deep-seated"],
    ["Wait with baited breath.", "grammar-confused-bated", "bated"], ["It was one in the same.", "grammar-confused-same", "one and the same"],
    ["For all intensive purposes.", "grammar-confused-intents", "intents and"], ["He extract revenge.", "grammar-confused-exact", "exact"],
    ["They wreck havoc.", "grammar-confused-wreak", "wreak"], ["It was, of coarse, late.", "grammar-confused-coarse", "course"],
    ["Give me piece of mind.", "grammar-confused-peace", "peace"], ["A right of passage.", "grammar-confused-rite", "rite"],
    ["She played a key roll.", "grammar-confused-roll", "role"], ["Weather you like it or not.", "grammar-confused-weather", "Whether"],
    ["A sweet desert followed.", "grammar-confused-dessert", "dessert"], ["I could care less.", "grammar-idiom-care-less", "couldn't"],
    ["Irregardless, we left.", "grammar-confused-regardless", "Regardless"], ["You ought of apologise.", "grammar-confused-of", "to"],
    ["Who's car is this?", "grammar-confused-whose", "Whose"], ["The race tested his medal.", "grammar-confused-mettle", "mettle"],
    ["She won mettle at the games.", "grammar-confused-medal", "medal"], ["The court marshal convened.", "grammar-confused-martial", "martial"],
    ["The knot is too lose.", "grammar-confused-loose", "loose"], ["I loose weight yearly.", "grammar-confused-loose", "lose"],
    ["Take a deep breathe.", "grammar-confused-breath", "breath"], ["His moral principal guided him.", "grammar-confused-principle", "principle"],
    ["The school principle resigned.", "grammar-confused-principal", "principal"], ["A full compliment of staff attended.", "grammar-confused-complement", "complement"],
    ["The discreet components failed.", "grammar-confused-discrete", "discrete"], ["He sought council for advice.", "grammar-confused-counsel", "counsel"],
    ["The city counsel met.", "grammar-confused-council", "council"], ["The construction sight closed.", "grammar-confused-site", "site"],
  ]) {
    const issues = rule(text, ruleId);
    assert.equal(issues.length, 1, text);
    assert.equal(issues[0].replacement, fixed, text);
  }
});

test("correct idioms and lookalikes stay silent", () => {
  assert.deepEqual(rule("Bare feet touched the sand.", "grammar-confused-bare"), []);
  assert.deepEqual(rule("Phase out old models first.", "grammar-confused-faze"), []);
  assert.deepEqual(rule("Say your piece at dinner.", "grammar-confused-peace"), []);
  assert.deepEqual(rule("We ate a bread roll with soup.", "grammar-confused-roll"), []);
  assert.deepEqual(rule("They are teaming up with rivals.", "grammar-confused-teem"), []);
  assert.deepEqual(rule("They weather the storm together.", "grammar-confused-weather"), []);
  assert.deepEqual(rule("She won a medal for bravery.", "grammar-confused-mettle"), []);
  assert.deepEqual(rule("Set the dog loose in the park.", "grammar-confused-loose"), []);
  assert.deepEqual(rule("Hold your breath now.", "grammar-confused-breath"), []);
  assert.deepEqual(rule("Help me devise a plan.", "grammar-confused-device"), []);
  assert.deepEqual(rule("The wine complements the meal.", "grammar-confused-complement"), []);
  assert.deepEqual(rule("They held a discreet inquiry.", "grammar-confused-discreet"), []);
  assert.deepEqual(rule("The city council meets weekly.", "grammar-confused-council"), []);
  assert.deepEqual(rule("If you could care less, try harder.", "grammar-idiom-care-less"), []);
});
