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
  tokenizeMedicineQuery,
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
  isDuplicateTotalStrengthMarker,
  mergeSameUnitSlashStrength,
  simplifyInhalationDoseRatios,
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
  isSolventVolumeCandidate,
  maybeInferEnzymeActivityStrength,
  maybeInferLiquidPackageVolume,
  maybeInferOralLiquidSpacedDoseRatio,
  maybeInferOralSolidStrength,
  maybeInferPowderGramStrength,
  maybeInferPowderMilligramStrength,
  maybeInferTrailingOralSolidPackCount,
  maybeInferVitaminDStrength,
} = require('./inference');
const {
  classifyProductType,
  isBrandOnlyProductType,
  shouldKeepCurrentDosageForm,
  shouldOverrideDosageFormForFinalForm,
} = require('./product-type');
const {
  isMeaningfulTradeNameWordToken,
  recoverHyphenatedEnemaTradeName,
  shouldKeepNumberAsBrandToken,
} = require('./trade-name');
const { ParseState } = require('./state');

function parseMedicineQuery(rawQuery) {
  const normalizedText = normalizeMedicineQuery(rawQuery);
  const tokens = tokenizeNormalizedQuery(normalizedText);
  const state = new ParseState({ rawQuery, normalizedText, tokens });
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
  // Extract pack count from №N / №NxM patterns directly from raw query (last one wins).
  let hasRawPackMultiplier = false;
  for (const match of (rawQuery || '').matchAll(/№\s*(\d+)\s*[хx×]\s*(\d+)/giu)) {
    const left = Number.parseInt(match[1], 10);
    const right = Number.parseInt(match[2], 10);
    if (Number.isFinite(left) && Number.isFinite(right) && left > 0 && right > 0) {
      state.setPackCount(left * right);
      hasRawPackMultiplier = true;
    }
  }
  for (const match of (rawQuery || '').matchAll(/№\s*(\d+)(?!\d)(?!\s*[хx×]\s*\d)/giu)) {
    state.setPackCount(Number.parseInt(match[1], 10));
  }

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
      state.considerDosageFormToken(token, {
        shouldKeepCurrentDosageForm,
        shouldOverrideDosageFormForFinalForm,
      });

      if (token.containerType) state.setContainerType(token.containerType);

      state.consume(index, 'dosage_form');
      continue;
    }

    if (token.type === 'CONTAINER') {
      state.setContainerType(token.containerType);
      state.consume(index, 'container');
    }
  }

  for (let index = 0; index < tokens.length; index += 1) {
    if (state.hasConsumed(index)) continue;

    const token = tokens[index];

    if (token.type !== 'NUMBER') continue;

    // Dimension notation: NUMBER UNIT(length) х NUMBER UNIT(length)
    if (
      tokens[index + 1]?.type === 'UNIT' &&
      UNIT_FAMILY_BY_VALUE.get(tokens[index + 1].normalizedValue) === 'length' &&
      tokens[index + 2]?.type === 'WORD' &&
      (tokens[index + 2].normalizedValue === 'х' || tokens[index + 2].normalizedValue === 'x') &&
      tokens[index + 3]?.type === 'NUMBER' &&
      tokens[index + 4]?.type === 'UNIT' &&
      UNIT_FAMILY_BY_VALUE.get(tokens[index + 4].normalizedValue) === 'length'
    ) {
      const dimensionText = `${token.value} ${tokens[index + 1].normalizedValue} х ${tokens[index + 3].value} ${tokens[index + 4].normalizedValue}`;
      state.addVolume({
        text: dimensionText,
        value: Number.parseFloat(token.value),
        unit: tokens[index + 1].normalizedValue,
        dimension2: {
          value: Number.parseFloat(tokens[index + 3].value),
          unit: tokens[index + 4].normalizedValue,
        },
        startIndex: index,
        endIndex: index + 4,
      });
      state.consumeRange(index, index + 4, 'volume');
      index = index + 4;
      continue;
    }

    const combinationStrength = buildCombinationStrengthCandidate(tokens, index);
    if (combinationStrength) {
      state.addStrength(combinationStrength);
      state.consumeRange(combinationStrength.startIndex, combinationStrength.endIndex, 'strength');
      index = combinationStrength.endIndex;
      continue;
    }

    const plusSeparatedSharedDenominatorRatio =
      buildPlusSeparatedSharedDenominatorRatioStrength(tokens, index);
    if (plusSeparatedSharedDenominatorRatio) {
      state.addStrength(plusSeparatedSharedDenominatorRatio);
      state.consumeRange(
        plusSeparatedSharedDenominatorRatio.startIndex,
        plusSeparatedSharedDenominatorRatio.endIndex,
        'strength',
      );
      index = plusSeparatedSharedDenominatorRatio.endIndex;
      continue;
    }

    const percentStrength = buildPercentStrengthNode(tokens, index);
    if (percentStrength) {
      state.addStrength(percentStrength);
      state.consumeRange(percentStrength.startIndex, percentStrength.endIndex, 'strength');
      index = percentStrength.endIndex;
      continue;
    }

    const plusSeparatedSharedUnit = buildPlusSeparatedSharedUnitStrength(tokens, index);
    if (plusSeparatedSharedUnit) {
      state.addStrength(plusSeparatedSharedUnit);
      state.consumeRange(
        plusSeparatedSharedUnit.startIndex,
        plusSeparatedSharedUnit.endIndex,
        'strength',
      );
      index = plusSeparatedSharedUnit.endIndex;
      continue;
    }

    const multiComponentRatio = buildMultiComponentRatioStrength(tokens, index);
    if (multiComponentRatio) {
      state.addStrength(multiComponentRatio);
      state.consumeRange(multiComponentRatio.startIndex, multiComponentRatio.endIndex, 'strength');
      index = multiComponentRatio.endIndex;
      continue;
    }

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
      continue;
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
      continue;
    }

    const strengthNode = buildStrengthNode(tokens, index);

    if (!strengthNode) continue;

    const unitFamily = UNIT_FAMILY_BY_VALUE.get(strengthNode.unit);
    const isDoseCount = strengthNode.kind === 'simple' && strengthNode.unit === 'доз';
    const isVolumeNode =
      strengthNode.kind === 'simple' &&
      (unitFamily === 'volume' || unitFamily === 'length' || isDoseCount);
    if (isDoseCount) {
      const perDoseStrength = inferMultiValuePerDoseStrength(strengthNode, state.strengthCandidates);
      if (perDoseStrength) {
        state.addStrength(perDoseStrength);
        state.consumeRange(strengthNode.startIndex, strengthNode.endIndex, 'strength');
        index = strengthNode.endIndex;
        continue;
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
    index = strengthNode.endIndex;
  }

  const PRECISE_STRENGTH_UNITS = new Set(['мг', 'мкг', '%']);
  const TOPICAL_PACKAGE_FORMS = new Set(['cream', 'ointment', 'gel', 'paste']);
  const hasPreciserStrength = state.strengthCandidates.some(
    (s) =>
      (s.kind === 'ratio' && UNIT_FAMILY_BY_VALUE.get(s.denominator?.unit) === 'volume') ||
      (s.kind === 'ratio' && UNIT_FAMILY_BY_VALUE.get(s.denominator?.unit) === 'mass') ||
      (s.kind === 'ratio' && UNIT_FAMILY_BY_VALUE.get(s.denominator?.unit) === 'dose') ||
      (s.kind === 'simple' && PRECISE_STRENGTH_UNITS.has(s.unit)) ||
      (s.kind === 'combination' && s.components?.some((c) => PRECISE_STRENGTH_UNITS.has(c.unit))),
  );
  const isTopicalForm = TOPICAL_PACKAGE_FORMS.has(state.dosageForm);
  if (hasPreciserStrength || isTopicalForm) {
    for (let i = state.strengthCandidates.length - 1; i >= 0; i -= 1) {
      const s = state.strengthCandidates[i];
      if (s.kind === 'simple' && (s.unit === 'г' || s.unit === 'л')) {
        state.addVolume(
          buildMeasurementNode(
            { value: String(s.value), normalizedValue: null },
            { normalizedValue: s.unit },
            s.startIndex,
            s.endIndex,
          ),
        );
        for (let ci = s.startIndex; ci <= s.endIndex; ci += 1) {
          state.setRole(ci, 'volume');
        }
        state.removeStrength(i);
      }
    }
  }

  // Infer injection form when a dose-unit/mL ratio strength is present and no
  // explicit injection form was found (e.g. bare р-р with 300 ед/1.5 мл).
  const DOSE_UNITS = new Set(['ед', 'ме']);
  const hasDoseRatioPerMl = state.strengthCandidates.some(
    (s) => s.kind === 'ratio' && DOSE_UNITS.has(s.unit) && s.denominator?.unit === 'мл',
  );
  if (hasDoseRatioPerMl && state.dosageForm !== 'injection') {
    state.dosageForm = 'injection';
    state.dosageFormSource = 'inferred_from_strength';
  }

  state.dropCandidates('volume', (v) =>
    isSolventVolumeCandidate(v, tokens),
  );

  const solventClauseStartIndex = findSolventClauseStartIndex(tokens);
  if (solventClauseStartIndex != null) {
    const isAfterSolventClause = (c) => (c.startIndex ?? 0) >= solventClauseStartIndex;
    state.dropCandidates('strength', isAfterSolventClause);
    state.dropCandidates('volume', isAfterSolventClause);

    for (let index = solventClauseStartIndex; index < tokens.length; index += 1) {
      state.consume(index);
      if (!state.tokenRoles.has(index)) state.setRole(index, 'solvent');
    }
  }

  // Prefilled syringes commonly list total dose + fill volume:
  // "4000 МЕ 0.4 мл предварительно заполненные шприцы" → "4000 МЕ/0.4 мл".
  // Keep the generic concentration inference below for insulin-style listings:
  // "100 ед" + "3 мл" → "100 ед/мл" + "3 мл".
  const hasVolumeMl = state.volumeCandidates.some((v) => v.unit === 'мл');
  const prefilledSyringeSignal = hasPrefilledSyringeSignal(rawQuery, normalizedText);
  const prefilledSyringeMlVolumes = prefilledSyringeSignal
    ? state.volumeCandidates.filter((v) => v.unit === 'мл' && v.value != null)
    : [];
  if (prefilledSyringeMlVolumes.length === 1) {
    const syringeVolume = prefilledSyringeMlVolumes[0];
    for (let i = 0; i < state.strengthCandidates.length; i += 1) {
      const s = state.strengthCandidates[i];
      if (s.kind === 'simple' && DOSE_UNITS.has(s.unit)) {
        state.replaceStrength(
          i,
          buildRatioStrengthNode(
            s.values,
            s.unit,
            { value: syringeVolume.value, unit: 'мл' },
            s.startIndex,
            syringeVolume.endIndex,
          ),
        );
      }
    }
  } else if (hasVolumeMl) {
    for (let i = 0; i < state.strengthCandidates.length; i += 1) {
      const s = state.strengthCandidates[i];
      if (s.kind === 'simple' && DOSE_UNITS.has(s.unit)) {
        state.replaceStrength(
          i,
          buildRatioStrengthNode(
            s.values,
            s.unit,
            { value: null, unit: 'мл' },
            s.startIndex,
            s.endIndex,
          ),
        );
      }
    }
  }

  // Infer per-dose concentration when the Russian preposition "по" connects a
  // mass strength to a dose-count: "100 мкг по 200 доз" → "100 мкг/доз" +
  // "200 доз". The explicit "по" is the disambiguating signal — without it,
  // bare "X mass + Y доз" stays simple (e.g. Паллада-НС "665 мкг, 30 мл (240 доз)").
  const MASS_STRENGTH_UNITS = new Set(['мкг', 'мг', 'г']);
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

  const uniqueResidueTokens = [...new Set(residueTokens)];
  const {
    canonical: vendorCountry,
    matchedTokens: vendorCountryTokens,
    remainingTokens: tradeNameResidueTokens,
  } = extractVendorCountryFromTokens(uniqueResidueTokens);
  const annotationNoiseTokens = collectAnnotationNoiseTokens(rawQuery);
  // An annotation token that appears more than once in the residue is likely
  // meaningful (not just annotation), so only single-occurrence tokens are
  // removable. Skip the work entirely when there are no annotation tokens.
  const removableAnnotationNoiseTokens = new Set();
  if (annotationNoiseTokens.size) {
    const seenResidueTokens = new Set();
    const duplicateResidueTokens = new Set();
    for (const token of residueTokens) {
      if (seenResidueTokens.has(token)) duplicateResidueTokens.add(token);
      else seenResidueTokens.add(token);
    }
    for (const token of annotationNoiseTokens) {
      if (!duplicateResidueTokens.has(token)) removableAnnotationNoiseTokens.add(token);
    }
  }
  const filteredResidueTokens = removableAnnotationNoiseTokens.size
    ? tradeNameResidueTokens.filter((token) => !removableAnnotationNoiseTokens.has(token))
    : tradeNameResidueTokens;
  if (removableAnnotationNoiseTokens.size) {
    for (const [tokenIndex, role] of state.tokenRoles) {
      if (role !== 'trade_name') continue;
      const value = tokens[tokenIndex]?.normalizedValue;
      if (value && removableAnnotationNoiseTokens.has(value)) state.clearRole(tokenIndex);
    }
  }
  const cyrillicTokenSet = new Set(filteredResidueTokens.filter((t) => /[\u0400-\u04ff]/u.test(t)));
  const tradeNameTokens = filteredResidueTokens
    .filter((token) => {
    if (/[\u0400-\u04ff]/u.test(token)) return true;
    const transliterated = transliterateLatinToCyrillic(token);
    return !cyrillicTokenSet.has(transliterated);
    })
    .map((token) => normalizeTradeNameAbbrevToken(token));

  maybeInferVitaminDStrength({
    state,
    tradeNameTokens,
  });

  maybeInferEnzymeActivityStrength({
    state,
    tradeNameTokens,
  });

  maybeInferOralSolidStrength({
    state,
    tradeNameTokens,
  });
  const inferredTrailingPackCount = maybeInferTrailingOralSolidPackCount({
    state,
    tradeNameTokens,
  });
  if (inferredTrailingPackCount != null) {
    state.setPackCount(inferredTrailingPackCount);
  }

  maybeInferOralLiquidSpacedDoseRatio({
    state,
  });

  const dosageFormRoute =
    detectDosageFormRoute(rawQuery)
    || inferOralRouteFromLiquidDose(state.dosageForm, state.strengthCandidates);

  maybeInferPowderMilligramStrength({
    state,
    dosageFormRoute,
    tradeNameTokens,
  });

  maybeInferPowderGramStrength({
    state,
    tradeNameTokens,
  });

  maybeInferLiquidPackageVolume({
    state,
  });

  if (
    state.packCount == null &&
    state.strengthCandidates.length === 0 &&
    state.volumeCandidates.some((volume) => volume.unit === 'мл') &&
    hasPrefilledSyringeSignal(rawQuery, normalizedText)
  ) {
    state.setPackCount(1);
  }

  // For infusion bags, injection ampoules, or injectable-looking vials written as a bare ratio
  // (e.g. "500 мг/100 мл" with no separate "100 мл"), the ratio's
  // denominator value IS the package volume. Promote it to volumes so
  // downstream consumers see the package size. Skip oral suspensions/
  // syrups, where the denominator is a per-dose reference (e.g. "5 мл").
  const isInjectableContext =
    dosageFormRoute === 'infusion' ||
    dosageFormRoute === 'injection' ||
    state.dosageForm === 'injection' ||
    state.dosageForm === 'infusion' ||
    (state.dosageForm === 'solution' &&
      state.dosageFormSource === 'inferred_from_container' &&
      state.containerType === 'vial');
  if (isInjectableContext && state.volumeCandidates.length === 0) {
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

  let strengths = dedupePublicNodes(
    state.strengthCandidates.map(toPublicStrengthNode).filter(Boolean),
  );
  strengths = mergeSameUnitSlashStrength(strengths, normalizedText);
  strengths = inferInhalationPerDoseStrengths(strengths, normalizedText, state.dosageForm);
  let volumes = dedupePublicNodes(
    state.volumeCandidates.map(toPublicMeasurementNode).filter(Boolean),
  );
  ({ strengths, volumes } = simplifyInhalationDoseRatios(strengths, volumes, state.dosageForm));
  volumes = dedupePublicNodes(volumes);
  const productType = classifyProductType(rawQuery, normalizedText, {
    dosageForm: state.dosageForm,
    strengths,
    volumes,
  });
  if (!tradeNameTokens.length) {
    const recoveredTradeName = recoverHyphenatedEnemaTradeName(tokens);
    if (recoveredTradeName) tradeNameTokens.push(recoveredTradeName);
  }
  const tradeNameText = tradeNameTokens.join(' ').trim() || null;

  const annotatedTokens = state.annotatedTokens();

  if (isBrandOnlyProductType(productType)) {
    // Strip pack-count multipliers (e.g. "3x10", "1x1") from the full trade name text
    let fullTradeName = normalizedText || null;
    if (fullTradeName) {
      for (const [idx, role] of state.tokenRoles) {
        if (role === 'pack' && tokens[idx]?.type === 'COUNT_MULTIPLIER') {
          const v = tokens[idx].normalizedValue || tokens[idx].value;
          if (v) fullTradeName = fullTradeName.replace(v, '').replace(/\s+/gu, ' ').trim();
        }
      }
    }
    const useFullTradeNameTokens = productType === 'device';
    const fullTradeNameTokens =
      (tradeNameTokens.length && !useFullTradeNameTokens) || !fullTradeName
        ? tradeNameTokens
        : fullTradeName.split(/\s+/u).filter(Boolean).map((token) => normalizeTradeNameAbbrevToken(token));
    return {
      rawQuery: rawQuery || '',
      normalizedText,
      tokens: annotatedTokens,
      residueTokens: fullTradeNameTokens,
      attributes: {
        trade_name_text: fullTradeName,
        trade_name_tokens: fullTradeNameTokens,
        dosage_form: null,
        dosage_form_token: null,
        dosage_form_source: null,
        dosage_form_route: null,
        container_type: null,
        product_type: productType,
        vendor_country_text: vendorCountry,
        vendor_country_tokens: vendorCountryTokens,
        strengths: [],
        volumes: [],
        pack_count: state.packCount,
      },
    };
  }

  return {
    rawQuery: rawQuery || '',
    normalizedText,
    tokens: annotatedTokens,
    residueTokens: tradeNameTokens,
    attributes: {
      trade_name_text: tradeNameText,
      trade_name_tokens: tradeNameTokens.map((token) => normalizeTradeNameAbbrevToken(token)),
      dosage_form: state.dosageForm || null,
      dosage_form_token: state.dosageFormToken?.normalizedValue || null,
      dosage_form_source: state.dosageFormSource,
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
}

module.exports = {
  normalizeMedicineQuery,
  parseMedicineQuery,
  tokenizeMedicineQuery,
};
