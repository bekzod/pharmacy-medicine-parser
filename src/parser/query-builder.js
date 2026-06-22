const {
  buildLikeAnyCondition,
  buildLikeAnyPredicates,
  escapeLikePattern,
} = require('../medicine-lookup-common');
const { isBrandOnlyProductType } = require('./product-type');

const BRAND_CANDIDATE_LIMIT_SINGLE = 50;
const BRAND_CANDIDATE_LIMIT_MIN = 200;
const BRAND_CANDIDATE_LIMIT_MAX = 250;
const BRAND_CANDIDATE_LIMIT_MULTIPLIER = 25;
const TRADE_NAME_TOKEN_LIMIT = 8;
const PACK_ONE_NULL_COMPATIBLE_DOSAGE_FORMS = new Set([
  'syrup',
  'solution',
  'suspension',
  'drops',
  'enema',
  'cream',
  'ointment',
  'gel',
  'paste',
]);
const TRADE_NAME_SCORE_PARTS = {
  structured: ['trade_name_score * 0.72'],
  trade_only: ['trade_name_score * 0.66'],
  brand_only: ['trade_name_score * 0.62', 'coalesce(name_score, 0) * 0.38'],
};

function buildDecimalVariants(value) {
  const normalized = normalizeMatchTerm(value);
  if (!normalized) return [];

  const variants = new Set([normalized]);
  if (/\d\.\d/u.test(normalized)) {
    variants.add(normalized.replace(/(\d)\.(\d)/gu, '$1,$2'));
  }
  if (/\d,\d/u.test(normalized)) {
    variants.add(normalized.replace(/(\d),(\d)/gu, '$1.$2'));
  }

  return [...variants];
}

function normalizeMatchTerm(value) {
  return String(value || '').toLowerCase().trim();
}

function buildCandidateLimit(limit, offset) {
  const requestedRows = Math.max(Number(limit) || 0, 1) + Math.max(Number(offset) || 0, 0);
  if (requestedRows <= 1) return BRAND_CANDIDATE_LIMIT_SINGLE;
  return Math.max(
    BRAND_CANDIDATE_LIMIT_MIN,
    Math.min(requestedRows * BRAND_CANDIDATE_LIMIT_MULTIPLIER, BRAND_CANDIDATE_LIMIT_MAX),
  );
}

function appendReplacementsWithVariants(
  replacements,
  prefix,
  values,
  variantBuilder = buildDecimalVariants,
) {
  const keys = [];

  values.forEach((value, valueIndex) => {
    variantBuilder(value).forEach((variant, variantIndex) => {
      const key = `${prefix}${valueIndex}_${variantIndex}`;
      replacements[key] = variant;
      keys.push(key);
    });
  });

  return keys;
}

function buildExactAnyPredicates(expressions, keys) {
  return expressions.flatMap((expression) => keys.map((key) => `${expression} = :${key}`));
}

function buildExactAnyCondition(expressions, keys) {
  return `(${buildExactAnyPredicates(expressions, keys).join(' OR ')})`;
}

function formatMeasurementNumber(value) {
  if (!Number.isFinite(value)) return null;
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(6))).replace(/\.?0+$/u, '');
}

function normalizeMeasurementValue(value, unit) {
  if (value == null) return null;
  const n = Number(value);
  if (!Number.isFinite(n) || !unit) return null;
  const normalizedUnit = String(unit).toLowerCase();
  if (normalizedUnit === 'г') return { value: n * 1000, unit: 'мг' };
  if (normalizedUnit === 'мг') return { value: n, unit: 'мг' };
  if (normalizedUnit === 'мкг') return { value: n / 1000, unit: 'мг' };
  if (normalizedUnit === 'л') return { value: n * 1000, unit: 'мл' };
  if (normalizedUnit === 'мл') return { value: n, unit: 'мл' };
  return { value: n, unit: normalizedUnit };
}

