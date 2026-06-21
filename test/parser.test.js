const test = require('node:test');
const assert = require('node:assert/strict');
const {
  parseMedicineQuery,
  buildMedicineSearchQuery,
} = require('../src');

// Implicit brand strength compatibility.
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

test('infers bare Siofor strength as milligrams when pack is explicit', () => {
  const parsed = parseMedicineQuery('Сиофор 500 №60');

  assert.equal(parsed.attributes.trade_name_text, 'сиофор');
  assert.equal(parsed.attributes.pack_count, 60);
  assert.deepEqual(parsed.attributes.strengths, [
    {
      kind: 'simple',
      text: '500 мг',
      values: [500],
      value: 500,
      unit: 'мг',
    },
  ]);
});

test('preserves duplicate components in same-unit slash strengths', () => {
  const raw = parseMedicineQuery('ЭКВАМЕР КАПС. 20МГ/10МГ/10МГ №30');
  assert.equal(raw.attributes.trade_name_text, 'эквамер');
  assert.equal(raw.attributes.dosage_form, 'capsule');
  assert.equal(raw.attributes.pack_count, 30);
  assert.deepEqual(raw.attributes.strengths, [
    {
      kind: 'simple',
      text: '20 мг/10 мг/10 мг',
      values: [20, 10, 10],
      value: null,
      unit: 'мг',
    },
  ]);

  const resolved = parseMedicineQuery('Эквамер, 20 мг/10 мг/20 мг, капс. №30');
  assert.deepEqual(resolved.attributes.strengths, [
    {
      kind: 'simple',
      text: '20 мг/10 мг/20 мг',
      values: [20, 10, 20],
      value: null,
      unit: 'мг',
    },
  ]);
});

test('keeps parenthesized device variant tokens', () => {
  const parsed = parseMedicineQuery('КОРРЕКТОР ОСАНКИ (UNIVERSAL) РАЗМЕР S');

  assert.equal(parsed.attributes.trade_name_text, 'корректор осанки universal размер s');
  assert.deepEqual(parsed.attributes.trade_name_tokens, [
    'корректор',
    'осанки',
    'universal',
    'размер',
    's',
  ]);
});

test('keeps numeric size tokens after abbreviated size markers', () => {
  const parsed = parseMedicineQuery('Гетры эластичный "GT" р. 2');

  assert.equal(parsed.attributes.trade_name_text, 'гетры эластичный gt р 2');
  assert.deepEqual(parsed.attributes.trade_name_tokens, ['гетры', 'эластичный', 'gt', 'р', '2']);
});

test('keeps decimal dimension tokens as strict identity', () => {
  const parsed = parseMedicineQuery('БИНТ ЭЛАСТИЧНЫЙ 10Х0.6');

  assert.equal(parsed.attributes.trade_name_text, 'бинт эластичный 10x0.6');
  assert.deepEqual(parsed.attributes.trade_name_tokens, ['бинт', 'эластичный', '10x0.6']);
  assert.equal(parsed.attributes.pack_count, null);
});

test('parses strength before slash pack marker', () => {
  const parsed = parseMedicineQuery(
    'СЕМАЛОНГ (СЕМАГЛУТИД) 0,5 р-р д/п-го 0,5мг/№1 шприц-ручка',
  );

  assert.equal(parsed.attributes.trade_name_text, 'семалонг');
  assert.equal(parsed.attributes.dosage_form, 'injection');
  assert.equal(parsed.attributes.pack_count, 1);
  assert.deepEqual(parsed.attributes.strengths, [
    {
      kind: 'simple',
      text: '0.5 мг',
      values: [0.5],
      value: 0.5,
      unit: 'мг',
    },
  ]);
});

test('infers sachet pack count before po-strength phrase', () => {
  const parsed = parseMedicineQuery(
    'Тайлолфен Хот порошок для приготовления раствора для приема внутрь, 12 пакетиков по 20 г',
  );

  assert.equal(parsed.attributes.trade_name_text, 'тайлолфен хот');
  assert.equal(parsed.attributes.container_type, 'sachet');
  assert.equal(parsed.attributes.pack_count, 12);
  assert.deepEqual(parsed.attributes.strengths, [
    {
      kind: 'simple',
      text: '20 г',
      values: [20],
      value: 20,
      unit: 'г',
    },
  ]);
});

// Device identity and brand-only parsing.
test('normalizes compact device gauge tokens', () => {
  const parsed = parseMedicineQuery('Катетер внутривенный KD-FIX 18G');

  assert.equal(parsed.attributes.product_type, 'device');
  assert.equal(parsed.attributes.trade_name_text, 'катетер внутривенный kd-fix 18 g');
  assert.deepEqual(parsed.attributes.trade_name_tokens, [
    'катетер',
    'внутривенный',
    'kd-fix',
    '18',
    'g',
  ]);
});

test('keeps syringe device size tokens for strict identity', () => {
  const parsed = parseMedicineQuery('Шприц-NS 20мл№1');

  assert.equal(parsed.attributes.product_type, 'device');
  assert.equal(parsed.attributes.trade_name_text, 'шприц-ns 20 мл');
  assert.deepEqual(parsed.attributes.trade_name_tokens, ['шприц-ns', '20', 'мл']);
  assert.equal(parsed.attributes.pack_count, 1);
});

test('keeps decimal syringe size tokens when brand tokens exist', () => {
  const parsed = parseMedicineQuery('Шприц однок. прим. KD-JECT III инсулин. 0.5мл U100');

  assert.equal(parsed.attributes.product_type, 'device');
  assert.equal(
    parsed.attributes.trade_name_text,
    'шприц однок прим kd-ject iii инсулин 0.5 мл u100',
  );
  assert.deepEqual(parsed.attributes.trade_name_tokens, [
    'шприц',
    'однок',
    'прим',
    'kd-ject',
    'iii',
    'инсулин',
    '0.5',
    'мл',
    'u100',
  ]);
});

test('does not collapse vitamin suffix into following volume', () => {
  const parsed = parseMedicineQuery('Активный кальций с витамином В6 330мл');

  assert.equal(parsed.attributes.trade_name_text, 'активный кальций с в6');
  assert.deepEqual(parsed.attributes.trade_name_tokens, ['активный', 'кальций', 'с', 'в6']);
  assert.deepEqual(parsed.attributes.volumes, [
    {
      text: '330 мл',
      value: 330,
      unit: 'мл',
    },
  ]);
});

