const { parseMedicineQuery } = require('./parser');
const { isBrandOnlyProductType } = require('./parser/product-type');
const {
  buildQueryVariants,
  normalizeQuery,
  transliterateLatinToCyrillic,
} = require('./medicine-fuzzy-search');
const { normalizeSqlTerm } = require('./medicine-lookup-common');

const VOLUME_LIKE_UNITS = new Set(['мл', 'л', 'г']);
const CONTAINER_TOKEN_RE =
  /(^|\s)(фл\.?|флак\.?|флакон(?:ы|а|е|ов|ам|ами|ах)?|амп(?:\.|ул(?:ы|а|е|ов|ам|ами|ах)?)?|карт(?:\.|ридж(?:и|а|ей|ам|ами|ах)?)?|блистер(?:ы|а|е|ов|ам|ами|ах)?|туб(?:а|ы|е|у|ой|ами|ах)?|туб\.?|бутылк(?:а|и|е|у|ой|ами|ах)?|пакетик[а-я]*|пакет\.?|пакеты|саше|стик[а-я]*)(?=\s|$)/iu;

function parseTradeName(name) {
  if (!name) return null;
  const commaIndex = findDelimitedCommaIndex(name);
  if (commaIndex === -1) return name.trim() || null;
  return name.slice(0, commaIndex).trim() || null;
}

// Match a comma that isn't a decimal separator (skip `0,1`; split on `name, 5 мг`).
const DELIMITED_COMMA_RE = /(?<!\d),|,(?!\d)/u;

function findDelimitedCommaIndex(value) {
  return String(value || '').search(DELIMITED_COMMA_RE);
}

function normalizeStoredLookupValue(value) {
  const text = String(value || '').trim();
  return text ? text.toLowerCase() : null;
}

function normalizeTextList(values) {
  const items = [];
  const seen = new Set();

  for (const value of values || []) {
    const text = String(value || '').trim();
    const key = text.toLowerCase().replace(/ё/gu, 'е');
    if (!text || seen.has(key)) continue;
    seen.add(key);
    items.push(text);
  }

  return items;
}

function normalizeMeasurementTexts(measurements) {
  return normalizeTextList((measurements || []).map((measurement) => measurement?.text)).map(
    normalizeQuery,
  );
}

function joinStoredValues(values) {
  const items = normalizeTextList(values);
  return items.length ? items.join(', ') : null;
}

function joinMeasurements(texts, name) {
  if (!texts.length) return null;
  if (texts.length === 1) return texts[0];
  const slashJoined = texts.join('/');
  if (String(name || '').includes(slashJoined)) return slashJoined;
  return texts.join(', ');
}

function strengthValueKey(strength) {
  if (!strength) return null;
  const unit = strength.unit ? String(strength.unit).toLowerCase() : '';
  if (!unit) return null;
  const values =
    Array.isArray(strength.values) && strength.values.length > 0
      ? strength.values
      : strength.value != null
        ? [strength.value]
        : null;
  if (!values || values.length === 0) return null;
  return `${unit}|${values.join(',')}`;
}

function dedupeOverlappingStrengths(strengthObjects) {
  // The parser can emit the same numerator chemistry twice for a single
  // segment — once as a plain simple ("5 мг/0.1 мг") and once as the more
  // specific ratio that retained the unit denominator ("5/0.1 мг/доз").
  // The ratio carries strictly more information, so drop the bare simple
  // duplicate to avoid joining both texts into a noisy compound string.
  if (!Array.isArray(strengthObjects) || strengthObjects.length < 2) {
    return strengthObjects || [];
  }
  const ratioKeys = new Set();
  for (const strength of strengthObjects) {
    if (strength?.kind === 'ratio') {
      const key = strengthValueKey(strength);
      if (key) ratioKeys.add(key);
    }
  }
  if (ratioKeys.size === 0) return strengthObjects;
  return strengthObjects.filter((strength) => {
    if (strength?.kind !== 'simple') return true;
    const key = strengthValueKey(strength);
    return !key || !ratioKeys.has(key);
  });
}

