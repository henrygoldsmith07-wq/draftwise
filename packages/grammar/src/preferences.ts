import type {
  StylePreferences,
  Dialect,
} from "../../types/src/index.js";

export const DEFAULT_STYLE_PREFERENCES : StylePreferences = {
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

export interface GrammarOptions extends Partial<StylePreferences> {
  dialect?: Dialect;
}

export function mergePreferences(options: GrammarOptions = {}): StylePreferences {
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
