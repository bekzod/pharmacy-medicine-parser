const { UNIT_FAMILY_BY_VALUE } = require('./constants');

function buildMeasurementNode(numberToken, unitToken, startIndex, endIndex) {
  return {
    text: `${numberToken.value} ${unitToken.normalizedValue}`,
    value: Number.parseFloat(numberToken.value),
    unit: unitToken.normalizedValue,
    startIndex,
    endIndex,
  };
}

function buildMeasurementNodeFromStrength(strengthNode) {
  if (!strengthNode || strengthNode.kind !== 'simple' || !strengthNode.unit) return null;

  if (strengthNode.value != null) {
    return buildMeasurementNode(
      { value: String(strengthNode.value), normalizedValue: null },
      { normalizedValue: strengthNode.unit },
      strengthNode.startIndex,
      strengthNode.endIndex,
    );
  }

  const values = Array.isArray(strengthNode.values) ? strengthNode.values : [];
  if (values.length < 2 || !values.every((value) => Number.isFinite(value))) return null;

  return {
    text: strengthNode.text,
    value: null,
    unit: strengthNode.unit,
    startIndex: strengthNode.startIndex,
    endIndex: strengthNode.endIndex,
  };
}

function buildSimpleStrengthNode(values, unit, startIndex, endIndex) {
  // DB stores multi-value combination strengths with the unit duplicated on
  // both sides of the slash (e.g. "5 мг/10 мг"). Match that format so strict
  // strength:= filters in Typesense hit. Single-value and percent stay compact.
  let text;
  if (unit === '%') {
    text = `${values.join('/')}%`;
  } else if (values.length > 1) {
    text = values.map((value) => `${value} ${unit}`).join('/');
  } else {
    text = `${values[0]} ${unit}`;
  }
  return {
    kind: 'simple',
    text,
    values,
    value: values.length === 1 ? values[0] : null,
    unit,
    startIndex,
    endIndex,
  };
}

function buildCombinationStrengthNode(components, startIndex, endIndex) {
  return {
    kind: 'combination',
    text: components.map((component) => component.text).join(' + '),
    components: components.map((component) => ({
      value: component.value,
      unit: component.unit,
    })),
    startIndex,
    endIndex,
  };
}

function buildRatioStrengthNode(values, unit, denominator, startIndex, endIndex) {
  const denominatorText =
    denominator.value == null ? denominator.unit : `${denominator.value} ${denominator.unit}`;

  return {
    kind: 'ratio',
    text: `${values.join('/')} ${unit}/${denominatorText}`,
    values,
    value: values.length === 1 ? values[0] : null,
    unit,
    denominator,
    startIndex,
    endIndex,
  };
}

function collectNumericSequence(tokens, startIndex) {
  if (tokens[startIndex]?.type !== 'NUMBER') return null;

  const values = [Number.parseFloat(tokens[startIndex].value)];
  let nextIndex = startIndex + 1;

  while (tokens[nextIndex]?.type === 'SLASH' && tokens[nextIndex + 1]?.type === 'NUMBER') {
    values.push(Number.parseFloat(tokens[nextIndex + 1].value));
    nextIndex += 2;
  }

  return { values, nextIndex };
}

function buildPercentStrengthNode(tokens, startIndex) {
  const sequence = collectNumericSequence(tokens, startIndex);
  if (!sequence || tokens[sequence.nextIndex]?.type !== 'PERCENT') return null;

  return buildSimpleStrengthNode(sequence.values, '%', startIndex, sequence.nextIndex);
}

function buildPlusSeparatedSharedUnitStrength(tokens, startIndex) {
  if (tokens[startIndex]?.type !== 'NUMBER') return null;

  const values = [Number.parseFloat(tokens[startIndex].value)];
  let cursor = startIndex + 1;

  while (tokens[cursor]?.type === 'PLUS' && tokens[cursor + 1]?.type === 'NUMBER') {
    values.push(Number.parseFloat(tokens[cursor + 1].value));
    cursor += 2;
  }

  if (values.length < 2 || tokens[cursor]?.type !== 'UNIT') return null;
  return buildSimpleStrengthNode(values, tokens[cursor].normalizedValue, startIndex, cursor);
}

