const test = require('node:test');
const assert = require('node:assert/strict');
const {
  parseMedicineQuery,
  buildMedicineSearchQuery,
} = require('../src');

function simple(text, values, value, unit) {
  return { kind: 'simple', text, values, value, unit };
}

function ratio(text, values, value, unit, denominator) {
  return { kind: 'ratio', text, values, value, unit, denominator };
}

function combination(text, components) {
  return { kind: 'combination', text, components };
}

function volume(text, value, unit, extra = {}) {
  return { text, value, unit, ...extra };
}

function assertSubset(actual, expected, label = 'value') {
  if (Array.isArray(expected)) {
    assert.deepEqual(actual, expected, label);
    return;
  }

  if (expected && typeof expected === 'object') {
    for (const [key, expectedValue] of Object.entries(expected)) {
      assertSubset(actual?.[key], expectedValue, `${label}.${key}`);
    }
    return;
  }

  assert.equal(actual, expected, label);
}

function assertSearchExpectations(searchQuery, search) {
  if (search.replacementsEqual) {
    for (const [key, expectedValue] of Object.entries(search.replacementsEqual)) {
      assert.equal(searchQuery.replacements[key], expectedValue, `replacements.${key}`);
    }
  }

  const replacementValues = Object.values(searchQuery.replacements);
  for (const expectedValue of search.replacementValuesInclude ?? []) {
    assert.ok(replacementValues.includes(expectedValue), `expected replacement ${expectedValue}`);
  }
  for (const unexpectedValue of search.replacementValuesExclude ?? []) {
    assert.ok(
      !replacementValues.includes(unexpectedValue),
      `unexpected replacement ${unexpectedValue}`,
    );
  }

  if (search.filterPrefix) {
    const filteredValues = Object.entries(searchQuery.replacements)
      .filter(([key]) => key.startsWith(search.filterPrefix))
      .map(([, value]) => value);

    for (const expectedValue of search.filterValuesInclude ?? []) {
      assert.ok(filteredValues.includes(expectedValue), `expected filtered ${expectedValue}`);
    }
    for (const unexpectedValue of search.filterValuesExclude ?? []) {
      assert.ok(
        !filteredValues.includes(unexpectedValue),
        `unexpected filtered ${unexpectedValue}`,
      );
    }
  }

  for (const expectedSql of search.sqlIncludes ?? []) {
    assert.ok(searchQuery.sql.includes(expectedSql), `expected SQL to include ${expectedSql}`);
  }
  for (const unexpectedSql of search.sqlExcludes ?? []) {
    assert.ok(
      !searchQuery.sql.includes(unexpectedSql),
      `expected SQL to exclude ${unexpectedSql}`,
    );
  }
}

function assertParsedCase({ query, expected, tokenRoles, search }) {
  const parsed = parseMedicineQuery(query);
  assertSubset(parsed, expected, query);

  for (const { value, role } of tokenRoles ?? []) {
    assert.equal(parsed.tokens.find((token) => token.value === value)?.role, role);
  }

  if (search) {
    assertSearchExpectations(
      buildMedicineSearchQuery(parsed, search.options ?? { limit: 5 }),
      search,
    );
  }
}

function addCases(cases) {
  for (const [name, query, attributes, extra = {}] of cases) {
    test(name, () => assertParsedCase({ query, expected: { attributes }, ...extra }));
  }
}