function addRatioEquivalentStrengthTexts(values, strength, volumes = []) {
  if (!strength || strength.kind !== 'ratio' || strength.value == null || !strength.unit) return;
  const numerator = normalizeMeasurementValue(strength.value, strength.unit);
  const denominator = normalizeMeasurementValue(
    strength.denominator?.value == null ? 1 : strength.denominator.value,
    strength.denominator?.unit,
  );
  if (!numerator || !denominator || denominator.value <= 0) return;
  if (denominator.unit !== 'мл') return;

  const concentration = formatMeasurementNumber(numerator.value / denominator.value);
  if (concentration) values.add(`${concentration} ${numerator.unit}/мл`);

  for (const volume of volumes) {
    const normalizedVolume = normalizeMeasurementValue(volume?.value, volume?.unit);
    if (!normalizedVolume || normalizedVolume.unit !== denominator.unit) continue;
    const total = formatMeasurementNumber(
      (numerator.value * normalizedVolume.value) / denominator.value,
    );
    if (total) values.add(`${total} ${numerator.unit}`);
  }
}

function buildDelimitedAnyPredicates(expressions, keys) {
  return expressions.flatMap((expression) =>
    keys.map(
      (key) =>
        `(${expression} = :${key} OR ${expression} LIKE :${key} || ',%' ESCAPE '\\' OR ${expression} LIKE '%, ' || :${key} ESCAPE '\\' OR ${expression} LIKE '%, ' || :${key} || ',%' ESCAPE '\\')`,
    ),
  );
}

function buildDelimitedAnyCondition(expressions, keys) {
  return `(${buildDelimitedAnyPredicates(expressions, keys).join(' OR ')})`;
}

function appendReplacementsWithVariantsGrouped(
  replacements,
  prefix,
  values,
  variantBuilder = buildDecimalVariants,
) {
  const groups = [];

  values.forEach((value, valueIndex) => {
    const keys = [];
    variantBuilder(value).forEach((variant, variantIndex) => {
      const key = `${prefix}${valueIndex}_${variantIndex}`;
      replacements[key] = variant;
      keys.push(key);
    });
    if (keys.length) groups.push(keys);
  });

  return groups;
}

function buildAttributeScoreExpression(attributeExpr, replacements, prefix, values) {
  const groups = appendReplacementsWithVariantsGrouped(replacements, prefix, values);
  if (!groups.length) return '0';

  const perValueExprs = groups.map((keys) => {
    const parts = keys.flatMap((key) => [
      `CASE WHEN ${attributeExpr} = :${key} THEN 1 ELSE 0 END`,
      `CASE WHEN ${attributeExpr} LIKE '%' || :${key} || '%' ESCAPE '\\' THEN 0.9 ELSE 0 END`,
    ]);
    return `GREATEST(${parts.join(', ')})`;
  });

  if (perValueExprs.length === 1) return perValueExprs[0];
  return `(${perValueExprs.join(' + ')}) / ${groups.length}`;
}

function buildStrengthSearchTexts(strengths) {
  const values = new Set();

  for (const strength of strengths) {
    if (!strength?.text) continue;
    values.add(strength.text);
    addSameUnitMultiValueStrengthTexts(values, strength);

    if (strength.kind === 'combination') {
      for (const component of strength.components || []) {
        if (component?.value == null || !component.unit) continue;
        values.add(`${String(component.value)} ${component.unit}`);
      }
      continue;
    }

    if (strength.value != null && strength.unit) {
      values.add(
        strength.unit === '%'
          ? `${String(strength.value)}%`
          : `${String(strength.value)} ${strength.unit}`,
      );
    }
  }

  return [...values];
}

function addSameUnitComponentTextVariants(
  values,
  numericValues,
  unit,
  { includeStandaloneComponents = true } = {},
) {
  if (!numericValues.length || !unit) return;

  const normalizedUnit = String(unit).toLowerCase();
  const formattedValues = numericValues.map(formatMeasurementNumber).filter(Boolean);
  if (formattedValues.length !== numericValues.length) return;

  const componentTexts = formattedValues.map((value) => `${value} ${normalizedUnit}`);
  const reversedComponentTexts = [...componentTexts].reverse();
  const reversedValues = [...formattedValues].reverse();

  values.add(`${formattedValues.join('/')} ${normalizedUnit}`);
  values.add(`${reversedValues.join('/')} ${normalizedUnit}`);
  values.add(componentTexts.join('/'));
  values.add(componentTexts.join(', '));
  values.add(reversedComponentTexts.join('/'));
  values.add(reversedComponentTexts.join(', '));

  if (includeStandaloneComponents) {
    for (const componentText of componentTexts) {
      values.add(componentText);
    }
  }
}

