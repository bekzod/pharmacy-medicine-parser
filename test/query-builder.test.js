const test = require('node:test');
const assert = require('node:assert/strict');
const {
  parseMedicineQuery,
  buildMedicineSearchQuery,
} = require('../src');

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

test('wet wipes keep name fallback search', () => {
  const parsed = parseMedicineQuery('Детские Влажные салфетки гигиенические Cotton Club №25');
  const searchQuery = buildMedicineSearchQuery(parsed, { limit: 5 });

  assert.ok(
    searchQuery.sql.includes('(m.trade_name IS NOT NULL OR m.name IS NOT NULL)'),
    'expected wet wipes to admit catalog rows with only a name',
  );
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
