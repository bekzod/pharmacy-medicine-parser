const {
  PREFILLED_RE,
  PRODUCT_TYPE_PATTERNS,
  SYRINGE_RE,
} = require('./constants');

function classifyProductType(rawQuery, normalizedText, { dosageForm, strengths, volumes } = {}) {
  const text = `${rawQuery || ''} ${normalizedText || ''}`.trim();
  const PHARMA_STRENGTH_UNITS = new Set(['мг', 'мкг', '%', 'ед', 'ме']);
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

// Pairs where both forms appear explicitly but only the first should win.
// e.g. "пор. д/сусп." (powder for suspension) is sold/stored as suspension,
// so keep suspension and drop powder regardless of encounter order.
const EXPLICIT_DOSAGE_FORM_KEEP_PAIRS = new Set([
  'spray|suspension',
  'enema|solution',
  'aerosol|inhaler',
  'suspension|powder',
  // "р-р д/внутрь и инг" (solution sold both for oral use and inhalation,
  // e.g. Лазолван 7,5 мг/мл): catalog rows store this as solution/drops, so
  // a trailing "инг" route hint must not override the primary solution form.
  // The reverse direction (genuine inhalers) never carries a "р-р" token —
  // "р-р д/инг" / "д/инг" are pre-normalized to bare " инг ".
  'solution|inhaler',
]);

function shouldKeepCurrentDosageForm({
  currentDosageForm,
  currentSource,
  nextDosageForm,
  nextSource,
}) {
  if (currentSource !== 'explicit' || nextSource !== 'explicit') return false;
  return EXPLICIT_DOSAGE_FORM_KEEP_PAIRS.has(`${currentDosageForm}|${nextDosageForm}`);
}

function shouldOverrideDosageFormForFinalForm(currentDosageForm, nextDosageForm) {
  return currentDosageForm === 'powder' && nextDosageForm === 'suspension';
}

module.exports = {
  classifyProductType,
  isBrandOnlyProductType,
  shouldKeepCurrentDosageForm,
  shouldOverrideDosageFormForFinalForm,
};
