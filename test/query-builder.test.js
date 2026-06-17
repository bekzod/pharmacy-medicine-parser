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
    searchQuery.sql.includes("OR replace(lower(coalesce(m.strength, '')), 'ё', 'е') = ''"),
    'expected the strength filter to admit candidates with NULL/blank strength',
  );
});
