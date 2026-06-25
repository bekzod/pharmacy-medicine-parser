const test = require('node:test');
const assert = require('node:assert/strict');
const { parseMedicineQuery } = require('../src');

test('normalizes sodium chloride wholesale abbreviation', () => {
  assert.deepEqual(parseMedicineQuery('Натр хлор амп 0,9% 5мл №10').attributes, {
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
});

test('normalizes Uzbek sesame oil wording', () => {
  assert.deepEqual(parseMedicineQuery('Кунжут ёги 100мл').attributes, {
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
});