function buildPlusSeparatedSharedDenominatorRatioStrength(tokens, startIndex) {
  if (tokens[startIndex]?.type !== 'NUMBER' || tokens[startIndex + 1]?.type !== 'UNIT') {
    return null;
  }

  const values = [Number.parseFloat(tokens[startIndex].value)];
  const sharedUnit = tokens[startIndex + 1].normalizedValue;
  let cursor = startIndex + 2;

  while (tokens[cursor]?.type === 'PLUS') {
    const numberToken = tokens[cursor + 1];
    const unitToken = tokens[cursor + 2];
    if (numberToken?.type !== 'NUMBER' || unitToken?.type !== 'UNIT') return null;
    if (unitToken.normalizedValue !== sharedUnit) return null;

    values.push(Number.parseFloat(numberToken.value));
    cursor += 3;
  }

  if (values.length < 2 || tokens[cursor]?.type !== 'SLASH') return null;

  const denominatorNumberToken = tokens[cursor + 1];
  const denominatorUnitToken = tokens[cursor + 2];
  if (
    denominatorNumberToken?.type !== 'NUMBER' ||
    denominatorUnitToken?.type !== 'UNIT' ||
    denominatorUnitToken.normalizedValue === sharedUnit
  ) {
    return null;
  }

  return buildRatioStrengthNode(
    values,
    sharedUnit,
    {
      value: Number.parseFloat(denominatorNumberToken.value),
      unit: denominatorUnitToken.normalizedValue,
    },
    startIndex,
    cursor + 2,
  );
}

function buildMultiComponentRatioStrength(tokens, startIndex) {
  if (tokens[startIndex]?.type !== 'NUMBER') return null;

  const components = [];
  let cursor = startIndex;

  const firstNum = tokens[cursor];
  const firstUnit = tokens[cursor + 1];
  if (firstUnit?.type !== 'UNIT') return null;

  components.push(firstNum);
  const sharedUnit = firstUnit.normalizedValue;
  cursor += 2;

  while (
    tokens[cursor]?.type === 'SLASH' &&
    tokens[cursor + 1]?.type === 'NUMBER' &&
    tokens[cursor + 2]?.type === 'UNIT' &&
    tokens[cursor + 2].normalizedValue === sharedUnit
  ) {
    components.push(tokens[cursor + 1]);
    cursor += 3;
  }

  if (components.length < 2 || tokens[cursor]?.type !== 'SLASH') return null;

  if (
    tokens[cursor + 1]?.type === 'NUMBER' &&
    tokens[cursor + 2]?.type === 'UNIT' &&
    tokens[cursor + 2].normalizedValue !== sharedUnit
  ) {
    return buildRatioStrengthNode(
      components.map((c) => Number.parseFloat(c.value)),
      sharedUnit,
      {
        value: Number.parseFloat(tokens[cursor + 1].value),
        unit: tokens[cursor + 2].normalizedValue,
      },
      startIndex,
      cursor + 2,
    );
  }

  if (tokens[cursor + 1]?.type === 'UNIT' && tokens[cursor + 1].normalizedValue !== sharedUnit) {
    return buildRatioStrengthNode(
      components.map((c) => Number.parseFloat(c.value)),
      sharedUnit,
      {
        value: null,
        unit: tokens[cursor + 1].normalizedValue,
      },
      startIndex,
      cursor + 1,
    );
  }

  return null;
}