function addSameUnitMultiValueStrengthTexts(values, strength) {
  if (strength?.kind !== 'simple' || !strength.unit) return;

  const numericValues = Array.isArray(strength.values)
    ? strength.values.map((value) => Number(value)).filter((value) => Number.isFinite(value))
    : [];
  if (numericValues.length < 2 || numericValues.length !== strength.values.length) return;

  addSameUnitComponentTextVariants(values, numericValues, strength.unit);
}

function buildStrictStrengthSearchTexts(strengths, volumes = []) {
  const values = new Set();
  const validStrengths = (strengths || []).filter((strength) => strength?.text);

  if (
    validStrengths.length > 1 &&
    validStrengths.every((strength) => strength.kind === 'simple')
  ) {
    const simpleStrengthTexts = validStrengths.map((strength) => strength.text);
    values.add(simpleStrengthTexts.join('/'));
    values.add(simpleStrengthTexts.join(', '));
    return [...values];
  }

  for (const strength of validStrengths) {
    values.add(strength.text);
    addSameUnitMultiValueStrengthTexts(values, strength);
    addRatioEquivalentStrengthTexts(values, strength, volumes);

    if (strength.kind === 'combination') {
      const components = Array.isArray(strength.components) ? strength.components : [];
      const units = [...new Set(components.map((component) => component?.unit).filter(Boolean))];
      if (components.length > 1 && units.length === 1 && String(units[0]).toLowerCase() === 'мг') {
        const componentValues = components
          .map((component) => Number(component?.value))
          .filter((value) => Number.isFinite(value));
        if (componentValues.length === components.length) {
          addSameUnitComponentTextVariants(values, componentValues, units[0], {
            includeStandaloneComponents: false,
          });
          const totalValue = componentValues.reduce((sum, value) => sum + value, 0);
          const formattedTotalValue = formatMeasurementNumber(totalValue);
          if (formattedTotalValue) {
            values.add(`${formattedTotalValue} ${units[0]}`);
            values.add(`${formatMeasurementNumber(totalValue / 1000)} г`);
          }
        }
      }
      continue;
    }

    if (strength.kind !== 'simple') continue;
    if (strength.value == null) continue;
    const value = Number(strength.value);
    if (!Number.isFinite(value) || !strength.unit) continue;

    const unit = String(strength.unit).toLowerCase();
    if (unit === 'г') values.add(`${String(value * 1000)} мг`);
    if (unit === 'мг') values.add(`${String(value / 1000)} г`);
    if (unit === 'мкг') values.add(`${String(value / 1000)} мг`);
  }

  return [...values];
}

function buildVolumeSearchTexts(volumes) {
  const values = new Set();

  for (const volume of volumes) {
    if (volume?.text) values.add(volume.text);
  }

  return [...values];
}

function unitValuesMatch(left, right) {
  if (!left || !right) return false;
  if (left.value == null || right.value == null) return false;
  const leftValue = Number(left.value);
  const rightValue = Number(right.value);
  if (!Number.isFinite(leftValue) || !Number.isFinite(rightValue)) return false;
  if (!left.unit || !right.unit) return false;
  return String(left.unit).toLowerCase() === String(right.unit).toLowerCase() &&
    Math.abs(leftValue - rightValue) < 0.000001;
}

function buildStrictVolumeSearchTexts(volumes, strengths) {
  const ratioDenominators = (strengths || [])
    .filter((strength) => strength?.kind === 'ratio' && strength.denominator)
    .map((strength) => strength.denominator);

  return buildVolumeSearchTexts(
    (volumes || []).filter(
      (volume) =>
        !ratioDenominators.some(
          (denominator) =>
            unitValuesMatch(volume, denominator) ||
            (volume?.text &&
              denominator?.text &&
              normalizeMatchTerm(volume.text) === normalizeMatchTerm(denominator.text)),
        ),
    ),
  );
}

