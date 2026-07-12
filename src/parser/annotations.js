const {
  PAREN_GROUP_RE,
  PARENTHESIZED_VARIANT_TOKENS,
} = require('./constants');
const { tokenizeMedicineQuery } = require('./tokenizer');

const PREFILLED_ANNOTATION_WORDS = new Set(['запол']);

function isPlainAnnotationToken(token) {
  return (
    (token?.type === 'WORD' && token.normalizedValue) ||
    (token?.type === 'NUMBER' && Number.isFinite(token.numericValue))
  );
}

// Wholesale listings sometimes write "<short code> (<active ingredient>)", e.g.
// "ПЕО (цефтриаксон)" — the parenthesized ingredient is the product's real
// identity and must be kept, not treated as noise. Short variant tags like
// "форте" are handled separately by PARENTHESIZED_VARIANT_TOKENS. We approximate
// the case as a short (2-3 char) leading code followed by a single longer
// Cyrillic word.
function isSingleCyrillicWord(tokens) {
  return (
    tokens.length === 1 &&
    tokens[0]?.type === 'WORD' &&
    /^[а-яё-]{5,}$/iu.test(tokens[0].normalizedValue || tokens[0].value || '')
  );
}

function hasShortLeadingBrand(prefixText) {
  const prefixTokens = tokenizeMedicineQuery(prefixText);
  if (prefixTokens.length !== 1 || prefixTokens[0]?.type !== 'WORD') return false;
  const len = (prefixTokens[0].normalizedValue || prefixTokens[0].value || '').length;
  return len >= 2 && len <= 3;
}

function addAnnotationNoiseTokens(noise, annotationText, options = {}) {
  if (!annotationText || !annotationText.trim()) return;

  const annotationTokens = tokenizeMedicineQuery(annotationText);
  if (!annotationTokens.length) return;

  for (const token of annotationTokens) {
    const value = token?.normalizedValue || token?.value;
    if (PREFILLED_ANNOTATION_WORDS.has(value)) noise.add(value);
  }

  if (annotationTokens.every(isPlainAnnotationToken)) {
    if (
      options.leadingPrefix !== undefined &&
      isSingleCyrillicWord(annotationTokens) &&
      hasShortLeadingBrand(options.leadingPrefix)
    ) {
      return;
    }

    for (const token of annotationTokens) {
      const value = token.normalizedValue || token.value;
      if (!PARENTHESIZED_VARIANT_TOKENS.has(value)) {
        noise.add(value);
        if (token.value && token.value !== value) noise.add(token.value);
      }
    }
    return;
  }

  const hasDosageSignal = annotationTokens.some(
    (token) => token?.type === 'UNIT' || token?.type === 'PERCENT',
  );
  if (!hasDosageSignal) return;

  for (const token of annotationTokens) {
    if (token?.type !== 'WORD' || !token.normalizedValue) continue;
    if (!PARENTHESIZED_VARIANT_TOKENS.has(token.normalizedValue)) {
      noise.add(token.normalizedValue);
    }
  }
}

function addInlineSprayFlavorNoiseTokens(noise, rawText) {
  for (const match of String(rawText || '').matchAll(
    /спре[йя][\s\S]*?со\s+вкус(?:ом|\.?)\s+([\p{L}\s-]+?)(?=\d|\s+\d|$)/giu,
  )) {
    for (const token of tokenizeMedicineQuery(match[1])) {
      if (token?.type !== 'WORD') continue;
      if (token.normalizedValue) noise.add(token.normalizedValue);
      if (token.value) noise.add(token.value);
    }
  }
}

// Collect normalized tokens from annotation-like spans. These spans are treated
// as noise only when they contain plain WORD/NUMBER tokens and no dosage,
// pack, measurement, slash, or multiplier signals. Country names can be added
// here; extractVendorCountryFromTokens re-extracts them before this filter runs.
function collectAnnotationNoiseTokens(rawQuery) {
  const text = String(rawQuery || '');
  const noise = new Set();
  if (!text) return noise;

  PAREN_GROUP_RE.lastIndex = 0;
  for (const match of text.matchAll(PAREN_GROUP_RE)) {
    addAnnotationNoiseTokens(noise, match[1], {
      leadingPrefix: text.slice(0, match.index),
    });
  }

  let suffix = '';
  for (const match of text.matchAll(/№\s*\d+(?:\s*[хx×]\s*\d+)?/giu)) {
    suffix = text.slice((match.index || 0) + match[0].length);
  }
  addAnnotationNoiseTokens(noise, suffix);

  addInlineSprayFlavorNoiseTokens(noise, text.replace(/\([^)]*\)/gu, ' '));

  return noise;
}

module.exports = {
  collectAnnotationNoiseTokens,
};
