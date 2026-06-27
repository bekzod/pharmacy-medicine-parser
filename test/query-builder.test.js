const test = require('node:test');
const assert = require('node:assert/strict');
const {
  parseMedicineQuery,
  buildMedicineSearchQuery,
} = require('../src');
const { formatMeasurementNumber } = require('../src/parser/query-builder');

test('exports measurement formatter for lookup compatibility', () => {
  assert.equal(formatMeasurementNumber(2.5000001), '2.5');
  assert.equal(formatMeasurementNumber(10), '10');
});

test('admits candidates with no stored strength under strict strength recall', () => {
  const parsed = parseMedicineQuery('синуприн капс 250 мг №60');
  const searchQuery = buildMedicineSearchQuery(parsed, {
    limit: 5,
    requireParsedAttributeMatch: true,
    strictParsedAttributeFilters: true,
  });

  // The strength must have been parsed, otherwise the strength filter would not apply at all.
  assert.ok(
    Object.values(searchQuery.replacements).includes('250 мг'),
    'expected the parsed strength to feed the candidate filter',
  );
  // A candidate whose stored strength is NULL/blank cannot contradict the parsed strength, so it
  // must not be excluded from recall — otherwise an exact trade-name match with no stored dosage
  // (e.g. "Синуприн") is dropped in favour of a trigram-similar different brand carrying 250 мг.
  assert.ok(
    searchQuery.sql.includes("OR lower(coalesce(m.strength, '')) = ''"),
    'expected the strength filter to admit candidates with NULL/blank strength',
  );
  assert.ok(
    !searchQuery.sql.includes("replace(lower(coalesce(m.strength, '')), 'ё', 'е')"),
    'expected strict strength recall not to normalize ё/е in SQL',
  );
});

test('strict strength recall matches comma-delimited stored strength components', () => {
  const parsed = parseMedicineQuery('АЛЬБУНОРМ Р-Р 20% 50МЛ');
  const searchQuery = buildMedicineSearchQuery(parsed, {
    limit: 5,
    requireParsedAttributeMatch: true,
    strictParsedAttributeFilters: true,
  });

  const normalizedStrengthExpr = "lower(coalesce(m.strength, ''))";

  assert.ok(
    Object.values(searchQuery.replacements).includes('20%'),
    'expected the parsed 20% strength to feed the candidate filter',
  );
  assert.ok(
    searchQuery.sql.includes(`${normalizedStrengthExpr} = :strengthFilter0_0`),
    'expected strict strength recall to keep exact component matching',
  );
  assert.ok(
    searchQuery.sql.includes(`${normalizedStrengthExpr} LIKE :strengthFilter0_0 || ',%'`),
    'expected strict strength recall to match the first component in comma-delimited strength',
  );
  assert.ok(
    searchQuery.sql.includes(`${normalizedStrengthExpr} LIKE '%, ' || :strengthFilter0_0`),
    'expected strict strength recall to match later comma-delimited strength components',
  );
  assert.ok(
    !searchQuery.sql.includes(`${normalizedStrengthExpr} LIKE '%' || :strengthFilter0_0 || '%'`),
    'expected strict strength recall not to use broad substring matching',
  );
});

test('strict fallback adds mg/ml equivalents for percent strengths', () => {
  const parsed = parseMedicineQuery('Риназолин спрей 0.05% 15мл');
  const searchQuery = buildMedicineSearchQuery(parsed, {
    limit: 5,
    requireParsedAttributeMatch: true,
    strictParsedAttributeFilters: true,
  });

  assert.ok(
    Object.values(searchQuery.replacements).includes('0.5 мг/мл'),
    'expected percent strength to add mg/ml equivalent',
  );
});

test('strict fallback adds mg/g equivalents for percent mass products', () => {
  const parsed = parseMedicineQuery('Артрокол гель 2.5%/45г№1');
  const searchQuery = buildMedicineSearchQuery(parsed, {
    limit: 5,
    requireParsedAttributeMatch: true,
    strictParsedAttributeFilters: true,
  });

  const replacementValues = Object.values(searchQuery.replacements);
  assert.ok(
    replacementValues.includes('25 мг/г'),
    'expected percent strength with mass package to add mg/g equivalent',
  );
  assert.ok(
    !replacementValues.includes('25 мг/мл'),
    'expected percent strength with mass package not to add mg/ml equivalent',
  );
});

test('strict fallback adds per-ml aliases for mass-denominator ratios', () => {
  const parsed = parseMedicineQuery('Тестовый р-р 100мг/г 120мл');
  const searchQuery = buildMedicineSearchQuery(parsed, {
    limit: 5,
    requireParsedAttributeMatch: true,
    strictParsedAttributeFilters: true,
  });

  const replacementValues = Object.values(searchQuery.replacements);
  assert.ok(replacementValues.includes('100 мг/г'), 'expected original mg/g ratio');
  assert.ok(replacementValues.includes('100 мг/мл'), 'expected mg/ml alias');
  assert.ok(replacementValues.includes('100 мг/1 мл'), 'expected explicit 1 ml alias');
  assert.ok(!replacementValues.includes('100 мг'), 'expected no numerator-only alias');
});