test('keeps bitter almond oil variant token', () => {
  const parsed = parseMedicineQuery('МИНДАЛЬНОЕ МАСЛО (ГОРЬКОГО) 50МЛ (SHANAZ)');

  assert.equal(parsed.attributes.trade_name_text, 'миндальное масло горького');
  assert.deepEqual(parsed.attributes.trade_name_tokens, ['миндальное', 'масло', 'горького']);
});

test('keeps brand tokens repeated in parenthesized annotations', () => {
  const parsed = parseMedicineQuery('Солипод мозольный пластырь №5 (солипод)');

  assert.equal(parsed.attributes.trade_name_text, 'солипод мозольный');
  assert.deepEqual(parsed.attributes.trade_name_tokens, ['солипод', 'мозольный']);
  assert.equal(parsed.attributes.dosage_form, 'patch');
  assert.equal(parsed.attributes.pack_count, 5);
});

test('keeps parenthesized flavor tokens that identify SKUs', () => {
  const parsed = parseMedicineQuery('ФИТОСЕПТ ПАСТ. №16 (ЛИМОН)');

  assert.equal(parsed.attributes.trade_name_text, 'фитосепт лимон');
  assert.deepEqual(parsed.attributes.trade_name_tokens, ['фитосепт', 'лимон']);
  assert.equal(parsed.attributes.dosage_form, 'paste');
  assert.equal(parsed.attributes.pack_count, 16);
});

// Catalog abbreviation compatibility.
test('infers bare Creon capsule potency as activity units', () => {
  const parsed = parseMedicineQuery('Креон капс 10000 №20');

  assert.equal(parsed.attributes.trade_name_text, 'креон');
  assert.equal(parsed.attributes.dosage_form, 'capsule');
  assert.equal(parsed.attributes.pack_count, 20);
  assert.deepEqual(parsed.attributes.strengths, [
    {
      kind: 'simple',
      text: '10000 ед',
      values: [10000],
      value: 10000,
      unit: 'ед',
    },
  ]);

  const mezim = parseMedicineQuery('МЕЗИМ КАПС. 25000 №20');
  assert.equal(mezim.attributes.trade_name_text, 'мезим');
  assert.equal(mezim.attributes.dosage_form, 'capsule');
  assert.equal(mezim.attributes.pack_count, 20);
  assert.deepEqual(mezim.attributes.strengths, [
    {
      kind: 'simple',
      text: '25000 ед',
      values: [25000],
      value: 25000,
      unit: 'ед',
    },
  ]);
});

test('disambiguates bare кап abbreviation from surrounding context', () => {
  const adaptol = parseMedicineQuery('Адаптол кап. 300 мг. №20');
  assert.equal(adaptol.attributes.trade_name_text, 'адаптол');
  assert.equal(adaptol.attributes.dosage_form, 'capsule');
  assert.deepEqual(adaptol.attributes.strengths, [
    {
      kind: 'simple',
      text: '300 мг',
      values: [300],
      value: 300,
      unit: 'мг',
    },
  ]);
  assert.equal(adaptol.attributes.pack_count, 20);

  const brimoptik = parseMedicineQuery('Бримоптик кап.глазн. 2мг/мл 5мг/мл 10мл');
  assert.equal(brimoptik.attributes.trade_name_text, 'бримоптик');
  assert.equal(brimoptik.attributes.dosage_form, 'drops');
  assert.deepEqual(brimoptik.attributes.volumes, [{ text: '10 мл', value: 10, unit: 'мл' }]);

  const aquadetrim = parseMedicineQuery('Аквадетрим кап. 10мл');
  assert.equal(aquadetrim.attributes.trade_name_text, 'аквадетрим');
  assert.equal(aquadetrim.attributes.dosage_form, 'drops');
  assert.deepEqual(aquadetrim.attributes.volumes, [{ text: '10 мл', value: 10, unit: 'мл' }]);

  const belatirs = parseMedicineQuery('БЕЛАТИРС ИНТЕНСИВ к-ли глазные 10мл');
  assert.equal(belatirs.attributes.trade_name_text, 'белатирс интенсив');
  assert.deepEqual(belatirs.attributes.trade_name_tokens, ['белатирс', 'интенсив']);
  assert.equal(belatirs.attributes.dosage_form, 'drops');
  assert.deepEqual(belatirs.attributes.volumes, [{ text: '10 мл', value: 10, unit: 'мл' }]);
});

test('parses compact percent-volume listings as strength plus package volume', () => {
  const potassium = parseMedicineQuery('Калия хлорид амп.4%.10мл№10');
  assert.equal(potassium.attributes.trade_name_text, 'калия хлорид');
  assert.equal(potassium.attributes.dosage_form, 'injection');
  assert.equal(potassium.attributes.pack_count, 10);
  assert.deepEqual(potassium.attributes.strengths, [
    {
      kind: 'simple',
      text: '4%',
      values: [4],
      value: 4,
      unit: '%',
    },
  ]);
  assert.deepEqual(potassium.attributes.volumes, [{ text: '10 мл', value: 10, unit: 'мл' }]);

  const bufesal = parseMedicineQuery('Буфесал 7 Гиал р-р.д/ингаляц.7%5мл №10');
  assert.equal(bufesal.attributes.trade_name_text, 'буфесал 7 гиал');
  assert.equal(bufesal.attributes.dosage_form, 'solution');
  assert.equal(bufesal.attributes.pack_count, 10);
  assert.deepEqual(bufesal.attributes.strengths, [
    {
      kind: 'simple',
      text: '7%',
      values: [7],
      value: 7,
      unit: '%',
    },
  ]);
  assert.deepEqual(bufesal.attributes.volumes, [{ text: '5 мл', value: 5, unit: 'мл' }]);
});

test('parses hyphen-glued ratio strength followed by package volume', () => {
  const parsed = parseMedicineQuery('Ибупрофен сусп. без сахара 100мг/5мл-100мл№1');

  assert.equal(parsed.attributes.trade_name_text, 'ибупрофен');
  assert.equal(parsed.attributes.dosage_form, 'suspension');
  assert.equal(parsed.attributes.pack_count, 1);
  assert.deepEqual(parsed.attributes.strengths, [
    {
      kind: 'ratio',
      text: '100 мг/5 мл',
      values: [100],
      value: 100,
      unit: 'мг',
      denominator: { value: 5, unit: 'мл' },
    },
  ]);
  assert.deepEqual(parsed.attributes.volumes, [{ text: '100 мл', value: 100, unit: 'мл' }]);
});