const implicitStrengthCases = [
  ['splits hyphenated MR suffixes from Cyrillic trade names', 'азимакс-мR сусп. 200мг/5мл 15мл', {
  trade_name_text: 'азимакс mr',
  trade_name_tokens: ['азимакс', 'mr'],
  dosage_form: 'suspension',
  strengths: [ratio('200 мг/5 мл', [200], 200, 'мг', { value: 5, unit: 'мл' })],
  volumes: [volume('15 мл', 15, 'мл')]
}],
  ['infers bare L-тироксин tablet strengths as micrograms', 'L-тироксин 100 берлин-хеми таб №50', {
  trade_name_text: 'l-тироксин берлин-хеми',
  dosage_form: 'tablet',
  pack_count: 50,
  strengths: [ { kind: 'simple', text: '100 мкг', values: [ 100 ], value: 100, unit: 'мкг' } ]
}],
  ['infers bare Siofor strength as milligrams when pack is explicit', 'Сиофор 500 №60', {
  trade_name_text: 'сиофор',
  pack_count: 60,
  strengths: [ { kind: 'simple', text: '500 мг', values: [ 500 ], value: 500, unit: 'мг' } ]
}],
  ['does not apply oral-solid brand strength inference to explicit syrup forms', 'Сиофор сироп 500 №1', {
  trade_name_text: 'сиофор',
  dosage_form: 'syrup',
  pack_count: 1,
  strengths: [],
  volumes: [volume('500 мл', 500, 'мл')]
}],
  ['normalizes cyrillic Carry F.A. injection brand spelling', 'Карри Ф.А. амп.1г/5мл№25 (Л-Карнитин)', {
  trade_name_text: 'carry f a',
  dosage_form: 'injection',
  container_type: 'ampoule',
  strengths: [ ratio('1 г/5 мл', [1], 1, 'г', { value: 5, unit: 'мл' }) ],
  volumes: [volume('5 мл', 5, 'мл')],
  pack_count: 25
}],
  ['preserves duplicate components in same-unit slash strengths', 'ЭКВАМЕР КАПС. 20МГ/10МГ/10МГ №30', {
  trade_name_text: 'эквамер',
  dosage_form: 'capsule',
  pack_count: 30,
  strengths: [
    {
      kind: 'simple',
      text: '20 мг/10 мг/10 мг',
      values: [ 20, 10, 10 ],
      value: null,
      unit: 'мг'
    }
  ]
}],
  ['preserves resolved duplicate components in same-unit slash strengths', 'Эквамер, 20 мг/10 мг/20 мг, капс. №30', {
  strengths: [
    {
      kind: 'simple',
      text: '20 мг/10 мг/20 мг',
      values: [ 20, 10, 20 ],
      value: null,
      unit: 'мг'
    }
  ]
}],
  ['infers bare Creon capsule potency as activity units', 'Креон капс 10000 №20', {
  trade_name_text: 'креон',
  dosage_form: 'capsule',
  pack_count: 20,
  strengths: [ { kind: 'simple', text: '10000 ед', values: [ 10000 ], value: 10000, unit: 'ед' } ]
}],
  ['infers bare Mezim capsule potency as activity units', 'МЕЗИМ КАПС. 25000 №20', {
  trade_name_text: 'мезим',
  dosage_form: 'capsule',
  pack_count: 20,
  strengths: [ { kind: 'simple', text: '25000 ед', values: [ 25000 ], value: 25000, unit: 'ед' } ]
}],
  ['parses spaced thousands activity units glued to unit', 'аквадетрим капс. 2 000ме №30', {
  trade_name_text: 'аквадетрим',
  dosage_form: 'capsule',
  pack_count: 30,
  strengths: [ { kind: 'simple', text: '2000 ме', values: [ 2000 ], value: 2000, unit: 'ме' } ]
}],
  ['parses spaced thousands activity units before separated unit', 'Д-ВИТ ЛАМИРА ТАБ. 50 000ME №8', {
  trade_name_text: 'д-вит ламира',
  dosage_form: 'tablet',
  pack_count: 8,
  strengths: [ { kind: 'simple', text: '50000 ме', values: [ 50000 ], value: 50000, unit: 'ме' } ]
}],
  ['parses apostrophe thousands activity units', "Виферон-2, 500'000 МЕ, супп. рект. №10", {
  trade_name_text: 'виферон-2',
  dosage_form: 'suppository',
  pack_count: 10,
  strengths: [simple('500000 ме', [500000], 500000, 'ме')]
}],
  ['parses million shorthand activity units', 'Виферон свечи 1 млн. МЕ №10', {
  trade_name_text: 'виферон',
  dosage_form: 'suppository',
  pack_count: 10,
  strengths: [simple('1000000 ме', [1000000], 1000000, 'ме')]
}],
  ['parses decimal million shorthand activity units', 'Виферон свечи 1,5 млн МЕ №10', {
  trade_name_text: 'виферон',
  dosage_form: 'suppository',
  pack_count: 10,
  strengths: [simple('1500000 ме', [1500000], 1500000, 'ме')]
}],
  ['parses compact anti-Xa dot activity strength', 'Велвин-4000 анти-Ха.МЕ/0,4мл №10 (Эноксапарин натрия)', {
  trade_name_text: 'велвин',
  pack_count: 10,
  strengths: [ratio('4000 ме/0.4 мл', [4000], 4000, 'ме', { value: 0.4, unit: 'мл' })]
}],
  ['normalizes camphor spirit adjectives for trade identity', 'Камфора р-р спиртовый 10% 25мл', {
  trade_name_text: 'камфора спирт',
  trade_name_tokens: ['камфора', 'спирт'],
  strengths: [simple('10%', [10], 10, '%')],
  volumes: [volume('25 мл', 25, 'мл')]
}],
  ['normalizes abbreviated Garamycin combination tokens for trade identity', 'Целестодерм В с гарамиц. крем 30г', {
  trade_name_tokens: ['целестодерм', 'в', 'с', 'гарамицин'],
  volumes: [volume('30 г', 30, 'г')]
}],
  ['parses compact decimal slash strengths', 'Максфло-Д капс. 0,5мг/0,4мг №30', {
  trade_name_text: 'максфло-д',
  pack_count: 30,
  strengths: [
    simple('0.5 мг', [0.5], 0.5, 'мг'),
    simple('0.4 мг', [0.4], 0.4, 'мг')
  ]
}],
  ['treats oral solid slash ml as a mistyped mg strength', 'КО-ПРЕНЕССА ТАБ. 8МГ/2,5МЛ №30', {
  trade_name_text: 'ко-пренесса',
  dosage_form: 'tablet',
  pack_count: 30,
  strengths: [simple('8 мг/2.5 мг', [8, 2.5], null, 'мг')]
}],
  ['infers low bare tablet strength for Olfrex', 'ОЛФРЕКС 5 ТАБ. №28', {
  trade_name_text: 'олфрекс',
  strengths: [ { kind: 'simple', text: '5 мг', values: [ 5 ], value: 5, unit: 'мг' } ]
}],
  ['infers low bare tablet strength for Raksaban', 'РАКСАБАН 15 ТАБ. П/О №30', {
  trade_name_text: 'раксабан',
  strengths: [ { kind: 'simple', text: '15 мг', values: [ 15 ], value: 15, unit: 'мг' } ]
}],
  ['infers low bare tablet strength for Gepirid', 'Гепирид® 1 таблетки №30 (SBNA01AC)', {
  trade_name_text: 'гепирид',
  strengths: [ { kind: 'simple', text: '1 мг', values: [ 1 ], value: 1, unit: 'мг' } ],
  pack_count: 30
}],
  ['infers low bare tablet strength for Brizezi', 'БРИЗЕЗИ 4 ТАБ. №30', {
  trade_name_text: 'бризези',
  strengths: [ { kind: 'simple', text: '4 мг', values: [ 4 ], value: 4, unit: 'мг' } ],
  pack_count: 30
}],
  ['infers low bare tablet strength for Afil', 'Афил 10 таб №4 Нобел', {
  trade_name_text: 'афил',
  strengths: [ { kind: 'simple', text: '10 мг', values: [ 10 ], value: 10, unit: 'мг' } ],
  pack_count: 4
}],
  ['infers low bare decimal tablet strength for Belasсor', 'Беласкор 2,5 таб №30', {
  trade_name_text: 'беласкор',
  strengths: [ { kind: 'simple', text: '2.5 мг', values: [ 2.5 ], value: 2.5, unit: 'мг' } ],
  pack_count: 30
}],
  ['infers bare slash tablet strengths for Sitadiab Met', 'СИТАДИАБ МЕТ 50/850 ТАБ. №56', {
  trade_name_text: 'ситадиаб мет',
  strengths: [
    { kind: 'simple', text: '50 мг/850 мг', values: [ 50, 850 ], value: null, unit: 'мг' }
  ]
}],
  ['infers bare slash tablet strengths for Amlodil-AB', 'Амлодил-АБ таб 8/10 №30', {
  trade_name_text: 'амлодил-аб',
  strengths: [ { kind: 'simple', text: '8 мг/10 мг', values: [ 8, 10 ], value: null, unit: 'мг' } ]
}],
  ['infers bare slash tablet strengths for Analdim', 'Анальдим св.рект 250/20 №10', {
  trade_name_text: 'анальдим св',
  strengths: [
    { kind: 'simple', text: '250 мг/20 мг', values: [ 250, 20 ], value: null, unit: 'мг' }
  ]
}],
  ['infers bare slash tablet strengths for Attento', 'Аттенто таб 20/5 №28', {
  trade_name_text: 'аттенто',
  strengths: [ { kind: 'simple', text: '20 мг/5 мг', values: [ 20, 5 ], value: null, unit: 'мг' } ]
}],
  ['infers bare decimal gram tablet strength for known brands', 'АМПИЦИЛЛИН ТРИГИДРАТ Таблетки 0.5  №10(10x1)', {
  trade_name_text: 'ампициллин тригидрат',
  strengths: [ { kind: 'simple', text: '0.5 г', values: [ 0.5 ], value: 0.5, unit: 'г' } ],
  pack_count: 10
}],
  ['treats explicit low mg tablet shorthand as grams for known antibiotic brands', 'Амоксициллин таб.0.25мг№10', {
  trade_name_text: 'амоксициллин',
  dosage_form: 'tablet',
  strengths: [ { kind: 'simple', text: '0.25 г', values: [ 0.25 ], value: 0.25, unit: 'г' } ],
  pack_count: 10
}],
  ['treats explicit low mg tablet shorthand as grams for ampicillin rows', 'Ампициллин таб.0.5мг№10', {
  trade_name_text: 'ампициллин',
  dosage_form: 'tablet',
  strengths: [ { kind: 'simple', text: '0.5 г', values: [ 0.5 ], value: 0.5, unit: 'г' } ],
  pack_count: 10
}],
  ['treats explicit low mg tablet shorthand as grams for acyclovir rows', 'Ацикловир таб.0.2мг№20', {
  trade_name_text: 'ацикловир',
  dosage_form: 'tablet',
  strengths: [ { kind: 'simple', text: '0.2 г', values: [ 0.2 ], value: 0.2, unit: 'г' } ],
  pack_count: 20
}],
  ['treats explicit low mg tablet shorthand as grams for known gram-dose brands', 'Аллапинин таб.0.025мг№30', {
  trade_name_text: 'аллапинин',
  dosage_form: 'tablet',
  strengths: [ { kind: 'simple', text: '0.025 г', values: [ 0.025 ], value: 0.025, unit: 'г' } ],
  pack_count: 30
}],
  ['treats explicit low mg tablet shorthand as grams for diazolin rows', 'Диазолин таб.0.1мг№10', {
  trade_name_text: 'диазолин',
  dosage_form: 'tablet',
  strengths: [ { kind: 'simple', text: '0.1 г', values: [ 0.1 ], value: 0.1, unit: 'г' } ],
  pack_count: 10
}],
  ['treats explicit low mg tablet shorthand as grams for drotaverine rows', 'Дротаверин-Лекхим таб.0.04мг№30', {
  trade_name_text: 'дротаверин-лекхим',
  dosage_form: 'tablet',
  strengths: [ { kind: 'simple', text: '0.04 г', values: [ 0.04 ], value: 0.04, unit: 'г' } ],
  pack_count: 30
}],
  ['treats explicit low mg tablet shorthand as grams for loperamide rows', 'Лоперамид таб.0.002мг№20', {
  trade_name_text: 'лоперамид',
  dosage_form: 'tablet',
  strengths: [ { kind: 'simple', text: '0.002 г', values: [ 0.002 ], value: 0.002, unit: 'г' } ],
  pack_count: 20
}],
  ['treats glycerin suppository mg shorthand as grams', 'Глицерин супп.1.24мг№10', {
  trade_name_text: 'глицерин',
  dosage_form: 'suppository',
  strengths: [ { kind: 'simple', text: '1.24 г', values: [ 1.24 ], value: 1.24, unit: 'г' } ],
  pack_count: 10
}],
  ['treats rehydration salt packet mg shorthand as grams', 'Регидрационная соль-LP №10 18,9мг', {
  trade_name_text: 'регидрационная соль-lр',
  product_type: 'medicine',
  strengths: [ { kind: 'simple', text: '18.9 г', values: [ 18.9 ], value: 18.9, unit: 'г' } ],
  pack_count: 10
}],
  ['classifies noun-first rehydration salt packet as medicine', 'Соль регидрационная 18,9мг №10', {
  trade_name_text: 'соль регидрационная',
  product_type: 'medicine',
  strengths: [ { kind: 'simple', text: '18.9 г', values: [ 18.9 ], value: 18.9, unit: 'г' } ],
  pack_count: 10
}],
  ['treats low mg/ml ratio shorthand as grams for known levocarnitine brands', 'L-Виава р-р.внутрь 1мг/10мл№10 Левокарнитин', {
  trade_name_text: 'l-виава',
  dosage_form: 'solution',
  strengths: [ ratio('1 г/10 мл', [1], 1, 'г', { value: 10, unit: 'мл' }) ],
  pack_count: 10
}],
  ['normalizes known high mg oral solution ratios to grams and package volume', 'Метакартин р-р.внутр.2000мг/10мл№10 Левокарнитин', {
  trade_name_text: 'метакартин',
  dosage_form: 'solution',
  strengths: [ ratio('2 г/10 мл', [2], 2, 'г', { value: 10, unit: 'мл' }) ],
  volumes: [ volume('10 мл', 10, 'мл') ],
  pack_count: 10
}],
  ['normalizes known high mg injection ratios to grams', 'Ливерин амп. 600мг/2мл №7', {
  trade_name_text: 'ливерин',
  dosage_form: 'injection',
  strengths: [ ratio('0.6 г/2 мл', [0.6], 0.6, 'г', { value: 2, unit: 'мл' }) ],
  volumes: [ volume('2 мл', 2, 'мл') ],
  pack_count: 7
}],
  ['keeps real low mg capsule strengths as milligrams', 'Максфло-Д капс. 0,5мг/0,4мг №30', {
  trade_name_text: 'максфло-д',
  dosage_form: 'capsule',
  strengths: [
    simple('0.5 мг', [0.5], 0.5, 'мг'),
    simple('0.4 мг', [0.4], 0.4, 'мг')
  ],
  pack_count: 30
}],
  ['parses compact 2x oral solid strength marker', 'АМОКСИКЛАВ ТАБ 2Х1000 №14', {
  trade_name_text: 'амоксиклав',
  strengths: [ { kind: 'simple', text: '1000 мг', values: [ 1000 ], value: 1000, unit: 'мг' } ],
  pack_count: 14
}],
  ['parses asterisk oral solid strength marker with glued unit', 'Амоксиклав таб 2*1000мг №14', {
  trade_name_text: 'амоксиклав',
  dosage_form: 'tablet',
  strengths: [ { kind: 'simple', text: '1000 мг', values: [ 1000 ], value: 1000, unit: 'мг' } ],
  pack_count: 14
}],
  ['parses x oral solid strength marker with glued unit', 'АМОКСИКЛАВ ТАБ. 2Х1000МГ №14', {
  trade_name_text: 'амоксиклав',
  dosage_form: 'tablet',
  strengths: [ { kind: 'simple', text: '1000 мг', values: [ 1000 ], value: 1000, unit: 'мг' } ],
  pack_count: 14
}],
  ['infers bare tablet strengths for known no-form iodine brands', 'Йодомиг SD 200 №100 (йодомарин)', {
  trade_name_text: 'йодомиг sd',
  strengths: [ { kind: 'simple', text: '200 мг', values: [ 200 ], value: 200, unit: 'мг' } ],
  pack_count: 100
}],
  ['infers compact bare microgram strength for known iodine tablet brands', 'Йодомарин-100 №100.', {
  trade_name_text: 'йодомарин',
  strengths: [ { kind: 'simple', text: '100 мкг', values: [ 100 ], value: 100, unit: 'мкг' } ],
  pack_count: 100
}],
  ['infers tablet bare microgram strength for known iodine tablet brands', 'Йодомарин 100 таб №100', {
  trade_name_text: 'йодомарин',
  dosage_form: 'tablet',
  strengths: [ { kind: 'simple', text: '100 мкг', values: [ 100 ], value: 100, unit: 'мкг' } ],
  pack_count: 100
}],
  ['infers bare gram strength for powder vial listings', 'ЦЕФОТАКСИМ ПОР ДЛЯ ПРИГ РР ДЛЯ ИНЬЕК 1,0 №50', {
  trade_name_text: 'цефотаксим',
  strengths: [ { kind: 'simple', text: '1 г', values: [ 1 ], value: 1, unit: 'г' } ]
}],
  ['drops misspelled injection-purpose tokens from powder listings', 'эфес пор.д/приг.р-ра для иньекций 5,0г №1', {
  trade_name_text: 'эфес',
  dosage_form: 'powder',
  strengths: [ { kind: 'simple', text: '5 г', values: [ 5 ], value: 5, unit: 'г' } ],
  pack_count: 1
}],
  ['infers bare milligram strength for known powder sachet brands', 'Ноофен порошок 500 №5', {
  trade_name_text: 'ноофен',
  dosage_form: 'powder',
  strengths: [ { kind: 'simple', text: '500 мг', values: [ 500 ], value: 500, unit: 'мг' } ],
  pack_count: 5
}],
  ['infers bare milligram strength for injection powder listings', 'Мегасеф 750, порошок для инъекции № 1, с растворителем 6 мл', {
  trade_name_text: 'мегасеф',
  dosage_form: 'powder',
  dosage_form_route: 'injection',
  strengths: [ { kind: 'simple', text: '750 мг', values: [ 750 ], value: 750, unit: 'мг' } ],
  pack_count: 1
}],
  ['infers low bare strengths for known no-form tablet brands', 'НЕОКЛАСТ 5 №28', {
  trade_name_text: 'неокласт',
  strengths: [ { kind: 'simple', text: '5 мг', values: [ 5 ], value: 5, unit: 'мг' } ],
  pack_count: 28
}],
  ['infers bare tablet strengths after tabl abbreviation', 'Синегра 50 табл. №4', {
  trade_name_text: 'синегра',
  dosage_form: 'tablet',
  strengths: [ { kind: 'simple', text: '50 мг', values: [ 50 ], value: 50, unit: 'мг' } ],
  pack_count: 4
}],
  ['parses stray letter prefix before tablet strength units', 'Валмак таб. H80мг №30', {
  trade_name_text: 'валмак',
  dosage_form: 'tablet',
  strengths: [ { kind: 'simple', text: '80 мг', values: [ 80 ], value: 80, unit: 'мг' } ],
  pack_count: 30
}],
  ['infers trailing oral solid pack count after glued strength', 'Ноклот таб.75мг30 Клопидогрел', {
  trade_name_text: 'ноклот клопидогрел',
  dosage_form: 'tablet',
  strengths: [ { kind: 'simple', text: '75 мг', values: [ 75 ], value: 75, unit: 'мг' } ],
  pack_count: 30
}],
  ['parses plus-separated strengths with a shared trailing unit', 'Цефтриаксон+Сульбактам 1,0+0,5 г', {
  trade_name_text: 'цефтриаксон сульбактам',
  strengths: [ { kind: 'simple', text: '1 г/0.5 г', values: [ 1, 0.5 ], value: null, unit: 'г' } ]
}],
];

