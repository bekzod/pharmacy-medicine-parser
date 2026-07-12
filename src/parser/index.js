const { transliterateLatinToCyrillic } = require('../medicine-fuzzy-search');
const { extractVendorCountryFromTokens } = require('../vendor-country');
const {
  COUNT_BEFORE_FORM_DOSAGE_FORMS,
  SIZE_CONTEXT_TOKENS,
  UNIT_FAMILY_BY_VALUE,
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
  buildCombinationStrengthCandidate,
  buildMeasurementNode,
  buildMeasurementNodeFromStrength,
  buildMultiComponentRatioStrength,
  buildPercentStrengthNode,
  buildPlusSeparatedSharedDenominatorRatioStrength,
  buildPlusSeparatedSharedUnitStrength,
  buildRatioStrengthNode,
  buildSimpleStrengthNode,
  buildStrengthNode,
  dedupePublicNodes,
  inferInhalationPerDoseStrengths,
  inferDropsMassPackageRatio,
  inferDropsMassPerMlStrengths,
  inferCompactPlusSharedDenominatorRatios,
  inferLiquidPlusMlComponentTypo,
  inferLiquidActivityUnitPackageRatio,
  inferMeteredDoseStrengths,
  inferOralLiquidVolumeFromDoseCount,
  inferTopicalDoseUnitPerGramStrength,
  isDuplicateTotalStrengthMarker,
  mergeSameUnitSlashStrength,
  simplifyInhalationDoseRatios,
  splitTopicalPackageMassRatios,
  toPublicMeasurementNode,
  toPublicStrengthNode,
} = require('./measurements');
const {
  ORAL_SOLID_FORMS_WITH_IMPLICIT_MG,
  detectDosageFormRoute,
  findSolventClauseStartIndex,
  hasPrefilledSyringeSignal,
  hasRepeatedStrengthNumberLater,
  inferMultiValuePerDoseStrength,
  inferOralRouteFromLiquidDose,
  fixExplicitKnownGramUnitTypos,
  fixExplicitOralSolidGramShorthand,
  fixExplicitRatioGramShorthand,
  fixKnownRatioMgToGram,
  fixSolutionPerGramDenominatorTypo,
  isSolventVolumeCandidate,
  maybeAddRatioDenominatorPackageVolume,
  maybeInferEnzymeActivityStrength,
  maybeInferLiquidPackageVolume,
  maybeInferOralLiquidSpacedDoseRatio,
  maybeInferOralSolidStrength,
  maybeInferInjectableSpacedDoseRatio,
  maybeInferPowderGramStrength,
  maybeInferPowderMilligramStrength,
  maybeInferConcentratePerMlStrength,
  maybeInferPackageDenominatorPerMlTypo,
  maybeInferRatioDenominatorPackageVolume,
  maybeInferTrailingOralSolidPackCount,
  maybeInferVitaminDStrength,
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

const PRECISE_STRENGTH_UNITS = new Set(['мг', 'мкг', '%']);
const MASS_PACKAGE_FORMS = new Set(['cream', 'ointment', 'gel', 'paste', 'drops', 'aerosol']);
const DOSE_UNITS = new Set(['ед', 'ме']);
const MASS_STRENGTH_UNITS = new Set(['мкг', 'мг', 'г']);
const PULMICORT_AMPOULE_RE = /пульмикорт/iu;
const AMPOULE_SUSPENSION_SIGNAL_RE = /амп|небул|сусп/iu;

const STRENGTH_CANDIDATE_RULES = [
  buildCombinationStrengthCandidate,
  buildPlusSeparatedSharedDenominatorRatioStrength,
  buildPercentStrengthNode,
  buildPlusSeparatedSharedUnitStrength,
  buildMultiComponentRatioStrength,
];

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

function buildDimensionVolumeNode(tokens, index) {
  const token = tokens[index];
  if (
    tokens[index + 1]?.type !== 'UNIT' ||
    UNIT_FAMILY_BY_VALUE.get(tokens[index + 1].normalizedValue) !== 'length' ||
    tokens[index + 2]?.type !== 'WORD' ||
    (tokens[index + 2].normalizedValue !== 'х' && tokens[index + 2].normalizedValue !== 'x') ||
    tokens[index + 3]?.type !== 'NUMBER' ||
    tokens[index + 4]?.type !== 'UNIT' ||
    UNIT_FAMILY_BY_VALUE.get(tokens[index + 4].normalizedValue) !== 'length'
  ) {
    return null;
  }

  return {
    text: `${token.value} ${tokens[index + 1].normalizedValue} х ${tokens[index + 3].value} ${tokens[index + 4].normalizedValue}`,
    value: Number.parseFloat(token.value),
    unit: tokens[index + 1].normalizedValue,
    dimension2: {
      value: Number.parseFloat(tokens[index + 3].value),
      unit: tokens[index + 4].normalizedValue,
    },
    startIndex: index,
    endIndex: index + 4,
  };
}

function applyCandidateRule(state, node, role) {
  if (role === 'strength') state.addStrength(node);
  else state.addVolume(node);
  state.consumeRange(node.startIndex, node.endIndex, role);
  return node.endIndex;
}

function runCandidateRules(state, tokens, index) {
  for (const buildCandidate of STRENGTH_CANDIDATE_RULES) {
    const node = buildCandidate(tokens, index);
    if (node) return applyCandidateRule(state, node, 'strength');
  }
  return null;
}

function maybeConsumePackBeforeContainerOrForm(tokens, state, index) {
  const token = tokens[index];
  if (
    state.packCount == null &&
    tokens[index + 1]?.type === 'CONTAINER' &&
    tokens[index + 1].containerType === 'sachet' &&
    Number.isFinite(token.numericValue) &&
    Number.isInteger(token.numericValue) &&
    token.numericValue > 0
  ) {
    state.setPackCount(token.numericValue);
    state.consume(index, 'pack');
    return true;
  }

  if (
    state.packCount == null &&
    tokens[index + 1]?.type === 'DOSAGE_FORM' &&
    COUNT_BEFORE_FORM_DOSAGE_FORMS.has(tokens[index + 1].dosageForm) &&
    Number.isFinite(token.numericValue) &&
    Number.isInteger(token.numericValue) &&
    token.numericValue > 0 &&
    !hasRepeatedStrengthNumberLater(tokens, index)
  ) {
    state.setPackCount(token.numericValue);
    state.consume(index, 'pack');
    return true;
  }

  return false;
}

function consumeStrengthOrVolumeNode(tokens, state, index) {
  const strengthNode = buildStrengthNode(tokens, index);
  if (!strengthNode) return null;

  const unitFamily = UNIT_FAMILY_BY_VALUE.get(strengthNode.unit);
  const isDoseCount = strengthNode.kind === 'simple' && strengthNode.unit === 'доз';
  const isVolumeNode =
    strengthNode.kind === 'simple' &&
    (unitFamily === 'volume' || unitFamily === 'length' || isDoseCount);
  if (isDoseCount) {
    const perDoseStrength = inferMultiValuePerDoseStrength(strengthNode, state.strengthCandidates);
    if (perDoseStrength) {
      return applyCandidateRule(state, perDoseStrength, 'strength');
    }
  }

  if (isVolumeNode) {
    const measurementNode = buildMeasurementNodeFromStrength(strengthNode);
    if (measurementNode) state.addVolume(measurementNode);
  } else {
    state.addStrength(strengthNode);
  }

  state.consumeRange(
    strengthNode.startIndex,
    strengthNode.endIndex,
    isVolumeNode ? 'volume' : 'strength',
  );
  return strengthNode.endIndex;
}

function parseExplicitMeasurementsPass(tokens, state) {
  for (let index = 0; index < tokens.length; index += 1) {
    if (state.hasConsumed(index)) continue;

    const token = tokens[index];
    if (token.type !== 'NUMBER') continue;

    const dimensionVolume = buildDimensionVolumeNode(tokens, index);
    if (dimensionVolume) {
      index = applyCandidateRule(state, dimensionVolume, 'volume');
      continue;
    }

    const ruleEndIndex = runCandidateRules(state, tokens, index);
    if (ruleEndIndex != null) {
      index = ruleEndIndex;
      continue;
    }

    if (maybeConsumePackBeforeContainerOrForm(tokens, state, index)) continue;

    const strengthEndIndex = consumeStrengthOrVolumeNode(tokens, state, index);
    if (strengthEndIndex != null) index = strengthEndIndex;
  }
}

function promoteStandalonePackageMasses(state) {
  const hasPreciserStrength = state.strengthCandidates.some(
    (s) =>
      (s.kind === 'ratio' && UNIT_FAMILY_BY_VALUE.get(s.denominator?.unit) === 'volume') ||
      (s.kind === 'ratio' && UNIT_FAMILY_BY_VALUE.get(s.denominator?.unit) === 'mass') ||
      (s.kind === 'ratio' && UNIT_FAMILY_BY_VALUE.get(s.denominator?.unit) === 'dose') ||
      (s.kind === 'simple' && PRECISE_STRENGTH_UNITS.has(s.unit)) ||
      (s.kind === 'combination' && s.components?.some((c) => PRECISE_STRENGTH_UNITS.has(c.unit))),
  );
  const hasMassPackageForm = MASS_PACKAGE_FORMS.has(state.dosageForm);
  if (!hasPreciserStrength && !hasMassPackageForm) return;

  for (let i = state.strengthCandidates.length - 1; i >= 0; i -= 1) {
    const s = state.strengthCandidates[i];
    if (s.kind !== 'simple' || (s.unit !== 'г' && s.unit !== 'л')) continue;
    state.addVolume(buildMeasurementNodeFromStrength(s));
    for (let ci = s.startIndex; ci <= s.endIndex; ci += 1) {
      state.setRole(ci, 'volume');
    }
    state.removeStrength(i);
  }
}

function inferInjectionFromDoseRatio(state) {
  const hasDoseRatioPerMl = state.strengthCandidates.some(
    (s) => s.kind === 'ratio' && DOSE_UNITS.has(s.unit) && s.denominator?.unit === 'мл',
  );
  if (hasDoseRatioPerMl && state.dosageForm !== 'injection' && state.dosageFormSource !== 'explicit') {
    state.dosageForm = 'injection';
    state.dosageFormSource = 'inferred_from_strength';
  }
}

function removeSolventCandidatesAndClause(state, tokens) {
  state.dropCandidates('volume', (v) => isSolventVolumeCandidate(v, tokens));

  const solventClauseStartIndex = findSolventClauseStartIndex(tokens);
  if (solventClauseStartIndex == null) return;

  const isAfterSolventClause = (c) => (c.startIndex ?? 0) >= solventClauseStartIndex;
  state.dropCandidates('strength', isAfterSolventClause);
  state.dropCandidates('volume', isAfterSolventClause);

  for (let index = solventClauseStartIndex; index < tokens.length; index += 1) {
    state.consume(index);
    if (!state.tokenRoles.has(index)) state.setRole(index, 'solvent');
  }
}

function convertSyringeDoseStrengths(state, rawQuery, normalizedText) {
  const hasVolumeMl = state.volumeCandidates.some((v) => v.unit === 'мл');
  const prefilledSyringeSignal = hasPrefilledSyringeSignal(rawQuery, normalizedText);
  const prefilledSyringeMlVolumes = prefilledSyringeSignal
    ? state.volumeCandidates.filter((v) => v.unit === 'мл' && v.value != null)
    : [];
  const denominator =
    prefilledSyringeMlVolumes.length === 1
      ? { value: prefilledSyringeMlVolumes[0].value, endIndex: prefilledSyringeMlVolumes[0].endIndex }
      : hasVolumeMl
        ? { value: null, endIndex: null }
        : null;
  if (!denominator) return;

  for (let i = 0; i < state.strengthCandidates.length; i += 1) {
    const s = state.strengthCandidates[i];
    if (s.kind !== 'simple' || !DOSE_UNITS.has(s.unit)) continue;
    state.replaceStrength(
      i,
      buildRatioStrengthNode(
        s.values,
        s.unit,
        { value: denominator.value, unit: 'мл' },
        s.startIndex,
        denominator.endIndex ?? s.endIndex,
      ),
    );
  }
}

function convertMassStrengthsToPerDoseWhenExplicit(tokens, state) {
  for (let i = 0; i < state.strengthCandidates.length; i += 1) {
    const s = state.strengthCandidates[i];
    if (s.kind !== 'simple' || !MASS_STRENGTH_UNITS.has(s.unit)) continue;

    const connector = tokens[s.endIndex + 1];
    const denominatorNumber = tokens[s.endIndex + 2];
    const denominatorUnit = tokens[s.endIndex + 3];

    if (
      connector?.type === 'WORD' &&
      connector.value === 'по' &&
      denominatorNumber?.type === 'NUMBER' &&
      denominatorUnit?.type === 'UNIT' &&
      denominatorUnit.normalizedValue === 'доз'
    ) {
      state.replaceStrength(
        i,
        buildRatioStrengthNode(
          s.values,
          s.unit,
          { value: null, unit: 'доз' },
          s.startIndex,
          s.endIndex,
        ),
      );
    }
  }
}

function isInjectionOrInfusionContext(state, dosageFormRoute) {
  return ['injection', 'infusion'].includes(state.dosageForm) ||
    ['injection', 'infusion'].includes(dosageFormRoute);
}

function convertInjectableOmittedMassSlashVolume(state, dosageFormRoute) {
  if (!isInjectionOrInfusionContext(state, dosageFormRoute) || state.strengthCandidates.length > 0) return;

  const malformedVolumeIndex = state.volumeCandidates.findIndex(
    (v) =>
      v?.unit === 'мл' &&
      v.value == null &&
      /^(\d+(?:\.\d+)?) мл\/(\d+(?:\.\d+)?) мл$/u.test(v.text || ''),
  );
  if (malformedVolumeIndex === -1) return;

  const malformedVolume = state.volumeCandidates[malformedVolumeIndex];
  const match = malformedVolume.text.match(/^(\d+(?:\.\d+)?) мл\/(\d+(?:\.\d+)?) мл$/u);
  const strengthValue = Number(match[1]);
  const volumeValue = Number(match[2]);
  if (!Number.isFinite(strengthValue) || strengthValue < 100 || !Number.isFinite(volumeValue)) return;

  state.addStrength(
    buildRatioStrengthNode(
      [strengthValue],
      'мг',
      { value: volumeValue, unit: 'мл' },
      malformedVolume.startIndex,
      malformedVolume.endIndex,
    ),
  );
  state.volumeCandidates[malformedVolumeIndex] = {
    text: `${volumeValue} мл`,
    value: volumeValue,
    unit: 'мл',
    startIndex: malformedVolume.startIndex,
    endIndex: malformedVolume.endIndex,
  };
}

function convertInjectableOmittedMassSeparateSlashVolumes(state, tokens, dosageFormRoute) {
  if (!isInjectionOrInfusionContext(state, dosageFormRoute) || state.strengthCandidates.length > 0) return;

  for (let i = 0; i < state.volumeCandidates.length - 1; i += 1) {
    const first = state.volumeCandidates[i];
    const second = state.volumeCandidates[i + 1];
    if (first?.unit !== 'мл' || second?.unit !== 'мл') continue;
    if (tokens[first.endIndex + 1]?.type !== 'SLASH') continue;
    if (second.startIndex !== first.endIndex + 2) continue;
    if (!Number.isFinite(first.value) || first.value < 100) continue;
    if (!Number.isFinite(second.value) || second.value <= 0) continue;

    state.addStrength(
      buildRatioStrengthNode(
        [first.value],
        'мг',
        { value: second.value, unit: 'мл' },
        first.startIndex,
        second.endIndex,
      ),
    );
    state.volumeCandidates.splice(i, 1);
    return;
  }
}

function runStrengthVolumePostProcessing({ state, tokens, rawQuery, normalizedText }) {
  promoteStandalonePackageMasses(state);
  inferInjectionFromDoseRatio(state);
  removeSolventCandidatesAndClause(state, tokens);
  convertSyringeDoseStrengths(state, rawQuery, normalizedText);
  convertMassStrengthsToPerDoseWhenExplicit(tokens, state);
  const dosageFormRoute = detectDosageFormRoute(rawQuery);
  convertInjectableOmittedMassSlashVolume(state, dosageFormRoute);
  convertInjectableOmittedMassSeparateSlashVolumes(state, tokens, dosageFormRoute);
}

function maybePromoteInjectableDenominatorVolumes(state, dosageFormRoute) {
  const isInjectableContext =
    isInjectionOrInfusionContext(state, dosageFormRoute) ||
    (state.dosageForm === 'solution' &&
      state.dosageFormSource === 'inferred_from_container' &&
      state.containerType === 'vial');
  if (!isInjectableContext || state.volumeCandidates.length > 0) return;

  for (const strength of state.strengthCandidates) {
    if (strength.kind !== 'ratio') continue;
    const denominator = strength.denominator;
    if (denominator?.value == null) continue;
    if (UNIT_FAMILY_BY_VALUE.get(denominator.unit) !== 'volume') continue;
    state.addVolume({
      text: `${denominator.value} ${denominator.unit}`,
      value: denominator.value,
      unit: denominator.unit,
      startIndex: strength.startIndex,
      endIndex: strength.endIndex,
    });
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

function runInferencePipeline({ state, rawQuery, normalizedText, tradeNameTokens }) {
  maybeInferVitaminDStrength({ state, tradeNameTokens });
  maybeInferEnzymeActivityStrength({ state, tradeNameTokens });
  maybeInferOralSolidStrength({ state, tradeNameTokens });
  fixExplicitOralSolidGramShorthand({ state, tradeNameTokens });
  fixExplicitKnownGramUnitTypos({ state, tradeNameTokens });
  fixExplicitRatioGramShorthand({ state, tradeNameTokens });
  fixKnownRatioMgToGram({ state, tradeNameTokens });
  maybeAddRatioDenominatorPackageVolume({ state, tradeNameTokens });

  const inferredTrailingPackCount = maybeInferTrailingOralSolidPackCount({ state, tradeNameTokens });
  if (inferredTrailingPackCount != null) state.setPackCount(inferredTrailingPackCount);

  maybeInferOralLiquidSpacedDoseRatio({ state });

  const dosageFormRoute =
    detectDosageFormRoute(rawQuery)
    || inferOralRouteFromLiquidDose(state.dosageForm, state.strengthCandidates);
  maybeInferInjectableSpacedDoseRatio({ state, dosageFormRoute, tradeNameTokens });

  maybeInferPowderMilligramStrength({ state, dosageFormRoute, tradeNameTokens });
  maybeInferPowderGramStrength({ state, tradeNameTokens });
  maybeInferConcentratePerMlStrength({ state, rawQuery, dosageFormRoute, tradeNameTokens });
  maybeInferRatioDenominatorPackageVolume({ state, tradeNameTokens });
  maybeInferPackageDenominatorPerMlTypo({ state, tradeNameTokens });
  fixSolutionPerGramDenominatorTypo({ state, tradeNameTokens });
  maybeInferLiquidPackageVolume({ state });

  if (
    state.packCount == null &&
    state.strengthCandidates.length === 0 &&
    state.volumeCandidates.some((volume) => volume.unit === 'мл') &&
    hasPrefilledSyringeSignal(rawQuery, normalizedText)
  ) {
    state.setPackCount(1);
  }

  maybePromoteInjectableDenominatorVolumes(state, dosageFormRoute);
  return dosageFormRoute;
}

function buildPublicMeasurements(state, normalizedText) {
  let strengths = dedupePublicNodes(
    state.strengthCandidates.map(toPublicStrengthNode).filter(Boolean),
  );
  strengths = fixOralSolidMlStrengthTypo(strengths, state.dosageForm);
  strengths = mergeSameUnitSlashStrength(strengths, normalizedText);
  strengths = inferCompactPlusSharedDenominatorRatios(strengths, normalizedText, state.dosageForm);
  strengths = inferInhalationPerDoseStrengths(strengths, normalizedText, state.dosageForm);
  let volumes = dedupePublicNodes(
    state.volumeCandidates.map(toPublicMeasurementNode).filter(Boolean),
  );
  ({ strengths, volumes } = splitTopicalPackageMassRatios(strengths, volumes, state.dosageForm));
  ({ strengths, volumes } = inferTopicalDoseUnitPerGramStrength(
    strengths,
    volumes,
    state.dosageForm,
  ));
  ({ strengths, volumes } = inferDropsMassPackageRatio(strengths, volumes, state.dosageForm));
  strengths = inferDropsMassPerMlStrengths(strengths, volumes, state.dosageForm);
  strengths = inferLiquidPlusMlComponentTypo(strengths, state.dosageForm, normalizedText);
  ({ strengths, volumes } = inferLiquidActivityUnitPackageRatio(
    strengths,
    volumes,
    state.dosageForm,
    normalizedText,
  ));
  ({ strengths, volumes } = inferMeteredDoseStrengths(strengths, volumes, state.dosageForm));
  ({ strengths, volumes } = simplifyInhalationDoseRatios(strengths, volumes, state.dosageForm));
  volumes = inferOralLiquidVolumeFromDoseCount(strengths, volumes, state.dosageForm);
  volumes = dedupePublicNodes(volumes);
  return { strengths, volumes };
}

function fixOralSolidMlStrengthTypo(strengths, dosageForm) {
  if (!ORAL_SOLID_FORMS_WITH_IMPLICIT_MG.has(dosageForm)) return strengths;

  return strengths.map((strength) => {
    if (
      strength?.kind !== 'ratio' ||
      strength.denominator?.unit !== 'мл' ||
      strength.unit !== 'мг' ||
      strength.value == null ||
      strength.denominator.value == null
    ) {
      return strength;
    }

    const values = [strength.value, strength.denominator.value];
    return {
      kind: 'simple',
      text: values.map((value) => `${value} мг`).join('/'),
      values,
      value: null,
      unit: 'мг',
    };
  });
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
  const { strengths, volumes } = buildPublicMeasurements(state, normalizedText);
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
  parseExplicitMeasurementsPass(tokens, state);

  runStrengthVolumePostProcessing({ state, tokens, rawQuery, normalizedText });
  const residue = extractTradeNameResidue({ state, tokens, rawQuery, normalizedText });
  const dosageFormRoute = runInferencePipeline({
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
