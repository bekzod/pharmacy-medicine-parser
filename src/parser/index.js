const { transliterateLatinToCyrillic } = require('../medicine-fuzzy-search');
const { extractVendorCountryFromTokens } = require('../vendor-country');
const {
  ORAL_SOLID_FORMS_WITH_IMPLICIT_MG,
  SIZE_CONTEXT_TOKENS,
} = require('./constants');
const {
  normalizeMedicineQuery,
  normalizeTradeNameAbbrevToken,
} = require('./normalization');
const {
  inferBareKapDosageForm,
  tokenizeNormalizedQuery,
} = require('./tokenizer');
const { collectAnnotationNoiseTokens } = require('./annotations');
const {
  buildMeasurementNode,
  buildSimpleStrengthNode,
  finalizePublicMeasurements,
  isDuplicateTotalStrengthMarker,
  parseExplicitMeasurementCandidates,
} = require('./measurements');
const {
  inferImplicitMedicineAttributes,
  normalizeExplicitMeasurementCandidates,
} = require('./inference');
const {
  classifyProductType,
  isBrandOnlyProductType,
} = require('./product-type');
const {
  isMeaningfulTradeNameWordToken,
  recoverHyphenatedEnemaTradeName,
  shouldKeepNumberAsBrandToken,
} = require('./trade-name');
const { ParseState } = require('./state');

const PULMICORT_AMPOULE_RE = /пульмикорт/iu;
const AMPOULE_SUSPENSION_SIGNAL_RE = /амп|небул|сусп/iu;

