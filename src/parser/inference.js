const {
  DOSAGE_FORM_ROUTE_PATTERNS,
  ORAL_LIQUID_DOSAGE_FORMS,
  ORAL_LIQUID_REFERENCE_VOLUME_ML,
  PREFILLED_RE,
  SYRINGE_RE,
  UNIT_FAMILY_BY_VALUE,
} = require('./constants');
const {
  buildMeasurementNode,
  buildRatioStrengthNode,
  buildSimpleStrengthNode,
  collectNumericSequence,
} = require('./measurements');

function detectDosageFormRoute(rawQuery) {
  const text = String(rawQuery || '')
    .toLowerCase()
    .replace(/ё/g, 'е');
  if (!text) return null;
  for (const { route, pattern } of DOSAGE_FORM_ROUTE_PATTERNS) {
    if (pattern.test(text)) return route;
  }
  return null;
}

function inferOralRouteFromLiquidDose(dosageForm, strengthCandidates) {
  if (!ORAL_LIQUID_DOSAGE_FORMS.has(dosageForm)) return null;

  const hasOralReferenceDose = (strengthCandidates || []).some((strength) => {
    if (strength?.kind !== 'ratio') return false;
    if (!MASS_UNITS_FOR_DOSE_INFERENCE.has(strength.unit)) return false;
    if (strength.denominator?.unit !== 'мл') return false;
    return ORAL_LIQUID_REFERENCE_VOLUME_ML.has(Number(strength.denominator.value));
  });

  return hasOralReferenceDose ? 'oral' : null;
}

const MASS_UNITS_FOR_DOSE_INFERENCE = new Set(['мкг', 'мг', 'г']);

function maybeInferOralLiquidSpacedDoseRatio({ state }) {
  const { dosageForm, strengthCandidates, volumeCandidates } = state;
  if (!ORAL_LIQUID_DOSAGE_FORMS.has(dosageForm)) return;

  for (let strengthIndex = 0; strengthIndex < strengthCandidates.length; strengthIndex += 1) {
    const strength = strengthCandidates[strengthIndex];
    if (strength?.kind !== 'simple') continue;
    if (!MASS_UNITS_FOR_DOSE_INFERENCE.has(strength.unit)) continue;

    const volumeIndex = volumeCandidates.findIndex(
      (volume) =>
        volume?.unit === 'мл' &&
        ORAL_LIQUID_REFERENCE_VOLUME_ML.has(Number(volume.value)) &&
        volume.startIndex === strength.endIndex + 1,
    );
    if (volumeIndex === -1) continue;

    const denominatorVolume = volumeCandidates[volumeIndex];
    state.replaceStrength(
      strengthIndex,
      buildRatioStrengthNode(
        strength.values,
        strength.unit,
        { value: denominatorVolume.value, unit: denominatorVolume.unit },
        strength.startIndex,
        denominatorVolume.endIndex,
      ),
    );

    for (let index = denominatorVolume.startIndex; index <= denominatorVolume.endIndex; index += 1) {
      state.setRole(index, 'strength');
    }
    state.removeVolume(volumeIndex);
  }
}

function inferMassUnitFromConcentration(strengthCandidates) {
  for (let i = strengthCandidates.length - 1; i >= 0; i -= 1) {
    const strength = strengthCandidates[i];
    if (
      strength?.kind === 'ratio' &&
      MASS_UNITS_FOR_DOSE_INFERENCE.has(strength.unit) &&
      strength.denominator?.unit === 'мл'
    ) {
      return strength.unit;
    }
  }

  return null;
}

