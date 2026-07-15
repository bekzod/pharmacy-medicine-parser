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
  buildMeasurementNodeFromStrength,
  buildRatioStrengthNode,
  buildSimpleStrengthNode,
  collectNumericSequence,
} = require('./measurements');
const { normalizeSqlTerm } = require('../medicine-lookup-common');

function detectDosageFormRoute(rawQuery) {
  const text = normalizeSqlTerm(rawQuery);
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
const PRECISE_STRENGTH_UNITS = new Set(['мг', 'мкг', '%']);
const MASS_PACKAGE_FORMS = new Set(['cream', 'ointment', 'gel', 'paste', 'drops', 'aerosol']);
const DOSE_UNITS = new Set(['ед', 'ме']);

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
    replaceRatioStrength(
      state,
      strengthIndex,
      strength,
      {
        denominator: { value: denominatorVolume.value, unit: denominatorVolume.unit },
        endIndex: denominatorVolume.endIndex,
      },
    );

    state.consumeRange(denominatorVolume.startIndex, denominatorVolume.endIndex, 'strength');
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

  addSingleTokenStrength(state, strengthIndex, 'ме');

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

  addSingleTokenStrength(state, strengthIndex, 'ед');
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
  'дротаверин-лекхим',
  'лоперамид',
]);
const RATIO_TRADES_WITH_IMPLICIT_G = new Set(['l-виава']);
const RATIO_TRADES_WITH_MG_TO_G = new Set(['ливерин', 'метакартин']);
const RATIO_DENOMINATOR_AS_PACKAGE_VOLUME_TRADES = new Set(['метакартин']);
const POWDER_TRADES_WITH_IMPLICIT_MG = new Set(['ноофен']);
const INJECTABLE_SPACED_DOSE_RATIO_TRADES = new Set(['амбромер', 'эсфолип']);
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

function addSingleTokenStrength(state, index, unit, tradeNameTokens = null) {
  const token = state.tokens[index];
  state.addStrength(buildSimpleStrengthNode([token.numericValue], unit, index, index));
  state.consume(index, 'strength');
  if (tradeNameTokens) dropPromotedTradeNameValues(tradeNameTokens, [token.value]);
}

function replaceSimpleStrengthUnit(state, index, strength, unit) {
  state.replaceStrength(
    index,
    buildSimpleStrengthNode(strength.values, unit, strength.startIndex, strength.endIndex),
  );
}

function replaceRatioStrength(
  state,
  index,
  strength,
  {
    values = strength.values,
    unit = strength.unit,
    denominator = strength.denominator,
    endIndex = strength.endIndex,
  },
) {
  state.replaceStrength(
    index,
    buildRatioStrengthNode(values, unit, denominator, strength.startIndex, endIndex),
  );
}

function addMissingMlVolume(state, strength, volumeValue) {
  const value = Number(volumeValue);
  if (!Number.isFinite(value)) return;
  if (
    state.volumeCandidates.some(
      (volume) => volume?.unit === 'мл' && Number(volume.value) === value,
    )
  ) {
    return;
  }

  state.addVolume({
    text: `${value} мл`,
    value,
    unit: 'мл',
    startIndex: strength.startIndex,
    endIndex: strength.endIndex,
  });
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

  // Trade-name tokens were collected from residue earlier — drop the just-
  // promoted strength value so it doesn't appear in both fields.
  addSingleTokenStrength(state, strengthIndex, rule.unit, tradeNameTokens);
}

function fixExplicitOralSolidGramShorthand({ state, tradeNameTokens }) {
  if (!tradeNameTokensInclude(tradeNameTokens, ORAL_SOLID_TRADES_WITH_IMPLICIT_G)) return;
  if (state.dosageForm && !ORAL_SOLID_FORMS_WITH_IMPLICIT_MG.has(state.dosageForm)) return;
  if (!state.dosageForm && state.packCount == null) return;

  for (let index = 0; index < state.strengthCandidates.length; index += 1) {
    const strength = state.strengthCandidates[index];
    if (strength?.kind !== 'simple' || strength.unit !== 'мг') continue;
    if (!Number.isFinite(strength.value) || strength.value <= 0 || strength.value >= 1) continue;
    replaceSimpleStrengthUnit(state, index, strength, 'г');
  }
}

function hasRehydrationSaltTrade(tradeNameTokens) {
  const tokens = (tradeNameTokens || []).map(normalizeSqlTerm);
  return (
    tokens.includes('регидрационная') &&
    tokens.some((token) => token === 'соль' || /^соль-l[рp]$/u.test(token))
  );
}

