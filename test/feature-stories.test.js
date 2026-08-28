const test = require('node:test');
const assert = require('node:assert/strict');
const pkg = require('../package.json');
const api = require('../src');
const parser = require('../src/parser');
const queryBuilder = require('../src/parser/query-builder');
const lookup = require('../src/medicine-lookup-profiles');
const fuzzy = require('../src/medicine-fuzzy-search');
const dosageForms = require('../src/medicine-dosage-forms');
const nameProfile = require('../src/medicine-name-profile');
const vendorCountry = require('../src/vendor-country');
const latin = require('../src/latin-to-cyrillic');
const common = require('../src/medicine-lookup-common');
const tokenizer = require('../src/parser/tokenizer');

function attributes(query) {
  return api.parseMedicineQuery(query).attributes;
}

function replacementValues(searchQuery) {
  return Object.values(searchQuery.replacements);
}

test('F001 root package facade exports documented APIs', () => {
  assert.deepEqual(Object.keys(api).sort(), [
    'buildMedicineSearchQuery',
    'buildQueryLookupProfiles',
    'buildQueryVariants',
    'parseMedicineQuery',
  ].sort());
});

test('F002 package subpaths are require-able and expose APIs', () => {
  assert.deepEqual(Object.keys(pkg.exports).sort(), [
    '.',
    './fuzzy-search',
    './latin-to-cyrillic',
    './lookup-profiles',
    './medicine-dosage-forms',
    './medicine-lookup-common',
    './medicine-name-profile',
    './parser',
    './query-builder',
    './vendor-country',
  ].sort());

  for (const exportPath of Object.values(pkg.exports)) {
    assert.ok(Object.keys(require(`..${exportPath.slice(1)}`)).length, exportPath);
  }
});

test('F003 parseMedicineQuery returns the public envelope', () => {
  const parsed = api.parseMedicineQuery('Ибупрофен таб 200мг №10');
  assert.equal(parsed.rawQuery, 'Ибупрофен таб 200мг №10');
  assert.equal(parsed.attributes.trade_name_text, 'ибупрофен');
  assert.ok(Array.isArray(parsed.tokens));
  assert.ok(parsed.tokens.some((token) => token.role === 'strength'));
  assert.deepEqual(parsed.residueTokens, ['ибупрофен']);
});

test('F004 parser normalizes messy pharmacy input', () => {
  const parsed = api.parseMedicineQuery('Кальция хлорид амп.10%.5мл№10').attributes;
  assert.equal(parsed.dosage_form, 'injection');
  assert.equal(parsed.strengths[0].text, '10%');
  assert.equal(parsed.volumes[0].text, '5 мл');
  assert.equal(parsed.pack_count, 10);
});

test('F005 tokenizer classifies normalized tokens', () => {
  const types = tokenizer.tokenizeNormalizedQuery('таб 10 мг/5 мл + 1% n 20').map((t) => t.type);
  assert.deepEqual(types, [
    'DOSAGE_FORM',
    'NUMBER',
    'UNIT',
    'SLASH',
    'NUMBER',
    'UNIT',
    'PLUS',
    'NUMBER',
    'PERCENT',
    'COUNT_MARKER',
    'NUMBER',
  ]);
});

test('F006 dosage form detection maps common forms', () => {
  assert.equal(dosageForms.parseDosageForm('табл.'), 'tablet');
  assert.equal(dosageForms.parseDosageForm('ампула'), 'injection');
  assert.equal(dosageForms.parseDosageForm('спрей'), 'spray');
});

test('F007 dosage form priority keeps final sold form', () => {
  const parsed = attributes('бренд пор. д/сусп. 100мг/5мл');
  assert.equal(parsed.dosage_form, 'suspension');
  assert.equal(parsed.dosage_form_source, 'explicit');
});

test('F008 container detection sets container type and inferred form', () => {
  const parsed = attributes('Ампула тест 5мл');
  assert.equal(parsed.container_type, 'ampoule');
  assert.equal(parsed.dosage_form, 'injection');
  assert.equal(parsed.dosage_form_source, 'inferred_from_container');
});