function inferMultiValuePerDoseStrength(strengthNode, strengthCandidates) {
  const values = Array.isArray(strengthNode?.values) ? strengthNode.values : [];
  const hasFractionalValue = values.some(
    (value) => Number.isFinite(value) && !Number.isInteger(value),
  );
  if (
    strengthNode?.kind !== 'simple' ||
    strengthNode.unit !== 'доз' ||
    strengthNode.value != null ||
    values.length < 2 ||
    !hasFractionalValue ||
    !values.every((value) => Number.isFinite(value) && value > 0)
  ) {
    return null;
  }

  const inferredUnit = inferMassUnitFromConcentration(strengthCandidates);
  if (!inferredUnit) return null;

  return buildRatioStrengthNode(
    values,
    inferredUnit,
    { value: null, unit: 'доз' },
    strengthNode.startIndex,
    strengthNode.endIndex,
  );
}

function isVitaminDTradeNameToken(token) {
  return ['д-3', 'д3', 'd-3', 'd3'].includes(String(token || '').toLowerCase());
}

function maybeInferVitaminDStrength({ state, tradeNameTokens }) {
  const { tokens } = state;
  if (state.strengthCandidates.length > 0) return;

  const normalizedTradeTokens = (tradeNameTokens || []).map((token) =>
    String(token || '').toLowerCase(),
  );
  const isVitaminD =
    normalizedTradeTokens[0] === 'витамин' &&
    normalizedTradeTokens.some((token) => isVitaminDTradeNameToken(token));

  if (!isVitaminD) return;

  const candidateIndexes = [];

  for (let index = 0; index < tokens.length; index += 1) {
    if (state.hasConsumed(index)) continue;

    const token = tokens[index];
    if (token?.type !== 'NUMBER') continue;
    if (!Number.isFinite(token.numericValue) || token.numericValue <= 0) continue;
    if (state.packCount != null && token.numericValue === state.packCount) continue;

    candidateIndexes.push(index);
  }

  const strengthIndex = candidateIndexes.find((index) => {
    const value = tokens[index].numericValue;
    return value >= 400 && value <= 50000;
  });

  if (strengthIndex == null) return;

  const strengthNode = buildSimpleStrengthNode(
    [tokens[strengthIndex].numericValue],
    'ме',
    strengthIndex,
    strengthIndex,
  );
  state.addStrength(strengthNode);
  state.consume(strengthIndex, 'strength');

  if (
    state.packCount != null &&
    candidateIndexes.length >= 2 &&
    candidateIndexes[0] !== strengthIndex &&
    tokens[candidateIndexes[0]].numericValue < 10 &&
    tokens[candidateIndexes[0] + 1]?.type === 'DOSAGE_FORM'
  ) {
    state.setRole(candidateIndexes[0], 'trade_name');
  }
}

// Scan the token stream for the single unconsumed NUMBER in [min, max] eligible
// to carry an inferred strength/volume. Returns its index, or null when there is
// no unambiguous candidate (zero or more than one). Shared by the maybeInfer*
// helpers below, which differ only in range, unit, and eligibility guard.
function findSoleNumericCandidate(
  tokens,
  { consumedIndexes, packCount, min, max, requireInteger = true, allowPackCountMatch = false },
) {
  const candidateIndexes = [];
  for (let index = 0; index < tokens.length; index += 1) {
    if (consumedIndexes.has(index)) continue;
    const token = tokens[index];
    if (token?.type !== 'NUMBER') continue;
    if (!Number.isFinite(token.numericValue)) continue;
    if (requireInteger && !Number.isInteger(token.numericValue)) continue;
    if (token.numericValue < min || token.numericValue > max) continue;
    if (packCount != null && token.numericValue === packCount && !allowPackCountMatch) continue;
    candidateIndexes.push(index);
  }
  return candidateIndexes.length === 1 ? candidateIndexes[0] : null;
}

const ENZYME_ACTIVITY_TRADE_TOKENS = new Set([
  'креон',
  'креон®',
  'мезим',
  'микразим',
  'панкреатин',
  'панзинорм',
  'эрмиталь',
]);