function fixExplicitKnownGramUnitTypos({ state, tradeNameTokens }) {
  const isGlycerinSuppository =
    state.dosageForm === 'suppository' &&
    tradeNameTokensInclude(tradeNameTokens, new Set(['глицерин']));
  const isRehydrationSaltPacket = state.packCount != null && hasRehydrationSaltTrade(tradeNameTokens);

  for (let index = 0; index < state.strengthCandidates.length; index += 1) {
    const strength = state.strengthCandidates[index];
    if (strength?.kind !== 'simple' || strength.unit !== 'мг') continue;
    if (!Number.isFinite(strength.value) || strength.value <= 0) continue;

    const shouldConvert =
      (isGlycerinSuppository && strength.value < 3) ||
      (isRehydrationSaltPacket && strength.value >= 10 && strength.value <= 30);
    if (!shouldConvert) continue;

    replaceSimpleStrengthUnit(state, index, strength, 'г');
  }
}

function fixExplicitRatioGramShorthand({ state, tradeNameTokens }) {
  if (!tradeNameTokensInclude(tradeNameTokens, RATIO_TRADES_WITH_IMPLICIT_G)) return;

  for (let index = 0; index < state.strengthCandidates.length; index += 1) {
    const strength = state.strengthCandidates[index];
    if (strength?.kind !== 'ratio' || strength.unit !== 'мг') continue;
    if (strength.denominator?.unit !== 'мл') continue;
    if (!Number.isFinite(strength.value) || strength.value <= 0 || strength.value > 1) continue;
    replaceRatioStrength(state, index, strength, { unit: 'г' });
  }
}

function fixKnownRatioMgToGram({ state, tradeNameTokens }) {
  if (!tradeNameTokensInclude(tradeNameTokens, RATIO_TRADES_WITH_MG_TO_G)) return;

  for (let index = 0; index < state.strengthCandidates.length; index += 1) {
    const strength = state.strengthCandidates[index];
    if (strength?.kind !== 'ratio' || strength.unit !== 'мг') continue;
    if (!Number.isFinite(strength.value) || strength.value < 500) continue;
    const values = (strength.values || []).map((value) => Number(value) / 1000);
    if (!values.every((value) => Number.isFinite(value) && value > 0)) continue;
    replaceRatioStrength(state, index, strength, { values, unit: 'г' });
  }
}

function maybeAddRatioDenominatorPackageVolume({ state, tradeNameTokens }) {
  if (!tradeNameTokensInclude(tradeNameTokens, RATIO_DENOMINATOR_AS_PACKAGE_VOLUME_TRADES)) {
    return;
  }

  for (const strength of state.strengthCandidates) {
    const denominator = strength?.denominator;
    if (
      denominator?.unit !== 'мл' ||
      !Number.isFinite(Number(denominator.value)) ||
      Number(denominator.value) <= 0
    ) {
      continue;
    }

    const volumeValue = Number(denominator.value);
    addMissingMlVolume(state, strength, volumeValue);
  }
}

