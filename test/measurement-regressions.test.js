const test = require('node:test');
const assert = require('node:assert/strict');
const { parseMedicineQuery, buildMedicineSearchQuery } = require('../src');
const { formatNormalizedNumber } = require('../src/parser/measurements');
const { extractMedicineDetails } = require('../src/medicine-lookup-profiles');

test('rounding calculated measurements preserves integer trailing zeros', () => {
  assert.equal(formatNormalizedNumber(3.3 / 0.33), '10');
  assert.equal(formatNormalizedNumber(99.9999999), '100');
  assert.equal(formatNormalizedNumber(2.5000001), '2.5');
  const query = buildMedicineSearchQuery(parseMedicineQuery('Тестовый р-р 3.3 мг/0.33 мл'), {
    requireParsedAttributeMatch: true,
    strictParsedAttributeFilters: true,
  });
  const values = Object.values(query.replacements);
  assert.ok(values.includes('10 мг/мл'));
  assert.ok(!values.includes('1 мг/мл'));
});

test('topical package mass conversion preserves all strength components', () => {
  for (const [query, text, values] of [
    ['Тестовый мазь 10/20 мг/30г', '10/20 мг/г', [10, 20]],
    ['Тестовый мазь 100/200 ме 30г', '100/200 ме/г', [100, 200]],
    ['Тестовый мазь 100/200 ед 30г', '100/200 ед/г', [100, 200]],
    ['Тестовый мазь 100 ме 30г', '100 ме/г', [100]],
  ]) {
    const { strengths, volumes } = parseMedicineQuery(query).attributes;
    assert.equal(strengths[0].text, text, query);
    assert.deepEqual(strengths[0].values, values, query);
    assert.deepEqual(strengths[0].denominator, { value: null, unit: 'г' }, query);
    assert.equal(volumes[0].text, '30 г', query);
  }
});

test('catalog delimiters accept missing spaces and preserve decimal commas', () => {
  for (const strength of ['5', '0,5']) {
    const compact = extractMedicineDetails(`Тестовый,${strength} мг, 20 мл`);
    const spaced = extractMedicineDetails(`Тестовый, ${strength} мг, 20 мл`);
    assert.deepEqual(compact, spaced);
    assert.equal(compact.strength, `${strength.replace(',', '.')} мг`);
    assert.equal(compact.volume, '20 мл');
  }
});