function pickSegmentMeasurements(attributes) {
  const strengthObjects = dedupeOverlappingStrengths(attributes?.strengths || []);
  const strengths = strengthObjects.map((strength) => strength?.text).filter(Boolean);
  const volumes = (attributes?.volumes || []).map((volume) => volume?.text).filter(Boolean);

  if (volumes.length || strengths.length !== 1) {
    return { strengths, volumes };
  }

  const [singleStrength] = strengthObjects;
  if (singleStrength?.kind === 'simple' && VOLUME_LIKE_UNITS.has(singleStrength.unit)) {
    return {
      strengths: [],
      volumes: [singleStrength.text],
    };
  }

  return { strengths, volumes };
}

function dosageFormPriority(source) {
  if (source === 'explicit') return 2;
  if (source === 'inferred_from_container') return 1;
  return 0;
}

function hasExplicitContainerHint(text) {
  return CONTAINER_TOKEN_RE.test(String(text || '').toLowerCase());
}

function applyAttributeOverrides(parsed, overrides) {
  if (!overrides) return parsed;

  const attributes = { ...(parsed?.attributes || {}) };

  if (overrides.dosage_form !== undefined) {
    attributes.dosage_form = overrides.dosage_form || null;
  }

  if (overrides.strength !== undefined) {
    attributes.strengths = overrides.strength
      ? [{ kind: 'simple', text: String(overrides.strength) }]
      : [];
  }

  if (overrides.volume !== undefined) {
    attributes.volumes = overrides.volume ? [{ text: String(overrides.volume) }] : [];
  }

  return { ...parsed, attributes };
}

function shouldUseSegmentAttributes(segment, attributes, wholeTradeName) {
  const segmentText = normalizeQuery(segment);
  const segmentTradeName = normalizeQuery(attributes?.trade_name_text || '');
  const normalizedWholeTradeName = normalizeQuery(wholeTradeName || '');

  if (!segmentTradeName || !normalizedWholeTradeName) return true;
  if (segmentTradeName !== normalizedWholeTradeName) return true;

  return segmentText === normalizedWholeTradeName;
}

function buildBrandOnlyDetails(attributes) {
  return {
    trade_name: normalizeStoredLookupValue(attributes.trade_name_text),
    container_type: null,
    dosage_form: null,
    product_type: attributes.product_type || null,
    strength: null,
    volume: null,
    pack: Number.isInteger(attributes.pack_count) ? attributes.pack_count : null,
    strengthTexts: [],
    volumeTexts: [],
  };
}