test('F009 pack counts parse markers and multipliers', () => {
  assert.equal(attributes('Бисопролол таб 10мг №10х3').pack_count, 30);
  assert.equal(attributes('Ватные диски 100шт').pack_count, 100);
});

test('F010 simple strengths parse values and units', () => {
  assert.deepEqual(attributes('Ибупрофен 200мг').strengths[0], {
    kind: 'simple',
    text: '200 мг',
    values: [200],
    value: 200,
    unit: 'мг',
  });
});

test('F011 percent strengths parse and generate equivalents', () => {
  const parsed = api.parseMedicineQuery('Риназолин спрей 0.05% 15мл');
  assert.equal(parsed.attributes.strengths[0].text, '0.05%');
  const searchQuery = api.buildMedicineSearchQuery(parsed, {
    requireParsedAttributeMatch: true,
    strictParsedAttributeFilters: true,
  });
  assert.ok(replacementValues(searchQuery).includes('0.5 мг/мл'));
});

test('F012 ratio strengths preserve denominator values', () => {
  const strength = attributes('Бакдиар сусп 220мг/5мл №10').strengths[0];
  assert.equal(strength.text, '220 мг/5 мл');
  assert.deepEqual(strength.denominator, { value: 5, unit: 'мл' });
});

test('F013 same-unit slash strengths become multi-value strengths', () => {
  const strength = attributes('ЭКВАМЕР КАПС. 20МГ/10МГ/10МГ №30').strengths[0];
  assert.equal(strength.text, '20 мг/10 мг/10 мг');
  assert.deepEqual(strength.values, [20, 10, 10]);
});

test('F014 plus-separated strengths become combination nodes', () => {
  const strength = attributes('комбипреп 30 таб. 10 мг + 20 мг №10').strengths[0];
  assert.equal(strength.kind, 'combination');
  assert.deepEqual(strength.components, [{ value: 10, unit: 'мг' }, { value: 20, unit: 'мг' }]);
});

test('F015 volume measurements parse package size', () => {
  assert.deepEqual(attributes('Кунжут ёги 100мл').volumes[0], {
    text: '100 мл',
    value: 100,
    unit: 'мл',
  });
});

test('F016 device dimensions stay in identity', () => {
  const parsed = attributes('Бинт эластичный 5см*500см');
  assert.equal(parsed.product_type, 'device');
  assert.equal(parsed.trade_name_text, 'бинт эластичный 5 см х 500 см');
  assert.deepEqual(parsed.volumes, []);
});

test('F017 topical package mass separates from per-gram strength', () => {
  const parsed = attributes('Дермазол крем 20мг/15г№1');
  assert.equal(parsed.strengths[0].text, '20 мг/г');
  assert.deepEqual(parsed.volumes[0], { text: '15 г', value: 15, unit: 'г', packageVolume: true });
});

test('F018 drops infer package-volume ratios', () => {
  const parsed = attributes('Левосетил капли 5мг 20мл');
  assert.equal(parsed.dosage_form, 'drops');
  assert.equal(parsed.strengths[0].text, '5 мг/мл');
  assert.equal(parsed.volumes[0].text, '20 мл');
});

test('F019 oral liquids infer per-dose ratio and route', () => {
  const parsed = attributes('Бакдиар сусп 220 мг 5 мл №10');
  assert.equal(parsed.dosage_form_route, 'oral');
  assert.equal(parsed.strengths[0].text, '220 мг/5 мл');
  assert.deepEqual(parsed.volumes, []);
});

test('F020 metered sprays keep per-dose strength and dose count', () => {
  const parsed = attributes('Момефин спрей назаль 0,5мг 120доз 12мл №1');
  assert.equal(parsed.strengths[0].text, '0.5 мг/доз');
  assert.deepEqual(parsed.volumes.map((volume) => volume.text), ['120 доз', '12 мл']);
});

