const IRREGULAR_FORMS: Record<string, string> = {
  am: "be",
  are: "be",
  is: "be",
  was: "be",
  were: "be",
  been: "be",
  being: "be",
  has: "have",
  had: "have",
  does: "do",
  did: "do",
  done: "do",
  goes: "go",
  went: "go",
  gone: "go",
  gets: "get",
  got: "get",
  gotten: "get",
  says: "say",
  said: "say",
  makes: "make",
  made: "make",
  takes: "take",
  took: "take",
  taken: "take",
  gives: "give",
  gave: "give",
  given: "give",
  sees: "see",
  saw: "see",
  seen: "see",
  knows: "know",
  knew: "know",
  known: "know",
  thinks: "think",
  thought: "think",
  finds: "find",
  found: "find",
  comes: "come",
  came: "come",
  becomes: "become",
  became: "become",
  leaves: "leave",
  left: "leave",
  feels: "feel",
  felt: "feel",
  keeps: "keep",
  kept: "keep",
  children: "child",
  men: "man",
  women: "woman",
  people: "person",
  mice: "mouse",
  geese: "goose",
  teeth: "tooth",
  feet: "foot",
  indices: "index",
  analyses: "analysis",
  better: "good",
  best: "good",
  worse: "bad",
  worst: "bad",
};

const DOUBLE_CONSONANT = /([b-df-hj-np-tv-z])\1$/;

/**
 * A compact, offline English lemmatizer for dictionary lookup. It deliberately
 * leaves unknown or non-English selections alone instead of guessing across
 * languages. The irregular table covers frequent reader vocabulary and the
 * suffix rules handle normal inflection without any network dependency.
 */
export function lemmatizeEnglishWord(value: string): string {
  const original = value.trim();
  if (!/^[A-Za-z]+(?:['’][A-Za-z]+)?$/.test(original)) return original;

  const word = original.toLocaleLowerCase();
  if (IRREGULAR_FORMS[word]) return IRREGULAR_FORMS[word];
  if (word.endsWith("'s") || word.endsWith("’s")) {
    return lemmatizeEnglishWord(word.slice(0, -2));
  }
  if (word.endsWith("ies") && word.length > 4) return `${word.slice(0, -3)}y`;
  if (word.endsWith("ves") && word.length > 4) {
    const stem = word.slice(0, -3);
    return /(li|wi|kni)$/.test(stem) ? `${stem}fe` : `${stem}f`;
  }
  if (word.endsWith("ing") && word.length > 5) {
    let stem = word.slice(0, -3);
    if (DOUBLE_CONSONANT.test(stem)) stem = stem.slice(0, -1);
    if (/^(mak|tak|giv|hav|us|mov|clos|hop|lik|lov|writ|rid|shak|com)$/.test(stem)) {
      return `${stem}e`;
    }
    return stem;
  }
  if (word.endsWith("ed") && word.length > 4) {
    let stem = word.slice(0, -2);
    if (stem.endsWith("i")) return `${stem.slice(0, -1)}y`;
    if (DOUBLE_CONSONANT.test(stem)) stem = stem.slice(0, -1);
    if (/^(mak|tak|giv|hav|us|mov|clos|hop|lik|lov|nam|not|writ|rid|shak|com)$/.test(stem)) {
      return `${stem}e`;
    }
    return stem;
  }
  if (word.endsWith("es") && word.length > 3) {
    if (/(ches|shes|sses|xes|zes|oes)$/.test(word)) return word.slice(0, -2);
    return word.slice(0, -1);
  }
  if (word.endsWith("s") && word.length > 3 && !word.endsWith("ss")) {
    return word.slice(0, -1);
  }
  return word;
}

export function lemmatizeEnglishText(value: string): string {
  return value.replace(/[A-Za-z]+(?:['’][A-Za-z]+)?/g, lemmatizeEnglishWord);
}
