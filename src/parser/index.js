const {
  ORAL_SOLID_FORMS_WITH_IMPLICIT_MG,
  SIZE_CONTEXT_TOKENS,
  SYRINGE_RE,
} = require('./constants');
const { normalizeMedicineQuery } = require('./normalization');
const {
  inferBareKapDosageForm,
  tokenizeNormalizedQuery,
} = require('./tokenizer');
const {
  buildMeasurementNode,
  buildSimpleStrengthNode,
  finalizePublicMeasurements,
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
  extractTradeIdentity,
  normalizeTradeNameTokens,
  recoverHyphenatedEnemaTradeName,
} = require('./trade-name');
const { ParseState } = require('./state');

const PULMICORT_AMPOULE_RE = /пульмикорт/iu;
const AMPOULE_SUSPENSION_SIGNAL_RE = /амп|небул|сусп/iu;

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

  const normalizedTradeNameTokens = normalizeTradeNameTokens(tradeNameTokens);
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
  const isSyringeProduct = productType === 'device' && SYRINGE_RE.test(normalizedText);
  const baseFullTradeNameTokens =
    (tradeNameTokens.length && productType !== 'device') || !fullTradeName
      ? normalizedTradeNameTokens
      : normalizeTradeNameTokens(fullTradeName.split(/\s+/u).filter(Boolean));
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
      volumes: isCottonProduct || isSyringeProduct ? volumes : [],
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
  const residue = extractTradeIdentity({ state, tokens, rawQuery, normalizedText });
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
