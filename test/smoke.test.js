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
