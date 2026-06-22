const { LATIN_TO_CYRILLIC, LATIN_HOMOGLYPH_RE } = require('./latin-to-cyrillic');

const TRADE_NAME_ABBREV_TOKEN_ALIASES = new Map([
  ['ср', 'sr'],
  ['мр', 'mr'],
  ['дср', 'dsr'],
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

function buildNormalizedNameExpr(alias = 'm') {
  return `lower(${alias}.name)`;
}

function buildNormalizedColumnExpr(alias, column) {
  return `lower(coalesce(${alias}.${column}::text, ''))`;
}

function jaccardSimilarity(leftTokens, rightTokens) {
  if (!leftTokens.length || !rightTokens.length) return 0;
  const left = new Set(leftTokens);
  const right = new Set(rightTokens);
  let overlap = 0;

  for (const token of left) {
    if (right.has(token)) overlap += 1;
  }

  const union = left.size + right.size - overlap;
  if (union <= 0) return 0;
  return overlap / union;
}

function overlapCoefficient(leftTokens, rightTokens) {
  if (!leftTokens.length || !rightTokens.length) return 0;
  const left = new Set(leftTokens);
  const right = new Set(rightTokens);
  let overlap = 0;

  for (const token of left) {
    if (right.has(token)) overlap += 1;
  }

  const denominator = Math.min(left.size, right.size);
  if (denominator <= 0) return 0;
  return overlap / denominator;
}

function blendedTokenSimilarity(leftTokens, rightTokens) {
  return (
    (jaccardSimilarity(leftTokens, rightTokens) + overlapCoefficient(leftTokens, rightTokens)) / 2
  );
}

function buildBaseSqlTokenVariants(token) {
  const normalized = normalizeSqlTerm(token);
  if (!normalized) return [];

  const variants = new Set([normalized]);
  if (/\d\.\d/u.test(normalized)) {
    variants.add(normalized.replace(/(\d)\.(\d)/gu, '$1,$2'));
  }
  if (/\d,\d/u.test(normalized)) {
    variants.add(normalized.replace(/(\d),(\d)/gu, '$1.$2'));
  }

  return [...variants];
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

function mergeCandidates(...candidateGroups) {
  const merged = new Map();

  for (const group of candidateGroups) {
    if (!Array.isArray(group)) continue;

    for (const candidate of group) {
      if (!candidate) continue;
      const candidateId = Number(candidate.id);
      const key = Number.isFinite(candidateId)
        ? candidateId
        : `${candidate.name || ''}:${merged.size}`;
      if (!merged.has(key)) {
        merged.set(key, candidate);
      }
    }
  }

  return [...merged.values()];
}

module.exports = {
  TRADE_NAME_ABBREV_TOKEN_ALIASES,
  escapeLikePattern,
  normalizeSqlTerm,
  normalizeLatinHomoglyphs,
  buildNormalizedNameExpr,
  buildNormalizedColumnExpr,
  blendedTokenSimilarity,
  buildBaseSqlTokenVariants,
  buildLikeAnyPredicates,
  buildLikeAnyCondition,
  mergeCandidates,
};