function collectStructuredDetails(name) {
  const rawName = String(name || '').trim();
  const tradeName = parseTradeName(rawName);

  if (!rawName) {
    return {
      trade_name: null,
      container_type: null,
      dosage_form: null,
      product_type: null,
      strength: null,
      volume: null,
      pack: null,
      strengthTexts: [],
      volumeTexts: [],
    };
  }

  if (findDelimitedCommaIndex(rawName) === -1) {
    const wholeQuery = parseMedicineQuery(rawName).attributes;
    if (isBrandOnlyProductType(wholeQuery.product_type)) {
      return buildBrandOnlyDetails(wholeQuery);
    }

    return {
      trade_name: normalizeStoredLookupValue(tradeName),
      container_type: wholeQuery.dosage_form ? null : wholeQuery.container_type || null,
      dosage_form: null,
      product_type: wholeQuery.product_type || null,
      strength: null,
      volume: null,
      pack: null,
      strengthTexts: [],
      volumeTexts: [],
    };
  }

  const segments = rawName
    .split(/,(?!\d)/u)
    .map((segment) => segment.trim())
    .filter(Boolean);
  const wholeQuery = parseMedicineQuery(rawName).attributes;

  if (isBrandOnlyProductType(wholeQuery.product_type)) {
    return buildBrandOnlyDetails(wholeQuery);
  }

  const tradeNameSegmentQuery = parseMedicineQuery(tradeName).attributes;
  const strengthTexts = [];
  const volumeTexts = [];
  let dosageForm = tradeNameSegmentQuery.dosage_form || null;
  let dosageFormSource = tradeNameSegmentQuery.dosage_form_source || null;
  let containerType =
    tradeNameSegmentQuery.container_type && hasExplicitContainerHint(tradeName)
      ? tradeNameSegmentQuery.container_type
      : null;
  let pack = null;
  let productType = tradeNameSegmentQuery.product_type || null;

  for (const segment of segments.slice(1)) {
    const attributes = parseMedicineQuery(segment).attributes;
    if (!shouldUseSegmentAttributes(segment, attributes, wholeQuery.trade_name_text)) {
      continue;
    }
    const { strengths, volumes } = pickSegmentMeasurements(attributes);
    const hasSlash = segment.includes('/');

    strengthTexts.push(...(hasSlash && strengths.length > 1 ? [strengths.join('/')] : strengths));
    volumeTexts.push(...(hasSlash && volumes.length > 1 ? [volumes.join('/')] : volumes));

    if (attributes.container_type && !containerType && hasExplicitContainerHint(segment)) {
      containerType = attributes.container_type;
    }

    if (attributes.dosage_form) {
      const candidatePriority = dosageFormPriority(attributes.dosage_form_source);
      const currentPriority = dosageFormPriority(dosageFormSource);

      if (!dosageForm || candidatePriority > currentPriority) {
        dosageForm = attributes.dosage_form;
        dosageFormSource = attributes.dosage_form_source;
      }
    }

    if (pack == null && Number.isInteger(attributes.pack_count)) {
      pack = attributes.pack_count;
    }

    if (!productType && attributes.product_type) {
      productType = attributes.product_type;
    }
  }

  if (!containerType && wholeQuery.container_type && hasExplicitContainerHint(rawName)) {
    containerType = wholeQuery.container_type;
  }

  if (!containerType && wholeQuery.container_type && !dosageForm) {
    containerType = wholeQuery.container_type;
  }

  if (!dosageForm && wholeQuery.dosage_form) {
    dosageForm = wholeQuery.dosage_form;
  }

  if (pack == null && Number.isInteger(wholeQuery.pack_count)) {
    pack = wholeQuery.pack_count;
  }

  if (!productType && wholeQuery.product_type) {
    productType = wholeQuery.product_type;
  }

  const normalizedStrengths = normalizeTextList(strengthTexts);
  const normalizedVolumes = normalizeTextList(volumeTexts);
  if (!normalizedStrengths.length && !normalizedVolumes.length) {
    const { strengths: fallbackStrengths, volumes: fallbackVolumes } =
      pickSegmentMeasurements(wholeQuery);
    const fallbackStrength = joinMeasurements(fallbackStrengths, rawName);
    const fallbackVolume = joinMeasurements(fallbackVolumes, rawName);

    if (fallbackStrength) normalizedStrengths.push(fallbackStrength);
    if (fallbackVolume) normalizedVolumes.push(fallbackVolume);
  }
  return {
    trade_name: normalizeStoredLookupValue(tradeName),
    container_type: containerType,
    dosage_form: dosageForm,
    product_type: productType,
    strength: normalizeStoredLookupValue(joinStoredValues(normalizedStrengths)),
    volume: normalizeStoredLookupValue(joinStoredValues(normalizedVolumes)),
    pack,
    strengthTexts: normalizedStrengths,
    volumeTexts: normalizedVolumes,
  };
}

function extractMedicineDetails(name) {
  const { strengthTexts, volumeTexts, ...details } = collectStructuredDetails(name);
  return details;
}

function withoutMedicineAttributes(parsed, overrides = {}) {
  return {
    ...parsed.attributes,
    dosage_form: null,
    dosage_form_token: null,
    dosage_form_source: null,
    container_type: null,
    product_type: null,
    strengths: [],
    volumes: [],
    pack_count: null,
    ...overrides,
  };
}

function buildTradeOnlyParsed(parsed) {
  if (!parsed) return null;
  return { ...parsed, attributes: withoutMedicineAttributes(parsed) };
}

function buildBrandOnlyParsed(parsed, rawName) {
  if (!parsed) return null;

  const rawText = parsed.normalizedText || parsed?.attributes?.trade_name_text || rawName || '';
  const fullText =
    rawText === rawName
      ? normalizeQuery(rawText)
      : normalizeSqlTerm(rawText);
  if (!fullText) return null;

  return {
    ...parsed,
    normalizedText: fullText,
    attributes: withoutMedicineAttributes(parsed, {
      trade_name_text: fullText,
      product_type: isBrandOnlyProductType(parsed?.attributes?.product_type)
        ? parsed.attributes.product_type
        : null,
    }),
  };
}