function buildStrengthNode(tokens, startIndex) {
  const sequence = collectNumericSequence(tokens, startIndex);
  if (!sequence) return null;

  const numeratorUnitToken = tokens[sequence.nextIndex];
  if (numeratorUnitToken?.type !== 'UNIT') return null;

  if (tokens[sequence.nextIndex + 1]?.type === 'SLASH') {
    const denominatorNumberToken = tokens[sequence.nextIndex + 2];
    const denominatorUnitToken = tokens[sequence.nextIndex + 3];

    if (
      denominatorNumberToken?.type === 'NUMBER' &&
      denominatorUnitToken?.type === 'UNIT' &&
      denominatorUnitToken.normalizedValue !== numeratorUnitToken.normalizedValue
    ) {
      return buildRatioStrengthNode(
        sequence.values,
        numeratorUnitToken.normalizedValue,
        {
          value: Number.parseFloat(denominatorNumberToken.value),
          unit: denominatorUnitToken.normalizedValue,
        },
        startIndex,
        sequence.nextIndex + 3,
      );
    }

    if (denominatorNumberToken?.type === 'UNIT') {
      return buildRatioStrengthNode(
        sequence.values,
        numeratorUnitToken.normalizedValue,
        {
          value: null,
          unit: denominatorNumberToken.normalizedValue,
        },
        startIndex,
        sequence.nextIndex + 2,
      );
    }
  }

  return buildSimpleStrengthNode(
    sequence.values,
    numeratorUnitToken.normalizedValue,
    startIndex,
    sequence.nextIndex,
  );
}

function buildSingleStrengthComponent(tokens, startIndex) {
  const percentStrength = buildPercentStrengthNode(tokens, startIndex);
  if (percentStrength) return percentStrength;

  const strengthNode = buildStrengthNode(tokens, startIndex);
  if (!strengthNode || strengthNode.kind !== 'simple' || strengthNode.value == null) return null;
  if (UNIT_FAMILY_BY_VALUE.get(strengthNode.unit) === 'volume') return null;
  return strengthNode;
}

function buildCombinationStrengthCandidate(tokens, startIndex) {
  const firstComponent = buildSingleStrengthComponent(tokens, startIndex);
  if (!firstComponent) return null;

  const components = [firstComponent];
  let cursor = firstComponent.endIndex + 1;

  while (tokens[cursor]?.type === 'PLUS') {
    const nextComponent = buildSingleStrengthComponent(tokens, cursor + 1);
    if (!nextComponent) break;
    components.push(nextComponent);
    cursor = nextComponent.endIndex + 1;
  }

  if (components.length < 2) return null;
  return buildCombinationStrengthNode(components, startIndex, components.at(-1).endIndex);
}

function strengthComponentValues(strength) {
  if (strength?.kind === 'simple' && Array.isArray(strength.values)) return strength.values;
  if (strength?.kind === 'combination' && Array.isArray(strength.components)) {
    const units = new Set(strength.components.map((component) => component.unit).filter(Boolean));
    return units.size === 1 ? strength.components.map((component) => component.value) : [];
  }
  return [];
}

function isDuplicateTotalStrengthMarker(tokens, index, strengthCandidates) {
  const token = tokens[index];
  if (token?.type !== 'NUMBER' || !Number.isFinite(token.numericValue) || token.numericValue <= 0) {
    return false;
  }

  if (tokens[index + 1]?.type !== 'DOSAGE_FORM') return false;

  for (const strength of strengthCandidates) {
    const values = strengthComponentValues(strength).filter((value) => Number.isFinite(value));
    if (values.length === 1 && Math.abs(token.numericValue - values[0]) < 1e-9) return true;
    if (values.length < 2) continue;
    const total = values.reduce((sum, value) => sum + value, 0);
    if (Math.abs(token.numericValue - total) < 1e-9) return true;
  }

  return false;
}

function toPublicStrengthNode(strength) {
  if (!strength) return null;

  if (strength.kind === 'combination') {
    return {
      kind: strength.kind,
      text: strength.text,
      components: strength.components,
    };
  }

  return {
    kind: strength.kind,
    text: strength.text,
    values: strength.values,
    value: strength.value,
    unit: strength.unit,
    ...(strength.denominator ? { denominator: strength.denominator } : {}),
  };
}