const deviceAndProductTypeCases = [
  ['keeps parenthesized device variant tokens', 'КОРРЕКТОР ОСАНКИ (UNIVERSAL) РАЗМЕР S', {
  trade_name_text: 'корректор осанки universal размер s',
  trade_name_tokens: [ 'корректор', 'осанки', 'universal', 'размер', 's' ]
}],
  ['keeps numeric size tokens after abbreviated size markers', 'Гетры эластичный "GT" р. 2', {
  trade_name_text: 'гетры эластичный gt р 2',
  trade_name_tokens: [ 'гетры', 'эластичный', 'gt', 'р', '2' ]
}],
  ['keeps decimal dimension tokens as strict identity', 'БИНТ ЭЛАСТИЧНЫЙ 10Х0.6', {
  trade_name_text: 'бинт эластичный 10x0.6',
  trade_name_tokens: [ 'бинт', 'эластичный', '10x0.6' ],
  pack_count: null
}],
  ['normalizes compact device gauge tokens', 'Катетер внутривенный KD-FIX 18G', {
  product_type: 'device',
  trade_name_text: 'катетер внутривенный kd-fix 18 g',
  trade_name_tokens: [ 'катетер', 'внутривенный', 'kd-fix', '18', 'g' ]
}],
  ['keeps syringe device size tokens for strict identity', 'Шприц-NS 20мл№1', {
  product_type: 'device',
  trade_name_text: 'шприц-ns 20 мл',
  trade_name_tokens: [ 'шприц-ns', '20', 'мл' ],
  pack_count: 1
}],
  ['keeps decimal syringe size tokens when brand tokens exist', 'Шприц однок. прим. KD-JECT III инсулин. 0.5мл U100', {
  product_type: 'device',
  trade_name_text: 'шприц однок прим kd-ject iii инсулин 0.5 мл u-100',
  trade_name_tokens: [
    'шприц', 'однок',
    'прим',  'kd-ject',
    'iii',   'инсулин',
    '0.5',   'мл',
    'u-100'
  ]
}],
  ['classifies toothbrush listings as non-medicine products', 'БИОМЕД Интенсив минерал з.щетка жесткая', {
  product_type: 'other',
  dosage_form: null,
  trade_name_tokens: [ 'биомед', 'интенсив', 'минерал', 'з', 'щетка', 'жесткая' ]
}],
  ['classifies abbreviated baby cookie listings as non-medicine products', 'БОНДИ детс.печ с железом 180р', {
  product_type: 'other',
  dosage_form: null,
  trade_name_tokens: [ 'бонди', 'детс', 'печ', 'с', 'железом', '180р' ]
}],
  ['keeps quoted Latin personal-care brands out of Cyrillic homoglyph normalization', 'Подгузники детс."Pure Born" р.5 №22', {
  product_type: 'other',
  dosage_form: null,
  trade_name_text: 'подгузники детс pure born р 5',
  trade_name_tokens: [ 'подгузники', 'детс', 'pure', 'born', 'р' ],
  pack_count: 22
}],
  ['normalizes mixed-script personal-care brand aliases', 'ТАМПОНЫ ГИГИЕН. EСЕНИЯ ДЛИННАЯ №10', {
  product_type: 'other',
  dosage_form: null,
  trade_name_text: 'тампоны гигиенические есения длинная',
  trade_name_tokens: [ 'тампоны', 'гигиенические', 'есения', 'длинная' ],
  pack_count: 10
}],
  ['classifies liquid soap listings as non-medicine products', 'Жидкое мыло.Океан с дозатором 300мл№1 Life', {
  product_type: 'other',
  dosage_form: null,
  trade_name_text: 'жидкое мыло океан с'
}],
  ['classifies dental paste listings as non-medicine products', 'Зубная паста Dentacare с экстра. трав 125+20 145г', {
  product_type: 'other',
  dosage_form: null,
  trade_name_tokens: [ 'dentacare', 'с', 'экстра', 'трав' ]
}],
  ['classifies shampoo listings as non-medicine products', 'Домашний-Доктор Шампунь Тройная сила 1000мл№1 Против выпад.волос', {
  product_type: 'other',
  dosage_form: null,
  trade_name_tokens: [ 'домашний-доктор', 'шампунь', 'тройная', 'сила' ]
}],
  ['classifies plasters as device products', 'Лейкопластырь MEDIK PLAST гипоаллер. на тканевой основе 5см*5м №1', {
  product_type: 'device',
  dosage_form: null,
  trade_name_text: 'лейкопластырь medik plast гипоаллер на тканевой основе 5 см х 5 м'
}],
  ['classifies baby powder listings as non-medicine products', 'Детская присыпка Alissa 40г №1', {
  product_type: 'other',
  dosage_form: null,
  trade_name_tokens: [ 'присыпка', 'alissa' ]
}],
  ['classifies body-care balm listings as non-medicine products', 'Карипаин бальзам д/тела сухой 10мл№10', {
  product_type: 'other',
  dosage_form: null,
  trade_name_text: 'карипаин бальзам сухой'
}],
  ['classifies lip balm listings as non-medicine products', 'Бороплюс Химани увлажняющий бальзам для губ-Ароматная мята 10мл', {
  product_type: 'other',
  dosage_form: null,
  trade_name_text: 'боро плюс химани увлажняющий бальзам губ-ароматная мята'
}],
  ['classifies hair-growth oil listings as non-medicine products', 'Домашний-Доктор Репейное масло 100мл№1 с красным перцем стимул. рост волос', {
  product_type: 'other',
  dosage_form: null,
  trade_name_text: 'домашний-доктор репейное масло с красным перцем стимул рост волос'
}],
  ['classifies probiotic context listings as non-medicine products', 'Бектолар саше №6 орал.пробиотик', {
  product_type: 'other',
  dosage_form: null,
  trade_name_text: 'бектолар'
}],
  ['classifies vitamin-mineral child syrup listings as non-medicine products', 'Кидекса вит.мин. для дете сироп 150мл №1', {
  product_type: 'other',
  dosage_form: null,
  trade_name_text: 'кидекса вит мин дете'
}],
  ['parses glued piece counts as pack count', 'Ватные Диски "Bella Cotton" 100шт в полиэтилен', {
  pack_count: 100,
  product_type: 'device',
  trade_name_tokens: [ 'ватные', 'диски', 'bella', 'cotton', 'n', '100', 'в', 'полиэтилен' ]
}],
];

