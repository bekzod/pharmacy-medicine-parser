const {
  MEDICINE_FORM_PRIORITIES,
  parseDosageForm,
} = require('../medicine-dosage-forms');
const {
  MEDICINE_UNIT_TOKENS,
  normalizeMedicineToken,
} = require('../medicine-name-profile');
const {
  TOKEN_RE,
  UNIT_FAMILY_BY_VALUE,
} = require('./constants');
const {
  normalizeMedicineQuery,
  normalizeFormTokenValue,
  parseContainerType,
} = require('./normalization');

function classifyWordToken(token) {
  if (token === 'n') {
    return { type: 'COUNT_MARKER', normalizedValue: token };
  }

  if (/^\d+x\d+$/u.test(token)) {
    const [left, right] = token.split('x').map((value) => Number.parseInt(value, 10));
    return {
      type: 'COUNT_MULTIPLIER',
      normalizedValue: token,
      left,
      right,
      count: Number.isFinite(left) && Number.isFinite(right) ? left * right : null,
    };
  }

  const container = parseContainerType(token);
  const dosageForm = parseDosageForm(token);
  if (dosageForm) {
    const normalizedValue = normalizeFormTokenValue(token);
    return {
      type: 'DOSAGE_FORM',
      normalizedValue,
      dosageForm,
      dosageFormSource:
        container?.dosageForm === dosageForm ? 'inferred_from_container' : 'explicit',
      containerType: container?.containerType || null,
      priority: MEDICINE_FORM_PRIORITIES.get(normalizedValue) || 0,
    };
  }

  if (container) {
    return {
      type: 'CONTAINER',
      normalizedValue: container.containerType,
      containerType: container.containerType,
    };
  }

  const normalizedToken = normalizeMedicineToken(token);
  if (MEDICINE_UNIT_TOKENS.has(normalizedToken)) {
    return {
      type: 'UNIT',
      normalizedValue: normalizedToken,
      unitFamily: UNIT_FAMILY_BY_VALUE.get(normalizedToken) || 'other',
    };
  }

  if (!normalizedToken) {
    return {
      type: 'WORD',
      normalizedValue: '',
    };
  }

  return {
    type: 'WORD',
    normalizedValue: normalizedToken,
  };
}

function hasNumericMeasurementContext(tokens, index) {
  return tokens[index - 1]?.type === 'NUMBER' || tokens[index + 1]?.type === 'NUMBER';
}

function hasFollowingStrengthContext(tokens, index) {
  if (tokens[index - 1]?.type !== 'WORD' || tokens[index + 1]?.type !== 'NUMBER') return false;

  let cursor = index + 2;
  while (tokens[cursor]?.type === 'SLASH' && tokens[cursor + 1]?.type === 'NUMBER') {
    cursor += 2;
  }

  return tokens[cursor]?.type === 'UNIT' && ['мг', 'мкг', 'г'].includes(tokens[cursor].normalizedValue);
}

function restoreStandaloneLengthUnitTokens(tokens) {
  return tokens.map((token, index) => {
    if (
      token?.type !== 'UNIT' ||
      token.normalizedValue !== 'м' ||
      (hasNumericMeasurementContext(tokens, index) && !hasFollowingStrengthContext(tokens, index))
    ) {
      return token;
    }

    const { unitFamily, ...rest } = token;
    return {
      ...rest,
      type: 'WORD',
      normalizedValue: 'м',
    };
  });
}

function restorePlasticBottleAnnotationTokens(tokens) {
  return tokens.map((token, index) => {
    if (
      token?.type !== 'DOSAGE_FORM' ||
      token.dosageForm !== 'patch' ||
      token.normalizedValue !== 'пласт' ||
      tokens[index + 1]?.normalizedValue !== 'бут'
    ) {
      return token;
    }

    const {
      dosageForm,
      dosageFormSource,
      containerType,
      priority,
      ...rest
    } = token;
    return {
      ...rest,
      type: 'WORD',
      normalizedValue: 'пласт',
    };
  });
}

const BARE_KAP_DROP_CONTEXT_TOKENS = new Set([
  'глаз',
  'наз',
  'нос',
  'уш',
  'офтальм',
  'носовая',
  'носовое',
  'носового',
  'носовом',
  'носовому',
  'носовую',
  'носовые',
  'носовым',
  'носовыми',
  'носовых',
]);