function allowsDeviceStoredProductTypeFallback(attributes) {
  return Boolean(
    attributes?.product_type === 'medicine' &&
      ['injection', 'suspension'].includes(attributes?.dosage_form) &&
      (attributes?.volumes || []).length &&
      Number.isInteger(attributes?.pack_count) &&
      attributes.pack_count > 0,
  );
}

function buildTradeNameTokenSearchTexts(tradeNameTokens) {
  const values = new Set();

  for (const token of tradeNameTokens || []) {
    if (values.size >= TRADE_NAME_TOKEN_LIMIT) break;
    const normalized = normalizeMatchTerm(token);
    if (!normalized) continue;
    if (normalized.length < 2) continue;
    if (
      /^n\d*$/u.test(normalized) ||
      /^\d+(?:\.\d+)?$/u.test(normalized) ||
      /^\d+x\d+$/u.test(normalized)
    ) {
      continue;
    }
    values.add(normalized);
  }

  return [...values];
}

function buildSimilarityExpression(columnExpr, includeTrigram) {
  const parts = [
    `CASE WHEN ${columnExpr} = :tradeNameQuery THEN 1 ELSE 0 END`,
    `CASE WHEN ${columnExpr} LIKE :tradeNamePrefix || '%' ESCAPE '\\' THEN 0.98 ELSE 0 END`,
  ];

  if (includeTrigram) {
    parts.push(
      `CASE WHEN ${columnExpr} LIKE '%' || :tradeNamePrefix || '%' ESCAPE '\\' THEN 0.92 ELSE 0 END`,
      `similarity(${columnExpr}, :tradeNameQuery)`,
      `word_similarity(${columnExpr}, :tradeNameQuery)`,
    );
  }

  return `GREATEST(${parts.join(', ')})`;
}

function buildBrandOnlyNameSimilarityExpression(columnExpr, includeTrigram) {
  const base = buildSimilarityExpression(columnExpr, includeTrigram);
  return `(${base}) * 0.82`;
}

function buildCandidateIdBranches(candidateBaseConditions, candidateJoinSql, candidatePredicates) {
  return candidatePredicates
    .map(
      (predicate) => `(
        SELECT m.id
        FROM medicines m
        ${candidateJoinSql}
        WHERE ${[...candidateBaseConditions, predicate].join('\n          AND ')}
        LIMIT :candidateLimit
      )`,
    )
    .join('\n      UNION\n      ');
}