const measurementAndRouteCases = [
  ['splits compact unit after slash in shared-unit strengths', 'Панангин таб.158 /140мг N60', {
  trade_name_text: 'панангин',
  dosage_form: 'tablet',
  strengths: [ { kind: 'simple', text: '158 мг/140 мг', values: [ 158, 140 ], value: null, unit: 'мг' } ],
  pack_count: 60
}],
  ['splits compact unit after tight slash in shared-unit strengths', 'Панангин таб.158/140мг N60', {
  trade_name_text: 'панангин',
  dosage_form: 'tablet',
  strengths: [ { kind: 'simple', text: '158 мг/140 мг', values: [ 158, 140 ], value: null, unit: 'мг' } ],
  pack_count: 60
}],
  ['keeps pure inhalation solution listings as inhalers', 'Нубетал р-р д/ингаляций 0,1% 2,5мл №10 (Сальбутамол)', {
  trade_name_text: 'нубетал',
  dosage_form: 'inhaler',
  strengths: [ { kind: 'simple', text: '0.1%', values: [ 0.1 ], value: 0.1, unit: '%' } ],
  volumes: [ { text: '2.5 мл', value: 2.5, unit: 'мл' } ],
  pack_count: 10
}],
  ['keeps for-inhalation solution listings as inhalers', 'Нубетал р-р для ингаляций 0,1% 2,5мл №10', {
  trade_name_text: 'нубетал',
  dosage_form: 'inhaler',
  strengths: [ { kind: 'simple', text: '0.1%', values: [ 0.1 ], value: 0.1, unit: '%' } ],
  volumes: [ { text: '2.5 мл', value: 2.5, unit: 'мл' } ],
  pack_count: 10
}],
  ['parses strength before slash pack marker', 'СЕМАЛОНГ (СЕМАГЛУТИД) 0,5 р-р д/п-го 0,5мг/№1 шприц-ручка', {
  trade_name_text: 'семалонг',
  dosage_form: 'injection',
  pack_count: 1,
  strengths: [ { kind: 'simple', text: '0.5 мг', values: [ 0.5 ], value: 0.5, unit: 'мг' } ]
}],
  ['parses underscore compact syringe dose as medicine ratio', 'Репо р-р.инъек.6000ЕД_0.6мл.Шприц№1', {
  trade_name_text: 'репо',
  dosage_form: 'injection',
  product_type: 'medicine',
  pack_count: 1,
  strengths: [ { kind: 'ratio', text: '6000 ед/0.6 мл', values: [ 6000 ], value: 6000, unit: 'ед', denominator: { value: 0.6, unit: 'мл' } } ],
  volumes: [ { text: '0.6 мл', value: 0.6, unit: 'мл' } ]
}],
  ['infers sachet pack count before po-strength phrase', 'Тайлолфен Хот порошок для приготовления раствора для приема внутрь, 12 пакетиков по 20 г', {
  trade_name_text: 'тайлолфен хот',
  container_type: 'sachet',
  pack_count: 12,
  strengths: [ { kind: 'simple', text: '20 г', values: [ 20 ], value: 20, unit: 'г' } ]
}],
  ['parses capsule кап abbreviation from surrounding context', 'Адаптол кап. 300 мг. №20', {
  trade_name_text: 'адаптол',
  dosage_form: 'capsule',
  strengths: [ { kind: 'simple', text: '300 мг', values: [ 300 ], value: 300, unit: 'мг' } ],
  pack_count: 20
}],
  ['does not treat route-like brand prefix before кап as drops', 'Глазовит кап. №30', {
  trade_name_text: 'глазовит',
  dosage_form: 'capsule',
  pack_count: 30
}],
  ['parses inflected nasal кап context without volume as drops', 'Бренд кап. носовые №10', {
  trade_name_text: 'бренд',
  dosage_form: 'drops',
  pack_count: 10
}],
  ['parses eye drop кап abbreviation from surrounding context', 'Бримоптик кап.глазн. 2мг/мл 5мг/мл 10мл', {
  trade_name_text: 'бримоптик',
  dosage_form: 'drops',
  volumes: [ { text: '10 мл', value: 10, unit: 'мл' } ]
}],
  ['parses гл.кап. abbreviation as eye drops', 'Глаумакс Плюс гл.кап.20мг/мл+5мг/мл №1', {
  trade_name_text: 'глаумакс плюс',
  dosage_form: 'drops',
  strengths: [
    ratio('20 мг/мл', [20], 20, 'мг', { value: null, unit: 'мл' }),
    ratio('5 мг/мл', [5], 5, 'мг', { value: null, unit: 'мл' })
  ],
  pack_count: 1
}],
  ['keeps ophthalmic suspension drops as drops', 'ВизуСол глаз.капли сусп.0,5% 5мг 5мл №1', {
  trade_name_text: 'визусол',
  dosage_form: 'drops',
  strengths: [
    { kind: 'simple', text: '0.5%', values: [0.5], value: 0.5, unit: '%' },
    ratio('5 мг/мл', [5], 5, 'мг', { value: null, unit: 'мл' })
  ],
  volumes: [volume('5 мл', 5, 'мл')],
  pack_count: 1
}],
  ['infers per-ml strength for drops with package volume', 'Левосетил капли 5мг 20мл', {
  trade_name_text: 'левосетил',
  dosage_form: 'drops',
  strengths: [ratio('5 мг/мл', [5], 5, 'мг', { value: null, unit: 'мл' })],
  volumes: [volume('20 мл', 20, 'мл')]
}],
  ['infers per-ml components for same-unit drop strengths with package volume', 'БИВОКСА-Д ГЛ.КАПЛИ 5МГ/1МГ 5МЛ', {
  trade_name_text: 'бивокса-д',
  dosage_form: 'drops',
  strengths: [
    ratio('5 мг/мл', [5], 5, 'мг', { value: null, unit: 'мл' }),
    ratio('1 мг/мл', [1], 1, 'мг', { value: null, unit: 'мл' })
  ],
  volumes: [volume('5 мл', 5, 'мл')]
}],
  ['infers missing per-ml component before repeated package volume', 'ЗЕТоптик капли глазные 10мг/мл+5мл сусп по 5мл', {
  trade_name_text: 'зетоптик',
  dosage_form: 'drops',
  strengths: [
    ratio('10 мг/мл', [10], 10, 'мг', { value: null, unit: 'мл' }),
    ratio('5 мг/мл', [5], 5, 'мг', { value: null, unit: 'мл' })
  ],
  volumes: [volume('5 мл', 5, 'мл')]
}],
  ['parses typo kали глаз as eye drops', 'Категор Офта, 5 мг/мл 5 мл, кали глаз.', {
  trade_name_text: 'категор офта',
  dosage_form: 'drops',
  strengths: [ratio('5 мг/мл', [5], 5, 'мг', { value: null, unit: 'мл' })],
  volumes: [volume('5 мл', 5, 'мл')]
}],
  ['parses dotted typo kали глаз as eye drops', 'Категор Офта 5мг/мл 5мл кали. глаз', {
  trade_name_text: 'категор офта',
  dosage_form: 'drops',
  strengths: [ratio('5 мг/мл', [5], 5, 'мг', { value: null, unit: 'мл' })],
  volumes: [volume('5 мл', 5, 'мл')]
}],
  ['parses plain drop кап abbreviation from surrounding context', 'Аквадетрим кап. 10мл', {
  trade_name_text: 'аквадетрим',
  dosage_form: 'drops',
  volumes: [ { text: '10 мл', value: 10, unit: 'мл' } ]
}],
  ['keeps explicit drops form for dose per ml strengths', "Назоферон, 100'000 МЕ/мл, 5 мл, капли назал.", {
  trade_name_text: 'назоферон',
  dosage_form: 'drops',
  strengths: [ { kind: 'ratio', text: '100000 ме/мл', values: [ 100000 ], value: 100000, unit: 'ме', denominator: { value: null, unit: 'мл' } } ],
  volumes: [ { text: '5 мл', value: 5, unit: 'мл' } ]
}],
  ['drops plain nasal wording from drops trade name', 'Десмопрессин капли в нос 100мкг/5мл №1', {
  trade_name_text: 'десмопрессин',
  dosage_form: 'drops',
  strengths: [ ratio('100 мкг/5 мл', [100], 100, 'мкг', { value: 5, unit: 'мл' }) ],
  pack_count: 1
}],
  ['treats gram value after drops form as package volume', 'Алчеба капли 100г.№1', {
  trade_name_text: 'алчеба',
  dosage_form: 'drops',
  volumes: [ { text: '100 г', value: 100, unit: 'г' } ],
  pack_count: 1
}],
  ['parses k-li eye drop abbreviation from surrounding context', 'БЕЛАТИРС ИНТЕНСИВ к-ли глазные 10мл', {
  trade_name_text: 'белатирс интенсив',
  trade_name_tokens: [ 'белатирс', 'интенсив' ],
  dosage_form: 'drops',
  volumes: [ { text: '10 мл', value: 10, unit: 'мл' } ]
}],
  ['parses hyphen-glued eye drop abbreviation from surrounding context', 'ФотилФорте-кап.глаз.4%5мл№1', {
  trade_name_text: 'фотил форте',
  trade_name_tokens: [ 'фотил', 'форте' ],
  dosage_form: 'drops',
  strengths: [ { kind: 'simple', text: '4%', values: [ 4 ], value: 4, unit: '%' } ],
  volumes: [ { text: '5 мл', value: 5, unit: 'мл' } ],
  pack_count: 1
}, {
  search: {
    options: { limit: 5 },
    sqlIncludes: [ 'CASE WHEN m.trade_name = :tradeNameQuery THEN 0.05 ELSE 0 END' ]
  }
}],
  ['parses compact patch dimensions with right-side unit', 'Лейкопластырь тканевой Fum Plast 5*500см', {
  trade_name_text: 'лейкопластырь тканевой fum plast 5 см х 500 см',
  dosage_form: null,
  product_type: 'device'
}],
  ['treats gram-packaged combination drops as per-gram strength', 'Фелисанс уш.капли 40мг+10мг 16г №1', {
  trade_name_text: 'фелисанс',
  dosage_form: 'drops',
  strengths: [ ratio('40/10 мг/г', [40, 10], null, 'мг', { value: null, unit: 'г' }) ],
  volumes: [ volume('16 г', 16, 'г', { packageVolume: true }) ],
  pack_count: 1
}],
  ['parses compact ampoule percent-volume listing as strength plus package volume', 'Калия хлорид амп.4%.10мл№10', {
  trade_name_text: 'калия хлорид',
  dosage_form: 'injection',
  pack_count: 10,
  strengths: [ { kind: 'simple', text: '4%', values: [ 4 ], value: 4, unit: '%' } ],
  volumes: [ { text: '10 мл', value: 10, unit: 'мл' } ]
}],
  ['parses compact solution percent-volume listing as strength plus package volume', 'Буфесал 7 Гиал р-р.д/ингаляц.7%5мл №10', {
  trade_name_text: 'буфесал 7 гиал',
  dosage_form: 'solution',
  pack_count: 10,
  strengths: [ { kind: 'simple', text: '7%', values: [ 7 ], value: 7, unit: '%' } ],
  volumes: [ { text: '5 мл', value: 5, unit: 'мл' } ]
}],
  ['parses Pulmicort ampoules as inhalation suspension, not injection', 'Пульмикорт, 0,25 мг/мл, 2 мл, амп. №20', {
  trade_name_text: 'пульмикорт',
  dosage_form: 'suspension',
  dosage_form_token: 'сусп',
  dosage_form_source: 'inferred_from_container',
  container_type: 'ampoule',
  strengths: [ratio('0.25 мг/мл', [0.25], 0.25, 'мг', { value: null, unit: 'мл' })],
  volumes: [volume('2 мл', 2, 'мл')],
  pack_count: 20
}],
  ['parses compact Pulmicort ampoules as inhalation suspension', 'Пульмикорт амп. 0,5мг/мл 2мл №20', {
  trade_name_text: 'пульмикорт',
  dosage_form: 'suspension',
  dosage_form_token: 'сусп',
  dosage_form_source: 'inferred_from_container',
  container_type: 'ampoule',
  strengths: [ratio('0.5 мг/мл', [0.5], 0.5, 'мг', { value: null, unit: 'мл' })],
  volumes: [volume('2 мл', 2, 'мл')],
  pack_count: 20
}],
  ['treats ингал/амп as ampoule container plus route hint', 'Брокс ингал/амп.15мг/2мл№10 (Амброксол г/х)', {
  trade_name_text: 'брокс',
  dosage_form: 'injection',
  dosage_form_token: 'амп',
  dosage_form_source: 'inferred_from_container',
  container_type: 'ampoule',
  strengths: [ratio('15 мг/2 мл', [15], 15, 'мг', { value: 2, unit: 'мл' })],
  pack_count: 10
}],
  ['parses hyphen-glued ratio strength followed by package volume', 'Ибупрофен сусп. без сахара 100мг/5мл-100мл№1', {
  trade_name_text: 'ибупрофен',
  dosage_form: 'suspension',
  pack_count: 1,
  strengths: [
    {
      kind: 'ratio',
      text: '100 мг/5 мл',
      values: [ 100 ],
      value: 100,
      unit: 'мг',
      denominator: { value: 5, unit: 'мл' }
    }
  ],
  volumes: [ { text: '100 мл', value: 100, unit: 'мл' } ]
}],
  ['infers oral liquid per-dose ratio from adjacent reference volume', 'азилаб® суспензия для внутр, прим, 100 мг 5мл 15мл', {
  trade_name_text: 'азилаб',
  dosage_form: 'suspension',
  dosage_form_route: 'oral',
  strengths: [
    {
      kind: 'ratio',
      text: '100 мг/5 мл',
      values: [ 100 ],
      value: 100,
      unit: 'мг',
      denominator: { value: 5, unit: 'мл' }
    }
  ],
  volumes: [ { text: '15 мл', value: 15, unit: 'мл' } ]
}],
  ['does not treat oral liquid reference dose as package volume', 'Бакдиар сусп 220 мг 5 мл №10', {
  trade_name_text: 'бакдиар',
  dosage_form: 'suspension',
  dosage_form_route: 'oral',
  strengths: [
    {
      kind: 'ratio',
      text: '220 мг/5 мл',
      values: [ 220 ],
      value: 220,
      unit: 'мг',
      denominator: { value: 5, unit: 'мл' }
    }
  ],
  volumes: [],
  pack_count: 10
}],
  ['keeps spaced infusion strength and package volume separate', 'аврола р-р.д/инф.500мг 100мл №1', {
  trade_name_text: 'аврола',
  dosage_form: 'solution',
  dosage_form_route: 'infusion',
  strengths: [ { kind: 'simple', text: '500 мг', values: [ 500 ], value: 500, unit: 'мг' } ],
  volumes: [ { text: '100 мл', value: 100, unit: 'мл' } ],
  pack_count: 1
}],
  ['keeps decimal package volume in injectable activity-unit strength', 'Эспоген р-р д/инъек.2000МЕ 0.5мл №6', {
  trade_name_text: 'эспоген',
  dosage_form: 'injection',
  strengths: [ratio('2000 ме/0.5 мл', [2000], 2000, 'ме', { value: 0.5, unit: 'мл' })],
  volumes: [volume('0.5 мл', 0.5, 'мл')],
  pack_count: 6
}],
  ['infers omitted per-ml unit for infusion concentrates', 'альвиум конц.д/приг.р-ра д/инф.1мг 5мл №10', {
  trade_name_text: 'альвиум',
  dosage_form: 'solution',
  dosage_form_route: 'infusion',
  strengths: [
    {
      kind: 'ratio',
      text: '1 мг/мл',
      values: [ 1 ],
      value: 1,
      unit: 'мг',
      denominator: { value: null, unit: 'мл' }
    }
  ],
  volumes: [ { text: '5 мл', value: 5, unit: 'мл' } ],
  pack_count: 10
}],
  ['infers known infusion concentration before package volume', 'Самфлок р-р.д/инф.5мг 100мл №1', {
  trade_name_text: 'самфлок',
  dosage_form: 'solution',
  dosage_form_route: 'infusion',
  strengths: [ratio('5 мг/мл', [5], 5, 'мг', { value: null, unit: 'мл' })],
  volumes: [volume('100 мл', 100, 'мл')],
  pack_count: 1
}],
  ['infers Tivortin infusion concentration before package volume', 'Тивортин р-р.д/инф.42мг 100мл №1', {
  trade_name_text: 'тивортин',
  dosage_form: 'solution',
  dosage_form_route: 'infusion',
  strengths: [ratio('42 мг/мл', [42], 42, 'мг', { value: null, unit: 'мл' })],
  volumes: [volume('100 мл', 100, 'мл')],
  pack_count: 1
}],
  ['infers Tivamin slash package volume as concentration', 'Тивамин р-р д/инф. 42мг/100мл№1', {
  trade_name_text: 'тивамин',
  dosage_form: 'solution',
  dosage_form_route: 'infusion',
  strengths: [ratio('42 мг/мл', [42], 42, 'мг', { value: null, unit: 'мл' })],
  volumes: [volume('100 мл', 100, 'мл')],
  pack_count: 1
}],
  ['infers known no-form concentration before package volume', 'Саргин Аспартат 200МГ 100МЛ', {
  trade_name_text: 'саргин аспартат',
  strengths: [ratio('200 мг/мл', [200], 200, 'мг', { value: null, unit: 'мл' })],
  volumes: [volume('100 мл', 100, 'мл')]
}],
  ['infers known injectable concentration before package volume', 'Тарес р-р.д/инъек.250мг 4мл №3', {
  trade_name_text: 'тарес',
  dosage_form: 'injection',
  strengths: [ratio('250 мг/мл', [250], 250, 'мг', { value: null, unit: 'мл' })],
  volumes: [volume('4 мл', 4, 'мл')],
  pack_count: 3
}],
  ['infers known diclofenac injection concentration before package volume', 'Диклион р-р.д/инъек.25мг 3мл №5', {
  trade_name_text: 'диклион',
  dosage_form: 'injection',
  strengths: [ratio('25 мг/мл', [25], 25, 'мг', { value: null, unit: 'мл' })],
  volumes: [volume('3 мл', 3, 'мл')],
  pack_count: 5
}],
  ['infers known infusion concentration for Tiopol before package volume', 'Тиопол р-р.д/инф.12мг 50мл №1', {
  trade_name_text: 'тиопол',
  dosage_form: 'solution',
  dosage_form_route: 'infusion',
  strengths: [ratio('12 мг/мл', [12], 12, 'мг', { value: null, unit: 'мл' })],
  volumes: [volume('50 мл', 50, 'мл')],
  pack_count: 1
}],
  ['keeps repeated concentrate volume as ratio denominator', 'Иритеро конц.д/приг.р-ра д/инф.100мг 5мл/5мл №1', {
  trade_name_text: 'иритеро',
  dosage_form: 'solution',
  dosage_form_route: 'infusion',
  strengths: [ ratio('100 мг/5 мл', [100], 100, 'мг', { value: 5, unit: 'мл' }) ],
  volumes: [ volume('5 мл', 5, 'мл', { packageVolume: true }) ],
  pack_count: 1
}, {
  search: {
    options: { limit: 5, requireParsedAttributeMatch: true, strictParsedAttributeFilters: true },
    filterPrefix: 'volumeFilter',
    filterValuesInclude: ['5 мл']
  }
}],
  ['treats Betadine solution mg/g denominator typo as per ml', 'Бетадин р-р 100мг/г 30мл', {
  trade_name_text: 'бетадин',
  dosage_form: 'solution',
  strengths: [ratio('100 мг/1 мл', [100], 100, 'мг', { value: 1, unit: 'мл' })],
  volumes: [volume('30 мл', 30, 'мл')]
}],
  ['infers known ampoule slash volume as package volume', 'ИНГАМИСТ АМП 100МГ/3МЛ №10', {
  trade_name_text: 'ингамист',
  dosage_form: 'injection',
  strengths: [ratio('100 мг/мл', [100], 100, 'мг', { value: null, unit: 'мл' })],
  volumes: [volume('3 мл', 3, 'мл')],
  pack_count: 10
}],
  ['infers known no-form slash volume as package volume', 'АМБРОКСОЛ 7,5МГ/2МЛ №20', {
  trade_name_text: 'амброксол',
  strengths: [ratio('7.5 мг/мл', [7.5], 7.5, 'мг', { value: null, unit: 'мл' })],
  volumes: [volume('2 мл', 2, 'мл')],
  pack_count: 20
}],
  ['infers known slash injectable volume as package volume', 'Тарес р-р.д/инъек.250мг/4мл №3', {
  trade_name_text: 'тарес',
  dosage_form: 'injection',
  strengths: [ratio('250 мг/мл', [250], 250, 'мг', { value: null, unit: 'мл' })],
  volumes: [volume('4 мл', 4, 'мл')],
  pack_count: 3
}],
  ['parses compact solution-form strength followed by package volume', 'Элькар р-р300мг/мл100мл№1', {
  trade_name_text: 'элькар',
  dosage_form: 'solution',
  pack_count: 1,
  strengths: [
    {
      kind: 'ratio',
      text: '300 мг/мл',
      values: [ 300 ],
      value: 300,
      unit: 'мг',
      denominator: { value: null, unit: 'мл' }
    }
  ],
  volumes: [ { text: '100 мл', value: 100, unit: 'мл' } ]
}],
  ['parses slash-space compact solution ratio', 'ЭЛЬКАР Р-Р 300МГ/ 100МЛ', {
  trade_name_text: 'элькар',
  dosage_form: 'solution',
  strengths: [
    {
      kind: 'ratio',
      text: '300 мг/100 мл',
      values: [ 300 ],
      value: 300,
      unit: 'мг',
      denominator: { value: 100, unit: 'мл' }
    }
  ]
}],
  ['parses measurement tokens with trailing vendor suffixes', 'НАТРИЯ ГИДРОКАРБОНАТ Р-Р 4% 100МЛ-МР', {
  trade_name_text: 'натрия гидрокарбонат',
  strengths: [ { kind: 'simple', text: '4%', values: [ 4 ], value: 4, unit: '%' } ],
  volumes: [ { text: '100 мл', value: 100, unit: 'мл' } ]
}],
  ['detects abbreviated oral route for inner-use listings', 'БАКДИАР Д/ПРИЕМ ВНУТРЬ  220МГ/5МЛ  N10', {
  trade_name_text: 'бакдиар',
  dosage_form_route: 'oral',
  strengths: [
    {
      kind: 'ratio',
      text: '220 мг/5 мл',
      values: [ 220 ],
      value: 220,
      unit: 'мг',
      denominator: { value: 5, unit: 'мл' }
    }
  ],
  pack_count: 10
}],
  ['infers oral route for liquid suspension per-dose strengths', 'Бакдиар сусп 220мг/5мл №10', {
  trade_name_text: 'бакдиар',
  dosage_form: 'suspension',
  dosage_form_route: 'oral',
  strengths: [
    {
      kind: 'ratio',
      text: '220 мг/5 мл',
      values: [ 220 ],
      value: 220,
      unit: 'мг',
      denominator: { value: 5, unit: 'мл' }
    }
  ],
  pack_count: 10
}],
  ['parses short sus abbreviation as suspension', 'Тайлол сус.120мг/5мл 100мл Малина', {
  trade_name_text: 'тайлол малина',
  dosage_form: 'suspension',
  strengths: [ratio('120 мг/5 мл', [120], 120, 'мг', { value: 5, unit: 'мл' })],
  volumes: [volume('100 мл', 100, 'мл')]
}],
  ['infers oral suspension package volume from dose count', 'Бактокс сусп. 250мг/5мл 12доз', {
  trade_name_text: 'бактокс',
  dosage_form: 'suspension',
  dosage_form_route: 'oral',
  strengths: [ratio('250 мг/5 мл', [250], 250, 'мг', { value: 5, unit: 'мл' })],
  volumes: [volume('60 мл', 60, 'мл', { packageVolume: true })]
}, {
  search: {
    options: { limit: 5, requireParsedAttributeMatch: true, strictParsedAttributeFilters: true },
    filterPrefix: 'volumeFilter',
    filterValuesInclude: ['60 мл'],
    filterValuesExclude: ['12 доз']
  }
}],
  ['keeps blank stored volume candidates for strict volume filters', 'Бруфен сироп 100мг/5мл 100мл', {
  trade_name_text: 'бруфен',
  dosage_form: 'syrup',
  dosage_form_route: 'oral',
  strengths: [ratio('100 мг/5 мл', [100], 100, 'мг', { value: 5, unit: 'мл' })],
  volumes: [volume('100 мл', 100, 'мл')]
}, {
  search: {
    options: { limit: 5, requireParsedAttributeMatch: true, strictParsedAttributeFilters: true },
    filterPrefix: 'volumeFilter',
    filterValuesInclude: ['100 мл'],
    sqlIncludes: ["lower(coalesce(m.volume, '')) = ''"]
  }
}],
  ['matches slash-delimited stored component strengths', 'Гайнекс ваг.супп.500мг№14', {
  trade_name_text: 'гайнекс',
  dosage_form: 'suppository',
  dosage_form_route: 'vaginal',
  strengths: [simple('500 мг', [500], 500, 'мг')],
  pack_count: 14
}, {
  search: {
    options: { limit: 5, requireParsedAttributeMatch: true, strictParsedAttributeFilters: true },
    replacementsEqual: { tradeNameQuery: 'гайнекс' },
    filterPrefix: 'strengthFilter',
    filterValuesInclude: ['500 мг'],
    sqlIncludes: ["LIKE :strengthFilter0_0 || '/%'"]
  }
}],
  ['parses slash aerosol dose count forms', 'Беклометазон аэр.250мкг/200 Бинно фарм', {
  trade_name_text: 'беклометазон бинно фарм',
  strengths: [
    {
      kind: 'ratio',
      text: '250 мкг/доз',
      values: [ 250 ],
      value: 250,
      unit: 'мкг',
      denominator: { value: null, unit: 'доз' }
    }
  ],
  volumes: [ { text: '200 доз', value: 200, unit: 'доз' } ]
}],
  ['parses per-dose compact aerosol dose count forms', 'Беклометазон аэр.д/инг 250мкг/д 200д', {
  trade_name_text: 'беклометазон',
  strengths: [
    {
      kind: 'ratio',
      text: '250 мкг/доз',
      values: [ 250 ],
      value: 250,
      unit: 'мкг',
      denominator: { value: null, unit: 'доз' }
    }
  ],
  volumes: [ { text: '200 доз', value: 200, unit: 'доз' } ]
}],
  ['infers metered spray dose strength before dose count', 'Момефин спрей назаль 0,5мг 120доз 12мл №1', {
  trade_name_text: 'момефин',
  dosage_form: 'spray',
  strengths: [ratio('0.5 мг/доз', [0.5], 0.5, 'мг', { value: null, unit: 'доз' })],
  volumes: [
    volume('120 доз', 120, 'доз'),
    volume('12 мл', 12, 'мл')
  ],
  pack_count: 1
}],
  ['infers metered aerosol dose strength before package mass and dose count', 'Сальбутамол-АВ аэроз.100мкг/7г.200доз.№1', {
  trade_name_text: 'сальбутамол-ав',
  dosage_form: 'aerosol',
  strengths: [ratio('100 мкг/доз', [100], 100, 'мкг', { value: null, unit: 'доз' })],
  volumes: [
    volume('200 доз', 200, 'доз'),
    volume('7 г', 7, 'г', { packageVolume: true })
  ],
  pack_count: 1
}],
  ['matches stored simple strength for per-dose aerosol strengths', 'Беклометазон 250мкг/доз 200доз аэрозоль', {
  trade_name_text: 'беклометазон',
  dosage_form: 'aerosol',
  strengths: [ratio('250 мкг/доз', [250], 250, 'мкг', { value: null, unit: 'доз' })],
  volumes: [volume('200 доз', 200, 'доз')]
}, {
  search: {
    options: { limit: 5, requireParsedAttributeMatch: true, strictParsedAttributeFilters: true },
    filterPrefix: 'strengthFilter',
    filterValuesInclude: ['250 мкг/доз', '250 мкг']
  }
}],
  ['does not parse Gelik trade name as gel dosage form', 'Гелик, 20 г, гель.', {
  trade_name_text: 'гелик',
  trade_name_tokens: [ 'гелик' ],
  dosage_form: 'gel',
  volumes: [ { text: '20 г', value: 20, unit: 'г' } ]
}],
  ['parses count multipliers after № as total pack count', 'Бисопролол, таблетки, покрытые оболочкой, 10 мг № 10х3', {
  trade_name_text: 'бисопролол',
  dosage_form: 'tablet',
  strengths: [ { kind: 'simple', text: '10 мг', values: [ 10 ], value: 10, unit: 'мг' } ],
  pack_count: 30
}],
  ['prefers outer pack marker over parenthesized blister count', 'Ранит №100 таб. (№10*10) (Ранитидин 150 мг)', {
  trade_name_text: 'ранит',
  dosage_form: 'tablet',
  strengths: [ { kind: 'simple', text: '150 мг', values: [ 150 ], value: 150, unit: 'мг' } ],
  pack_count: 100
}],
  ['parses compact injectable powder abbreviation with gram strength', 'эфес пор.д/приг.р-ра д/инъек.5,0г №1', {
  trade_name_text: 'эфес',
  dosage_form: 'powder',
  dosage_form_route: 'injection',
  strengths: [ { kind: 'simple', text: '5 г', values: [ 5 ], value: 5, unit: 'г' } ],
  pack_count: 1
}],
  ['parses percent strength slash package mass as separate volume', 'Артрокол гель 2.5%/45г№1', {
  trade_name_text: 'артрокол',
  dosage_form: 'gel',
  pack_count: 1,
  strengths: [ { kind: 'simple', text: '2.5%', values: [ 2.5 ], value: 2.5, unit: '%' } ],
  volumes: [ { text: '45 г', value: 45, unit: 'г' } ]
}],
  ['infers topical dose-unit strengths as per gram before package mass', 'ВИФЕРОН МАЗЬ 40 000МЕ 12ГР.', {
  trade_name_text: 'виферон',
  dosage_form: 'ointment',
  strengths: [ratio('40000 ме/г', [40000], 40000, 'ме', { value: null, unit: 'г' })],
  volumes: [volume('12 г', 12, 'г')]
}],
  ['infers topical dose-unit ED strengths as per gram before package mass', 'Ацикловир крем 100000ЕД 5г', {
  trade_name_text: 'ацикловир',
  dosage_form: 'cream',
  strengths: [ratio('100000 ед/г', [100000], 100000, 'ед', { value: null, unit: 'г' })],
  volumes: [volume('5 г', 5, 'г')]
}],
  ['treats topical slash mass as package size', 'Дермазол крем 20мг/15г№1', {
  trade_name_text: 'дермазол',
  dosage_form: 'cream',
  pack_count: 1,
  strengths: [ratio('20 мг/г', [20], 20, 'мг', { value: null, unit: 'г' })],
  volumes: [volume('15 г', 15, 'г', { packageVolume: true })]
}, {
  search: {
    options: { limit: 5, requireParsedAttributeMatch: true, strictParsedAttributeFilters: true },
    filterPrefix: 'volumeFilter',
    filterValuesInclude: ['15 г']
  }
}],
  ['treats aerosol slash mass as package size', 'Пантенол аэрозоль 50мг/116г.№1 МикроФарм', {
  trade_name_text: 'пантенол',
  dosage_form: 'aerosol',
  pack_count: 1,
  strengths: [ratio('50 мг/г', [50], 50, 'мг', { value: null, unit: 'г' })],
  volumes: [volume('116 г', 116, 'г', { packageVolume: true })]
}],
  ['treats trailing mass after topical ratio strengths as package size', 'Изигел плюс 50мг/г+30мг/г 40г №1', {
  trade_name_text: 'изигел плюс',
  pack_count: 1,
  strengths: [
    {
      kind: 'ratio',
      text: '50 мг/г',
      values: [ 50 ],
      value: 50,
      unit: 'мг',
      denominator: { value: null, unit: 'г' }
    },
    {
      kind: 'ratio',
      text: '30 мг/г',
      values: [ 30 ],
      value: 30,
      unit: 'мг',
      denominator: { value: null, unit: 'г' }
    }
  ],
  volumes: [ { text: '40 г', value: 40, unit: 'г' } ]
}],
  ['parses Semavik multi-dose pen without leaking null dose volume', 'Семавик р-р 1,34мг/мл 0,25/0,5/1доза 3мл (Семаглутид)', {
  trade_name_text: 'семавик',
  dosage_form: 'solution',
  strengths: [
    {
      kind: 'ratio',
      text: '1.34 мг/мл',
      values: [ 1.34 ],
      value: 1.34,
      unit: 'мг',
      denominator: { value: null, unit: 'мл' }
    },
    {
      kind: 'ratio',
      text: '0.25/0.5/1 мг/доз',
      values: [ 0.25, 0.5, 1 ],
      value: null,
      unit: 'мг',
      denominator: { value: null, unit: 'доз' }
    }
  ],
  volumes: [ { text: '3 мл', value: 3, unit: 'мл' } ]
}, {
  search: { replacementsEqual: { volume0_0: '3 мл' }, replacementValuesExclude: [ 'null доз' ] }
}],
  ['preserves multi-value measurements without NaN text', 'тест 1мг/мл 5/10мл', {
  strengths: [
    {
      kind: 'ratio',
      text: '1 мг/мл',
      values: [ 1 ],
      value: 1,
      unit: 'мг',
      denominator: { value: null, unit: 'мл' }
    }
  ],
  volumes: [ { text: '5 мл/10 мл', value: null, unit: 'мл' } ]
}, {
  search: {
    options: { limit: 5, requireParsedAttributeMatch: true, strictParsedAttributeFilters: true },
    replacementValuesExclude: [ '0 мг' ],
    replacementValuesInclude: [ '5 мл/10 мл' ]
  }
}],
  ['parses compact patch dimensions written with an asterisk', 'Перцовый пластырь 6см*10см №220 (без перфорации)', {
  trade_name_text: 'перцовый пластырь 6 см х 10 см без перфорации',
  dosage_form: null,
  product_type: 'device',
  pack_count: 220
}],
  ['detects suppository rectal route', 'НАТАЦИН СУПП. РЕКТ. 100МГ №3', { dosage_form: 'suppository', dosage_form_route: 'rectal' }],
  ['detects suppository vaginal route', 'Натацин, 100 мг, супп. ваг. №3', { dosage_form: 'suppository', dosage_form_route: 'vaginal' }],
  ['infers bare syrup package volumes as milliliters', 'Солодкового корня (Зиё Нур) сироп 90', {
  trade_name_text: 'солодкового корня',
  dosage_form: 'syrup',
  volumes: [ { text: '90 мл', value: 90, unit: 'мл' } ]
}],
  ['drops duplicate total strength marker before injectable powder form', 'абилот 1,5 пор для приг.р-ра для инъек. 1,0/0,5г №1', {
  trade_name_text: 'абилот',
  dosage_form: 'powder',
  dosage_form_route: 'injection',
  strengths: [ { kind: 'simple', text: '1 г/0.5 г', values: [ 1, 0.5 ], value: null, unit: 'г' } ],
  pack_count: 1
}],
  ['drops duplicate total strength marker for same-unit combination strengths', 'комбипреп 30 таб. 10 мг + 20 мг №10', {
  trade_name_text: 'комбипреп',
  strengths: [
    {
      kind: 'combination',
      text: '10 мг + 20 мг',
      components: [ { value: 10, unit: 'мг' }, { value: 20, unit: 'мг' } ]
    }
  ]
}, {
  tokenRoles: [ { value: '30', role: 'strength' } ],
  search: {
    options: { limit: 5, requireParsedAttributeMatch: true, strictParsedAttributeFilters: true },
    replacementValuesInclude: [ '10/20 мг', '30 мг', '0.03 г', '0,03 г' ]
  }
}],
  ['parses trailing-unit plus strengths as combination components', 'Эналозид 25 таб 25+10мг №20', {
  trade_name_text: 'эналозид 25',
  dosage_form: 'tablet',
  strengths: [
    {
      kind: 'combination',
      text: '25 мг + 10 мг',
      components: [ { value: 25, unit: 'мг' }, { value: 10, unit: 'мг' } ]
    }
  ],
  pack_count: 20
}],
  ['drops trailing generic annotation after ampoule pack count', 'авикарнитин амп.200мг/5мл№5 левокарнитин', {
  trade_name_text: 'авикарнитин',
  dosage_form: 'injection',
  container_type: 'ampoule',
  strengths: [
    {
      kind: 'ratio',
      text: '200 мг/5 мл',
      values: [ 200 ],
      value: 200,
      unit: 'мг',
      denominator: { value: 5, unit: 'мл' }
    }
  ],
  volumes: [ { text: '5 мл', value: 5, unit: 'мл' } ],
  pack_count: 5
}],
  ['parses Avicarnitine injection solution abbreviation', 'авикарнитин р-р д/инь. 200мг/5мл №5', {
  trade_name_text: 'авикарнитин',
  dosage_form: 'injection',
  dosage_form_route: 'injection',
  container_type: 'ampoule',
  strengths: [
    {
      kind: 'ratio',
      text: '200 мг/5 мл',
      values: [ 200 ],
      value: 200,
      unit: 'мг',
      denominator: { value: 5, unit: 'мл' }
    }
  ],
  volumes: [ { text: '5 мл', value: 5, unit: 'мл' } ],
  pack_count: 5
}],
  ['splits compact plus strengths with shared per-ml denominator', 'Толкимадо амп.100+2,5мг/мл№5', {
  trade_name_text: 'толкимадо',
  dosage_form: 'injection',
  container_type: 'ampoule',
  strengths: [
    ratio('100 мг/мл', [100], 100, 'мг', { value: null, unit: 'мл' }),
    ratio('2.5 мг/мл', [2.5], 2.5, 'мг', { value: null, unit: 'мл' })
  ],
  pack_count: 5
}],
  ['parses Adrenaline ampoule decimal percent strength', 'адреналин амп. 0,18% 1мл №10', {
  trade_name_text: 'адреналин',
  dosage_form: 'injection',
  container_type: 'ampoule',
  strengths: [ { kind: 'simple', text: '0.18%', values: [ 0.18 ], value: 0.18, unit: '%' } ],
  volumes: [ { text: '1 мл', value: 1, unit: 'мл' } ],
  pack_count: 10
}],
  ['drops Adaksikam complex package annotation from solution listing', 'адаксикам р-р 20мг  №3 в комплекс 2мл  №3', {
  trade_name_text: 'адаксикам',
  dosage_form: 'solution',
  strengths: [ { kind: 'simple', text: '20 мг', values: [ 20 ], value: 20, unit: 'мг' } ],
  volumes: [ { text: '2 мл', value: 2, unit: 'мл' } ],
  pack_count: 3
}],
  ['parses Adaksikam lyophilisate injection listing with trailing ingredient', 'адаксикам лиоф.д/приг.р-ра.д/инъек.20мг 2мл №3 теноксикам', {
  trade_name_text: 'адаксикам',
  dosage_form: 'powder',
  dosage_form_route: 'injection',
  strengths: [ { kind: 'simple', text: '20 мг', values: [ 20 ], value: 20, unit: 'мг' } ],
  volumes: [ { text: '2 мл', value: 2, unit: 'мл' } ],
  pack_count: 3
}],
  ['parses abbreviated intramuscular solution dose as ratio', 'Артексим р-р.д/внут.введ.15мг 1,5мл №3', {
  trade_name_text: 'артексим',
  dosage_form: 'solution',
  dosage_form_route: 'injection',
  strengths: [ ratio('15 мг/1.5 мл', [15], 15, 'мг', { value: 1.5, unit: 'мл' }) ],
  volumes: [ { text: '1.5 мл', value: 1.5, unit: 'мл' } ],
  pack_count: 3
}],
  ['parses abbreviated intramuscular route with v-m marker', 'Инфелокс р-р.д/внут.в-м.введ.15мг 1,5мл №5', {
  trade_name_text: 'инфелокс',
  dosage_form: 'solution',
  dosage_form_route: 'injection',
  strengths: [ ratio('15 мг/1.5 мл', [15], 15, 'мг', { value: 1.5, unit: 'мл' }) ],
  volumes: [ { text: '1.5 мл', value: 1.5, unit: 'мл' } ],
  pack_count: 5
}],
  ['parses abbreviated injection route written as d/i', 'Ламбене р-р д/и 2мл №3', {
  trade_name_text: 'ламбене',
  dosage_form: 'solution',
  dosage_form_route: 'injection',
  volumes: [ { text: '2 мл', value: 2, unit: 'мл' } ],
  pack_count: 3
}],
  ['fixes repeated mass unit typo before matching package volume', 'ЦИТИКОЛИН Р-Р 1000МГ/4МГ 4МЛ №5', {
  trade_name_text: 'цитиколин',
  dosage_form: 'solution',
  strengths: [ ratio('1000 мг/4 мл', [1000], 1000, 'мг', { value: 4, unit: 'мл' }) ],
  pack_count: 5
}],
  ['treats citicoline per-ml ampoule typo as package-dose ratio', 'Цитиколин-LP амп.1000мг/мл.4мл№5', {
  trade_name_text: 'цитиколин-lр',
  dosage_form: 'injection',
  container_type: 'ampoule',
  strengths: [ ratio('1000 мг/4 мл', [1000], 1000, 'мг', { value: 4, unit: 'мл' }) ],
  volumes: [ { text: '4 мл', value: 4, unit: 'мл' } ],
  pack_count: 5
}],
  ['infers omitted injectable mass unit before slash volume', 'РОНОЦИТ АМП. 1000/4МЛ №5', {
  trade_name_text: 'роноцит',
  dosage_form: 'injection',
  container_type: 'ampoule',
  strengths: [ ratio('1000 мг/4 мл', [1000], 1000, 'мг', { value: 4, unit: 'мл' }) ],
  volumes: [ { text: '4 мл', value: 4, unit: 'мл' } ],
  pack_count: 5
}],
  ['infers omitted injectable mass unit for injection-route solution', 'Артексим р-р.д/внут.введ.1000/4мл №3', {
  trade_name_text: 'артексим',
  dosage_form: 'solution',
  dosage_form_route: 'injection',
  strengths: [ ratio('1000 мг/4 мл', [1000], 1000, 'мг', { value: 4, unit: 'мл' }) ],
  volumes: [ { text: '4 мл', value: 4, unit: 'мл' } ],
  pack_count: 3
}],
  ['infers ampoule total-dose ratio for known Ambromer listings without route text', 'Амбромер амп.15мг 2мл №5', {
  trade_name_text: 'амбромер',
  dosage_form: 'injection',
  strengths: [ ratio('15 мг/2 мл', [15], 15, 'мг', { value: 2, unit: 'мл' }) ],
  volumes: [ { text: '2 мл', value: 2, unit: 'мл' } ],
  pack_count: 5
}],
  ['infers ampoule total-dose ratio for known Esfolip listings without route text', 'Эсфолип амп.250мг.5мл№5 Эссенциальные Фосфолипиды', {
  trade_name_text: 'эсфолип',
  dosage_form: 'injection',
  strengths: [ ratio('250 мг/5 мл', [250], 250, 'мг', { value: 5, unit: 'мл' }) ],
  volumes: [ { text: '5 мл', value: 5, unit: 'мл' } ],
  pack_count: 5
}],
  ['drops parenthesized active ingredient annotation with oral liquid dose', 'азилаб сусп.15мл №1 (азитромицин 100мг 5мл)', {
  trade_name_text: 'азилаб',
  dosage_form: 'suspension',
  dosage_form_route: 'oral',
  strengths: [
    {
      kind: 'ratio',
      text: '100 мг/5 мл',
      values: [ 100 ],
      value: 100,
      unit: 'мг',
      denominator: { value: 5, unit: 'мл' }
    }
  ],
  volumes: [ { text: '15 мл', value: 15, unit: 'мл' } ],
  pack_count: 1
}],
  ['does not parse plastic bottle annotation as plaster dosage form', 'Минеральная Вода Боржоми, 0,5 л (пласт. бут.)', {
  dosage_form: null,
  volumes: [ { text: '0.5 л', value: 0.5, unit: 'л' } ],
  trade_name_tokens: [ 'минеральная', 'вода', 'боржоми' ]
}],
  ['does not normalize Vishnevsky ointment to cherry flavor', 'Вишневский мазь 30г', {
  dosage_form: 'ointment',
  trade_name_tokens: [ 'вишневский' ],
  volumes: [ { text: '30 г', value: 30, unit: 'г' } ]
}],
  ['keeps standalone M brand suffix before dosage form', 'Аллервэй М таб. 5мг+10мг №30', {
  trade_name_text: 'аллервэй м',
  trade_name_tokens: [ 'аллервэй', 'м' ],
  dosage_form: 'tablet',
  strengths: [
    {
      kind: 'combination',
      text: '5 мг + 10 мг',
      components: [ { value: 5, unit: 'мг' }, { value: 10, unit: 'мг' } ]
    }
  ],
  pack_count: 30
}, {
  search: {
    options: { limit: 1, requireParsedAttributeMatch: true, strictParsedAttributeFilters: true },
    replacementsEqual: { tradeNameQuery: 'аллервэй м' },
    filterPrefix: 'strengthFilter',
    filterValuesInclude: [ '10/5 мг', '10 мг/5 мг' ],
    filterValuesExclude: [ '5 мг', '10 мг' ],
    sqlIncludes: [ 'lower((m.name)::text) LIKE :tradeNamePrefix' ]
  }
}],
  ['keeps standalone M brand suffix before strength', 'Диампа М, 12,5/1000 мг, таб. №28', {
  trade_name_text: 'диампа м',
  trade_name_tokens: [ 'диампа', 'м' ],
  dosage_form: 'tablet',
  strengths: [ { kind: 'simple', text: '12.5 мг/1000 мг', values: [ 12.5, 1000 ], value: null, unit: 'мг' } ],
  pack_count: 28
}],
  ['splits hyphenated M brand suffix before strength', 'ДИАМПА-М ТАБ. 12,5/1000МГ №28', {
  trade_name_text: 'диампа м',
  trade_name_tokens: [ 'диампа', 'м' ],
  dosage_form: 'tablet',
  strengths: [ { kind: 'simple', text: '12.5 мг/1000 мг', values: [ 12.5, 1000 ], value: null, unit: 'мг' } ],
  pack_count: 28
}],
  ['detects explicit oral route for suspension listings', 'Алмидоз суспензия для приема внутрь 10 мл №10', {
  dosage_form: 'suspension',
  dosage_form_route: 'oral',
  volumes: [ { text: '10 мл', value: 10, unit: 'мл' } ],
  pack_count: 10
}],
  ['drops abbreviated inner-use route from trade name', 'Д-Вит Ламира 400МЕ р-р.д/прием.внут.масл.10мл №1', {
  trade_name_text: 'д-вит ламира',
  dosage_form: 'solution',
  strengths: [ratio('400 ме/мл', [400], 400, 'ме', { value: null, unit: 'мл' })],
  volumes: [ { text: '10 мл', value: 10, unit: 'мл' } ],
  pack_count: 1
}],
  ['drops compact intravascular intracavitary route from trade name', 'Фторурацил р-р.д/внутр-сосуд.внутр-полост.введ.50мг 20мл №1', {
  trade_name_text: 'фторурацил',
  dosage_form: 'solution',
  strengths: [ratio('50 мг/мл', [50], 50, 'мг', { value: null, unit: 'мл' })],
  volumes: [ { text: '20 мл', value: 20, unit: 'мл' } ],
  pack_count: 1
}],
];