function maybeInferEnzymeActivityStrength({ state, tradeNameTokens }) {
  const { tokens } = state;
  if (state.strengthCandidates.length > 0) return;

  if (!tradeNameTokensInclude(tradeNameTokens, ENZYME_ACTIVITY_TRADE_TOKENS)) return;

  const strengthIndex = findSoleNumericCandidate(tokens, {
    consumedIndexes: state.consumedIndexes,
    packCount: state.packCount,
    min: 10000,
    max: 100000,
  });
  if (strengthIndex == null) return;

  const strengthNode = buildSimpleStrengthNode(
    [tokens[strengthIndex].numericValue],
    'ед',
    strengthIndex,
    strengthIndex,
  );
  state.addStrength(strengthNode);
  state.consume(strengthIndex, 'strength');
}

// Oral solid forms (tablet, capsule, etc.) where pharmacy listings often
// abbreviate the strength as a bare number adjacent to the form token. The
// implicit unit is usually мг — e.g. "АЗИТОКОМ-500 ТАБ №3" → 500 мг,
// "Сумамед 250 капс №6" → 250 мг. L-тироксин tablets are conventionally listed
// in micrograms, so bare "100" maps to 100 мкг for that brand.
const ORAL_SOLID_FORMS_WITH_IMPLICIT_MG = new Set([
  'tablet',
  'capsule',
  'pastille',
  'granule',
]);
const ORAL_SOLID_TRADES_WITH_LOW_IMPLICIT_MG = new Set([
  'афил',
  'беласкор',
  'бризези',
  'гепирид',
  'неокласт',
  'олфрекс',
  'раксабан',
]);
const ORAL_SOLID_TRADES_WITH_SLASH_IMPLICIT_MG = new Set([
  'амлодил-аб',
  'анальдим',
  'аттенто',
  'ситадиаб',
]);
const ORAL_SOLID_TRADES_WITH_IMPLICIT_MG = new Set(['йодомиг', 'сиофор']);
const ORAL_SOLID_TRADES_WITH_IMPLICIT_G = new Set([
  'ацикловир',
  'аллапинин',
  'амоксициллин',
  'ампициллин',
  'диазолин',
]);
const RATIO_TRADES_WITH_IMPLICIT_G = new Set(['l-виава']);
const POWDER_TRADES_WITH_IMPLICIT_MG = new Set(['ноофен']);
const ORAL_SOLID_TRADES_WITH_IMPLICIT_MCG = new Set(['йодомарин']);
// L-тироксин tablets are conventionally listed in micrograms.
const LEVOTHYROXINE_TABLET_TRADES = new Set(['l-тироксин']);
const LIQUID_FORMS_WITH_IMPLICIT_ML_VOLUME = new Set(['syrup']);

const ORAL_SOLID_STRENGTH_RULES = [
  {
    tradeTokens: LEVOTHYROXINE_TABLET_TRADES,
    formGuard: (dosageForm) => dosageForm === 'tablet',
    min: 25,
    max: 5000,
    unit: 'мкг',
  },
  {
    tradeTokens: ORAL_SOLID_TRADES_WITH_IMPLICIT_MCG,
    requiresPackWithoutForm: true,
    min: 25,
    max: 5000,
    unit: 'мкг',
    allowPackMatch: true,
  },
  {
    tradeTokens: ORAL_SOLID_TRADES_WITH_IMPLICIT_G,
    requiresPackWithoutForm: true,
    min: 0.01,
    max: 5000,
    unit: 'г',
    requireInteger: false,
  },
  {
    tradeTokens: ORAL_SOLID_TRADES_WITH_LOW_IMPLICIT_MG,
    requiresPackWithoutForm: true,
    min: 1,
    max: 5000,
    unit: 'мг',
    requireInteger: false,
  },
  {
    tradeTokens: ORAL_SOLID_TRADES_WITH_IMPLICIT_MG,
    requiresPackWithoutForm: true,
    min: 25,
    max: 5000,
    unit: 'мг',
  },
  {
    formGuard: (dosageForm) => ORAL_SOLID_FORMS_WITH_IMPLICIT_MG.has(dosageForm),
    min: 25,
    max: 5000,
    unit: 'мг',
  },
];