test('F021 injection context infers omitted mass unit before slash volume', () => {
  const parsed = attributes('РОНОЦИТ АМП. 1000/4МЛ №5');
  assert.equal(parsed.dosage_form, 'injection');
  assert.equal(parsed.strengths[0].text, '1000 мг/4 мл');
});

test('F022 powder inference ignores solvent volume', () => {
  const parsed = attributes('Мегасеф 750, порошок для инъекции № 1, с растворителем 6 мл');
  assert.equal(parsed.dosage_form, 'powder');
  assert.equal(parsed.strengths[0].text, '750 мг');
  assert.deepEqual(parsed.volumes, []);
});

test('F023 oral solid implicit strengths parse bare numbers', () => {
  const parsed = attributes('Синегра 50 табл. №4');
  assert.equal(parsed.dosage_form, 'tablet');
  assert.equal(parsed.strengths[0].text, '50 мг');
});

test('F024 known unit typo corrections run', () => {
  assert.equal(attributes('Амоксициллин таб.0.25мг№10').strengths[0].text, '0.25 г');
  assert.equal(attributes('Регидрационная соль-LP №10 18,9мг').strengths[0].text, '18.9 г');
});

test('F025 vitamin and enzyme activity inference runs', () => {
  assert.equal(attributes('Витамин Д3 2000 №30').strengths[0].text, '2000 ме');
  assert.equal(attributes('Креон капс 10000 №20').strengths[0].text, '10000 ед');
});

test('F026 solvent clauses are not public volume attributes', () => {
  assert.deepEqual(attributes('Мегасеф 750, порошок для инъекции № 1, с растворителем 6 мл').volumes, []);
});

test('F027 prefilled syringe markers do not pollute trade name', () => {
  const parsed = attributes('Эспоген р-р 2000МЕ 0,5мл №6 (запол. шприц.)');
  assert.equal(parsed.trade_name_text, 'эспоген');
  assert.equal(parsed.strengths[0].text, '2000 ме/0.5 мл');
});

test('F028 trade-name residue excludes parsed attributes', () => {
  const parsed = attributes('Линкомицина гидрохлорид р-р 300мг 1мл №10');
  assert.equal(parsed.trade_name_text, 'линкомицин');
  assert.deepEqual(parsed.trade_name_tokens, ['линкомицин']);
});

test('F029 annotations keep active ingredient for short wholesale codes', () => {
  const parsed = attributes('ПЕО (цефтриаксон) 1г №1 фл.');
  assert.equal(parsed.trade_name_text, 'пео цефтриаксон');
  assert.equal(parsed.container_type, 'vial');
});

test('F030 flavor and variant tokens survive when they identify SKUs', () => {
  const parsed = attributes('ФИТОСЕПТ ПАСТ. №16 (ЛИМОН)');
  assert.deepEqual(parsed.trade_name_tokens, ['фитосепт', 'лимон']);
  assert.equal(parsed.pack_count, 16);
});

test('F031 cotton and wet-wipe names normalize canonically', () => {
  assert.equal(attributes('Вата гигиеническая гигрос. н/с 50г').trade_name_text, 'вата гигр нестер');
  assert.equal(
    attributes('Детские Влажные салфетки гигиенические Cotton Club №25').trade_name_text,
    'салфетки влажные cotton club',
  );
});

test('F032 vendor country separates from trade name', () => {
  const parsed = attributes('Ибупрофен Германия 200мг');
  assert.equal(parsed.vendor_country_text, 'германия');
  assert.deepEqual(parsed.trade_name_tokens, ['ибупрофен']);
});

test('F033 product type classification distinguishes non-medicine', () => {
  assert.equal(attributes('Катетер внутривенный KD-FIX 18G').product_type, 'device');
  assert.equal(attributes('Зубная паста Dentacare 145г').product_type, 'other');
});

test('F034 brand-only products clear medicine attributes', () => {
  const parsed = attributes('Детские Влажные салфетки гигиенические Cotton Club №25');
  assert.equal(parsed.product_type, 'other');
  assert.equal(parsed.dosage_form, null);
  assert.deepEqual(parsed.strengths, []);
  assert.deepEqual(parsed.volumes, []);
});