test('infers oral liquid per-dose ratio from adjacent reference volume', () => {
  const parsed = parseMedicineQuery('азилаб® суспензия для внутр, прим, 100 мг 5мл 15мл');

  assert.equal(parsed.attributes.trade_name_text, 'азилаб');
  assert.equal(parsed.attributes.dosage_form, 'suspension');
  assert.equal(parsed.attributes.dosage_form_route, 'oral');
  assert.deepEqual(parsed.attributes.strengths, [
    {
      kind: 'ratio',
      text: '100 мг/5 мл',
      values: [100],
      value: 100,
      unit: 'мг',
      denominator: { value: 5, unit: 'мл' },
    },
  ]);
  assert.deepEqual(parsed.attributes.volumes, [{ text: '15 мл', value: 15, unit: 'мл' }]);
});

test('does not treat oral liquid reference dose as package volume', () => {
  const parsed = parseMedicineQuery('Бакдиар сусп 220 мг 5 мл №10');

  assert.equal(parsed.attributes.trade_name_text, 'бакдиар');
  assert.equal(parsed.attributes.dosage_form, 'suspension');
  assert.equal(parsed.attributes.dosage_form_route, 'oral');
  assert.deepEqual(parsed.attributes.strengths, [
    {
      kind: 'ratio',
      text: '220 мг/5 мл',
      values: [220],
      value: 220,
      unit: 'мг',
      denominator: { value: 5, unit: 'мл' },
    },
  ]);
  assert.deepEqual(parsed.attributes.volumes, []);
  assert.equal(parsed.attributes.pack_count, 10);
});

test('keeps spaced infusion strength and package volume separate', () => {
  const parsed = parseMedicineQuery('аврола р-р.д/инф.500мг 100мл №1');

  assert.equal(parsed.attributes.trade_name_text, 'аврола');
  assert.equal(parsed.attributes.dosage_form, 'solution');
  assert.equal(parsed.attributes.dosage_form_route, 'infusion');
  assert.deepEqual(parsed.attributes.strengths, [
    {
      kind: 'simple',
      text: '500 мг',
      values: [500],
      value: 500,
      unit: 'мг',
    },
  ]);
  assert.deepEqual(parsed.attributes.volumes, [{ text: '100 мл', value: 100, unit: 'мл' }]);
  assert.equal(parsed.attributes.pack_count, 1);
});

test('parses compact solution-form strength followed by package volume', () => {
  const parsed = parseMedicineQuery('Элькар р-р300мг/мл100мл№1');

  assert.equal(parsed.attributes.trade_name_text, 'элькар');
  assert.equal(parsed.attributes.dosage_form, 'solution');
  assert.equal(parsed.attributes.pack_count, 1);
  assert.deepEqual(parsed.attributes.strengths, [
    {
      kind: 'ratio',
      text: '300 мг/мл',
      values: [300],
      value: 300,
      unit: 'мг',
      denominator: { value: null, unit: 'мл' },
    },
  ]);
  assert.deepEqual(parsed.attributes.volumes, [{ text: '100 мл', value: 100, unit: 'мл' }]);
});

test('parses slash-space compact solution ratio', () => {
  const parsed = parseMedicineQuery('ЭЛЬКАР Р-Р 300МГ/ 100МЛ');

  assert.equal(parsed.attributes.trade_name_text, 'элькар');
  assert.equal(parsed.attributes.dosage_form, 'solution');
  assert.deepEqual(parsed.attributes.strengths, [
    {
      kind: 'ratio',
      text: '300 мг/100 мл',
      values: [300],
      value: 300,
      unit: 'мг',
      denominator: { value: 100, unit: 'мл' },
    },
  ]);
});

test('parses measurement tokens with trailing vendor suffixes', () => {
  const parsed = parseMedicineQuery('НАТРИЯ ГИДРОКАРБОНАТ Р-Р 4% 100МЛ-МР');

  assert.equal(parsed.attributes.trade_name_text, 'натрия гидрокарбонат');
  assert.deepEqual(parsed.attributes.strengths, [
    {
      kind: 'simple',
      text: '4%',
      values: [4],
      value: 4,
      unit: '%',
    },
  ]);
  assert.deepEqual(parsed.attributes.volumes, [{ text: '100 мл', value: 100, unit: 'мл' }]);
});

// Brand-specific implicit strength compatibility.
test('infers low bare tablet strengths for known brands', () => {
  const olfrex = parseMedicineQuery('ОЛФРЕКС 5 ТАБ. №28');
  assert.equal(olfrex.attributes.trade_name_text, 'олфрекс');
  assert.deepEqual(olfrex.attributes.strengths, [
    {
      kind: 'simple',
      text: '5 мг',
      values: [5],
      value: 5,
      unit: 'мг',
    },
  ]);

  const raksaban = parseMedicineQuery('РАКСАБАН 15 ТАБ. П/О №30');
  assert.equal(raksaban.attributes.trade_name_text, 'раксабан');
  assert.deepEqual(raksaban.attributes.strengths, [
    {
      kind: 'simple',
      text: '15 мг',
      values: [15],
      value: 15,
      unit: 'мг',
    },
  ]);

  const gepirid = parseMedicineQuery('Гепирид® 1 таблетки №30 (SBNA01AC)');
  assert.equal(gepirid.attributes.trade_name_text, 'гепирид');
  assert.deepEqual(gepirid.attributes.strengths, [
    {
      kind: 'simple',
      text: '1 мг',
      values: [1],
      value: 1,
      unit: 'мг',
    },
  ]);
  assert.equal(gepirid.attributes.pack_count, 30);

  const brizezi = parseMedicineQuery('БРИЗЕЗИ 4 ТАБ. №30');
  assert.equal(brizezi.attributes.trade_name_text, 'бризези');
  assert.deepEqual(brizezi.attributes.strengths, [
    {
      kind: 'simple',
      text: '4 мг',
      values: [4],
      value: 4,
      unit: 'мг',
    },
  ]);
  assert.equal(brizezi.attributes.pack_count, 30);

  const afil = parseMedicineQuery('Афил 10 таб №4 Нобел');
  assert.equal(afil.attributes.trade_name_text, 'афил');
  assert.deepEqual(afil.attributes.strengths, [
    {
      kind: 'simple',
      text: '10 мг',
      values: [10],
      value: 10,
      unit: 'мг',
    },
  ]);
  assert.equal(afil.attributes.pack_count, 4);

  const belascor = parseMedicineQuery('Беласкор 2,5 таб №30');
  assert.equal(belascor.attributes.trade_name_text, 'беласкор');
  assert.deepEqual(belascor.attributes.strengths, [
    {
      kind: 'simple',
      text: '2.5 мг',
      values: [2.5],
      value: 2.5,
      unit: 'мг',
    },
  ]);
  assert.equal(belascor.attributes.pack_count, 30);
});