const annotationAndVariantCases = [
  ['does not collapse vitamin suffix into following volume', 'Активный кальций с витамином В6 330мл', {
  trade_name_text: 'активный кальций с в6',
  trade_name_tokens: [ 'активный', 'кальций', 'с', 'в6' ],
  volumes: [ { text: '330 мл', value: 330, unit: 'мл' } ]
}],
  ['keeps bitter almond oil variant token', 'МИНДАЛЬНОЕ МАСЛО (ГОРЬКОГО) 50МЛ (SHANAZ)', {
  trade_name_text: 'миндальное масло горького',
  trade_name_tokens: [ 'миндальное', 'масло', 'горького' ]
}],
  ['drops prefilled syringe marker from parenthesized annotation', 'Эспоген р-р 2000МЕ 0,5мл №6 (запол. шприц.)', {
  trade_name_text: 'эспоген',
  trade_name_tokens: [ 'эспоген' ],
  dosage_form: 'injection',
  strengths: [ratio('2000 ме/0.5 мл', [2000], 2000, 'ме', { value: 0.5, unit: 'мл' })],
  volumes: [volume('0.5 мл', 0.5, 'мл')],
  pack_count: 6
}],
  ['keeps brand tokens repeated in parenthesized annotations', 'Солипод мозольный пластырь №5 (солипод)', {
  trade_name_text: 'солипод мозольный пластырь солипод',
  trade_name_tokens: [ 'солипод', 'мозольный', 'пластырь', 'солипод' ],
  dosage_form: null,
  product_type: 'device',
  pack_count: 5
}],
  ['keeps parenthesized flavor tokens that identify SKUs', 'ФИТОСЕПТ ПАСТ. №16 (ЛИМОН)', {
  trade_name_text: 'фитосепт лимон',
  trade_name_tokens: [ 'фитосепт', 'лимон' ],
  dosage_form: 'paste',
  pack_count: 16
}],
  ['drops disinfectant descriptor from Betadine trade name', 'Бетадин р-р 10% дезинфир. 1000мл', {
  trade_name_text: 'бетадин',
  trade_name_tokens: [ 'бетадин' ],
  dosage_form: 'solution',
  strengths: [ { kind: 'simple', text: '10%', values: [ 10 ], value: 10, unit: '%' } ],
  volumes: [ { text: '1000 мл', value: 1000, unit: 'мл' } ]
}, {
  search: {
    replacementsEqual: { tradeNameQuery: 'бетадин' },
    replacementValuesExclude: [ 'бетадин дезинфир' ]
  }
}],
  ['recognizes inflected packet containers with explicit pack counts', 'Кора дуба чай №25 пакетов', { trade_name_text: 'кора дуба чай', container_type: 'sachet', pack_count: 25 }],
  ['recognizes filtered packet containers with explicit pack counts', 'ШАЛФЕЙ ФИТОЧАЙ Ф-П №20', { trade_name_text: 'шалфей фиточай', container_type: 'sachet', pack_count: 20 }],
  ['keeps parenthesized laterality tokens for device variants', 'Повязка для рук с ремнём GT раз.L (Правый)', {
  trade_name_tokens: [
    'повязка', 'рук',
    'с',       'ремнем',
    'gt',      'раз',
    'l',       'правый'
  ]
}],
  ['keeps post-pack flavor variants', 'аджисепт паст №24 лимон', { trade_name_tokens: [ 'аджисепт', 'лимон' ], dosage_form: 'paste', pack_count: 24 }],
  ['keeps parenthesized berry flavor variants', 'Био Доктор МОМ таб №20 (ягодные)', {
  trade_name_tokens: [ 'био', 'доктор', 'мом', 'ягодные' ],
  dosage_form: 'tablet',
  pack_count: 20
}],
  ['keeps parenthesized typo flavor variants', 'ТРАВРЕЛАКС ЛЕДЕНЦЫ №50 (АПЕЛСИНА)', {
  trade_name_tokens: [ 'траврелакс', 'апелсина' ],
  dosage_form: 'pastille',
  pack_count: 50
}],
  ['keeps parenthesized menthol flavor variants', 'Ангал пастилки №24 (со вкусом ментол)', { trade_name_tokens: [ 'ангал', 'ментол' ], dosage_form: 'pastille', pack_count: 24 }],
  ['keeps parenthesized blackcurrant flavor variants', 'БРОНХО ВЕДА ЛЕДЕНЦЫ №24 (ЧЕРНАЯ СМОРОДИНА)', {
  trade_name_tokens: [ 'бронхо', 'веда', 'черная', 'смородина' ],
  dosage_form: 'pastille',
  pack_count: 24
}],
  ['keeps abbreviated blackcurrant flavor variants', 'БРОНХО ВЕДА ПАСТ №12 "ЧЕРН. СМОРОДИНА"', {
  trade_name_tokens: [ 'бронхо', 'веда', 'черн', 'смородина' ],
  dosage_form: 'paste',
  pack_count: 12
}],
  ['drops plain trailing annotations after post-pack variants', 'аджисепт паст №24 фарм 2', { trade_name_tokens: [ 'аджисепт' ], dosage_form: 'paste', pack_count: 24 }],
  ['keeps parenthesized trade-name text when the span contains a dosage signal', 'бренд (актив 5 мг) таб №10', {
  trade_name_text: 'бренд актив',
  dosage_form: 'tablet',
  strengths: [ { kind: 'simple', text: '5 мг', values: [ 5 ], value: 5, unit: 'мг' } ],
  pack_count: 10
}],
  ['keeps english parenthesized trade-name text when the span contains a dosage signal', 'БИФОЛАК КАПС. 0,5Г №10 (ACTIVE)', {
  trade_name_text: 'бифолак active',
  trade_name_tokens: [ 'бифолак', 'active' ],
  pack_count: 10
}],
  ['keeps parenthesized classic flavor variants', 'АДЖИСЕПТ ПАСТ №24 (КЛАССИЧЕСКИЙ)', { trade_name_tokens: [ 'аджисепт', 'классический' ], pack_count: 24 }],
  ['drops inline spray flavor annotation before strength', 'Стрепсилс Интенсив спрей дозир. со вкусом вишни и мяты 8,75мг/доза 15мл №1', {
  trade_name_text: 'стрепсилс интенсив',
  trade_name_tokens: [ 'стрепсилс', 'интенсив' ],
  dosage_form: 'spray',
  strengths: [ratio('8.75 мг/доз', [8.75], 8.75, 'мг', { value: null, unit: 'доз' })],
  volumes: [volume('15 мл', 15, 'мл')],
  pack_count: 1
}],
  ['drops abbreviated inline spray flavor annotation before strength', 'Стрепсилс Интенсив спрей дозир. со вкус. вишни 8,75мг/доза 15мл №1', {
  trade_name_text: 'стрепсилс интенсив',
  trade_name_tokens: [ 'стрепсилс', 'интенсив' ],
  dosage_form: 'spray',
  strengths: [ratio('8.75 мг/доз', [8.75], 8.75, 'мг', { value: null, unit: 'доз' })],
  volumes: [volume('15 мл', 15, 'мл')],
  pack_count: 1
}],
  ['keeps parenthesized short variant tokens', 'АКВА МАРИС СПРЕЙ 50МЛ (НОРМ)', {
  trade_name_tokens: [ 'аква', 'марис', 'норм' ],
  volumes: [ { text: '50 мл', value: 50, unit: 'мл' } ]
}],
  ['keeps alphabet parenthesized short variant tokens', 'АЛФАВИТ ТАБ. №60 (КЛАССИК)', { trade_name_tokens: [ 'алфавит', 'классик' ], pack_count: 60 }],
  ['keeps standalone short variant tokens', 'ВИТАМИН Д3+К2 КАПС. №60 SWANSON', { trade_name_tokens: [ 'витамин', 'д3', 'к2', 'swanson' ], pack_count: 60 }],
];