function tradeNameTokensInclude(tradeNameTokens, tokenSet) {
  return (tradeNameTokens || []).some((token) =>
    tokenSet.has(String(token || '').toLowerCase()),
  );
}

function dropPromotedTradeNameValues(tradeNameTokens, values) {
  if (!Array.isArray(tradeNameTokens)) return;
  const promotedValues = new Set(values.map((value) => String(value)));
  for (let i = tradeNameTokens.length - 1; i >= 0; i -= 1) {
    if (promotedValues.has(String(tradeNameTokens[i]))) tradeNameTokens.splice(i, 1);
  }
}

function findOralSolidStrengthRule({ dosageForm, packCount, tradeNameTokens }) {
  return ORAL_SOLID_STRENGTH_RULES.find((rule) => {
    if (rule.tradeTokens && !tradeNameTokensInclude(tradeNameTokens, rule.tradeTokens)) return false;
    if (rule.formGuard && !rule.formGuard(dosageForm)) return false;
    if (dosageForm && !rule.formGuard && !ORAL_SOLID_FORMS_WITH_IMPLICIT_MG.has(dosageForm)) return false;
    if (!dosageForm && !rule.tradeTokens) return false;
    if (!dosageForm && rule.requiresPackWithoutForm && packCount == null) return false;
    return true;
  });
}

function maybeInferOralSolidStrength({ state, tradeNameTokens }) {
  const { tokens, dosageForm } = state;
  if (state.strengthCandidates.length > 0) return;

  if (
    tradeNameTokensInclude(tradeNameTokens, ORAL_SOLID_TRADES_WITH_SLASH_IMPLICIT_MG) &&
    ((dosageForm && ORAL_SOLID_FORMS_WITH_IMPLICIT_MG.has(dosageForm)) ||
      (!dosageForm && state.packCount != null))
  ) {
    const slashSequences = [];
    for (let index = 0; index < tokens.length; index += 1) {
      if (state.hasConsumed(index) || tokens[index]?.type !== 'NUMBER') continue;
      const sequence = collectNumericSequence(tokens, index);
      if (!sequence || sequence.values.length < 2) continue;
      if (sequence.values.some((value) => value < 1 || value > 5000)) continue;
      slashSequences.push({ index, ...sequence });
      index = sequence.nextIndex - 1;
    }

    if (slashSequences.length === 1) {
      const sequence = slashSequences[0];
      const strengthNode = buildSimpleStrengthNode(
        sequence.values,
        'мг',
        sequence.index,
        sequence.nextIndex - 1,
      );
      state.addStrength(strengthNode);
      for (let index = sequence.index; index < sequence.nextIndex; index += 1) {
        state.consume(index, 'strength');
      }
      dropPromotedTradeNameValues(tradeNameTokens, sequence.values);
      return;
    }
  }

  const rule = findOralSolidStrengthRule({
    dosageForm,
    packCount: state.packCount,
    tradeNameTokens,
  });
  if (!rule) return;

  const strengthIndex = findSoleNumericCandidate(tokens, {
    consumedIndexes: state.consumedIndexes,
    packCount: state.packCount,
    min: rule.min,
    max: rule.max,
    requireInteger: rule.requireInteger !== false,
    allowPackCountMatch: rule.allowPackMatch === true,
  });
  if (strengthIndex == null) return;

  const strengthNode = buildSimpleStrengthNode(
    [tokens[strengthIndex].numericValue],
    rule.unit,
    strengthIndex,
    strengthIndex,
  );
  state.addStrength(strengthNode);
  state.consume(strengthIndex, 'strength');

  // Trade-name tokens were collected from residue earlier — drop the just-
  // promoted strength value so it doesn't appear in both fields.
  dropPromotedTradeNameValues(tradeNameTokens, [tokens[strengthIndex].value]);
}