test('infers bare slash tablet strengths for known combination brands', () => {
  const parsed = parseMedicineQuery('СИТАДИАБ МЕТ 50/850 ТАБ. №56');

  assert.equal(parsed.attributes.trade_name_text, 'ситадиаб мет');
  assert.deepEqual(parsed.attributes.strengths, [
    {
      kind: 'simple',
      text: '50 мг/850 мг',
      values: [50, 850],
      value: null,
      unit: 'мг',
    },
  ]);

  const amlodil = parseMedicineQuery('Амлодил-АБ таб 8/10 №30');
  assert.equal(amlodil.attributes.trade_name_text, 'амлодил-аб');
  assert.deepEqual(amlodil.attributes.strengths, [
    {
      kind: 'simple',
      text: '8 мг/10 мг',
      values: [8, 10],
      value: null,
      unit: 'мг',
    },
  ]);

  const analdim = parseMedicineQuery('Анальдим св.рект 250/20 №10');
  assert.equal(analdim.attributes.trade_name_text, 'анальдим св');
  assert.deepEqual(analdim.attributes.strengths, [
    {
      kind: 'simple',
      text: '250 мг/20 мг',
      values: [250, 20],
      value: null,
      unit: 'мг',
    },
  ]);

  const attento = parseMedicineQuery('Аттенто таб 20/5 №28');
  assert.equal(attento.attributes.trade_name_text, 'аттенто');
  assert.deepEqual(attento.attributes.strengths, [
    {
      kind: 'simple',
      text: '20 мг/5 мг',
      values: [20, 5],
      value: null,
      unit: 'мг',
    },
  ]);
});

test('infers bare decimal gram tablet strength for known brands', () => {
  const parsed = parseMedicineQuery('АМПИЦИЛЛИН ТРИГИДРАТ Таблетки 0.5  №10(10x1)');

  assert.equal(parsed.attributes.trade_name_text, 'ампициллин тригидрат');
  assert.deepEqual(parsed.attributes.strengths, [
    {
      kind: 'simple',
      text: '0.5 г',
      values: [0.5],
      value: 0.5,
      unit: 'г',
    },
  ]);
  assert.equal(parsed.attributes.pack_count, 10);
});

test('parses compact 2x oral solid strength marker', () => {
  const parsed = parseMedicineQuery('АМОКСИКЛАВ ТАБ 2Х1000 №14');

  assert.equal(parsed.attributes.trade_name_text, 'амоксиклав');
  assert.deepEqual(parsed.attributes.strengths, [
    {
      kind: 'simple',
      text: '1000 мг',
      values: [1000],
      value: 1000,
      unit: 'мг',
    },
  ]);
  assert.equal(parsed.attributes.pack_count, 14);
});

test('detects abbreviated oral route for inner-use listings', () => {
  const parsed = parseMedicineQuery('БАКДИАР Д/ПРИЕМ ВНУТРЬ  220МГ/5МЛ  N10');

  assert.equal(parsed.attributes.trade_name_text, 'бакдиар рием');
  assert.equal(parsed.attributes.dosage_form_route, 'oral');
  assert.deepEqual(parsed.attributes.strengths, [
    {
      kind: 'ratio',
      text: '220 мг/5 мл',
      values: [220],
      value: 220,
      unit: 'мг',
      denominator: {
        value: 5,
        unit: 'мл',
      },
    },
  ]);
  assert.equal(parsed.attributes.pack_count, 10);
});

test('infers oral route for liquid suspension per-dose strengths', () => {
  const parsed = parseMedicineQuery('Бакдиар сусп 220мг/5мл №10');

  assert.equal(parsed.attributes.trade_name_text, 'бакдиар');
  assert.equal(parsed.attributes.dosage_form, 'suspension');
  assert.equal(parsed.attributes.dosage_form_route, 'oral');
  assert.deepEqual(parsed.attributes.strengths, [
    {
      kind: 'ratio',
      text: '220 мг/5 мл',
      values: [220],
      value: 220,
      unit: 'мг',
      denominator: {
        value: 5,
        unit: 'мл',
      },
    },
  ]);
  assert.equal(parsed.attributes.pack_count, 10);
});

test('parses compact aerosol dose count forms', () => {
  const slashDose = parseMedicineQuery('Беклометазон аэр.250мкг/200 Бинно фарм');
  assert.equal(slashDose.attributes.trade_name_text, 'беклометазон бинно фарм');
  assert.deepEqual(slashDose.attributes.strengths, [
    {
      kind: 'ratio',
      text: '250 мкг/доз',
      values: [250],
      value: 250,
      unit: 'мкг',
      denominator: {
        value: null,
        unit: 'доз',
      },
    },
  ]);
  assert.deepEqual(slashDose.attributes.volumes, [
    {
      text: '200 доз',
      value: 200,
      unit: 'доз',
    },
  ]);

  const perDose = parseMedicineQuery('Беклометазон аэр.д/инг 250мкг/д 200д');
  assert.equal(perDose.attributes.trade_name_text, 'беклометазон');
  assert.deepEqual(perDose.attributes.strengths, [
    {
      kind: 'ratio',
      text: '250 мкг/доз',
      values: [250],
      value: 250,
      unit: 'мкг',
      denominator: {
        value: null,
        unit: 'доз',
      },
    },
  ]);
  assert.deepEqual(perDose.attributes.volumes, [
    {
      text: '200 доз',
      value: 200,
      unit: 'доз',
    },
  ]);
});

test('does not parse Gelik trade name as gel dosage form', () => {
  const parsed = parseMedicineQuery('Гелик, 20 г, гель.');

  assert.equal(parsed.attributes.trade_name_text, 'гелик');
  assert.deepEqual(parsed.attributes.trade_name_tokens, ['гелик']);
  assert.equal(parsed.attributes.dosage_form, 'gel');
  assert.deepEqual(parsed.attributes.volumes, [
    {
      text: '20 г',
      value: 20,
      unit: 'г',
    },
  ]);
});

test('infers bare tablet strengths for known no-form iodine brands', () => {
  const parsed = parseMedicineQuery('Йодомиг SD 200 №100 (йодомарин)');

  assert.equal(parsed.attributes.trade_name_text, 'йодомиг sd');
  assert.deepEqual(parsed.attributes.strengths, [
    {
      kind: 'simple',
      text: '200 мг',
      values: [200],
      value: 200,
      unit: 'мг',
    },
  ]);
  assert.equal(parsed.attributes.pack_count, 100);
});

