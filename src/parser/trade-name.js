const { transliterateLatinToCyrillic } = require('../medicine-fuzzy-search');
const { extractVendorCountryFromTokens } = require('../vendor-country');
const {
  MEDICINE_DESCRIPTOR_TOKENS,
  MEDICINE_FORM_TOKENS,
  MEDICINE_UNIT_TOKENS,
} = require('../medicine-name-profile');
const { collectAnnotationNoiseTokens } = require('./annotations');
const { PARSER_NOISE_TOKENS } = require('./constants');
const { isDuplicateTotalStrengthMarker } = require('./measurements');
const { normalizeTradeNameAbbrevToken } = require('./normalization');

function isMeaningfulTradeNameWordToken(token, consumedIndexes = null, index = null) {
  if (token?.type !== 'WORD') return false;
  if (consumedIndexes && index != null && consumedIndexes.has(index)) return false;

  const normalizedToken = token.normalizedValue || '';
  if (!normalizedToken) return false;

  return (
    !MEDICINE_DESCRIPTOR_TOKENS.has(normalizedToken) &&
    !MEDICINE_FORM_TOKENS.has(normalizedToken) &&
    (!MEDICINE_UNIT_TOKENS.has(normalizedToken) || normalizedToken === 'м') &&
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

function normalizeTradeNameTokens(tokens) {
  return tokens.flatMap((token) =>
    normalizeTradeNameAbbrevToken(token).split(/\s+/u).filter(Boolean),
  );
}

function normalizeCottonTradeTokens(tokens) {
  if (!tokens.includes('вата')) return tokens;
  const filtered = tokens
    .map((token) => {
      if (/^нестерильн/u.test(token)) return 'нестер';
      if (/^стерильн/u.test(token)) return 'стер';
      return token;
    })
    .filter((token) => token !== 'мед' && token !== 'гигиеническая');
  if (
    filtered.includes('гигр') ||
    (!filtered.includes('стер') && !filtered.includes('нестер'))
  ) {
    return filtered;
  }

  const cottonIndex = filtered.indexOf('вата');
  return [
    ...filtered.slice(0, cottonIndex + 1),
    'гигр',
    ...filtered.slice(cottonIndex + 1),
  ];
}

function normalizeWetWipesTradeTokens(tokens) {
  if (!tokens.includes('салфетки') || !tokens.some((token) => token.startsWith('влаж'))) {
    return tokens;
  }

  const rest = tokens.filter(
    (token) =>
      token !== 'салфетки' &&
      !token.startsWith('влаж') &&
      token !== 'гигиенические' &&
      token !== 'гигиеническая',
  );
  return ['салфетки', 'влажные', ...rest];
}

function collectTradeNameEntries(tokens, state) {
  const tradeNameEntries = [];
  for (let index = 0; index < tokens.length; index += 1) {
    if (state.hasConsumed(index)) continue;

    const token = tokens[index];
    if (token.type === 'WORD') {
      const normalizedToken = token.normalizedValue || '';
      if (isMeaningfulTradeNameWordToken(token)) {
        tradeNameEntries.push({ index, value: normalizedToken, isTradeName: true });
      } else if (!normalizedToken && token.value.length === 1) {
        tradeNameEntries.push({ index, value: token.value, isTradeName: false });
      }
      continue;
    }

    if (token.type === 'CONTAINER' || token.type === 'DOSAGE_FORM') continue;

    if (token.type === 'NUMBER') {
      if (isDuplicateTotalStrengthMarker(tokens, index, state.strengthCandidates)) {
        state.setRole(index, 'strength');
      } else if (shouldKeepNumberAsBrandToken(tokens, index, state.consumedIndexes)) {
        tradeNameEntries.push({ index, value: token.value, isTradeName: true });
      }
    }
  }
  return tradeNameEntries;
}

function buildTradeIdentityTokens(tradeNameEntries, state) {
  const tradeNameIndexes = new Set(
    tradeNameEntries.filter((entry) => entry.isTradeName).map((entry) => entry.index),
  );
  const tokens = [];
  for (const entry of tradeNameEntries) {
    if (entry.isTradeName) {
      tokens.push(entry.value);
      state.setRole(entry.index, 'trade_name');
    } else if (
      tradeNameIndexes.has(entry.index - 1) ||
      tradeNameIndexes.has(entry.index + 1)
    ) {
      tokens.push(entry.value);
      state.setRole(entry.index, 'trade_name');
    }
  }
  return tokens;
}

function removableAnnotationTokens(annotationNoiseTokens, tradeIdentityTokens) {
  const removable = new Set();
  if (!annotationNoiseTokens.size) return removable;

  const seenTokens = new Set();
  const duplicateTokens = new Set();
  for (const token of tradeIdentityTokens) {
    if (seenTokens.has(token)) duplicateTokens.add(token);
    else seenTokens.add(token);
  }
  for (const token of annotationNoiseTokens) {
    if (!duplicateTokens.has(token)) removable.add(token);
  }
  return removable;
}

function addCottonSterilityToken(tokens, normalizedText) {
  if (
    !tokens.includes('вата') ||
    tokens.some((token) => /^стер|^нестер/u.test(token))
  ) {
    return;
  }
  if (/(?<![а-яёa-z0-9])нестерильн[а-яё.]*(?![а-яёa-z0-9])/iu.test(normalizedText)) {
    tokens.push('нестерильн');
  } else if (/(?<![а-яёa-z0-9])стерильн[а-яё.]*(?![а-яёa-z0-9])/iu.test(normalizedText)) {
    tokens.push('стерильн');
  }
}

function filterOphthalmicSolutionDescriptorTokens(tokens, state, normalizedText) {
  if (
    state.dosageForm !== 'drops' ||
    !/офтальмолог/u.test(normalizedText || '') ||
    !/(?:р\s*-\s*р|раствор)/u.test(normalizedText || '')
  ) {
    return tokens;
  }

  return tokens.filter((token) => !/^(?:стер|стерильн|офтальмолог)/u.test(token));
}

function clearRemovedTradeNameRoles(state, tokens, removedTokens) {
  if (!removedTokens.size) return;
  for (const [tokenIndex, role] of state.tokenRoles) {
    if (role !== 'trade_name') continue;
    const value = tokens[tokenIndex]?.normalizedValue;
    if (value && removedTokens.has(value)) state.clearRole(tokenIndex);
  }
}

function dedupeMixedScriptTokens(tokens) {
  const cyrillicTokenSet = new Set(
    tokens.filter((token) => /[\u0400-\u04ff]/u.test(token)),
  );
  return tokens.filter((token) => {
    if (/[\u0400-\u04ff]/u.test(token)) return true;
    return !cyrillicTokenSet.has(transliterateLatinToCyrillic(token));
  });
}

function extractTradeIdentity({ state, tokens, rawQuery, normalizedText }) {
  const tradeIdentityTokens = buildTradeIdentityTokens(
    collectTradeNameEntries(tokens, state),
    state,
  );
  const {
    canonical: vendorCountry,
    matchedTokens: vendorCountryTokens,
    remainingTokens,
  } = extractVendorCountryFromTokens([...new Set(tradeIdentityTokens)]);
  const removedAnnotationTokens = removableAnnotationTokens(
    collectAnnotationNoiseTokens(rawQuery),
    tradeIdentityTokens,
  );
  let filteredTokens = removedAnnotationTokens.size
    ? remainingTokens.filter((token) => !removedAnnotationTokens.has(token))
    : remainingTokens;

  filteredTokens = filterOphthalmicSolutionDescriptorTokens(
    filteredTokens,
    state,
    normalizedText,
  );
  addCottonSterilityToken(filteredTokens, normalizedText);
  clearRemovedTradeNameRoles(state, tokens, removedAnnotationTokens);

  const tradeNameTokens = normalizeWetWipesTradeTokens(
    normalizeCottonTradeTokens(
      normalizeTradeNameTokens(dedupeMixedScriptTokens(filteredTokens)),
    ),
  );
  return { tradeNameTokens, vendorCountry, vendorCountryTokens };
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
  extractTradeIdentity,
  normalizeTradeNameTokens,
  recoverHyphenatedEnemaTradeName,
};