function buildMedicineSearchQuery(parsedQuery, options = {}) {
  const { attributes } = parsedQuery || {};
  if (!attributes?.trade_name_tokens?.length) return null;
  const searchMode =
    options.searchMode || (isBrandOnlyProductType(attributes.product_type) ? 'brand_only' : 'structured');
  const brandOnlySearch = searchMode === 'brand_only';
  const structuredSearch = searchMode === 'structured';
  const includeTrigram = options.includeTrigram !== false;
  const includeTokenFallback = brandOnlySearch && options.includeTokenFallback !== false;
  const requireParsedAttributeMatch = options.requireParsedAttributeMatch === true;

  const threshold = Number.isFinite(options.threshold) ? options.threshold : 0.25;
  const limit = Number.isFinite(options.limit) ? Math.max(options.limit, 1) : 10;
  const offset = Number.isFinite(options.offset) ? Math.max(options.offset, 0) : 0;
  const vendorIds = Array.isArray(options.vendorIds)
    ? options.vendorIds
        .map((id) => (id == null ? null : String(id).trim()))
        .filter(Boolean)
    : [];
  const candidateLimit = Number.isFinite(options.candidateLimit)
    ? Math.max(Math.trunc(options.candidateLimit), limit + offset, 1)
    : buildCandidateLimit(limit, offset);
  const tradeNameQuery = normalizeMatchTerm(attributes.trade_name_text);
  const tradeNamePrefix = escapeLikePattern(tradeNameQuery);

  const replacements = {
    threshold,
    limit,
    offset,
    candidateLimit,
  };
  const normalizedTradeNameExpr = 'm.trade_name';
  const normalizedNameExpr = 'lower((m.name)::text)';
  const normalizedAttributeExpr =
    "concat_ws(' ', lower(coalesce(m.strength, '')), lower(coalesce(m.volume, '')))";
  const normalizedAttributeOrNameExpr =
    "concat_ws(' ', lower(coalesce(m.strength, '')), lower(coalesce(m.volume, '')), lower(coalesce(m.trade_name, '')), lower((m.name)::text))";
  const normalizedStrengthExpr = "lower(coalesce(m.strength, ''))";
  const normalizedVolumeExpr = "lower(coalesce(m.volume, ''))";
  const normalizedVendorCountryExpr = "lower(coalesce(v.country_name, ''))";
  const needsVendorCountryJoin = Boolean(attributes.vendor_country_text);
  const strictParsedAttributeFilters = options.strictParsedAttributeFilters === true;
  const tradeNameTokenSearchTexts = includeTokenFallback
    ? buildTradeNameTokenSearchTexts([
        String(attributes.trade_name_text || '')
          .split(/\s+/u)
          .filter(Boolean)[0],
        ...(attributes.trade_name_tokens || []),
      ])
    : [];

  replacements.tradeNameQuery = tradeNameQuery;
  replacements.tradeNamePrefix = tradeNamePrefix;
  const tradeNameCandidatePredicates = [
    `${normalizedTradeNameExpr} = :tradeNameQuery`,
    `${normalizedTradeNameExpr} LIKE :tradeNamePrefix || '%' ESCAPE '\\'`,
  ];
  if (!brandOnlySearch) {
    tradeNameCandidatePredicates.push(
      `${normalizedNameExpr} = :tradeNameQuery`,
      `${normalizedNameExpr} LIKE :tradeNamePrefix || '%' ESCAPE '\\'`,
    );
  }
  const nameCandidatePredicates = brandOnlySearch
    ? [
        `${normalizedNameExpr} = :tradeNameQuery`,
        `${normalizedNameExpr} LIKE :tradeNamePrefix || '%' ESCAPE '\\'`,
      ]
    : [];
  if (includeTrigram) {
    tradeNameCandidatePredicates.push(`${normalizedTradeNameExpr} % :tradeNameQuery`);
    if (brandOnlySearch) {
      nameCandidatePredicates.push(`${normalizedNameExpr} % :tradeNameQuery`);
    }
  }
  let tradeNameTokenKeys = [];
  if (tradeNameTokenSearchTexts.length) {
    tradeNameTokenKeys = appendReplacementsWithVariants(
      replacements,
      'tradeNameToken',
      tradeNameTokenSearchTexts,
    );
    tradeNameCandidatePredicates.push(
      ...buildLikeAnyPredicates(
        brandOnlySearch ? [normalizedTradeNameExpr, normalizedNameExpr] : [normalizedTradeNameExpr],
        tradeNameTokenKeys,
      ),
    );
  }

  const tradeNameSimilarityExpression = buildSimilarityExpression(normalizedTradeNameExpr, includeTrigram);
  const nameSimilarityExpression = brandOnlySearch
    ? buildBrandOnlyNameSimilarityExpression(normalizedNameExpr, includeTrigram)
    : null;
  const candidateOrderExpression = brandOnlySearch
    ? `GREATEST(${tradeNameSimilarityExpression}, coalesce(${nameSimilarityExpression}, 0))`
    : tradeNameSimilarityExpression;
  const scoreParts = [...TRADE_NAME_SCORE_PARTS[searchMode]];

  if (tradeNameTokenKeys.length) {
    const tokenLikeExprs = brandOnlySearch
      ? [normalizedTradeNameExpr, normalizedNameExpr]
      : [normalizedTradeNameExpr];
    const partialParts = tradeNameTokenKeys.map((key) => {
      const predicate = buildLikeAnyPredicates(tokenLikeExprs, [key]).join(' OR ');
      return `CASE WHEN ${tokenLikeExprs.length > 1 ? `(${predicate})` : predicate} THEN 0.6 ELSE 0 END`;
    });
    const tradeNameTokenScoreExpression = `LEAST(${partialParts.join(' + ')}, 1.8)`;
    scoreParts.push(`(${tradeNameTokenScoreExpression}) * 0.18`);
  }

  if (structuredSearch && attributes.dosage_form) {
    replacements.dosageForm = attributes.dosage_form;
    scoreParts.push(`CASE WHEN m.dosage_form = :dosageForm THEN 0.12 ELSE 0 END`);
  }

  if (structuredSearch && attributes.product_type) {
    replacements.productType = attributes.product_type;
    scoreParts.push(`CASE WHEN m.product_type = :productType THEN 0.1 ELSE 0 END`);
  }

  const includeMeasurementSearchTexts = structuredSearch || requireParsedAttributeMatch;
  const strengthSearchTexts = includeMeasurementSearchTexts
    ? strictParsedAttributeFilters
      ? buildStrictStrengthSearchTexts(attributes.strengths || [], attributes.volumes || [])
      : buildStrengthSearchTexts(attributes.strengths || [])
    : [];
  if (strengthSearchTexts.length && structuredSearch) {
    const strengthScoreExpression = buildAttributeScoreExpression(
      normalizedAttributeExpr,
      replacements,
      'strength',
      strengthSearchTexts,
    );
    scoreParts.push(`(${strengthScoreExpression}) * 0.11`);
  }

  const volumeSearchTexts = includeMeasurementSearchTexts
    ? strictParsedAttributeFilters
      ? buildStrictVolumeSearchTexts(attributes.volumes || [], attributes.strengths || [])
      : buildVolumeSearchTexts(attributes.volumes || [])
    : [];
  if (volumeSearchTexts.length && structuredSearch) {
    const volumeScoreExpression = buildAttributeScoreExpression(
      normalizedAttributeExpr,
      replacements,
      'volume',
      volumeSearchTexts,
    );
    scoreParts.push(`(${volumeScoreExpression}) * 0.08`);
  }

  if (attributes.vendor_country_text) {
    const vendorCountryScoreExpression = buildAttributeScoreExpression(
      'm.normalized_vendor_country',
      replacements,
      'vendorCountry',
      [attributes.vendor_country_text],
    );
    scoreParts.push(`(${vendorCountryScoreExpression}) * 0.06`);
  }

  const hasParsedPackCount =
    Number.isInteger(attributes.pack_count) && attributes.pack_count > 0;
  if (hasParsedPackCount) {
    replacements.packCount = attributes.pack_count;
    if (structuredSearch) {
      scoreParts.push(`CASE WHEN m.pack = :packCount THEN 0.07 ELSE 0 END`);
    }
  }

  const scoreExpression = scoreParts.join(' + ');
  const candidateBaseConditions = [
    brandOnlySearch ? '(m.trade_name IS NOT NULL OR m.name IS NOT NULL)' : 'm.trade_name IS NOT NULL',
  ];
  const candidatePredicates = [...tradeNameCandidatePredicates, ...nameCandidatePredicates];
  if (needsVendorCountryJoin) {
    const vendorCountryKeys = appendReplacementsWithVariants(
      replacements,
      'vendorCountryFilter',
      [attributes.vendor_country_text],
      (value) => [normalizeMatchTerm(value)],
    );
    candidateBaseConditions.push(buildLikeAnyCondition([normalizedVendorCountryExpr], vendorCountryKeys));
  }
  if (structuredSearch && attributes.product_type) {
    candidateBaseConditions.push(
      allowsDeviceStoredProductTypeFallback(attributes)
        ? "(m.product_type = :productType OR m.product_type = 'device' OR m.product_type IS NULL)"
        : '(m.product_type = :productType OR m.product_type IS NULL)',
    );
  }
  const relaxPackOneNullMatch =
    attributes.pack_count === 1 && PACK_ONE_NULL_COMPATIBLE_DOSAGE_FORMS.has(attributes.dosage_form);
  if (hasParsedPackCount && requireParsedAttributeMatch) {
    candidateBaseConditions.push(
      relaxPackOneNullMatch ? '(m.pack = :packCount OR m.pack IS NULL)' : 'm.pack = :packCount',
    );
  } else if (hasParsedPackCount) {
    candidateBaseConditions.push('(m.pack = :packCount OR m.pack IS NULL)');
  }
  if (requireParsedAttributeMatch && strengthSearchTexts.length) {
    const strengthFilterKeys = appendReplacementsWithVariants(
      replacements,
      'strengthFilter',
      strengthSearchTexts,
    );
    const strengthFilterCondition = strictParsedAttributeFilters
      ? `(${[
          buildDelimitedAnyCondition([normalizedStrengthExpr], strengthFilterKeys),
          buildExactAnyCondition([normalizedVolumeExpr], strengthFilterKeys),
        ].join(' OR ')})`
      : buildLikeAnyCondition([normalizedAttributeOrNameExpr], strengthFilterKeys);
    // A candidate with no stored strength cannot contradict the parsed strength (omission is
    // not a mismatch), so admit it and let scoring rank it — otherwise an exact-name match with
    // a NULL/blank strength (e.g. a trade name stored without dosage) is dropped from recall in
    // favour of a trigram-similar different brand that merely happens to carry the parsed strength.
    candidateBaseConditions.push(`(${strengthFilterCondition} OR ${normalizedStrengthExpr} = '')`);
  }
  if (requireParsedAttributeMatch && volumeSearchTexts.length) {
    const volumeFilterKeys = appendReplacementsWithVariants(
      replacements,
      'volumeFilter',
      volumeSearchTexts,
    );
    candidateBaseConditions.push(
      strictParsedAttributeFilters
        ? buildDelimitedAnyCondition([normalizedVolumeExpr], volumeFilterKeys)
        : buildLikeAnyCondition([normalizedAttributeOrNameExpr], volumeFilterKeys),
    );
  }
  if (vendorIds.length === 1) {
    replacements.vendorId = vendorIds[0];
    candidateBaseConditions.unshift('m.vendor_id = :vendorId');
  } else if (vendorIds.length > 1) {
    replacements.vendorIds = vendorIds;
    candidateBaseConditions.unshift('m.vendor_id IN (:vendorIds)');
  }

  const candidateJoinSql = needsVendorCountryJoin ? 'LEFT JOIN vendors v ON v.id = m.vendor_id' : '';
  const candidateSelectColumns = [
    'm.*',
    needsVendorCountryJoin && `${normalizedVendorCountryExpr} AS normalized_vendor_country`,
    `${tradeNameSimilarityExpression} AS trade_name_score`,
    brandOnlySearch && `${nameSimilarityExpression} AS name_score`,
  ]
    .filter(Boolean)
    .join(',\n        ');
  const useUnionCandidateIds = brandOnlySearch && !needsVendorCountryJoin && candidatePredicates.length > 1;
  const candidateCteSql = useUnionCandidateIds
    ? `candidate_ids AS MATERIALIZED (
      ${buildCandidateIdBranches(candidateBaseConditions, candidateJoinSql, candidatePredicates)}
    ),
    candidates AS MATERIALIZED (
      SELECT
        ${candidateSelectColumns}
      FROM medicines m
      JOIN candidate_ids ci ON ci.id = m.id
      ORDER BY ${candidateOrderExpression} DESC, m.trade_name ASC, m.id ASC
      LIMIT :candidateLimit
    )`
    : `candidates AS MATERIALIZED (
      SELECT
        ${candidateSelectColumns}
      FROM medicines m
      ${candidateJoinSql}
      WHERE ${[...candidateBaseConditions, `(${candidatePredicates.join(' OR ')})`].join('\n        AND ')}
      ORDER BY ${candidateOrderExpression} DESC, m.trade_name ASC, m.id ASC
      LIMIT :candidateLimit
    )`;

  const sql = `
    WITH ${candidateCteSql},
    scored AS (
      SELECT m.*, ${scoreExpression} AS score
      FROM candidates m
    )
    SELECT
      scored.*,
      v.name AS vendor_name,
      v.country_name AS vendor_country,
      v.aa_crawl_id AS vendor_aa_crawl_id
    FROM scored
    LEFT JOIN vendors v ON v.id = scored.vendor_id
    WHERE scored.score >= :threshold
    ORDER BY scored.score DESC, scored.trade_name ASC, scored.id ASC
    LIMIT :limit
    OFFSET :offset
  `;

  return {
    sql,
    replacements,
  };
}

module.exports = {
  buildMedicineSearchQuery,
  formatMeasurementNumber,
};