test('infers bare microgram strength for known iodine tablet brands', () => {
  const compact = parseMedicineQuery('Йодомарин-100 №100.');
  assert.equal(compact.attributes.trade_name_text, 'йодомарин');
  assert.deepEqual(compact.attributes.strengths, [
    {
      kind: 'simple',
      text: '100 мкг',
      values: [100],
      value: 100,
      unit: 'мкг',
    },
  ]);
  assert.equal(compact.attributes.pack_count, 100);

  const tablet = parseMedicineQuery('Йодомарин 100 таб №100');
  assert.equal(tablet.attributes.trade_name_text, 'йодомарин');
  assert.equal(tablet.attributes.dosage_form, 'tablet');
  assert.deepEqual(tablet.attributes.strengths, [
    {
      kind: 'simple',
      text: '100 мкг',
      values: [100],
      value: 100,
      unit: 'мкг',
    },
  ]);
  assert.equal(tablet.attributes.pack_count, 100);
});

test('parses count multipliers after № as total pack count', () => {
  const parsed = parseMedicineQuery('Бисопролол, таблетки, покрытые оболочкой, 10 мг № 10х3');

  assert.equal(parsed.attributes.trade_name_text, 'бисопролол');
  assert.equal(parsed.attributes.dosage_form, 'tablet');
  assert.deepEqual(parsed.attributes.strengths, [
    {
      kind: 'simple',
      text: '10 мг',
      values: [10],
      value: 10,
      unit: 'мг',
    },
  ]);
  assert.equal(parsed.attributes.pack_count, 30);
});

test('infers bare gram strength for powder vial listings', () => {
  const parsed = parseMedicineQuery('ЦЕФОТАКСИМ ПОР ДЛЯ ПРИГ РР ДЛЯ ИНЬЕК 1,0 №50');

  assert.equal(parsed.attributes.trade_name_text, 'цефотаксим');
  assert.deepEqual(parsed.attributes.strengths, [
    {
      kind: 'simple',
      text: '1 г',
      values: [1],
      value: 1,
      unit: 'г',
    },
  ]);
});

test('parses compact injectable powder abbreviation with gram strength', () => {
  const parsed = parseMedicineQuery('эфес пор.д/приг.р-ра д/инъек.5,0г №1');

  assert.equal(parsed.attributes.trade_name_text, 'эфес');
  assert.equal(parsed.attributes.dosage_form, 'powder');
  assert.equal(parsed.attributes.dosage_form_route, 'injection');
  assert.deepEqual(parsed.attributes.strengths, [
    {
      kind: 'simple',
      text: '5 г',
      values: [5],
      value: 5,
      unit: 'г',
    },
  ]);
  assert.equal(parsed.attributes.pack_count, 1);
});

test('infers bare milligram strength for known powder sachet brands', () => {
  const parsed = parseMedicineQuery('Ноофен порошок 500 №5');

  assert.equal(parsed.attributes.trade_name_text, 'ноофен');
  assert.equal(parsed.attributes.dosage_form, 'powder');
  assert.deepEqual(parsed.attributes.strengths, [
    {
      kind: 'simple',
      text: '500 мг',
      values: [500],
      value: 500,
      unit: 'мг',
    },
  ]);
  assert.equal(parsed.attributes.pack_count, 5);
});

test('parses percent strength slash package mass as separate volume', () => {
  const parsed = parseMedicineQuery('Артрокол гель 2.5%/45г№1');

  assert.equal(parsed.attributes.trade_name_text, 'артрокол');
  assert.equal(parsed.attributes.dosage_form, 'gel');
  assert.equal(parsed.attributes.pack_count, 1);
  assert.deepEqual(parsed.attributes.strengths, [
    {
      kind: 'simple',
      text: '2.5%',
      values: [2.5],
      value: 2.5,
      unit: '%',
    },
  ]);
  assert.deepEqual(parsed.attributes.volumes, [{ text: '45 г', value: 45, unit: 'г' }]);
});