test('normalizes common genitive and spelling-variant trade tokens', () => {
  assertParsedCase({
    query: 'Био Хлоргексидина 90мл №1',
    expected: {
      attributes: {
        trade_name_text: 'био хлоргексидин',
        trade_name_tokens: ['био', 'хлоргексидин'],
        volumes: [volume('90 мл', 90, 'мл')],
        pack_count: 1,
      },
    },
  });

  assertParsedCase({
    query: 'Линкомицина гидрохлорид р-р 300мг 1мл №10',
    expected: {
      attributes: {
        trade_name_text: 'линкомицин',
        trade_name_tokens: ['линкомицин'],
        dosage_form: 'solution',
        strengths: [simple('300 мг', [300], 300, 'мг')],
        volumes: [volume('1 мл', 1, 'мл')],
        pack_count: 10,
      },
    },
  });

  assertParsedCase({
    query: 'Бифилакс-Бэби саше.0.6г.№10',
    expected: {
      attributes: {
        trade_name_text: 'бифилакс бейби',
        trade_name_tokens: ['бифилакс', 'бейби'],
        container_type: 'sachet',
        strengths: [simple('0.6 г', [0.6], 0.6, 'г')],
        pack_count: 10,
      },
    },
  });

  assertParsedCase({
    query: 'Бороплюс смягчающий крем для ухода за кожей 100мл',
    expected: {
      attributes: {
        trade_name_text: 'боро плюс софт',
        trade_name_tokens: ['боро', 'плюс', 'софт'],
        product_type: 'other',
        dosage_form: null,
        volumes: [],
      },
    },
  });

  assertParsedCase({
    query: 'Хилак форте капли д/приема внутрь 100мл***',
    expected: {
      attributes: {
        dosage_form: 'drops',
        volumes: [volume('100 мл', 100, 'мл')],
      },
    },
  });
});

