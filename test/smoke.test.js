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

test('recognizes inflected packet containers with explicit pack counts', () => {
  const parsed = parseMedicineQuery('Кора дуба чай №25 пакетов');

  assert.equal(parsed.attributes.trade_name_text, 'кора дуба чай');
  assert.equal(parsed.attributes.container_type, 'sachet');
  assert.equal(parsed.attributes.pack_count, 25);
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

test('keeps post-pack flavor variants but drops plain trailing annotations', () => {
  const flavor = parseMedicineQuery('аджисепт паст №24 лимон');
  assert.deepEqual(flavor.attributes.trade_name_tokens, ['аджисепт', 'лимон']);
  assert.equal(flavor.attributes.dosage_form, 'paste');
  assert.equal(flavor.attributes.pack_count, 24);

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
});

test('detects explicit oral route for suspension listings', () => {
  const parsed = parseMedicineQuery('Алмидоз суспензия для приема внутрь 10 мл №10');

  assert.equal(parsed.attributes.dosage_form, 'suspension');
  assert.equal(parsed.attributes.dosage_form_route, 'oral');
  assert.deepEqual(parsed.attributes.volumes, [{ text: '10 мл', value: 10, unit: 'мл' }]);
  assert.equal(parsed.attributes.pack_count, 10);
});
