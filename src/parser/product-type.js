const {
  PREFILLED_RE,
  PRODUCT_TYPE_PATTERNS,
  SYRINGE_RE,
} = require('./constants');

const PHARMA_STRENGTH_UNITS = new Set(['мг', 'мкг', '%', 'ед', 'ме']);

function classifyProductType(rawQuery, normalizedText, { dosageForm, strengths, volumes } = {}) {
  const text = `${rawQuery || ''} ${normalizedText || ''}`.trim();
  const hasPharmaStrength = (strengths || []).some(
    (s) =>
      (s.kind === 'simple' && PHARMA_STRENGTH_UNITS.has(s.unit)) ||
      s.kind === 'ratio' ||
      s.kind === 'combination',
  );
  const hasLiquidVolume = (volumes || []).some((v) => v.unit === 'мл' || v.unit === 'л');
  const hasInjectableRouteSignal = /инъекц|подкож|внутримыш|внутривен|введ/iu.test(text);
  const hasPrefilledSignal = PREFILLED_RE.test(text);
  const hasSyringeSignal = SYRINGE_RE.test(text);
  const hasInjectableMedicineSignal =
    dosageForm === 'injection' ||
    hasInjectableRouteSignal ||
    (hasSyringeSignal && hasPrefilledSignal);

  for (const pattern of PRODUCT_TYPE_PATTERNS.medicine) {
    if (pattern.test(text)) return 'medicine';
  }

  for (const pattern of PRODUCT_TYPE_PATTERNS.other) {
    if (pattern.test(text)) return 'other';
  }

  if (dosageForm && hasSyringeSignal && hasPrefilledSignal) return 'medicine';
  if (hasPharmaStrength && hasInjectableMedicineSignal) return 'medicine';

  for (const pattern of PRODUCT_TYPE_PATTERNS.devicePrimary) {
    if (pattern.test(text)) return 'device';
  }

  if (dosageForm) return 'medicine';

  for (const pattern of PRODUCT_TYPE_PATTERNS.deviceAccessory) {
    if (pattern.test(text)) return 'device';
  }

  if (hasPharmaStrength || hasLiquidVolume) {
    return 'medicine';
  }

  return null;
}

function isBrandOnlyProductType(productType) {
  return productType === 'device' || productType === 'other';
}

module.exports = {
  classifyProductType,
  isBrandOnlyProductType,
};
