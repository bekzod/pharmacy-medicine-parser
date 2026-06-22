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
  ['parses compact 2x oral solid strength marker', 'АМОКСИКЛАВ ТАБ 2Х1000 №14', {
  trade_name_text: 'амоксиклав',
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
  trade_name_text: 'шприц однок прим kd-ject iii инсулин 0.5 мл u100',
  trade_name_tokens: [
    'шприц', 'однок',
    'прим',  'kd-ject',
    'iii',   'инсулин',
    '0.5',   'мл',
    'u100'
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
  ['parses glued piece counts as pack count', 'Ватные Диски "Bella Cotton" 100шт в полиэтилен', {
  pack_count: 100,
  trade_name_tokens: [ 'ватные', 'диски', 'bella', 'cotton', 'в', 'полиэтилен' ]
}],
];

const measurementAndRouteCases = [
  ['parses strength before slash pack marker', 'СЕМАЛОНГ (СЕМАГЛУТИД) 0,5 р-р д/п-го 0,5мг/№1 шприц-ручка', {
  trade_name_text: 'семалонг',
  dosage_form: 'injection',
  pack_count: 1,
  strengths: [ { kind: 'simple', text: '0.5 мг', values: [ 0.5 ], value: 0.5, unit: 'мг' } ]
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
  ['parses eye drop кап abbreviation from surrounding context', 'Бримоптик кап.глазн. 2мг/мл 5мг/мл 10мл', {
  trade_name_text: 'бримоптик',
  dosage_form: 'drops',
  volumes: [ { text: '10 мл', value: 10, unit: 'мл' } ]
}],
  ['parses plain drop кап abbreviation from surrounding context', 'Аквадетрим кап. 10мл', {
  trade_name_text: 'аквадетрим',
  dosage_form: 'drops',
  volumes: [ { text: '10 мл', value: 10, unit: 'мл' } ]
}],
  ['parses k-li eye drop abbreviation from surrounding context', 'БЕЛАТИРС ИНТЕНСИВ к-ли глазные 10мл', {
  trade_name_text: 'белатирс интенсив',
  trade_name_tokens: [ 'белатирс', 'интенсив' ],
  dosage_form: 'drops',
  volumes: [ { text: '10 мл', value: 10, unit: 'мл' } ]
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
  trade_name_text: 'бакдиар рием',
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
  trade_name_text: 'перцовый',
  dosage_form: 'patch',
  volumes: [ { text: '6 см х 10 см', value: 6, unit: 'см', dimension2: { value: 10, unit: 'см' } } ],
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
  ['detects explicit oral route for suspension listings', 'Алмидоз суспензия для приема внутрь 10 мл №10', {
  dosage_form: 'suspension',
  dosage_form_route: 'oral',
  volumes: [ { text: '10 мл', value: 10, unit: 'мл' } ],
  pack_count: 10
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
  ['keeps brand tokens repeated in parenthesized annotations', 'Солипод мозольный пластырь №5 (солипод)', {
  trade_name_text: 'солипод мозольный',
  trade_name_tokens: [ 'солипод', 'мозольный' ],
  dosage_form: 'patch',
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
  ['keeps parenthesized short variant tokens', 'АКВА МАРИС СПРЕЙ 50МЛ (НОРМ)', {
  trade_name_tokens: [ 'аква', 'марис', 'норм' ],
  volumes: [ { text: '50 мл', value: 50, unit: 'мл' } ]
}],
  ['keeps alphabet parenthesized short variant tokens', 'АЛФАВИТ ТАБ. №60 (КЛАССИК)', { trade_name_tokens: [ 'алфавит', 'классик' ], pack_count: 60 }],
  ['keeps standalone short variant tokens', 'ВИТАМИН Д3+К2 КАПС. №60 SWANSON', { trade_name_tokens: [ 'витамин', 'д3', 'к2', 'swanson' ], pack_count: 60 }],
];

addCases(implicitStrengthCases);
addCases(deviceAndProductTypeCases);
addCases(measurementAndRouteCases);
addCases(annotationAndVariantCases);