function hasVolumeMeasurementAfter(tokens, index, lookahead = 6) {
  const end = Math.min(tokens.length - 1, index + lookahead);
  for (let cursor = index + 1; cursor < end; cursor += 1) {
    if (
      tokens[cursor]?.type === 'NUMBER' &&
      tokens[cursor + 1]?.type === 'UNIT' &&
      UNIT_FAMILY_BY_VALUE.get(tokens[cursor + 1].normalizedValue) === 'volume'
    ) {
      return true;
    }
  }
  return false;
}

function inferBareKapDosageForm(tokens, index, packCount) {
  const token = tokens[index];
  if (token?.type !== 'WORD' || token.normalizedValue !== 'кап') return null;

  const nextWord = tokens
    .slice(index + 1, Math.min(tokens.length, index + 4))
    .find((candidate) => candidate?.type === 'WORD' && candidate.normalizedValue);
  const previousWord = tokens
    .slice(Math.max(0, index - 3), index)
    .reverse()
    .find((candidate) => candidate?.type === 'WORD' && candidate.normalizedValue);
  if (
    (previousWord && BARE_KAP_DROP_CONTEXT_TOKENS.has(previousWord.normalizedValue)) ||
    (nextWord && BARE_KAP_DROP_CONTEXT_TOKENS.has(nextWord.normalizedValue)) ||
    hasVolumeMeasurementAfter(tokens, index)
  ) {
    return {
      dosageForm: 'drops',
      dosageFormSource: 'explicit',
      normalizedValue: 'капли',
      priority: MEDICINE_FORM_PRIORITIES.get('капли') || 0,
    };
  }

  if (packCount != null) {
    return {
      dosageForm: 'capsule',
      dosageFormSource: 'explicit',
      normalizedValue: 'капс',
      priority: MEDICINE_FORM_PRIORITIES.get('капс') || 0,
    };
  }

  return null;
}

function tokenizeNormalizedQuery(normalizedText) {
  if (!normalizedText) return [];

  const tokens = [...normalizedText.matchAll(TOKEN_RE)].flatMap((match) => {
    const value = match[0];
    const start = match.index || 0;
    const end = start + value.length;

    const compactMeasurement = value.match(/^(\d+(?:\.\d+)?)([a-zа-яё]+)$/iu);
    if (compactMeasurement) {
      const unit = normalizeMedicineToken(compactMeasurement[2]);
      if (MEDICINE_UNIT_TOKENS.has(unit)) {
        const numberValue = compactMeasurement[1];
        return [
          {
            type: 'NUMBER',
            value: numberValue,
            normalizedValue: numberValue,
            numericValue: Number.parseFloat(numberValue),
            start,
            end: start + numberValue.length,
          },
          {
            type: 'UNIT',
            value: compactMeasurement[2],
            normalizedValue: unit,
            unitFamily: UNIT_FAMILY_BY_VALUE.get(unit) || 'other',
            start: start + numberValue.length,
            end,
          },
        ];
      }
    }

    if (value === '%') {
      return { type: 'PERCENT', value, normalizedValue: value, start, end };
    }

    if (value === '/') {
      return { type: 'SLASH', value, normalizedValue: value, start, end };
    }

    if (value === '+') {
      return { type: 'PLUS', value, normalizedValue: value, start, end };
    }

    if (/^\d+(?:\.\d+)?$/u.test(value)) {
      return {
        type: 'NUMBER',
        value,
        normalizedValue: value,
        numericValue: Number.parseFloat(value),
        start,
        end,
      };
    }

    return {
      value,
      start,
      end,
      ...classifyWordToken(value),
    };
  });

  return restorePlasticBottleAnnotationTokens(restoreStandaloneLengthUnitTokens(tokens));
}

function tokenizeMedicineQuery(rawQuery) {
  return tokenizeNormalizedQuery(normalizeMedicineQuery(rawQuery));
}

module.exports = {
  classifyWordToken,
  tokenizeNormalizedQuery,
  tokenizeMedicineQuery,
  inferBareKapDosageForm,
};
