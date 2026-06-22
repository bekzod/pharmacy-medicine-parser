const { LATIN_TO_CYRILLIC, LATIN_HOMOGLYPH_RE } = require('./latin-to-cyrillic');

const TRADE_NAME_ABBREV_TOKEN_ALIASES = new Map([
  ['ср', 'sr'],
  ['мр', 'mr'],
  ['дср', 'dsr'],
  ['хлоргексидина', 'хлоргексидин'],
  ['бэби', 'бейби'],
  ['бифилакс-бэби', 'бифилакс бейби'],
  ['бороплюс', 'боро плюс'],
  ['смягчающий', 'софт'],
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

function normalizeSqlTerm(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .trim();
}

function normalizeLatinHomoglyphs(text) {
  return String(text || '').replace(/\S+/g, (word) => {
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
  normalizeSqlTerm,
  normalizeLatinHomoglyphs,
  buildLikeAnyPredicates,
  buildLikeAnyCondition,
};