test('normalizes cotton sterility and wet wipes descriptor order', () => {
  assertParsedCase({
    query: 'Вата гигиеническая гигрос. н/с 50г',
    expected: {
      attributes: {
        trade_name_text: 'вата гигр нестер',
        product_type: 'other',
        dosage_form: null,
      },
    },
  });

  assertParsedCase({
    query: 'Вата мед. гигрос. стерильн. 50г',
    expected: {
      attributes: {
        trade_name_text: 'вата гигр стер',
        trade_name_tokens: ['вата', 'мед', 'гигр', 'стер', '50', 'г'],
        product_type: 'device',
        dosage_form: null,
        strengths: [simple('50 г', [50], 50, 'г')],
      },
    },
  });

  assertParsedCase({
    query: 'Детские Влажные салфетки гигиенические Cotton Club №25',
    expected: {
      attributes: {
        trade_name_text: 'салфетки влажные cotton club',
        trade_name_tokens: ['салфетки', 'влажные', 'cotton', 'club'],
        product_type: 'other',
        pack_count: 25,
      },
    },
  });
});

test('normalizes gummy magnesium B6 and compact percent-volume after dot', () => {
  assertParsedCase({
    query: 'Витагум-Магний+Б6 150г Мармелад',
    expected: {
      attributes: {
        trade_name_text: 'витагам витамин магний в6 мармеладки',
        trade_name_tokens: ['витагам', 'витамин', 'магний', 'в6', 'мармеладки'],
        strengths: [simple('150 г', [150], 150, 'г')],
      },
    },
  });

  assertParsedCase({
    query: 'Кальция хлорид амп.10%.5мл№10',
    expected: {
      attributes: {
        trade_name_text: 'кальция хлорид',
        trade_name_tokens: ['кальция', 'хлорид'],
        dosage_form: 'injection',
        container_type: 'ampoule',
        strengths: [simple('10%', [10], 10, '%')],
        volumes: [volume('5 мл', 5, 'мл')],
        pack_count: 10,
      },
    },
  });

  assertParsedCase({
    query: 'Ампициллина тригидрат таб 0, 25г №10',
    expected: {
      attributes: {
        trade_name_text: 'ампициллина тригидрат',
        dosage_form: 'tablet',
        strengths: [simple('0.25 г', [0.25], 0.25, 'г')],
        pack_count: 10,
      },
    },
  });

  assertParsedCase({
    query: 'Полипарин р-р для в/в и п/к введ.25000МЕ 5мл№1 фл.',
    expected: {
      attributes: {
        trade_name_text: 'полипарин',
        dosage_form: 'injection',
        strengths: [ratio('25000 ме/5 мл', [25000], 25000, 'ме', { value: 5, unit: 'мл' })],
        volumes: [volume('5 мл', 5, 'мл')],
        pack_count: 1,
      },
    },
  });

  assertParsedCase({
    query: 'Имферон-С Р-Р 20МГ/5 МЛ №1',
    expected: {
      attributes: {
        trade_name_text: 'имферон-с',
        dosage_form: 'solution',
        strengths: [ratio('20 мг/5 мл', [20], 20, 'мг', { value: 5, unit: 'мл' })],
        pack_count: 1,
      },
    },
  });

  assertParsedCase({
    query: 'ОМК-2 стер. офтальмолог. р-р 10мл',
    expected: {
      attributes: {
        trade_name_text: 'омк-2',
        trade_name_tokens: ['омк-2'],
        dosage_form: 'drops',
        volumes: [volume('10 мл', 10, 'мл')],
      },
    },
  });
});

addCases(implicitStrengthCases);
addCases(deviceAndProductTypeCases);
addCases(measurementAndRouteCases);
addCases(annotationAndVariantCases);