function maybeInferInjectableSpacedDoseRatio({ state, dosageFormRoute, tradeNameTokens }) {
  if (
    dosageFormRoute !== 'injection' &&
    !tradeNameTokensInclude(tradeNameTokens, INJECTABLE_SPACED_DOSE_RATIO_TRADES)
  ) {
    return;
  }
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

  replaceRatioStrength(
    state,
    strengthIndex,
    strength,
    {
      denominator: { value: volume.value, unit: volume.unit },
      endIndex: volume.endIndex,
    },
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

  const hasStrengthBefore = [...state.tokenRoles].some(
    ([index, role]) => index < packIndex && role === 'strength',
  );
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

  addSingleTokenStrength(state, strengthIndex, 'г', tradeNameTokens);
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

  addSingleTokenStrength(state, strengthIndex, 'мг', tradeNameTokens);
}

const CONCENTRATE_RE = /(?<![а-яё])конц(?:\.|ентрат[а-я]*)?/iu;
const PER_ML_PACKAGE_VOLUME_TRADES = new Set([
  'диклион',
  'левофлоксацин',
  'самфлок',
  'саргин',
  'тазлион',
  'тивамин',
  'тивортин',
  'тиопол',
  'элванта',
  'фторурацил',
  'хондрогард',
]);
const PER_ML_DENOMINATOR_PACKAGE_TRADES = new Set([
  'амброксол',
  'барвитон',
  'диклион',
  'ингамист',
  'инфенак',
  'синалинат',
  'тазлион',
  'тарес',
  'тивамин',
  'тивортин',
  'хондрогард',
  'эллезиум',
]);
const PACKAGE_DENOMINATOR_PER_ML_TYPO_TRADES = new Set([
  'цитиколин',
  'цитиколин-lp',
  'цитиколин-lр',
]);
const SOLUTION_MG_PER_G_DENOMINATOR_TO_ML_TRADES = new Set(['бетадин']);

function maybeInferConcentratePerMlStrength({ state, rawQuery, dosageFormRoute, tradeNameTokens }) {
  const hasKnownPerMlTrade = tradeNameTokensInclude(
    tradeNameTokens,
    PER_ML_PACKAGE_VOLUME_TRADES,
  );
  if (!CONCENTRATE_RE.test(String(rawQuery || '')) && !hasKnownPerMlTrade) return;
  if (
    !hasKnownPerMlTrade &&
    dosageFormRoute !== 'infusion' &&
    dosageFormRoute !== 'injection'
  ) {
    return;
  }

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

  replaceRatioStrength(state, strengthIndex, strength, { denominator });
}

function maybeInferRatioDenominatorPackageVolume({ state, tradeNameTokens }) {
  if (!tradeNameTokensInclude(tradeNameTokens, PER_ML_DENOMINATOR_PACKAGE_TRADES)) return;

  for (let index = 0; index < state.strengthCandidates.length; index += 1) {
    const strength = state.strengthCandidates[index];
    if (
      strength?.kind !== 'ratio' ||
      strength.denominator?.unit !== 'мл' ||
      strength.denominator?.value == null ||
      !Number.isFinite(Number(strength.denominator.value)) ||
      !MASS_UNITS_FOR_DOSE_INFERENCE.has(strength.unit)
    ) {
      continue;
    }

    const volumeValue = Number(strength.denominator.value);
    addMissingMlVolume(state, strength, volumeValue);

    replaceRatioStrength(state, index, strength, { denominator: { value: null, unit: 'мл' } });
  }
}

function maybeInferPackageDenominatorPerMlTypo({ state, tradeNameTokens }) {
  if (!tradeNameTokensInclude(tradeNameTokens, PACKAGE_DENOMINATOR_PER_ML_TYPO_TRADES)) {
    return;
  }

  for (let index = 0; index < state.strengthCandidates.length; index += 1) {
    const strength = state.strengthCandidates[index];
    if (
      strength?.kind !== 'ratio' ||
      strength.denominator?.unit !== 'мл' ||
      strength.denominator?.value != null ||
      !MASS_UNITS_FOR_DOSE_INFERENCE.has(strength.unit) ||
      !Number.isFinite(Number(strength.value)) ||
      Number(strength.value) < 500
    ) {
      continue;
    }

    const packageVolume = state.volumeCandidates.find(
      (volume) => volume?.unit === 'мл' && Number(volume.value) === 4,
    );
    if (!packageVolume) continue;

    replaceRatioStrength(
      state,
      index,
      strength,
      {
        denominator: { value: packageVolume.value, unit: packageVolume.unit },
        endIndex: packageVolume.endIndex,
      },
    );
  }
}

function fixSolutionPerGramDenominatorTypo({ state, tradeNameTokens }) {
  if (state.dosageForm !== 'solution') return;
  if (!tradeNameTokensInclude(tradeNameTokens, SOLUTION_MG_PER_G_DENOMINATOR_TO_ML_TRADES)) {
    return;
  }

  for (let index = 0; index < state.strengthCandidates.length; index += 1) {
    const strength = state.strengthCandidates[index];
    if (
      strength?.kind !== 'ratio' ||
      strength.unit !== 'мг' ||
      strength.denominator?.unit !== 'г' ||
      strength.denominator?.value != null
    ) {
      continue;
    }

    replaceRatioStrength(state, index, strength, { denominator: { value: 1, unit: 'мл' } });
  }
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

function hasTokenWithPrefixInRange(tokens, prefixRe, fromIndex, toIndex) {
  return tokens
    .slice(fromIndex, toIndex)
    .some((token) => prefixRe.test(normalizeSqlTerm(token?.value)));
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
    if (!/^растворител/u.test(normalizeSqlTerm(tokens[index]?.value))) continue;
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

function promoteStandalonePackageMasses(state) {
  const hasPreciserStrength = state.strengthCandidates.some(
    (strength) =>
      (strength.kind === 'ratio' &&
        ['volume', 'mass', 'dose'].includes(
          UNIT_FAMILY_BY_VALUE.get(strength.denominator?.unit),
        )) ||
      (strength.kind === 'simple' && PRECISE_STRENGTH_UNITS.has(strength.unit)) ||
      (strength.kind === 'combination' &&
        strength.components?.some((component) =>
          PRECISE_STRENGTH_UNITS.has(component.unit),
        )),
  );
  if (!hasPreciserStrength && !MASS_PACKAGE_FORMS.has(state.dosageForm)) return;

  for (let index = state.strengthCandidates.length - 1; index >= 0; index -= 1) {
    const strength = state.strengthCandidates[index];
    if (strength.kind !== 'simple' || !['г', 'л'].includes(strength.unit)) continue;
    state.addVolume(buildMeasurementNodeFromStrength(strength));
    for (
      let tokenIndex = strength.startIndex;
      tokenIndex <= strength.endIndex;
      tokenIndex += 1
    ) {
      state.setRole(tokenIndex, 'volume');
    }
    state.removeStrength(index);
  }
}

function inferInjectionFromDoseRatio(state) {
  const hasDoseRatioPerMl = state.strengthCandidates.some(
    (strength) =>
      strength.kind === 'ratio' &&
      DOSE_UNITS.has(strength.unit) &&
      strength.denominator?.unit === 'мл',
  );
  if (
    hasDoseRatioPerMl &&
    state.dosageForm !== 'injection' &&
    state.dosageFormSource !== 'explicit'
  ) {
    state.dosageForm = 'injection';
    state.dosageFormSource = 'inferred_from_strength';
  }
}

function removeSolventCandidatesAndClause(state, tokens) {
  state.dropCandidates('volume', (volume) => isSolventVolumeCandidate(volume, tokens));

  const solventClauseStartIndex = findSolventClauseStartIndex(tokens);
  if (solventClauseStartIndex == null) return;

  const isAfterSolventClause = (candidate) =>
    (candidate.startIndex ?? 0) >= solventClauseStartIndex;
  state.dropCandidates('strength', isAfterSolventClause);
  state.dropCandidates('volume', isAfterSolventClause);

  for (let index = solventClauseStartIndex; index < tokens.length; index += 1) {
    state.consume(index);
    if (!state.tokenRoles.has(index)) state.setRole(index, 'solvent');
  }
}

function convertSyringeDoseStrengths(state, rawQuery, normalizedText) {
  const hasVolumeMl = state.volumeCandidates.some((volume) => volume.unit === 'мл');
  const prefilledSyringeSignal = hasPrefilledSyringeSignal(rawQuery, normalizedText);
  const prefilledSyringeMlVolumes = prefilledSyringeSignal
    ? state.volumeCandidates.filter(
        (volume) => volume.unit === 'мл' && volume.value != null,
      )
    : [];
  const denominator =
    prefilledSyringeMlVolumes.length === 1
      ? {
          value: prefilledSyringeMlVolumes[0].value,
          endIndex: prefilledSyringeMlVolumes[0].endIndex,
        }
      : hasVolumeMl
        ? { value: null, endIndex: null }
        : null;
  if (!denominator) return;

  for (let index = 0; index < state.strengthCandidates.length; index += 1) {
    const strength = state.strengthCandidates[index];
    if (strength.kind !== 'simple' || !DOSE_UNITS.has(strength.unit)) continue;
    state.replaceStrength(
      index,
      buildRatioStrengthNode(
        strength.values,
        strength.unit,
        { value: denominator.value, unit: 'мл' },
        strength.startIndex,
        denominator.endIndex ?? strength.endIndex,
      ),
    );
  }
}

function convertMassStrengthsToPerDoseWhenExplicit(tokens, state) {
  for (let index = 0; index < state.strengthCandidates.length; index += 1) {
    const strength = state.strengthCandidates[index];
    if (strength.kind !== 'simple' || !MASS_UNITS_FOR_DOSE_INFERENCE.has(strength.unit)) {
      continue;
    }

    const connector = tokens[strength.endIndex + 1];
    const denominatorNumber = tokens[strength.endIndex + 2];
    const denominatorUnit = tokens[strength.endIndex + 3];

    if (
      connector?.type === 'WORD' &&
      connector.value === 'по' &&
      denominatorNumber?.type === 'NUMBER' &&
      denominatorUnit?.type === 'UNIT' &&
      denominatorUnit.normalizedValue === 'доз'
    ) {
      state.replaceStrength(
        index,
        buildRatioStrengthNode(
          strength.values,
          strength.unit,
          { value: null, unit: 'доз' },
          strength.startIndex,
          strength.endIndex,
        ),
      );
    }
  }
}

function isInjectionOrInfusionContext(state, dosageFormRoute) {
  return (
    ['injection', 'infusion'].includes(state.dosageForm) ||
    ['injection', 'infusion'].includes(dosageFormRoute)
  );
}

function convertInjectableOmittedMassSlashVolume(state, dosageFormRoute) {
  if (
    !isInjectionOrInfusionContext(state, dosageFormRoute) ||
    state.strengthCandidates.length > 0
  ) {
    return;
  }

  const malformedVolumeIndex = state.volumeCandidates.findIndex(
    (volume) =>
      volume?.unit === 'мл' &&
      volume.value == null &&
      /^(\d+(?:\.\d+)?) мл\/(\d+(?:\.\d+)?) мл$/u.test(volume.text || ''),
  );
  if (malformedVolumeIndex === -1) return;

  const malformedVolume = state.volumeCandidates[malformedVolumeIndex];
  const match = malformedVolume.text.match(
    /^(\d+(?:\.\d+)?) мл\/(\d+(?:\.\d+)?) мл$/u,
  );
  const strengthValue = Number(match[1]);
  const volumeValue = Number(match[2]);
  if (
    !Number.isFinite(strengthValue) ||
    strengthValue < 100 ||
    !Number.isFinite(volumeValue)
  ) {
    return;
  }

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

function convertInjectableOmittedMassSeparateSlashVolumes(
  state,
  tokens,
  dosageFormRoute,
) {
  if (
    !isInjectionOrInfusionContext(state, dosageFormRoute) ||
    state.strengthCandidates.length > 0
  ) {
    return;
  }

  for (let index = 0; index < state.volumeCandidates.length - 1; index += 1) {
    const first = state.volumeCandidates[index];
    const second = state.volumeCandidates[index + 1];
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
    state.volumeCandidates.splice(index, 1);
    return;
  }
}

function normalizeExplicitMeasurementCandidates({
  state,
  tokens,
  rawQuery,
  normalizedText,
}) {
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

function inferImplicitMedicineAttributes({
  state,
  rawQuery,
  normalizedText,
  tradeNameTokens,
}) {
  maybeInferVitaminDStrength({ state, tradeNameTokens });
  maybeInferEnzymeActivityStrength({ state, tradeNameTokens });
  maybeInferOralSolidStrength({ state, tradeNameTokens });
  fixExplicitOralSolidGramShorthand({ state, tradeNameTokens });
  fixExplicitKnownGramUnitTypos({ state, tradeNameTokens });
  fixExplicitRatioGramShorthand({ state, tradeNameTokens });
  fixKnownRatioMgToGram({ state, tradeNameTokens });
  maybeAddRatioDenominatorPackageVolume({ state, tradeNameTokens });

  const inferredTrailingPackCount = maybeInferTrailingOralSolidPackCount({
    state,
    tradeNameTokens,
  });
  if (inferredTrailingPackCount != null) state.setPackCount(inferredTrailingPackCount);

  maybeInferOralLiquidSpacedDoseRatio({ state });

  const dosageFormRoute =
    detectDosageFormRoute(rawQuery) ||
    inferOralRouteFromLiquidDose(state.dosageForm, state.strengthCandidates);
  maybeInferInjectableSpacedDoseRatio({ state, dosageFormRoute, tradeNameTokens });
  maybeInferPowderMilligramStrength({ state, dosageFormRoute, tradeNameTokens });
  maybeInferPowderGramStrength({ state, tradeNameTokens });
  maybeInferConcentratePerMlStrength({
    state,
    rawQuery,
    dosageFormRoute,
    tradeNameTokens,
  });
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

module.exports = {
  ORAL_SOLID_FORMS_WITH_IMPLICIT_MG,
  inferImplicitMedicineAttributes,
  inferMultiValuePerDoseStrength,
  hasRepeatedStrengthNumberLater,
  normalizeExplicitMeasurementCandidates,
};