test('F035 tokens include parser roles', () => {
  const parsed = api.parseMedicineQuery('Ибупрофен таб 200мг n10');
  assert.equal(parsed.tokens.find((token) => token.normalizedValue === 'мг').role, 'strength');
  assert.equal(parsed.tokens.find((token) => token.value === '10').role, 'pack');
});

test('F036 query variants include layout and transliteration variants', () => {
  assert.deepEqual(api.buildQueryVariants('ibuprofen'), ['ibuprofen', 'шигзкщаут', 'ибупрофен']);
});

test('F037 Latin transliteration supports medicine spelling', () => {
  assert.equal(fuzzy.transliterateLatinToCyrillic('salbutamol'), 'сальбутамол');
});

test('F038 fuzzy normalization strips punctuation and normalizes form phrases', () => {
  assert.equal(fuzzy.normalizeQuery('Таблетки, покрытые оболочкой 0,5 мг'), 'таб 0 5 мг');
});

test('F039 medicine-name tokenization normalizes stored names', () => {
  assert.deepEqual(nameProfile.tokenizeMedicineName('Ибупрофен табл. 200 мг №10'), [
    'ибупрофен',
    'таб',
    '200',
    'мг',
    'n10',
  ]);
});

test('F040 medicine profile extraction builds searchable signature', () => {
  const profile = nameProfile.extractMedicineProfile('Ибупрофен табл. 200 мг №10');
  assert.deepEqual(profile.brandTokens, ['ибупрофен']);
  assert.deepEqual(profile.strengthTokens, ['200 мг']);
  assert.equal(profile.signature, 'ибупрофен|200 мг|таб|10');
});

test('F041 dosage-form profile exports are usable', () => {
  assert.ok(dosageForms.MEDICINE_FORM_PRIORITIES.get('таб') > 0);
  assert.deepEqual(dosageForms.MEDICINE_FORM_TO_DOSAGE_FORMS.get('таб'), ['tablet']);
});

test('F042 trade name parsing splits non-decimal commas', () => {
  assert.equal(lookup.parseTradeName('Ибупрофен, табл., 200 мг'), 'Ибупрофен');
  assert.equal(lookup.parseTradeName('Раствор 0,1%, 10 мл'), 'Раствор 0,1%');
});

test('F043 structured medicine details extract catalog attributes', () => {
  assert.deepEqual(lookup.extractMedicineDetails('Ибупрофен, табл., 200 мг, №10'), {
    trade_name: 'ибупрофен',
    container_type: null,
    dosage_form: 'tablet',
    product_type: 'medicine',
    strength: '200 мг',
    volume: null,
    pack: 10,
  });
});

test('F044 lookup profiles include structured, trade-only, and brand-only modes', () => {
  assert.deepEqual(
    lookup.buildQueryLookupProfiles('Ибупрофен 200 мг №10').map((profile) => profile.kind),
    ['structured', 'trade_only', 'brand_only'],
  );
});

test('F044a lookup profiles accept an injected parser', () => {
  const parseQuery = () => ({
    rawQuery: 'custom',
    normalizedText: 'custom',
    tokens: [],
    residueTokens: ['custom'],
    attributes: {
      trade_name_text: 'custom',
      trade_name_tokens: ['custom'],
      strengths: [],
      volumes: [],
    },
  });
  const profiles = lookup.buildQueryLookupProfiles('ignored', {}, parseQuery);
  assert.equal(profiles[0].parsed.attributes.trade_name_text, 'custom');
});

test('F045 search aliases include fuzzy generated text', () => {
  const aliases = lookup.buildMedicineSearchAliases('Ибупрофен, табл., 200 мг, №10', {
    dosage_form: 'tablet',
    strength: '200 мг',
  });
  assert.ok(aliases.includes('ибупрофен tablet 200 мг'));
  assert.ok(aliases.includes('ибупрофен таблет 200 мг'));
});

