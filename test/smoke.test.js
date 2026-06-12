const test = require('node:test');
const assert = require('node:assert/strict');
const {
  parseMedicineQuery,
  buildMedicineSearchQuery,
  buildQueryLookupProfiles,
  buildQueryVariants,
} = require('../src');

test('exports parser, lookup profiles, variants, and SQL query builder', () => {
  const parsed = parseMedicineQuery('ибупрофен 200 мг №10');
  assert.equal(parsed.attributes.trade_name_text, 'ибупрофен');
  assert.equal(parsed.attributes.pack_count, 10);

  const profiles = buildQueryLookupProfiles('ибупрофен 200 мг №10');
  assert.ok(profiles.length > 0);

  const variants = buildQueryVariants('ibuprofen');
  assert.ok(Array.isArray(variants));

  const searchQuery = buildMedicineSearchQuery(parsed, { limit: 5 });
  assert.ok(searchQuery.sql.includes('FROM medicines m'));
  assert.equal(searchQuery.replacements.limit, 5);
});

test('infers bare L-тироксин tablet strengths as micrograms', () => {
  const parsed = parseMedicineQuery('L-тироксин 100 берлин-хеми таб №50');

  assert.equal(parsed.attributes.trade_name_text, 'l-тироксин берлин-хеми');
  assert.equal(parsed.attributes.dosage_form, 'tablet');
  assert.equal(parsed.attributes.pack_count, 50);
  assert.deepEqual(parsed.attributes.strengths, [
    {
      kind: 'simple',
      text: '100 мкг',
      values: [100],
      value: 100,
      unit: 'мкг',
    },
  ]);
});

test('parses Semavik multi-dose pen without leaking null dose volume', () => {
  const parsed = parseMedicineQuery('Семавик р-р 1,34мг/мл 0,25/0,5/1доза 3мл (Семаглутид)');

  assert.equal(parsed.attributes.trade_name_text, 'семавик');
  assert.equal(parsed.attributes.dosage_form, 'solution');
  assert.deepEqual(parsed.attributes.strengths, [
    {
      kind: 'ratio',
      text: '1.34 мг/мл',
      values: [1.34],
      value: 1.34,
      unit: 'мг',
      denominator: { value: null, unit: 'мл' },
    },
    {
      kind: 'ratio',
      text: '0.25/0.5/1 мг/доз',
      values: [0.25, 0.5, 1],
      value: null,
      unit: 'мг',
      denominator: { value: null, unit: 'доз' },
    },
  ]);
  assert.deepEqual(parsed.attributes.volumes, [{ text: '3 мл', value: 3, unit: 'мл' }]);

  const searchQuery = buildMedicineSearchQuery(parsed, { limit: 5 });
  assert.equal(searchQuery.replacements.volume0_0, '3 мл');
  assert.ok(!Object.values(searchQuery.replacements).includes('null доз'));
});

test('preserves multi-value measurements without NaN text', () => {
  const parsed = parseMedicineQuery('тест 1мг/мл 5/10мл');

  assert.deepEqual(parsed.attributes.strengths, [
    {
      kind: 'ratio',
      text: '1 мг/мл',
      values: [1],
      value: 1,
      unit: 'мг',
      denominator: { value: null, unit: 'мл' },
    },
  ]);
  assert.deepEqual(parsed.attributes.volumes, [
    { text: '5 мл/10 мл', value: null, unit: 'мл' },
  ]);

  const searchQuery = buildMedicineSearchQuery(parsed, {
    limit: 5,
    requireParsedAttributeMatch: true,
    strictParsedAttributeFilters: true,
  });
  assert.ok(!Object.values(searchQuery.replacements).includes('0 мг'));
  assert.ok(Object.values(searchQuery.replacements).includes('5 мл/10 мл'));
});

test('drops disinfectant descriptor from Betadine trade name', () => {
  const parsed = parseMedicineQuery('Бетадин р-р 10% дезинфир. 1000мл');

  assert.equal(parsed.attributes.trade_name_text, 'бетадин');
  assert.deepEqual(parsed.attributes.trade_name_tokens, ['бетадин']);
  assert.equal(parsed.attributes.dosage_form, 'solution');
  assert.deepEqual(parsed.attributes.strengths, [
    {
      kind: 'simple',
      text: '10%',
      values: [10],
      value: 10,
      unit: '%',
    },
  ]);
  assert.deepEqual(parsed.attributes.volumes, [{ text: '1000 мл', value: 1000, unit: 'мл' }]);

  const searchQuery = buildMedicineSearchQuery(parsed, { limit: 5 });
  assert.equal(searchQuery.replacements.tradeNameQuery, 'бетадин');
  assert.ok(!Object.values(searchQuery.replacements).includes('бетадин дезинфир'));
});
