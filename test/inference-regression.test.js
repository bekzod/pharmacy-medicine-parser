const test = require('node:test');
const assert = require('node:assert/strict');
const { parseMedicineQuery } = require('../src');
const parse = (query) => parseMedicineQuery(query).attributes;

test('bare integer tablet strengths use milligrams and fractional shorthand keeps grams', () => {
  for (const [query, strength] of [
    ['Амоксициллин 500 таб №20', '500 мг'],
    ['Амоксициллин 1 таб №12', '1 г'],
    ['Амоксициллин 1 №12', '1 г'],
    ['Ацикловир 200 таб №20', '200 мг'],
    ['Амоксициллин 500 №20', '500 мг'],
    ['Амоксициллин 0.5 таб №20', '0.5 г'],
    ['Ацикловир 0.2 таб №20', '0.2 г'],
  ])
    assert.equal(parse(query).strengths[0]?.text, strength, query);
});

test('promoted enzyme, vitamin-D and syrup numbers leave the trade name', () => {
  for (const [before, after, name] of [
    ['Креон 10000 капс №20', 'Креон капс 10000 №20', 'креон'],
    ['Витамин Д3 1000 капс №20', 'Витамин Д3 капс 1000 №20', 'витамин д3'],
    ['Бруфен 100 сироп', 'Бруфен сироп 100', 'бруфен'],
  ]) {
    assert.deepEqual(parse(before), parse(after));
    assert.equal(parse(before).trade_name_text, name);
  }
});

test('inhalation route does not match the injection abbreviation', () => {
  assert.notEqual(
    parse('Пульмикорт р-р д/ингаляций 0.25мг/мл 2мл №20').dosage_form_route,
    'injection',
  );
  assert.equal(parse('Тестовый р-р д/и 5мл').dosage_form_route, 'injection');
  assert.equal(parse('Тестовый р-р д/инъекций 5мл').dosage_form_route, 'injection');
});

test('gauze words remain non-medicines while Марлин retains medicine attributes', () => {
  const medicine = parse('Марлин таб 5 мг №20');
  assert.equal(medicine.product_type, 'medicine');
  assert.equal(medicine.dosage_form, 'tablet');
  assert.equal(medicine.strengths[0]?.text, '5 мг');
  for (const query of ['Марля 5м', 'Бинт марлевый 5м']) {
    assert.equal(parse(query).product_type, 'other', query);
  }
});

test('bare strengths remain conservative for ambiguous numbers and small integers', () => {
  for (const query of ['Амоксициллин 500 250 таб №20', 'Амоксициллин 5 таб №20']) {
    assert.deepEqual(parse(query).strengths, [], query);
  }
});

test('one-gram shorthand leaves the trade identity', () => {
  assert.deepEqual(parse('Амоксициллин 1 таб №12').trade_name_tokens, ['амоксициллин']);
});