test('F046 lookup overrides replace parsed attributes', () => {
  const [profile] = lookup.buildQueryLookupProfiles('Ибупрофен', {
    dosage_form: 'tablet',
    strength: '200 мг',
    volume: '10 мл',
  });
  assert.equal(profile.parsed.attributes.dosage_form, 'tablet');
  assert.equal(profile.parsed.attributes.strengths[0].text, '200 мг');
  assert.equal(profile.parsed.attributes.volumes[0].text, '10 мл');
});

test('F047 search query returns null without a trade name', () => {
  assert.equal(api.buildMedicineSearchQuery(api.parseMedicineQuery('')), null);
});

test('F048 search query returns SQL and replacements', () => {
  const searchQuery = api.buildMedicineSearchQuery(api.parseMedicineQuery('Ибупрофен 200мг'), {
    limit: 5,
  });
  assert.ok(searchQuery.sql.includes('FROM medicines m'));
  assert.equal(searchQuery.replacements.limit, 5);
  assert.equal(searchQuery.replacements.tradeNameQuery, 'ибупрофен');
});

test('F049 search modes change scoring policy', () => {
  const parsed = api.parseMedicineQuery('Детские Влажные салфетки гигиенические Cotton Club №25');
  const searchQuery = api.buildMedicineSearchQuery(parsed, { searchMode: 'brand_only' });
  assert.ok(searchQuery.sql.includes('coalesce(name_score, 0) * 0.38'));
  assert.ok(searchQuery.sql.includes('(m.trade_name IS NOT NULL OR m.name IS NOT NULL)'));
});

test('F050 search options normalize replacements', () => {
  const searchQuery = api.buildMedicineSearchQuery(api.parseMedicineQuery('Ибупрофен'), {
    limit: 2,
    offset: 3,
    threshold: 0.4,
    candidateLimit: 9,
  });
  assert.equal(searchQuery.replacements.limit, 2);
  assert.equal(searchQuery.replacements.offset, 3);
  assert.equal(searchQuery.replacements.threshold, 0.4);
  assert.equal(searchQuery.replacements.candidateLimit, 9);
});

test('F051 vendor ID filters are emitted', () => {
  const one = api.buildMedicineSearchQuery(api.parseMedicineQuery('Ибупрофен'), {
    vendorIds: ['v1'],
  });
  assert.ok(one.sql.includes('m.vendor_id = :vendorId'));
  assert.equal(one.replacements.vendorId, 'v1');

  const many = api.buildMedicineSearchQuery(api.parseMedicineQuery('Ибупрофен'), {
    vendorIds: ['v1', ' v2 '],
  });
  assert.ok(many.sql.includes('m.vendor_id IN (:vendorIds)'));
  assert.deepEqual(many.replacements.vendorIds, ['v1', 'v2']);
});

test('F052 strict strength filters use delimited matching and blank fallback', () => {
  const searchQuery = api.buildMedicineSearchQuery(api.parseMedicineQuery('Гайнекс ваг.супп.500мг№14'), {
    requireParsedAttributeMatch: true,
    strictParsedAttributeFilters: true,
  });
  assert.ok(searchQuery.sql.includes("LIKE :strengthFilter0_0 || '/%'"));
  assert.ok(searchQuery.sql.includes("OR lower(coalesce(m.strength, '')) = ''"));
});

test('F053 strict volume filters use parsed volume and blank fallback', () => {
  const searchQuery = api.buildMedicineSearchQuery(api.parseMedicineQuery('Бруфен сироп 100мг/5мл 100мл'), {
    requireParsedAttributeMatch: true,
    strictParsedAttributeFilters: true,
  });
  assert.ok(replacementValues(searchQuery).includes('100 мл'));
  assert.ok(searchQuery.sql.includes("OR lower(coalesce(m.volume, '')) = ''"));
});