function toPublicMeasurementNode(measurement) {
  if (!measurement) return null;

  const node = {
    text: measurement.text,
    value: measurement.value,
    unit: measurement.unit,
  };

  if (measurement.dimension2) {
    node.dimension2 = measurement.dimension2;
  }

  return node;
}

function dedupePublicNodes(nodes) {
  const seen = new Set();
  return nodes.filter((node) => {
    const key = JSON.stringify(node);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function formatNormalizedNumber(value) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return String(value || '');
  return Number.isInteger(numericValue) ? String(Math.trunc(numericValue)) : String(numericValue);
}

function buildSameUnitSlashStrength(normalizedText) {
  const match = String(normalizedText || '').match(
    /(?:^|[^\p{L}\p{N}])((?:\d+(?:\.\d+)?\s*(мг|мкг|г|ме|ед)\s*\/\s*)+\d+(?:\.\d+)?\s*\2)(?=$|[^\p{L}\p{N}])/iu,
  );
  if (!match) return null;

  const unit = match[2].toLowerCase();
  const values = Array.from(
    match[1].matchAll(/(\d+(?:\.\d+)?)\s*(мг|мкг|г|ме|ед)/giu),
    (component) => ({
      value: Number.parseFloat(component[1]),
      unit: component[2].toLowerCase(),
    }),
  );
  if (
    values.length < 2 ||
    values.some((component) => !Number.isFinite(component.value) || component.unit !== unit)
  ) {
    return null;
  }

  return {
    kind: 'simple',
    text: values.map((component) => `${formatNormalizedNumber(component.value)} ${unit}`).join('/'),
    values: values.map((component) => component.value),
    value: null,
    unit,
  };
}

function mergeSameUnitSlashStrength(strengths, normalizedText) {
  if (!normalizedText || !normalizedText.includes('/')) return strengths;
  const slashStrength = buildSameUnitSlashStrength(normalizedText);
  if (!slashStrength) return strengths;

  const sameValuesAlreadyPresent = (strength) =>
    strength &&
    strength.unit === slashStrength.unit &&
    Array.isArray(strength.values) &&
    strength.values.length === slashStrength.values.length &&
    strength.values.every((value, index) => value === slashStrength.values[index]);

  // Already represented (as either a multi-value simple or as a ratio
  // with matching numerator values, e.g. inhalation per-dose ratios).
  if (strengths.some(sameValuesAlreadyPresent)) return strengths;

  // Combination tablets / capsules expressed as duplicated-unit slash
  // (e.g. "4 мг/10 мг", "75 мг/15.2 мг") describe distinct active
  // components and should stay as individual simple strengths. The merge
  // only applies when the parser dedupe collapsed an equal-value
  // split-vial pattern (e.g. "25 мг/25 мг") into a single strength. For
  // other units (ме, ед, г, мкг) the slash form is canonically stored as
  // a single multi-value simple, so merge unconditionally.
  const slashValues = slashStrength.values;
  const allValuesEqual = slashValues.every((value) => value === slashValues[0]);
  const hasDuplicateValues = new Set(slashValues.map((value) => `${value}`)).size < slashValues.length;
  const separateSimples = strengths.filter(
    (strength) =>
      strength?.kind === 'simple' &&
      strength.unit === slashStrength.unit &&
      strength.value != null &&
      slashValues.includes(strength.value),
  );
  const hasDistinctSeparates = separateSimples.length >= 2;
  if (slashStrength.unit === 'мг' && hasDistinctSeparates && !allValuesEqual && !hasDuplicateValues) {
    return strengths;
  }

  const slashValuesSet = new Set(slashValues.map((value) => `${value}`));
  const filtered = strengths.filter(
    (strength) =>
      !(
        strength?.kind === 'simple' &&
        strength.unit === slashStrength.unit &&
        strength.value != null &&
        slashValuesSet.has(`${strength.value}`)
      ),
  );

  return [slashStrength, ...filtered];
}

function inferInhalationPerDoseStrengths(strengths, normalizedText, dosageForm) {
  if (dosageForm !== 'aerosol' && dosageForm !== 'inhaler') return strengths;
  if (
    !/(?:^|[^\p{L}\p{N}])доз(?:ир)?(?=$|[^\p{L}\p{N}])[^\d]{0,24}\d+(?:\.\d+)?\s*\/\s*\d/iu.test(
      normalizedText || '',
    )
  ) {
    return strengths;
  }

  return strengths.map((strength) => {
    const values = Array.isArray(strength?.values) ? strength.values : [];
    if (
      strength?.kind !== 'simple' ||
      values.length < 2 ||
      strength.value != null ||
      !strength.unit
    ) {
      return strength;
    }

    const unit = String(strength.unit).toLowerCase();
    if (unit !== 'мкг' && unit !== 'мг') return strength;

    return {
      ...strength,
      kind: 'ratio',
      text: `${values.map(formatNormalizedNumber).join('/')} ${unit}/доз`,
      denominator: { value: null, unit: 'доз' },
    };
  });
}

// Listings like "Азмасол ... 100мкг/200 доз" glue the per-dose mass and the
// total dose count into one ratio "100 мкг/200 доз". The product semantic is
// "100 mcg per single dose, 200 doses per container" — i.e. the "200 доз" is
// volume, not the strength's denominator. Indexed catalog rows store strength
// as "100 мкг/доз" and volume as "200 доз". Without simplification, the
// strict Typesense filter `strength:="100 мкг/200 доз"` excludes those rows.
function simplifyInhalationDoseRatios(strengths, volumes, dosageForm) {
  if (dosageForm !== 'aerosol' && dosageForm !== 'inhaler' && dosageForm !== 'spray') {
    return { strengths, volumes };
  }

  const newStrengths = [];
  const newVolumes = [...(volumes || [])];

  const MASS_NUMERATOR_UNITS = new Set(['мг', 'мкг']);

  for (const strength of strengths || []) {
    if (
      strength?.kind === 'ratio' &&
      MASS_NUMERATOR_UNITS.has(String(strength.unit || '').toLowerCase()) &&
      strength.denominator?.unit === 'доз' &&
      Number.isFinite(strength.denominator.value) &&
      strength.denominator.value > 1
    ) {
      const doseCount = strength.denominator.value;
      const alreadyHasDoseVolume = newVolumes.some(
        (volume) => volume?.unit === 'доз' && volume?.value === doseCount,
      );
      if (!alreadyHasDoseVolume) {
        newVolumes.push({
          text: `${formatNormalizedNumber(doseCount)} доз`,
          value: doseCount,
          unit: 'доз',
        });
      }

      const numeratorText = Array.isArray(strength.values)
        ? strength.values.map(formatNormalizedNumber).join('/')
        : formatNormalizedNumber(strength.value);
      newStrengths.push({
        ...strength,
        text: `${numeratorText} ${strength.unit}/доз`,
        denominator: { value: null, unit: 'доз' },
      });
    } else {
      newStrengths.push(strength);
    }
  }

  return { strengths: newStrengths, volumes: newVolumes };
}

module.exports = {
  buildMeasurementNode,
  buildMeasurementNodeFromStrength,
  buildSimpleStrengthNode,
  buildCombinationStrengthNode,
  buildRatioStrengthNode,
  collectNumericSequence,
  buildPercentStrengthNode,
  buildPlusSeparatedSharedUnitStrength,
  buildPlusSeparatedSharedDenominatorRatioStrength,
  buildMultiComponentRatioStrength,
  buildStrengthNode,
  buildCombinationStrengthCandidate,
  isDuplicateTotalStrengthMarker,
  toPublicStrengthNode,
  toPublicMeasurementNode,
  dedupePublicNodes,
  mergeSameUnitSlashStrength,
  inferInhalationPerDoseStrengths,
  simplifyInhalationDoseRatios,
};
