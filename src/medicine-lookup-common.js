const { LATIN_TO_CYRILLIC, LATIN_HOMOGLYPH_RE } = require('./latin-to-cyrillic');

const TRADE_NAME_ABBREV_TOKEN_ALIASES = new Map([
  ['ср', 'sr'],
  ['мр', 'mr'],
  ['мr', 'mr'],
  ['mр', 'mr'],
  ['дср', 'dsr'],
  ['хлоргексидина', 'хлоргексидин'],
  ['линкомицина', 'линкомицин'],
  ['бэби', 'бейби'],
  ['бифилакс-бэби', 'бифилакс бейби'],
  ['бороплюс', 'боро плюс'],
  ['смягчающий', 'софт'],
  ['гигиен', 'гигиенические'],
  ['гигрос', 'гигр'],
  ['стерильн', 'стер'],
  ['стерильный', 'стер'],
  ['стерильная', 'стер'],
  ['стерильн.', 'стер'],
  ['витагум-магний', 'витагам витамин магний'],
  ['б6', 'в6'],
  ['мармелад', 'мармеладки'],
  ['перикись-зие', 'перекись зие'],
  ['u100', 'u-100'],
  ['драй', 'drydry'],
]);

function escapeLikePattern(value) {
  return String(value || '').replace(/[\\%_]/g, '\\$&');
}

const NORMALIZATION_MODES = {
  sql: [
    (value) => value.toLowerCase(),
    (value) => value.replace(/ё/g, 'е'),
    (value) => value.trim(),
  ],
};

function normalizeText(value, mode = 'sql') {
  const rules = NORMALIZATION_MODES[mode];
  if (!rules) throw new Error(`Unknown normalization mode: ${mode}`);
  return rules.reduce((normalized, rule) => rule(normalized), String(value || ''));
}

function normalizeSqlTerm(value) {
  return normalizeText(value, 'sql');
}

const HOMOGLYPH_WORD_RE = /[\p{L}\p{N}]+(?:['\u2019-][\p{L}\p{N}]+)*/gu;

function normalizeLatinHomoglyphs(text) {
  return String(text || '').replace(HOMOGLYPH_WORD_RE, (word) => {
    if (/[\u0400-\u04ff]/u.test(word) && /[a-zA-Z]/u.test(word)) {
      return word.replace(LATIN_HOMOGLYPH_RE, (char) => LATIN_TO_CYRILLIC[char] || char);
    }
    return word;
  });
}

function buildLikeAnyPredicates(expressions, keys) {
  const expressionList = Array.isArray(expressions) ? expressions : [expressions];
  return expressionList.flatMap((expression) =>
    keys.map((key) => `${expression} LIKE '%' || :${key} || '%' ESCAPE '\\'`),
  );
}

function buildLikeAnyCondition(expressions, keys) {
  const predicates = buildLikeAnyPredicates(expressions, keys);
  return predicates.length ? `(${predicates.join(' OR ')})` : '';
}

module.exports = {
  TRADE_NAME_ABBREV_TOKEN_ALIASES,
  escapeLikePattern,
  normalizeText,
  normalizeSqlTerm,
  normalizeLatinHomoglyphs,
  buildLikeAnyPredicates,
  buildLikeAnyCondition,
};