function normalizeTradeNameAbbrevTokens(tokens) {
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

function normalizeSizeContextTokens(tokens) {
  for (let index = 1; index < tokens.length; index += 1) {
    const token = tokens[index];
    const previous = tokens[index - 1];
    if (
      token?.type === 'UNIT' &&
      token.normalizedValue === 'л' &&
      SIZE_CONTEXT_TOKENS.has(previous?.normalizedValue || previous?.value)
    ) {
      tokens[index] = {
        value: 'l',
        normalizedValue: 'l',
        start: token.start,
        end: token.end,
        type: 'WORD',
      };
    }
  }
}

function isInsideParenthetical(text, index) {
  let depth = 0;
  for (let i = 0; i < index; i += 1) {
    const char = text[i];
    if (char === '(' || char === '[' || char === '{') depth += 1;
    if ((char === ')' || char === ']' || char === '}') && depth > 0) depth -= 1;
  }
  return depth > 0;
}

function extractRawPackCounts(rawQuery, state) {
  let hasRawPackMultiplier = false;
  const text = String(rawQuery || '');
  let outsidePackCount = null;
  let parentheticalPackCount = null;

  for (const match of text.matchAll(/№\s*(\d+)(?:\s*[хx×]\s*(\d+))?/giu)) {
    const left = Number.parseInt(match[1], 10);
    const right = match[2] == null ? null : Number.parseInt(match[2], 10);
    if (!Number.isFinite(left) || left <= 0) continue;
    if (right != null && (!Number.isFinite(right) || right <= 0)) continue;
    if (right != null) hasRawPackMultiplier = true;

    const packCount = right == null ? left : left * right;
    if (isInsideParenthetical(text, match.index || 0)) {
      if (parentheticalPackCount == null) parentheticalPackCount = packCount;
    } else {
      outsidePackCount = packCount;
    }
  }

  if (outsidePackCount != null) state.setPackCount(outsidePackCount);
  else if (parentheticalPackCount != null) state.setPackCount(parentheticalPackCount);
  return hasRawPackMultiplier;
}

function isAmpouleInhalationRouteToken(tokens, index) {
  const token = tokens[index];
  return (
    token?.type === 'DOSAGE_FORM' &&
    token.dosageForm === 'inhaler' &&
    tokens[index + 1]?.type === 'SLASH' &&
    tokens[index + 2]?.type === 'DOSAGE_FORM' &&
    tokens[index + 2].dosageForm === 'injection' &&
    tokens[index + 2].containerType === 'ampoule'
  );
}

function parsePackContainerAndFormPass(tokens, state, hasRawPackMultiplier) {
  for (let index = 0; index < tokens.length; index += 1) {
    let token = tokens[index];

    const inferredBareKapDosageForm = inferBareKapDosageForm(tokens, index, state.packCount);
    if (inferredBareKapDosageForm) {
      token = {
        ...token,
        type: 'DOSAGE_FORM',
        ...inferredBareKapDosageForm,
        containerType: null,
      };
      tokens[index] = token;
    }

    if (token.type === 'COUNT_MARKER') {
      const nextToken = tokens[index + 1];
      if (
        nextToken?.type === 'NUMBER' &&
        Number.isFinite(nextToken.numericValue) &&
        Number.isInteger(nextToken.numericValue) &&
        nextToken.numericValue > 0
      ) {
        state.setPackCount(nextToken.numericValue, { onlyIfEmpty: true });
        state.consume(index, 'pack');
        state.consume(index + 1, 'pack');
        index += 1;
        continue;
      }
      state.consume(index, 'pack');
      continue;
    }

    if (token.type === 'COUNT_MULTIPLIER') {
      const nextToken = tokens[index + 1];
      if (nextToken?.type === 'UNIT') {
        state.addVolume(
          buildMeasurementNode(
            { value: token.normalizedValue, normalizedValue: null },
            { normalizedValue: nextToken.normalizedValue },
            index,
            index + 1,
          ),
        );
        state.consume(index, 'volume');
        state.consume(index + 1, 'volume');
        index += 1;
        continue;
      }
      if (
        state.dosageForm &&
        ORAL_SOLID_FORMS_WITH_IMPLICIT_MG.has(state.dosageForm) &&
        Number.isFinite(token.right) &&
        token.right >= 100
      ) {
        state.addStrength(buildSimpleStrengthNode([token.right], 'мг', index, index));
        state.consume(index, 'strength');
        continue;
      }
      if (state.packCount == null && Number.isFinite(token.count) && token.count > 0) {
        state.setPackCount(token.count);
      }
      state.consume(index, 'pack');
      continue;
    }

    if (hasRawPackMultiplier && token.type === 'WORD' && /^x\d+$/u.test(token.value)) {
      state.consume(index, 'pack');
      continue;
    }

    if (token.type === 'DOSAGE_FORM') {
      if (isAmpouleInhalationRouteToken(tokens, index)) {
        state.consume(index, 'route');
        continue;
      }

      state.considerDosageFormToken(token);

      if (token.containerType) state.setContainerType(token.containerType);

      state.consume(index, 'dosage_form');
      continue;
    }

    if (token.type === 'CONTAINER') {
      state.setContainerType(token.containerType);
      state.consume(index, 'container');
    }
  }
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

function buildResidueTokens(tradeNameEntries, state) {
  const tradeNameIndexes = new Set(
    tradeNameEntries.filter((entry) => entry.isTradeName).map((entry) => entry.index),
  );
  const residueTokens = [];
  for (const entry of tradeNameEntries) {
    if (entry.isTradeName) {
      residueTokens.push(entry.value);
      state.setRole(entry.index, 'trade_name');
    } else if (tradeNameIndexes.has(entry.index - 1) || tradeNameIndexes.has(entry.index + 1)) {
      residueTokens.push(entry.value);
      state.setRole(entry.index, 'trade_name');
    }
  }
  return residueTokens;
}

function removableAnnotationTokens(annotationNoiseTokens, residueTokens) {
  const removable = new Set();
  if (!annotationNoiseTokens.size) return removable;

  const seenResidueTokens = new Set();
  const duplicateResidueTokens = new Set();
  for (const token of residueTokens) {
    if (seenResidueTokens.has(token)) duplicateResidueTokens.add(token);
    else seenResidueTokens.add(token);
  }
  for (const token of annotationNoiseTokens) {
    if (!duplicateResidueTokens.has(token)) removable.add(token);
  }
  return removable;
}

function addCottonSterilityToken(filteredResidueTokens, normalizedText) {
  if (
    !filteredResidueTokens.includes('вата') ||
    filteredResidueTokens.some((token) => /^стер|^нестер/u.test(token))
  ) {
    return;
  }
  if (/(?<![а-яёa-z0-9])нестерильн[а-яё.]*(?![а-яёa-z0-9])/iu.test(normalizedText)) {
    filteredResidueTokens.push('нестерильн');
  } else if (/(?<![а-яёa-z0-9])стерильн[а-яё.]*(?![а-яёa-z0-9])/iu.test(normalizedText)) {
    filteredResidueTokens.push('стерильн');
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

function extractTradeNameResidue({ state, tokens, rawQuery, normalizedText }) {
  const residueTokens = buildResidueTokens(collectTradeNameEntries(tokens, state), state);
  const {
    canonical: vendorCountry,
    matchedTokens: vendorCountryTokens,
    remainingTokens: tradeNameResidueTokens,
  } = extractVendorCountryFromTokens([...new Set(residueTokens)]);
  const removableAnnotationNoiseTokens = removableAnnotationTokens(
    collectAnnotationNoiseTokens(rawQuery),
    residueTokens,
  );
  let filteredResidueTokens = removableAnnotationNoiseTokens.size
    ? tradeNameResidueTokens.filter((token) => !removableAnnotationNoiseTokens.has(token))
    : tradeNameResidueTokens;

  filteredResidueTokens = filterOphthalmicSolutionDescriptorTokens(
    filteredResidueTokens,
    state,
    normalizedText,
  );
  addCottonSterilityToken(filteredResidueTokens, normalizedText);

  if (removableAnnotationNoiseTokens.size) {
    for (const [tokenIndex, role] of state.tokenRoles) {
      if (role !== 'trade_name') continue;
      const value = tokens[tokenIndex]?.normalizedValue;
      if (value && removableAnnotationNoiseTokens.has(value)) state.clearRole(tokenIndex);
    }
  }

  const cyrillicTokenSet = new Set(filteredResidueTokens.filter((t) => /[\u0400-\u04ff]/u.test(t)));
  const tradeNameTokens = normalizeWetWipesTradeTokens(normalizeCottonTradeTokens(
    normalizeTradeNameAbbrevTokens(filteredResidueTokens.filter((token) => {
      if (/[\u0400-\u04ff]/u.test(token)) return true;
      const transliterated = transliterateLatinToCyrillic(token);
      return !cyrillicTokenSet.has(transliterated);
    })),
  ));

  return { tradeNameTokens, vendorCountry, vendorCountryTokens };
}

function stripPackMultipliersFromTradeName(fullTradeName, state, tokens) {
  if (!fullTradeName) return fullTradeName;
  let stripped = fullTradeName;
  for (const [idx, role] of state.tokenRoles) {
    if (role === 'pack' && tokens[idx]?.type === 'COUNT_MULTIPLIER') {
      const v = tokens[idx].normalizedValue || tokens[idx].value;
      if (v) stripped = stripped.replace(v, '').replace(/\s+/gu, ' ').trim();
    }
  }
  return stripped;
}

function dropPackagedOtherProductSizeNumbers(tokens) {
  return tokens.filter((token, index) => {
    const previous = tokens[index - 1];
    const value = Number.parseFloat(token);
    return !(
      SIZE_CONTEXT_TOKENS.has(previous) &&
      Number.isFinite(value) &&
      value > 0 &&
      value <= 20
    );
  });
}

function assembleParsedQuery({
  rawQuery,
  normalizedText,
  tokens,
  state,
  tradeNameTokens,
  dosageFormRoute,
  vendorCountry,
  vendorCountryTokens,
}) {
  const { strengths, volumes } = finalizePublicMeasurements(state, normalizedText);
  let dosageForm = state.dosageForm || null;
  let dosageFormToken = state.dosageFormToken?.normalizedValue || null;
  let dosageFormSource = state.dosageFormSource;
  if (
    dosageForm === 'injection' &&
    PULMICORT_AMPOULE_RE.test(normalizedText) &&
    AMPOULE_SUSPENSION_SIGNAL_RE.test(normalizedText)
  ) {
    dosageForm = 'suspension';
    dosageFormToken = 'сусп';
    dosageFormSource = 'inferred_from_container';
  }
  const productType = classifyProductType(rawQuery, normalizedText, {
    dosageForm,
    strengths,
    volumes,
  });
  if (!tradeNameTokens.length) {
    const recoveredTradeName = recoverHyphenatedEnemaTradeName(tokens);
    if (recoveredTradeName) tradeNameTokens.push(recoveredTradeName);
  }

  const normalizedTradeNameTokens = normalizeTradeNameAbbrevTokens(tradeNameTokens);
  const tradeNameText = normalizedTradeNameTokens.join(' ').trim() || null;
  const parsedQuery = {
    rawQuery: rawQuery || '',
    normalizedText,
    tokens: state.annotatedTokens(),
    residueTokens: tradeNameTokens,
    attributes: {
      trade_name_text: tradeNameText,
      trade_name_tokens: normalizedTradeNameTokens,
      dosage_form: dosageForm,
      dosage_form_token: dosageFormToken,
      dosage_form_source: dosageFormSource,
      dosage_form_route: dosageFormRoute,
      container_type: state.containerType,
      product_type: productType,
      vendor_country_text: vendorCountry,
      vendor_country_tokens: vendorCountryTokens,
      strengths,
      volumes,
      pack_count: state.packCount,
    },
  };

  if (!isBrandOnlyProductType(productType)) return parsedQuery;

  const fullTradeName = stripPackMultipliersFromTradeName(normalizedText || null, state, tokens);
  const isCottonProduct = normalizedTradeNameTokens.includes('вата');
  const baseFullTradeNameTokens =
    (tradeNameTokens.length && productType !== 'device') || !fullTradeName
      ? normalizedTradeNameTokens
      : normalizeTradeNameAbbrevTokens(fullTradeName.split(/\s+/u).filter(Boolean));
  const fullTradeNameTokens =
    productType === 'other' && state.packCount != null
      ? dropPackagedOtherProductSizeNumbers(baseFullTradeNameTokens)
      : baseFullTradeNameTokens;
  return {
    ...parsedQuery,
    residueTokens: fullTradeNameTokens,
    attributes: {
      ...parsedQuery.attributes,
      trade_name_text: isCottonProduct
        ? normalizedTradeNameTokens.join(' ')
        : baseFullTradeNameTokens.join(' ').trim() || null,
      trade_name_tokens: fullTradeNameTokens,
      dosage_form: null,
      dosage_form_token: null,
      dosage_form_source: null,
      dosage_form_route: null,
      container_type: null,
      strengths: isCottonProduct ? strengths : [],
      volumes: isCottonProduct ? volumes : [],
    },
  };
}

function parseMedicineQuery(rawQuery) {
  const normalizedText = normalizeMedicineQuery(rawQuery);
  const tokens = tokenizeNormalizedQuery(normalizedText);
  const state = new ParseState({ rawQuery, normalizedText, tokens });
  normalizeSizeContextTokens(tokens);
  const hasRawPackMultiplier = extractRawPackCounts(rawQuery, state);
  parsePackContainerAndFormPass(tokens, state, hasRawPackMultiplier);
  parseExplicitMeasurementCandidates(tokens, state);

  normalizeExplicitMeasurementCandidates({ state, tokens, rawQuery, normalizedText });
  const residue = extractTradeNameResidue({ state, tokens, rawQuery, normalizedText });
  const dosageFormRoute = inferImplicitMedicineAttributes({
    state,
    rawQuery,
    normalizedText,
    tradeNameTokens: residue.tradeNameTokens,
  });
  return assembleParsedQuery({
    rawQuery,
    normalizedText,
    tokens,
    state,
    dosageFormRoute,
    ...residue,
  });
}

module.exports = {
  parseMedicineQuery,
};
