const test = require('node:test');
const assert = require('node:assert/strict');
const { buildQueryLookupProfiles, parseMedicineQuery } = require('../src');

const BASE_ATTRIBUTES = {
  trade_name_text: null,
  trade_name_tokens: [],
  dosage_form: null,
  dosage_form_token: null,
  dosage_form_source: null,
  dosage_form_route: null,
  container_type: null,
  product_type: 'medicine',
  vendor_country_text: null,
  vendor_country_tokens: [],
  strengths: [],
  volumes: [],
  pack_count: null,
};

function wholesaleFixture(name, query, attributes) {
  test(name, () =>
    assert.deepEqual(parseMedicineQuery(query).attributes, { ...BASE_ATTRIBUTES, ...attributes }),
  );
}

for (const [name, query] of [
  ['normalizes sodium chloride wholesale abbreviation', 'Натр хлор амп 0,9% 5мл №10'],
  ['normalizes dotted sodium chloride wholesale abbreviation', 'Натр. хлор. амп 0,9% 5мл №10'],
]) {
  wholesaleFixture(name, query, {
    trade_name_text: 'натрия хлорид',
    trade_name_tokens: ['натрия', 'хлорид'],
    dosage_form: 'injection',
    dosage_form_token: 'амп',
    dosage_form_source: 'inferred_from_container',
    dosage_form_route: null,
    container_type: 'ampoule',
    product_type: 'medicine',
    vendor_country_text: null,
    vendor_country_tokens: [],
    strengths: [{ kind: 'simple', text: '0.9%', values: [0.9], value: 0.9, unit: '%' }],
    volumes: [{ text: '5 мл', value: 5, unit: 'мл' }],
    pack_count: 10,
  });
}

wholesaleFixture('normalizes Uzbek sesame oil wording', 'Кунжут ёги 100мл', {
    trade_name_text: 'кунжутное масло',
    trade_name_tokens: ['кунжутное', 'масло'],
    dosage_form: null,
    dosage_form_token: null,
    dosage_form_source: null,
    dosage_form_route: null,
    container_type: null,
    product_type: 'medicine',
    vendor_country_text: null,
    vendor_country_tokens: [],
    strengths: [],
    volumes: [{ text: '100 мл', value: 100, unit: 'мл' }],
    pack_count: null,
});

wholesaleFixture('treats infusion ml/ml concentration typo as mg/ml ratio', 'ИНТРАФЕН р/инф 400мл/4мл №1', {
    trade_name_text: 'интрафен',
    trade_name_tokens: ['интрафен'],
    dosage_form: 'infusion',
    dosage_form_token: 'инф',
    dosage_form_source: 'explicit',
    dosage_form_route: null,
    container_type: null,
    product_type: 'medicine',
    vendor_country_text: null,
    vendor_country_tokens: [],
    strengths: [
      {
        kind: 'ratio',
        text: '400 мг/4 мл',
        values: [400],
        value: 400,
        unit: 'мг',
        denominator: { value: 4, unit: 'мл' },
      },
    ],
    volumes: [{ text: '4 мл', value: 4, unit: 'мл' }],
    pack_count: 1,
});

wholesaleFixture('keeps bare potassium wording out of eye-drop typo handling', 'Кали хлорид р-р 4% 10мл', {
    trade_name_text: 'кали хлорид',
    trade_name_tokens: ['кали', 'хлорид'],
    dosage_form: 'solution',
    dosage_form_token: 'р-р',
    dosage_form_source: 'explicit',
    dosage_form_route: null,
    container_type: null,
    product_type: 'medicine',
    vendor_country_text: null,
    vendor_country_tokens: [],
    strengths: [{ kind: 'simple', text: '4%', values: [4], value: 4, unit: '%' }],
    volumes: [{ text: '10 мл', value: 10, unit: 'мл' }],
    pack_count: null,
});

wholesaleFixture('keeps parenthesized active ingredient in wholesale trade identity', 'ПЕО (цефтриаксон) 1г №1 фл.', {
    trade_name_text: 'пео цефтриаксон',
    trade_name_tokens: ['пео', 'цефтриаксон'],
    dosage_form: 'solution',
    dosage_form_token: 'раствор',
    dosage_form_source: 'inferred_from_container',
    dosage_form_route: null,
    container_type: 'vial',
    product_type: 'medicine',
    vendor_country_text: null,
    vendor_country_tokens: [],
    strengths: [{ kind: 'simple', text: '1 г', values: [1], value: 1, unit: 'г' }],
    volumes: [],
    pack_count: 1,
});

wholesaleFixture('recognizes English liquid supplement form', 'Liquid Vitamin B-Complex 240 ml', {
    trade_name_text: 'vitamin b-complex',
    trade_name_tokens: ['vitamin', 'b-complex'],
    dosage_form: 'solution',
    dosage_form_token: 'жид',
    dosage_form_source: 'explicit',
    dosage_form_route: null,
    container_type: null,
    product_type: 'medicine',
    vendor_country_text: null,
    vendor_country_tokens: [],
    strengths: [],
    volumes: [{ text: '240 мл', value: 240, unit: 'мл' }],
    pack_count: null,
});

test('drops parenthesized variant after one-letter wholesale name', () => {
  assert.deepEqual(parseMedicineQuery('А (форте) таб').attributes.trade_name_tokens, ['а']);
});

test('drops trailing parenthesized annotation after short wholesale code', () => {
  assert.deepEqual(parseMedicineQuery('ПЕО 1г №1 фл. (картон)').attributes.trade_name_tokens, ['пео']);
});

test('keeps short vial marker in lookup profiles', () => {
  const [profile] = buildQueryLookupProfiles('ПЕО (цефтриаксон) 1г №1 фл.');
  assert.equal(profile.parsed.attributes.container_type, 'vial');
  assert.equal(profile.parsed.attributes.dosage_form, 'solution');
});