test('treats trailing mass after topical ratio strengths as package size', () => {
  const parsed = parseMedicineQuery('Изигел плюс 50мг/г+30мг/г 40г №1');

  assert.equal(parsed.attributes.trade_name_text, 'изигел плюс');
  assert.equal(parsed.attributes.pack_count, 1);
  assert.deepEqual(parsed.attributes.strengths, [
    {
      kind: 'ratio',
      text: '50 мг/г',
      values: [50],
      value: 50,
      unit: 'мг',
      denominator: { value: null, unit: 'г' },
    },
    {
      kind: 'ratio',
      text: '30 мг/г',
      values: [30],
      value: 30,
      unit: 'мг',
      denominator: { value: null, unit: 'г' },
    },
  ]);
  assert.deepEqual(parsed.attributes.volumes, [{ text: '40 г', value: 40, unit: 'г' }]);
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

// Annotation cleanup and post-pack variant preservation.
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

test('recognizes inflected packet containers with explicit pack counts', () => {
  const parsed = parseMedicineQuery('Кора дуба чай №25 пакетов');

  assert.equal(parsed.attributes.trade_name_text, 'кора дуба чай');
  assert.equal(parsed.attributes.container_type, 'sachet');
  assert.equal(parsed.attributes.pack_count, 25);

  const filterPacket = parseMedicineQuery('ШАЛФЕЙ ФИТОЧАЙ Ф-П №20');
  assert.equal(filterPacket.attributes.trade_name_text, 'шалфей фиточай');
  assert.equal(filterPacket.attributes.container_type, 'sachet');
  assert.equal(filterPacket.attributes.pack_count, 20);
});

test('infers bare milligram strength for injection powder listings', () => {
  const parsed = parseMedicineQuery(
    'Мегасеф 750, порошок для инъекции № 1, с растворителем 6 мл',
  );

  assert.equal(parsed.attributes.trade_name_text, 'мегасеф');
  assert.equal(parsed.attributes.dosage_form, 'powder');
  assert.equal(parsed.attributes.dosage_form_route, 'injection');
  assert.deepEqual(parsed.attributes.strengths, [
    { kind: 'simple', text: '750 мг', values: [750], value: 750, unit: 'мг' },
  ]);
  assert.equal(parsed.attributes.pack_count, 1);
});

test('infers low bare strengths for known no-form tablet brands', () => {
  const parsed = parseMedicineQuery('НЕОКЛАСТ 5 №28');

  assert.equal(parsed.attributes.trade_name_text, 'неокласт');
  assert.deepEqual(parsed.attributes.strengths, [
    { kind: 'simple', text: '5 мг', values: [5], value: 5, unit: 'мг' },
  ]);
  assert.equal(parsed.attributes.pack_count, 28);
});

test('parses compact patch dimensions written with an asterisk', () => {
  const parsed = parseMedicineQuery('Перцовый пластырь 6см*10см №220 (без перфорации)');

  assert.equal(parsed.attributes.trade_name_text, 'перцовый');
  assert.equal(parsed.attributes.dosage_form, 'patch');
  assert.deepEqual(parsed.attributes.volumes, [
    {
      text: '6 см х 10 см',
      value: 6,
      unit: 'см',
      dimension2: { value: 10, unit: 'см' },
    },
  ]);
  assert.equal(parsed.attributes.pack_count, 220);
});

test('keeps parenthesized laterality tokens for device variants', () => {
  const parsed = parseMedicineQuery('Повязка для рук с ремнём GT раз.L (Правый)');

  assert.deepEqual(parsed.attributes.trade_name_tokens, [
    'повязка',
    'рук',
    'с',
    'ремнем',
    'gt',
    'раз',
    'l',
    'правый',
  ]);
});

test('infers bare tablet strengths after tabl abbreviation', () => {
  const parsed = parseMedicineQuery('Синегра 50 табл. №4');

  assert.equal(parsed.attributes.trade_name_text, 'синегра');
  assert.equal(parsed.attributes.dosage_form, 'tablet');
  assert.deepEqual(parsed.attributes.strengths, [
    { kind: 'simple', text: '50 мг', values: [50], value: 50, unit: 'мг' },
  ]);
  assert.equal(parsed.attributes.pack_count, 4);
});

test('parses stray letter prefix before tablet strength units', () => {
  const parsed = parseMedicineQuery('Валмак таб. H80мг №30');

  assert.equal(parsed.attributes.trade_name_text, 'валмак');
  assert.equal(parsed.attributes.dosage_form, 'tablet');
  assert.deepEqual(parsed.attributes.strengths, [
    { kind: 'simple', text: '80 мг', values: [80], value: 80, unit: 'мг' },
  ]);
  assert.equal(parsed.attributes.pack_count, 30);
});

test('infers trailing oral solid pack count after glued strength', () => {
  const parsed = parseMedicineQuery('Ноклот таб.75мг30 Клопидогрел');

  assert.equal(parsed.attributes.trade_name_text, 'ноклот клопидогрел');
  assert.equal(parsed.attributes.dosage_form, 'tablet');
  assert.deepEqual(parsed.attributes.strengths, [
    { kind: 'simple', text: '75 мг', values: [75], value: 75, unit: 'мг' },
  ]);
  assert.equal(parsed.attributes.pack_count, 30);
});

test('detects suppository rectal and vaginal routes', () => {
  const rectal = parseMedicineQuery('НАТАЦИН СУПП. РЕКТ. 100МГ №3');
  const vaginal = parseMedicineQuery('Натацин, 100 мг, супп. ваг. №3');

  assert.equal(rectal.attributes.dosage_form, 'suppository');
  assert.equal(rectal.attributes.dosage_form_route, 'rectal');
  assert.equal(vaginal.attributes.dosage_form, 'suppository');
  assert.equal(vaginal.attributes.dosage_form_route, 'vaginal');
});

test('infers bare syrup package volumes as milliliters', () => {
  const parsed = parseMedicineQuery('Солодкового корня (Зиё Нур) сироп 90');

  assert.equal(parsed.attributes.trade_name_text, 'солодкового корня');
  assert.equal(parsed.attributes.dosage_form, 'syrup');
  assert.deepEqual(parsed.attributes.volumes, [{ text: '90 мл', value: 90, unit: 'мл' }]);
});

test('parses plus-separated strengths with a shared trailing unit', () => {
  const parsed = parseMedicineQuery('Цефтриаксон+Сульбактам 1,0+0,5 г');

  assert.equal(parsed.attributes.trade_name_text, 'цефтриаксон сульбактам');
  assert.deepEqual(parsed.attributes.strengths, [
    { kind: 'simple', text: '1 г/0.5 г', values: [1, 0.5], value: null, unit: 'г' },
  ]);
});

test('drops duplicate total strength marker before injectable powder form', () => {
  const parsed = parseMedicineQuery('абилот 1,5 пор для приг.р-ра для инъек. 1,0/0,5г №1');

  assert.equal(parsed.attributes.trade_name_text, 'абилот');
  assert.equal(parsed.attributes.dosage_form, 'powder');
  assert.equal(parsed.attributes.dosage_form_route, 'injection');
  assert.deepEqual(parsed.attributes.strengths, [
    { kind: 'simple', text: '1 г/0.5 г', values: [1, 0.5], value: null, unit: 'г' },
  ]);
  assert.equal(parsed.attributes.pack_count, 1);
});

test('drops duplicate total strength marker for same-unit combination strengths', () => {
  const parsed = parseMedicineQuery('комбипреп 30 таб. 10 мг + 20 мг №10');

  assert.equal(parsed.attributes.trade_name_text, 'комбипреп');
  assert.equal(parsed.tokens.find((token) => token.value === '30')?.role, 'strength');
  assert.deepEqual(parsed.attributes.strengths, [
    {
      kind: 'combination',
      text: '10 мг + 20 мг',
      components: [
        { value: 10, unit: 'мг' },
        { value: 20, unit: 'мг' },
      ],
    },
  ]);

  const searchQuery = buildMedicineSearchQuery(parsed, {
    limit: 5,
    requireParsedAttributeMatch: true,
    strictParsedAttributeFilters: true,
  });
  const replacementValues = Object.values(searchQuery.replacements);
  assert.ok(replacementValues.includes('10/20 мг'));
  assert.ok(replacementValues.includes('30 мг'));
  assert.ok(replacementValues.includes('0.03 г'));
  assert.ok(replacementValues.includes('0,03 г'));
});

test('drops trailing generic annotation after ampoule pack count', () => {
  const parsed = parseMedicineQuery('авикарнитин амп.200мг/5мл№5 левокарнитин');

  assert.equal(parsed.attributes.trade_name_text, 'авикарнитин');
  assert.equal(parsed.attributes.dosage_form, 'injection');
  assert.equal(parsed.attributes.container_type, 'ampoule');
  assert.deepEqual(parsed.attributes.strengths, [
    {
      kind: 'ratio',
      text: '200 мг/5 мл',
      values: [200],
      value: 200,
      unit: 'мг',
      denominator: { value: 5, unit: 'мл' },
    },
  ]);
  assert.deepEqual(parsed.attributes.volumes, [{ text: '5 мл', value: 5, unit: 'мл' }]);
  assert.equal(parsed.attributes.pack_count, 5);
});

test('parses Avicarnitine injection solution abbreviation', () => {
  const parsed = parseMedicineQuery('авикарнитин р-р д/инь. 200мг/5мл №5');

  assert.equal(parsed.attributes.trade_name_text, 'авикарнитин');
  assert.equal(parsed.attributes.dosage_form, 'injection');
  assert.equal(parsed.attributes.dosage_form_route, 'injection');
  assert.equal(parsed.attributes.container_type, 'ampoule');
  assert.deepEqual(parsed.attributes.strengths, [
    {
      kind: 'ratio',
      text: '200 мг/5 мл',
      values: [200],
      value: 200,
      unit: 'мг',
      denominator: { value: 5, unit: 'мл' },
    },
  ]);
  assert.deepEqual(parsed.attributes.volumes, [{ text: '5 мл', value: 5, unit: 'мл' }]);
  assert.equal(parsed.attributes.pack_count, 5);
});

test('parses Adrenaline ampoule decimal percent strength', () => {
  const parsed = parseMedicineQuery('адреналин амп. 0,18% 1мл №10');

  assert.equal(parsed.attributes.trade_name_text, 'адреналин');
  assert.equal(parsed.attributes.dosage_form, 'injection');
  assert.equal(parsed.attributes.container_type, 'ampoule');
  assert.deepEqual(parsed.attributes.strengths, [
    {
      kind: 'simple',
      text: '0.18%',
      values: [0.18],
      value: 0.18,
      unit: '%',
    },
  ]);
  assert.deepEqual(parsed.attributes.volumes, [{ text: '1 мл', value: 1, unit: 'мл' }]);
  assert.equal(parsed.attributes.pack_count, 10);
});

test('drops Adaksikam complex package annotation from solution listing', () => {
  const parsed = parseMedicineQuery('адаксикам р-р 20мг  №3 в комплекс 2мл  №3');

  assert.equal(parsed.attributes.trade_name_text, 'адаксикам');
  assert.equal(parsed.attributes.dosage_form, 'solution');
  assert.deepEqual(parsed.attributes.strengths, [
    {
      kind: 'simple',
      text: '20 мг',
      values: [20],
      value: 20,
      unit: 'мг',
    },
  ]);
  assert.deepEqual(parsed.attributes.volumes, [{ text: '2 мл', value: 2, unit: 'мл' }]);
  assert.equal(parsed.attributes.pack_count, 3);
});

test('parses Adaksikam lyophilisate injection listing with trailing ingredient', () => {
  const parsed = parseMedicineQuery(
    'адаксикам лиоф.д/приг.р-ра.д/инъек.20мг 2мл №3 теноксикам',
  );

  assert.equal(parsed.attributes.trade_name_text, 'адаксикам');
  assert.equal(parsed.attributes.dosage_form, 'powder');
  assert.equal(parsed.attributes.dosage_form_route, 'injection');
  assert.deepEqual(parsed.attributes.strengths, [
    {
      kind: 'simple',
      text: '20 мг',
      values: [20],
      value: 20,
      unit: 'мг',
    },
  ]);
  assert.deepEqual(parsed.attributes.volumes, [{ text: '2 мл', value: 2, unit: 'мл' }]);
  assert.equal(parsed.attributes.pack_count, 3);
});

test('keeps post-pack flavor variants but drops plain trailing annotations', () => {
  const flavor = parseMedicineQuery('аджисепт паст №24 лимон');
  assert.deepEqual(flavor.attributes.trade_name_tokens, ['аджисепт', 'лимон']);
  assert.equal(flavor.attributes.dosage_form, 'paste');
  assert.equal(flavor.attributes.pack_count, 24);

  const berry = parseMedicineQuery('Био Доктор МОМ таб №20 (ягодные)');
  assert.deepEqual(berry.attributes.trade_name_tokens, ['био', 'доктор', 'мом', 'ягодные']);
  assert.equal(berry.attributes.dosage_form, 'tablet');
  assert.equal(berry.attributes.pack_count, 20);

  const orangeTypo = parseMedicineQuery('ТРАВРЕЛАКС ЛЕДЕНЦЫ №50 (АПЕЛСИНА)');
  assert.deepEqual(orangeTypo.attributes.trade_name_tokens, ['траврелакс', 'апелсина']);
  assert.equal(orangeTypo.attributes.dosage_form, 'pastille');
  assert.equal(orangeTypo.attributes.pack_count, 50);

  const menthol = parseMedicineQuery('Ангал пастилки №24 (со вкусом ментол)');
  assert.deepEqual(menthol.attributes.trade_name_tokens, ['ангал', 'ментол']);
  assert.equal(menthol.attributes.dosage_form, 'pastille');
  assert.equal(menthol.attributes.pack_count, 24);

  const blackcurrant = parseMedicineQuery('БРОНХО ВЕДА ЛЕДЕНЦЫ №24 (ЧЕРНАЯ СМОРОДИНА)');
  assert.deepEqual(blackcurrant.attributes.trade_name_tokens, [
    'бронхо',
    'веда',
    'черная',
    'смородина',
  ]);
  assert.equal(blackcurrant.attributes.dosage_form, 'pastille');
  assert.equal(blackcurrant.attributes.pack_count, 24);

  const abbreviatedBlackcurrant = parseMedicineQuery('БРОНХО ВЕДА ПАСТ №12 "ЧЕРН. СМОРОДИНА"');
  assert.deepEqual(abbreviatedBlackcurrant.attributes.trade_name_tokens, [
    'бронхо',
    'веда',
    'черн',
    'смородина',
  ]);
  assert.equal(abbreviatedBlackcurrant.attributes.dosage_form, 'paste');
  assert.equal(abbreviatedBlackcurrant.attributes.pack_count, 12);

  const generic = parseMedicineQuery('аджисепт паст №24 фарм 2');
  assert.deepEqual(generic.attributes.trade_name_tokens, ['аджисепт']);
  assert.equal(generic.attributes.dosage_form, 'paste');
  assert.equal(generic.attributes.pack_count, 24);
});

test('keeps parenthesized trade-name text when the span contains a dosage signal', () => {
  const parsed = parseMedicineQuery('бренд (актив 5 мг) таб №10');

  assert.equal(parsed.attributes.trade_name_text, 'бренд актив');
  assert.equal(parsed.attributes.dosage_form, 'tablet');
  assert.deepEqual(parsed.attributes.strengths, [
    { kind: 'simple', text: '5 мг', values: [5], value: 5, unit: 'мг' },
  ]);
  assert.equal(parsed.attributes.pack_count, 10);

  const english = parseMedicineQuery('БИФОЛАК КАПС. 0,5Г №10 (ACTIVE)');
  assert.equal(english.attributes.trade_name_text, 'бифолак active');
  assert.deepEqual(english.attributes.trade_name_tokens, ['бифолак', 'active']);
  assert.equal(english.attributes.pack_count, 10);
});

test('drops parenthesized active ingredient annotation with oral liquid dose', () => {
  const parsed = parseMedicineQuery('азилаб сусп.15мл №1 (азитромицин 100мг 5мл)');

  assert.equal(parsed.attributes.trade_name_text, 'азилаб');
  assert.equal(parsed.attributes.dosage_form, 'suspension');
  assert.equal(parsed.attributes.dosage_form_route, 'oral');
  assert.deepEqual(parsed.attributes.strengths, [
    {
      kind: 'ratio',
      text: '100 мг/5 мл',
      values: [100],
      value: 100,
      unit: 'мг',
      denominator: { value: 5, unit: 'мл' },
    },
  ]);
  assert.deepEqual(parsed.attributes.volumes, [{ text: '15 мл', value: 15, unit: 'мл' }]);
  assert.equal(parsed.attributes.pack_count, 1);
});

test('classifies toothbrush listings as non-medicine products', () => {
  const parsed = parseMedicineQuery('БИОМЕД Интенсив минерал з.щетка жесткая');

  assert.equal(parsed.attributes.product_type, 'other');
  assert.equal(parsed.attributes.dosage_form, null);
  assert.deepEqual(parsed.attributes.trade_name_tokens, [
    'биомед',
    'интенсив',
    'минерал',
    'з',
    'щетка',
    'жесткая',
  ]);
});

test('classifies abbreviated baby cookie listings as non-medicine products', () => {
  const parsed = parseMedicineQuery('БОНДИ детс.печ с железом 180р');

  assert.equal(parsed.attributes.product_type, 'other');
  assert.equal(parsed.attributes.dosage_form, null);
  assert.deepEqual(parsed.attributes.trade_name_tokens, [
    'бонди',
    'детс',
    'печ',
    'с',
    'железом',
    '180р',
  ]);
});

test('parses glued piece counts as pack count', () => {
  const parsed = parseMedicineQuery('Ватные Диски "Bella Cotton" 100шт в полиэтилен');

  assert.equal(parsed.attributes.pack_count, 100);
  assert.deepEqual(parsed.attributes.trade_name_tokens, [
    'ватные',
    'диски',
    'bella',
    'cotton',
    'в',
    'полиэтилен',
  ]);
});

test('does not parse plastic bottle annotation as plaster dosage form', () => {
  const parsed = parseMedicineQuery('Минеральная Вода Боржоми, 0,5 л (пласт. бут.)');

  assert.equal(parsed.attributes.dosage_form, null);
  assert.deepEqual(parsed.attributes.volumes, [{ text: '0.5 л', value: 0.5, unit: 'л' }]);
  assert.deepEqual(parsed.attributes.trade_name_tokens, ['минеральная', 'вода', 'боржоми']);
});

test('does not normalize Vishnevsky ointment to cherry flavor', () => {
  const parsed = parseMedicineQuery('Вишневский мазь 30г');

  assert.equal(parsed.attributes.dosage_form, 'ointment');
  assert.deepEqual(parsed.attributes.trade_name_tokens, ['вишневский']);
  assert.deepEqual(parsed.attributes.volumes, [{ text: '30 г', value: 30, unit: 'г' }]);
});

test('keeps parenthesized classic flavor variants', () => {
  const parsed = parseMedicineQuery('АДЖИСЕПТ ПАСТ №24 (КЛАССИЧЕСКИЙ)');

  assert.deepEqual(parsed.attributes.trade_name_tokens, ['аджисепт', 'классический']);
  assert.equal(parsed.attributes.pack_count, 24);
});

test('keeps parenthesized short variant tokens', () => {
  const aqua = parseMedicineQuery('АКВА МАРИС СПРЕЙ 50МЛ (НОРМ)');
  assert.deepEqual(aqua.attributes.trade_name_tokens, ['аква', 'марис', 'норм']);
  assert.deepEqual(aqua.attributes.volumes, [{ text: '50 мл', value: 50, unit: 'мл' }]);

  const alphabet = parseMedicineQuery('АЛФАВИТ ТАБ. №60 (КЛАССИК)');
  assert.deepEqual(alphabet.attributes.trade_name_tokens, ['алфавит', 'классик']);
  assert.equal(alphabet.attributes.pack_count, 60);

  const swanson = parseMedicineQuery('ВИТАМИН Д3+К2 КАПС. №60 SWANSON');
  assert.deepEqual(swanson.attributes.trade_name_tokens, ['витамин', 'д3', 'к2', 'swanson']);
  assert.equal(swanson.attributes.pack_count, 60);
});

test('keeps standalone M brand suffix before dosage form', () => {
  const parsed = parseMedicineQuery('Аллервэй М таб. 5мг+10мг №30');

  assert.equal(parsed.attributes.trade_name_text, 'аллервэй м');
  assert.deepEqual(parsed.attributes.trade_name_tokens, ['аллервэй', 'м']);
  assert.equal(parsed.attributes.dosage_form, 'tablet');
  assert.deepEqual(parsed.attributes.strengths, [
    {
      kind: 'combination',
      text: '5 мг + 10 мг',
      components: [
        { value: 5, unit: 'мг' },
        { value: 10, unit: 'мг' },
      ],
    },
  ]);
  assert.equal(parsed.attributes.pack_count, 30);

  const searchQuery = buildMedicineSearchQuery(parsed, {
    limit: 1,
    requireParsedAttributeMatch: true,
    strictParsedAttributeFilters: true,
  });
  assert.equal(searchQuery.replacements.tradeNameQuery, 'аллервэй м');
  const strictStrengthFilters = Object.entries(searchQuery.replacements)
    .filter(([key]) => key.startsWith('strengthFilter'))
    .map(([, value]) => value);
  assert.ok(strictStrengthFilters.includes('10/5 мг'));
  assert.ok(strictStrengthFilters.includes('10 мг/5 мг'));
  assert.ok(!strictStrengthFilters.includes('5 мг'));
  assert.ok(!strictStrengthFilters.includes('10 мг'));
  assert.ok(
    searchQuery.sql.includes('lower((m.name)::text) LIKE :tradeNamePrefix'),
  );
});

test('detects explicit oral route for suspension listings', () => {
  const parsed = parseMedicineQuery('Алмидоз суспензия для приема внутрь 10 мл №10');

  assert.equal(parsed.attributes.dosage_form, 'suspension');
  assert.equal(parsed.attributes.dosage_form_route, 'oral');
  assert.deepEqual(parsed.attributes.volumes, [{ text: '10 мл', value: 10, unit: 'мл' }]);
  assert.equal(parsed.attributes.pack_count, 10);
});