function fixExplicitOralSolidGramShorthand({ state, tradeNameTokens }) {
  if (!tradeNameTokensInclude(tradeNameTokens, ORAL_SOLID_TRADES_WITH_IMPLICIT_G)) return;
  if (state.dosageForm && !ORAL_SOLID_FORMS_WITH_IMPLICIT_MG.has(state.dosageForm)) return;
  if (!state.dosageForm && state.packCount == null) return;

  for (let index = 0; index < state.strengthCandidates.length; index += 1) {
    const strength = state.strengthCandidates[index];
    if (strength?.kind !== 'simple' || strength.unit !== 'мг') continue;
    if (!Number.isFinite(strength.value) || strength.value <= 0 || strength.value >= 1) continue;
    state.replaceStrength(
      index,
      buildSimpleStrengthNode(strength.values, 'г', strength.startIndex, strength.endIndex),
    );
  }
}

function fixExplicitRatioGramShorthand({ state, tradeNameTokens }) {
  if (!tradeNameTokensInclude(tradeNameTokens, RATIO_TRADES_WITH_IMPLICIT_G)) return;

  for (let index = 0; index < state.strengthCandidates.length; index += 1) {
    const strength = state.strengthCandidates[index];
    if (strength?.kind !== 'ratio' || strength.unit !== 'мг') continue;
    if (strength.denominator?.unit !== 'мл') continue;
    if (!Number.isFinite(strength.value) || strength.value <= 0 || strength.value > 1) continue;
    state.replaceStrength(
      index,
      buildRatioStrengthNode(
        strength.values,
        'г',
        strength.denominator,
        strength.startIndex,
        strength.endIndex,
      ),
    );
  }
}

function maybeInferInjectableSpacedDoseRatio({ state, dosageFormRoute }) {
  if (dosageFormRoute !== 'injection') return;
  if (state.dosageForm === 'powder') return;
  const strengthIndex = state.strengthCandidates.findIndex(
    (strength) =>
      strength?.kind === 'simple' &&
      MASS_UNITS_FOR_DOSE_INFERENCE.has(strength.unit) &&
      strength.value != null,
  );
  if (strengthIndex === -1) return;
  const strength = state.strengthCandidates[strengthIndex];
  const volume = state.volumeCandidates.find(
    (candidate) => candidate?.unit === 'мл' && candidate.startIndex === strength.endIndex + 1,
  );
  if (!volume) return;

  state.replaceStrength(
    strengthIndex,
    buildRatioStrengthNode(
      strength.values,
      strength.unit,
      { value: volume.value, unit: volume.unit },
      strength.startIndex,
      volume.endIndex,
    ),
  );
}

function maybeInferTrailingOralSolidPackCount({ state, tradeNameTokens }) {
  const { tokens, dosageForm } = state;
  if (state.packCount != null) return null;
  if (!ORAL_SOLID_FORMS_WITH_IMPLICIT_MG.has(dosageForm)) return null;
  if (!state.strengthCandidates.length) return null;

  const packIndex = findSoleNumericCandidate(tokens, {
    consumedIndexes: state.consumedIndexes,
    min: 2,
    max: 200,
  });
  if (packIndex == null) return null;

  let hasStrengthBefore = false;
  for (let index = 0; index < packIndex; index += 1) {
    if (state.tokenRoles.get(index) === 'strength') {
      hasStrengthBefore = true;
      break;
    }
  }
  if (!hasStrengthBefore) return null;

  state.consume(packIndex, 'pack');
  dropPromotedTradeNameValues(tradeNameTokens, [tokens[packIndex].value]);
  return tokens[packIndex].numericValue;
}