test('strict fallback does not add numerator-only aliases for per-ml ratios', () => {
  const parsed = parseMedicineQuery('Бримоптик капли 2мг/мл+5мг/мл 10мл');
  const searchQuery = buildMedicineSearchQuery(parsed, {
    limit: 5,
    requireParsedAttributeMatch: true,
    strictParsedAttributeFilters: true,
  });

  const replacementValues = Object.values(searchQuery.replacements);
  assert.ok(!replacementValues.includes('2 мг'), 'expected no first numerator-only alias');
  assert.ok(!replacementValues.includes('5 мг'), 'expected no second numerator-only alias');
});

test('strict fallback does not add per-ml aliases for gram-packaged mass ratios', () => {
  const parsed = parseMedicineQuery('Изигел плюс 50мг/г+30мг/г 40г №1');
  const searchQuery = buildMedicineSearchQuery(parsed, {
    limit: 5,
    requireParsedAttributeMatch: true,
    strictParsedAttributeFilters: true,
  });

  const replacementValues = Object.values(searchQuery.replacements);
  assert.ok(!replacementValues.includes('50 мг/мл'), 'expected no first per-ml alias');
  assert.ok(!replacementValues.includes('30 мг/мл'), 'expected no second per-ml alias');
});

test('strict fallback reverses separate simple strength pairs', () => {
  const parsed = parseMedicineQuery('Арлеверт 40мг/20мг №20');
  const searchQuery = buildMedicineSearchQuery(parsed, {
    limit: 5,
    requireParsedAttributeMatch: true,
    strictParsedAttributeFilters: true,
  });

  const replacementValues = Object.values(searchQuery.replacements);
  assert.ok(replacementValues.includes('40 мг/20 мг'), 'expected original slash order');
  assert.ok(replacementValues.includes('20 мг/40 мг'), 'expected reversed slash order');
  assert.ok(replacementValues.includes('20 мг, 40 мг'), 'expected reversed comma order');
});

test('wet wipes keep name fallback search', () => {
  const parsed = parseMedicineQuery('Детские Влажные салфетки гигиенические Cotton Club №25');
  const searchQuery = buildMedicineSearchQuery(parsed, { limit: 5 });

  assert.ok(
    searchQuery.sql.includes('(m.trade_name IS NOT NULL OR m.name IS NOT NULL)'),
    'expected wet wipes to admit catalog rows with only a name',
  );
});

test('brand-only candidate union keeps limited branches valid for PostgreSQL', () => {
  const parsed = parseMedicineQuery('Детские Влажные салфетки гигиенические Cotton Club №25');
  const searchQuery = buildMedicineSearchQuery(parsed, { limit: 5 });

  assert.ok(searchQuery.sql.includes('candidate_ids AS MATERIALIZED'));
  assert.ok(searchQuery.sql.includes('SELECT id FROM (\n        SELECT m.id'));
  assert.ok(!searchQuery.sql.includes(')\n      UNION\n      ('));
});

test('strict fallback combines multiple ratio strengths for catalog strength columns', () => {
  const parsed = parseMedicineQuery('Бримоптик капли 2мг/мл+5мг/мл 10мл');
  const searchQuery = buildMedicineSearchQuery(parsed, {
    limit: 5,
    requireParsedAttributeMatch: true,
    strictParsedAttributeFilters: true,
  });

  const replacementValues = Object.values(searchQuery.replacements);
  assert.ok(
    replacementValues.includes('2 мг/мл+5 мг/мл'),
    'expected plus-joined same-denominator ratio text',
  );
  assert.ok(
    replacementValues.includes('2 мг/мл, 5 мг/мл'),
    'expected comma-joined same-denominator ratio text',
  );
});

test('strict pack-one recall admits null pack for standalone mass products', () => {
  const parsed = parseMedicineQuery('Вата мед. н/с 100г №1');
  const searchQuery = buildMedicineSearchQuery(parsed, {
    limit: 5,
    requireParsedAttributeMatch: true,
    strictParsedAttributeFilters: true,
  });

  assert.ok(
    searchQuery.sql.includes('(m.pack = :packCount OR m.pack IS NULL)'),
    'expected pack-one standalone mass products to admit null pack',
  );
});

test('strict pack-one recall admits null pack for metered sprays', () => {
  const parsed = parseMedicineQuery('Момефин спрей назаль 0,5мг 120доз 12мл №1');
  const searchQuery = buildMedicineSearchQuery(parsed, {
    limit: 5,
    requireParsedAttributeMatch: true,
    strictParsedAttributeFilters: true,
  });

  assert.ok(
    searchQuery.sql.includes('(m.pack = :packCount OR m.pack IS NULL)'),
    'expected pack-one metered sprays to admit null pack',
  );
});
