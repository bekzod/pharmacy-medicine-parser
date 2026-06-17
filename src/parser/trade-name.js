const {
  MEDICINE_DESCRIPTOR_TOKENS,
  MEDICINE_FORM_TOKENS,
  MEDICINE_UNIT_TOKENS,
} = require('../medicine-name-profile');
const { PARSER_NOISE_TOKENS } = require('./constants');

function isMeaningfulTradeNameWordToken(token, consumedIndexes = null, index = null) {
  if (token?.type !== 'WORD') return false;
  if (consumedIndexes && index != null && consumedIndexes.has(index)) return false;

  const normalizedToken = token.normalizedValue || '';
  if (!normalizedToken) return false;
  const restoredStandaloneMeterSuffix = normalizedToken === 'м';

  return (
    !MEDICINE_DESCRIPTOR_TOKENS.has(normalizedToken) &&
    !MEDICINE_FORM_TOKENS.has(normalizedToken) &&
    (!MEDICINE_UNIT_TOKENS.has(normalizedToken) || restoredStandaloneMeterSuffix) &&
    !PARSER_NOISE_TOKENS.has(normalizedToken)
  );
}

function shouldKeepNumberAsBrandToken(tokens, index, consumedIndexes) {
  if (consumedIndexes.has(index)) return false;

  const previous = tokens[index - 1];
  const next = tokens[index + 1];
  const previousValue = String(previous?.normalizedValue || previous?.value || '').toLowerCase();
  if (
    previous?.type === 'WORD' &&
    /^(р|раз|разм|размер)$/u.test(previousValue) &&
    Number.isFinite(tokens[index]?.numericValue) &&
    tokens[index].numericValue > 0 &&
    tokens[index].numericValue <= 20
  ) {
    return true;
  }
  const hasMeaningfulPrevious = isMeaningfulTradeNameWordToken(
    previous,
    consumedIndexes,
    index - 1,
  );
  const hasMeaningfulNext = isMeaningfulTradeNameWordToken(next, consumedIndexes, index + 1);

  if (next?.type === 'WORD' && !hasMeaningfulNext) return false;
  return hasMeaningfulPrevious || hasMeaningfulNext;
}

function recoverHyphenatedEnemaTradeName(tokens) {
  const firstToken = tokens?.[0];
  if (!firstToken || firstToken.type !== 'DOSAGE_FORM' || firstToken.dosageForm !== 'enema') {
    return null;
  }

  const value = String(firstToken.normalizedValue || firstToken.value || '').toLowerCase();
  if (!value.includes('-')) return null;

  const [leadingToken] = value.split('-').filter(Boolean);
  return leadingToken && leadingToken.length >= 2 ? leadingToken : null;
}

module.exports = {
  isMeaningfulTradeNameWordToken,
  shouldKeepNumberAsBrandToken,
  recoverHyphenatedEnemaTradeName,
};