function maybeInferLiquidPackageVolume({ state }) {
  const { tokens, dosageForm, volumeCandidates } = state;
  if (!LIQUID_FORMS_WITH_IMPLICIT_ML_VOLUME.has(dosageForm)) return;
  if (volumeCandidates.length > 0) return;

  const volumeIndex = findSoleNumericCandidate(tokens, {
    consumedIndexes: state.consumedIndexes,
    min: 10,
    max: 1000,
  });
  if (volumeIndex == null) return;

  state.addVolume(
    buildMeasurementNode(
      { value: tokens[volumeIndex].value, normalizedValue: null },
      { normalizedValue: 'мл' },
      volumeIndex,
      volumeIndex,
    ),
  );
  state.consume(volumeIndex, 'volume');
}

function maybeInferPowderGramStrength({ state, tradeNameTokens }) {
  const { tokens, dosageForm } = state;
  if (dosageForm !== 'powder') return;
  if (state.strengthCandidates.length > 0) return;
  if (state.packCount == null) return;

  const strengthIndex = findSoleNumericCandidate(tokens, {
    consumedIndexes: state.consumedIndexes,
    packCount: state.packCount,
    min: Number.MIN_VALUE,
    max: 10,
    requireInteger: false,
  });
  if (strengthIndex == null) return;

  const strengthNode = buildSimpleStrengthNode(
    [tokens[strengthIndex].numericValue],
    'г',
    strengthIndex,
    strengthIndex,
  );
  state.addStrength(strengthNode);
  state.consume(strengthIndex, 'strength');
  dropPromotedTradeNameValues(tradeNameTokens, [tokens[strengthIndex].value]);
}

function maybeInferPowderMilligramStrength({
  state,
  dosageFormRoute,
  tradeNameTokens,
}) {
  const { tokens, dosageForm } = state;
  if (dosageForm !== 'powder') return;
  if (state.strengthCandidates.length > 0) return;
  if (state.packCount == null) return;
  const isInjectionPowder = dosageFormRoute === 'injection' || dosageFormRoute === 'infusion';
  if (!isInjectionPowder && !tradeNameTokensInclude(tradeNameTokens, POWDER_TRADES_WITH_IMPLICIT_MG)) {
    return;
  }

  const strengthIndex = findSoleNumericCandidate(tokens, {
    consumedIndexes: state.consumedIndexes,
    packCount: state.packCount,
    min: 25,
    max: 5000,
  });
  if (strengthIndex == null) return;

  const strengthNode = buildSimpleStrengthNode(
    [tokens[strengthIndex].numericValue],
    'мг',
    strengthIndex,
    strengthIndex,
  );
  state.addStrength(strengthNode);
  state.consume(strengthIndex, 'strength');
  dropPromotedTradeNameValues(tradeNameTokens, [tokens[strengthIndex].value]);
}

const CONCENTRATE_RE = /(?<![а-яё])конц(?:\.|ентрат[а-я]*)?/iu;

function maybeInferConcentratePerMlStrength({ state, rawQuery, dosageFormRoute }) {
  if (!CONCENTRATE_RE.test(String(rawQuery || ''))) return;
  if (dosageFormRoute !== 'infusion' && dosageFormRoute !== 'injection') return;

  const massStrengths = state.strengthCandidates.filter(
    (strength) =>
      strength?.kind === 'simple' &&
      MASS_UNITS_FOR_DOSE_INFERENCE.has(strength.unit) &&
      strength.value != null,
  );
  if (massStrengths.length !== 1) return;

  const strength = massStrengths[0];
  const adjacentMlVolume = state.volumeCandidates.find(
    (volume) => volume?.unit === 'мл' && volume.startIndex === strength.endIndex + 1,
  );
  if (!adjacentMlVolume) return;

  const strengthIndex = state.strengthCandidates.indexOf(strength);
  if (strengthIndex === -1) return;

  const slashToken = state.tokens[adjacentMlVolume.endIndex + 1];
  const repeatedMlVolume = state.volumeCandidates.find(
    (volume) =>
      volume !== adjacentMlVolume &&
      volume?.unit === 'мл' &&
      volume.value === adjacentMlVolume.value &&
      volume.startIndex === adjacentMlVolume.endIndex + 2,
  );
  const denominator =
    slashToken?.type === 'SLASH' && repeatedMlVolume
      ? { value: adjacentMlVolume.value, unit: 'мл' }
      : { value: null, unit: 'мл' };
  if (repeatedMlVolume) {
    adjacentMlVolume.packageVolume = true;
    repeatedMlVolume.packageVolume = true;
  }

  state.replaceStrength(
    strengthIndex,
    buildRatioStrengthNode(
      strength.values,
      strength.unit,
      denominator,
      strength.startIndex,
      strength.endIndex,
    ),
  );
}