function buildTradeNameVariantParsed(parsed, tradeNameText) {
  const normalizedTradeName = normalizeQuery(tradeNameText);
  if (!parsed || !normalizedTradeName) return null;

  return {
    ...parsed,
    attributes: {
      ...parsed.attributes,
      trade_name_text: normalizedTradeName,
      trade_name_tokens: normalizedTradeName.split(/\s+/u).filter(Boolean),
    },
  };
}

function buildStructuredTradeNameVariantParses(parsed) {
  const tradeNameText = normalizeQuery(parsed?.attributes?.trade_name_text || '');
  const attributes = parsed?.attributes || {};
  const hasDisambiguatingAttribute = Boolean(
    attributes.dosage_form ||
    (attributes.strengths || []).length ||
    (attributes.volumes || []).length ||
    (Number.isInteger(attributes.pack_count) && attributes.pack_count > 0),
  );

  if (!hasDisambiguatingAttribute) return [];
  if (!tradeNameText || !/[a-z]/iu.test(tradeNameText)) return [];

  const transliterated = normalizeQuery(transliterateLatinToCyrillic(tradeNameText));
  if (!transliterated || transliterated === tradeNameText) return [];

  return [buildTradeNameVariantParsed(parsed, transliterated)];
}

function buildProfileSignature(kind, parsed) {
  const attributes = parsed?.attributes || {};
  const tradeNameText = normalizeQuery(attributes.trade_name_text || '');
  const dosageForm = normalizeQuery(attributes.dosage_form || '');
  const strengthTexts = normalizeMeasurementTexts(attributes.strengths);
  const volumeTexts = normalizeMeasurementTexts(attributes.volumes);
  const pack = Number.isInteger(attributes.pack_count) ? attributes.pack_count : '';
  const productType = normalizeStoredLookupValue(attributes.product_type) || '';

  return JSON.stringify([
    kind,
    tradeNameText,
    dosageForm,
    strengthTexts,
    volumeTexts,
    pack,
    productType,
  ]);
}

function buildQueryLookupProfiles(rawName, overrides = {}, parseQuery = parseMedicineQuery) {
  const parsed = applyAttributeOverrides(parseQuery(rawName), overrides);
  const profiles = [];
  const seen = new Set();

  function add(kind, profileParsed) {
    if (!profileParsed?.attributes?.trade_name_text) return;

    const signature = buildProfileSignature(kind, profileParsed);
    if (seen.has(signature)) return;
    seen.add(signature);
    profiles.push({ kind, searchMode: kind, rawName, parsed: profileParsed });
  }

  if (
    parsed?.attributes?.trade_name_text &&
    !isBrandOnlyProductType(parsed?.attributes?.product_type)
  ) {
    add('structured', parsed);
    for (const variantParsed of buildStructuredTradeNameVariantParses(parsed)) {
      add('structured', variantParsed);
    }
    add('trade_only', buildTradeOnlyParsed(parsed));
  }

  add('brand_only', buildBrandOnlyParsed(parsed, rawName));

  return profiles;
}

function buildAliasTextsFromProfile(profile) {
  if (!profile?.parsed?.attributes?.trade_name_text) return [];

  const attributes = profile.parsed.attributes;
  const texts = new Set();
  const tradeNameText = normalizeQuery(attributes.trade_name_text || '');

  if (tradeNameText) texts.add(tradeNameText);

  if (profile.kind === 'structured') {
    const parts = [
      tradeNameText,
      normalizeQuery(attributes.dosage_form || ''),
      ...normalizeMeasurementTexts(attributes.strengths),
      ...normalizeMeasurementTexts(attributes.volumes),
    ].filter(Boolean);

    if (parts.length) {
      texts.add(parts.join(' '));
    }
  }

  return [...texts];
}

function buildMedicineSearchAliases(name, details = {}) {
  const profiles = buildQueryLookupProfiles(name, {
    dosage_form: details?.dosage_form,
    strength: details?.strength,
    volume: details?.volume,
  });
  const aliases = new Set();

  for (const profile of profiles) {
    for (const candidateText of buildAliasTextsFromProfile(profile)) {
      for (const variant of buildQueryVariants(candidateText)) {
        if (variant) aliases.add(variant);
      }
    }
  }

  return aliases.size ? [...aliases].join(' ') : null;
}

module.exports = {
  parseTradeName,
  normalizeStoredLookupValue,
  extractMedicineDetails,
  buildQueryLookupProfiles,
  buildMedicineSearchAliases,
  isBrandOnlyProductType,
};
