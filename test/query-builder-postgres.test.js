const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { parseMedicineQuery, buildMedicineSearchQuery } = require('../src');

// Run against a disposable database: MEDICINE_TEST_POSTGRES=postgresql://... node --test test/query-builder-postgres.test.js
const database = process.env.MEDICINE_TEST_POSTGRES;
function literal(value) {
  if (value == null) return 'NULL';
  return typeof value === 'number' ? String(value) : "'" + String(value).replaceAll("'", "''") + "'";
}
function search(text, rows, options = {}) {
  const query = buildMedicineSearchQuery(parseMedicineQuery(text), { includeTrigram: false, ...options });
  const sql = query.sql.replace(/(?<!:):([a-zA-Z]\w*)/gu, (_, key) => literal(query.replacements[key]));
  const inserts = rows.map((row, index) => `(${[index + 1, 'тестовый', 'тестовый', row.strength, row.volume, row.form, row.pack, 'medicine', 1].map(literal).join(',')})`);
  const result = execFileSync('psql', [database, '-XAt', '-v', 'ON_ERROR_STOP=1'], { encoding: 'utf8', input: `
    BEGIN;
    CREATE TEMP TABLE vendors (id int, name text, country_name text, aa_crawl_id text);
    INSERT INTO vendors VALUES (1, 'vendor', 'германия', NULL);
    CREATE TEMP TABLE medicines (id int, trade_name text, name text, strength text, volume text, dosage_form text, pack int, product_type text, vendor_id int);
    INSERT INTO medicines VALUES ${inserts.join(',')};
    SELECT coalesce(jsonb_agg(result), '[]'::jsonb) FROM (${sql}) result;
    ROLLBACK;
  ` });
  return JSON.parse(result.split('\n').find((line) => line.startsWith('[')));
}
const strict = { requireParsedAttributeMatch: true, strictParsedAttributeFilters: true };
test('PostgreSQL rejects partial combinations and wildcard percentages', { skip: !database }, () => {
  assert.deepEqual(search('Тестовый 40/20мг', [{ strength: '40 мг' }, { strength: '40 мг/20 мг' }], strict).map((row) => row.id), [2]);
  assert.deepEqual(search('Тестовый 40мг/20мг', [{ strength: '40 мг' }, { strength: '40 мг/20 мг' }], strict).map((row) => row.id), [2]);
  assert.deepEqual(search('Тестовый 1%', [{ strength: '10%, 2 мг' }, { strength: '1%, 2 мг' }, { strength: '1%' }], strict).map((row) => row.id).sort(), [2, 3]);
});
test('PostgreSQL non-strict percentage filters treat percent as literal', { skip: !database }, () => {
  assert.deepEqual(search('Тестовый 1%', [{ strength: '10%' }, { strength: '12 мг' }, { strength: '1%' }], { requireParsedAttributeMatch: true }).map((row) => row.id), [3]);
});
test('PostgreSQL rejects conflicting forms and preserves missing forms', { skip: !database }, () => {
  const rows = [{ form: 'capsule' }, { form: 'tablet' }, { form: null }, { form: '' }].map((row) => ({ strength: '500 мг', ...row }));
  assert.deepEqual(search('Тестовый таб 500мг', rows, strict).map((row) => row.id).sort(), [2, 3, 4]);
});
test('PostgreSQL ranks all attributes before candidate truncation', { skip: !database }, () => {
  const rows = Array.from({ length: 60 }, () => ({ strength: '200 мг', form: 'tablet' }));
  rows.push({ strength: '500 мг', form: 'tablet' });
  assert.equal(search('Тестовый таб 500мг', rows, { limit: 1 })[0].id, 61);
  assert.equal(search('Тестовый таб 500мг Германия', rows, { limit: 1 })[0].id, 61);
});
test('PostgreSQL reaches pages beyond the default candidate cap', { skip: !database }, () => {
  const rows = Array.from({ length: 300 }, () => ({}));
  assert.deepEqual(search('Тестовый', rows, { limit: 10, offset: 250 }).map((row) => row.id), Array.from({ length: 10 }, (_, index) => index + 251));
  assert.deepEqual(search('Тестовый', rows, { limit: 10, offset: 250, searchMode: 'brand_only' }).map((row) => row.id), Array.from({ length: 10 }, (_, index) => index + 251));
});