test('F054 pack-one filtering admits null pack for compatible forms', () => {
  const searchQuery = api.buildMedicineSearchQuery(api.parseMedicineQuery('Момефин спрей назаль 0,5мг 120доз 12мл №1'), {
    requireParsedAttributeMatch: true,
    strictParsedAttributeFilters: true,
  });
  assert.ok(searchQuery.sql.includes('(m.pack = :packCount OR m.pack IS NULL)'));
});

test('F055 vendor country search joins and filters vendors', () => {
  const searchQuery = api.buildMedicineSearchQuery(api.parseMedicineQuery('Ибупрофен Германия 200мг'));
  assert.ok(searchQuery.sql.includes('LEFT JOIN vendors v ON v.id = m.vendor_id'));
  assert.ok(replacementValues(searchQuery).includes('германия'));
});

test('F056 measurement search aliases include equivalents', () => {
  const percent = api.buildMedicineSearchQuery(api.parseMedicineQuery('Риназолин спрей 0.05% 15мл'), {
    requireParsedAttributeMatch: true,
    strictParsedAttributeFilters: true,
  });
  assert.ok(replacementValues(percent).includes('0.5 мг/мл'));

  const reversed = api.buildMedicineSearchQuery(api.parseMedicineQuery('Арлеверт 40мг/20мг №20'), {
    requireParsedAttributeMatch: true,
    strictParsedAttributeFilters: true,
  });
  assert.ok(replacementValues(reversed).includes('20 мг/40 мг'));
});

test('F057 measurement number formatter trims insignificant zeros', () => {
  assert.equal(queryBuilder.formatMeasurementNumber(2.5000001), '2.5');
  assert.equal(queryBuilder.formatMeasurementNumber(10), '10');
});

test('F058 lookup-common normalizes SQL terms and escapes LIKE values', () => {
  assert.equal(common.normalizeSqlTerm(' ЁЖ '), 'еж');
  assert.equal(common.escapeLikePattern('10%_x\\y'), '10\\%\\_x\\\\y');
  assert.equal(common.buildLikeAnyCondition(['m.name'], ['q']), "(m.name LIKE '%' || :q || '%' ESCAPE '\\')");
});

test('F059 Latin homoglyph normalization only changes mixed-script words', () => {
  assert.equal(common.normalizeLatinHomoglyphs('Синaп'), 'Синап');
  assert.equal(common.normalizeLatinHomoglyphs('pure born'), 'pure born');
});

test('F060 vendor country aliases normalize and match', () => {
  assert.equal(vendorCountry.normalizeVendorCountry('germany'), 'германия');
  assert.equal(vendorCountry.normalizeVendorCountry('Швецария'), 'швейцария');
  assert.equal(vendorCountry.normalizeVendorCountry('San Marino'), 'сан-марино');
  assert.ok(vendorCountry.getVendorCountrySearchTerms('USA').includes('united states'));
  assert.equal(vendorCountry.vendorCountryMatches('Germany', 'Германия'), true);
});

test('F061 exported constants and maps are available to consumers', () => {
  assert.equal(latin.LATIN_TO_CYRILLIC.a, 'а');
  assert.ok(latin.LATIN_HOMOGLYPH_RE.test('a'));
  assert.equal(common.TRADE_NAME_ABBREV_TOKEN_ALIASES.get('мр'), 'mr');
  assert.equal(common.TRADE_NAME_ABBREV_TOKEN_ALIASES.get('ртути'), 'ртутный');
  assert.equal(fuzzy.LATIN_TO_CYRILLIC_TRANSLIT_SINGLE.a, 'а');
  assert.deepEqual(fuzzy.buildLatinMedicinePhoneticVariants('parasitamol'), ['paracetamol']);
  assert.ok(nameProfile.MEDICINE_UNIT_TOKENS.has('мг'));
});

test('F062 empty input is safe and unsearchable', () => {
  const parsed = parser.parseMedicineQuery(null);
  assert.equal(parsed.normalizedText, '');
  assert.equal(parsed.attributes.trade_name_text, null);
  assert.equal(api.buildMedicineSearchQuery(parsed), null);
});