function hasRepeatedStrengthNumberLater(tokens, index) {
  const token = tokens[index];
  if (token?.type !== 'NUMBER') return false;

  for (let cursor = index + 1; cursor < tokens.length - 1; cursor += 1) {
    if (tokens[cursor]?.type !== 'NUMBER') continue;
    if (tokens[cursor].value !== token.value) continue;

    const next = tokens[cursor + 1];
    if (next?.type !== 'UNIT') continue;
    const unitFamily = UNIT_FAMILY_BY_VALUE.get(next.normalizedValue);
    if (unitFamily === 'mass' || unitFamily === 'percent' || next.normalizedValue === '%') {
      return true;
    }
  }

  return false;
}

function hasPrefilledSyringeSignal(rawQuery, normalizedText) {
  const text = `${rawQuery || ''} ${normalizedText || ''}`;
  return SYRINGE_RE.test(text) && PREFILLED_RE.test(text);
}

const SOLVENT_LOOKBACK_TOKENS = 8;

function lowerToken(token) {
  return String(token?.value || '').toLowerCase().replace(/ё/g, 'е');
}

function hasTokenWithPrefixInRange(tokens, prefixRe, fromIndex, toIndex) {
  for (let index = fromIndex; index < toIndex; index += 1) {
    if (prefixRe.test(lowerToken(tokens[index]))) return true;
  }
  return false;
}

function isSolventVolumeCandidate(volume, tokens) {
  if (!volume || volume.unit !== 'мл') return false;
  const startIndex = volume.startIndex ?? 0;
  return hasTokenWithPrefixInRange(
    tokens,
    /^растворител/u,
    Math.max(0, startIndex - SOLVENT_LOOKBACK_TOKENS),
    startIndex,
  );
}

function findSolventClauseStartIndex(tokens) {
  for (let index = 0; index < tokens.length; index += 1) {
    if (!/^растворител/u.test(lowerToken(tokens[index]))) continue;
    if (
      hasTokenWithPrefixInRange(
        tokens,
        /^комплект/u,
        Math.max(0, index - SOLVENT_LOOKBACK_TOKENS),
        index,
      )
    ) {
      return index;
    }
  }
  return null;
}

module.exports = {
  detectDosageFormRoute,
  inferOralRouteFromLiquidDose,
  maybeInferOralLiquidSpacedDoseRatio,
  inferMultiValuePerDoseStrength,
  maybeInferVitaminDStrength,
  maybeInferEnzymeActivityStrength,
  ORAL_SOLID_FORMS_WITH_IMPLICIT_MG,
  maybeInferOralSolidStrength,
  fixExplicitOralSolidGramShorthand,
  fixExplicitRatioGramShorthand,
  maybeInferInjectableSpacedDoseRatio,
  maybeInferTrailingOralSolidPackCount,
  maybeInferLiquidPackageVolume,
  maybeInferPowderGramStrength,
  maybeInferPowderMilligramStrength,
  maybeInferConcentratePerMlStrength,
  hasRepeatedStrengthNumberLater,
  hasPrefilledSyringeSignal,
  isSolventVolumeCandidate,
  findSolventClauseStartIndex,
};
