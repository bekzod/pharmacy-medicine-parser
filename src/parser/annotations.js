const {
  PAREN_GROUP_RE,
  PARENTHESIZED_VARIANT_TOKENS,
} = require('./constants');
const { tokenizeMedicineQuery } = require('./tokenizer');

function isPlainAnnotationToken(token) {
  return (
    (token?.type === 'WORD' && token.normalizedValue) ||
    (token?.type === 'NUMBER' && Number.isFinite(token.numericValue))
  );
}

function addAnnotationNoiseTokens(noise, annotationText) {
  if (!annotationText || !annotationText.trim()) return;

  const annotationTokens = tokenizeMedicineQuery(annotationText);
  if (!annotationTokens.length || !annotationTokens.every(isPlainAnnotationToken)) return;

  for (const token of annotationTokens) {
    const value = token.normalizedValue || token.value;
    if (!PARENTHESIZED_VARIANT_TOKENS.has(value)) noise.add(value);
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

  if (text.includes('(')) {
    PAREN_GROUP_RE.lastIndex = 0;
    let match;
    while ((match = PAREN_GROUP_RE.exec(text)) !== null) {
      addAnnotationNoiseTokens(noise, match[1]);
    }
  }

  if (text.includes('№')) {
    let suffix = '';
    for (const match of text.matchAll(/№\s*\d+(?:\s*[хx×]\s*\d+)?/giu)) {
      suffix = text.slice((match.index || 0) + match[0].length);
    }
    addAnnotationNoiseTokens(noise, suffix);
  }

  return noise;
}

module.exports = {
  collectAnnotationNoiseTokens,
};
