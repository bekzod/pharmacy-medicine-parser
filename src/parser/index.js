const {
  normalizeMedicineFormPhrases,
  transliterateLatinToCyrillic,
} = require('../medicine-fuzzy-search');
const { extractVendorCountryFromTokens } = require('../vendor-country');
const {
  MEDICINE_FORM_NORMALIZERS,
  MEDICINE_FORM_PRIORITIES,
  parseDosageForm,
} = require('../medicine-dosage-forms');
const {
  MEDICINE_DESCRIPTOR_TOKENS,
  MEDICINE_FORM_TOKENS,
  MEDICINE_UNIT_TOKENS,
  normalizeMedicineToken,
} = require('../medicine-name-profile');
const { LATIN_TO_CYRILLIC, LATIN_HOMOGLYPH_RE } = require('../latin-to-cyrillic');
const { TRADE_NAME_ABBREV_TOKEN_ALIASES } = require('../medicine-lookup-common');
const TOKEN_RE =
  /\d+(?:\.\d+)?(?:x\d+|[a-zа-яё]+)?(?:-[a-zа-яё][a-zа-яё0-9]*)*|[a-zа-яё][a-zа-яё0-9]*(?:-[a-zа-яё0-9]+)*|%|\/|\+/giu;

// Russian descriptor / indication words that commonly trail pharmacy listings
// and shouldn't pollute the trade-name signal. Keep tight to avoid dropping
// legitimate active-ingredient tokens.
const PARSER_NOISE_TOKENS = new Set([
  'антигистаминное',
  'антигистаминный',
  'антигистаминная',
  'антигистаминные',
  'средство',
  'средства',
  'средств',
  'препарат',
  'препарата',
  'препараты',
  'лекарство',
  'лекарства',
  'лиофилизированный',
  'лиофилизированная',
  'лиофилизированное',
  'лиофилизированные',
  'лиофиллизированный',
  'лиофиллизированная',
  'лиофиллизированное',
  'лиофиллизированные',
  'лиофиллизованный',
  'лиофиллизованная',
  'лиофиллизованное',
  'лиофиллизованные',
  'гранулированный',
  'гранулированная',
  'гранулированное',
  'гранулированные',
  'леч',
  'муж',
  'жен',
  'без',
  'них',
  'эрекции',
  'эрекция',
  'бесплодия',
  'бесплодие',
  'потенции',
  'потенция',
  'дет',
  'детей',
  'детск',
  'взр',
  'взрослых',
  'взрослый',
  'дозир',
  'местн',
  'наружн',
  'оральный',
  'оральная',
  'оральное',
  'оральные',
  'приема',
  'прием',
  'внутрь',
  'предварительно',
  'преднаполненный',
  'преднаполненные',
  'наполненный',
  'наполненные',
  'заполненный',
  'заполненная',
  'заполненные',
  'мягкий',
  'мягкая',
  'мягкое',
  'мягкие',
  'желатин',
  'желатиновый',
  'желатиновая',
  'желатиновое',
  'желатиновые',
  'алюминиевый',
  'алюминиевая',
  'алюминиевые',
  'полиэтиленовый',
  'полиэтиленовая',
  'полиэтиленовые',
  'полипропиленовый',
  'полипропиленовая',
  'полипропиленовые',
  'полимерный',
  'полимерная',
  'полимерное',
  'полимерные',
  'контурный',
  'контурная',
  'контурное',
  'контурные',
  'ячейковый',
  'ячейковая',
  'ячейковое',
  'ячейковые',
  'безъячейковый',
  'безъячейковая',
  'безъячейковое',
  'безъячейковые',
  'сахарный',
  'сахарная',
  'сахарное',
  'сахарные',
  'сахарной',
  'оболочка',
  'оболочки',
  'оболочкой',
  'упаковка',
  'упаковки',
  'упаковке',
  'упаковку',
  'банка',
  'банки',
  'банке',
  'банку',
  'микропеллетами',
  'микропеллеты',
  'микропеллет',
  'замедленным',
  'замедленный',
  'замедленная',
  'замедленное',
  'комплект',
  'комплекты',
  'вкус',
  'вкуса',
  'вкусом',
  // NOTE: flavor names (мята, лимон, апельсин, ананас, клубника, etc.) are
  // intentionally NOT in PARSER_NOISE_TOKENS — they often disambiguate SKUs
  // (e.g. "Терафлю лимон" vs "Терафлю мед"). Parenthesized flavor tokens
  // still get stripped via collectParenthesizedNoiseTokens since paren
  // content with normalized word tokens is treated as annotation noise.
  'защитный',
  'защитная',
  'защитное',
  'защитные',
  'защитным',
  'защитного',
  'защитной',
  'мерный',
  'мерная',
  'мерное',
  'мерные',
  'мерной',
  'ложка',
  'ложки',
  'ложкой',
  'стаканчик',
  'стаканчика',
  'стаканчиком',
  'колпачок',
  'колпачка',
  'колпачке',
  'колпачки',
  'grippni',
  'oldini',
  'olish',
  'uchun',
  'faolsizlantirilgan',
  'split',
  'vaksina',
  'split-vaksina',
  'сплит',
  'ваксина',
  'шип',
  'шипуч',
  // Truncated route/route-purpose words that survive the form parser as
  // bare WORD tokens (e.g. "ПОР. ДЛЯ ИНЪЕК."). Without these, "инъек"
  // pollutes trade_name_text for injection abbreviations.
  'инъек',
  'инъекц',
  'инъекций',
  'инъекции',
  'инфузий',
  'инфузии',
  'иг',
  // Pharmacy-listing trailing abbreviations that aren't ingredients or brand
  // tokens. "ЖР" appears at the tail of solution listings (e.g.
  // "ГЛЮКОЗА Р-Р 5% 500МЛ ЖР") and pollutes the trade-name signal.
  'жр',
  // "БАД" (биологически активная добавка) is a Russian dietary-supplement
  // category prefix, not part of the brand. Appears as a leading token in
  // catalog rows like "бад наридон форте капс. №20".
  'бад',
]);

const UNIT_FAMILY_BY_VALUE = new Map([
  ['%', 'percent'],
  ['ед', 'dose'],
  ['ме', 'dose'],
  ['доз', 'dose'],
  ['мг', 'mass'],
  ['мкг', 'mass'],
  ['г', 'mass'],
  ['кг', 'mass'],
  ['мл', 'volume'],
  ['л', 'volume'],
  ['мм', 'length'],
  ['см', 'length'],
  ['м', 'length'],
  ['ч', 'time'],
  ['сут', 'time'],
]);

const SYRINGE_RE = /шприц(?!-?\s*руч)(?:[а-я]*)?/iu;
const PREFILLED_RE = /преднаполненн|(?:предварительно\s+)?(?:наполненн|заполненн)/iu;
const PAREN_GROUP_RE = /\(([^()]+)\)/gu;
const COUNT_BEFORE_FORM_DOSAGE_FORMS = new Set(['capsule', 'tablet']);

const CONTAINER_NORMALIZERS = [
  {
    pattern: /^(флак\.?|флакон(?:ы|а|е|ов|ам|ами|ах)?|флакон-капельниц[а-я-]*)$/u,
    containerType: 'vial',
    dosageForm: 'solution',
  },
  {
    pattern: /^(амп|амп\.|ампул(?:ы|а|е|ов|ам|ами|ах)?)$/u,
    containerType: 'ampoule',
    dosageForm: 'injection',
  },
  {
    pattern: /^(карт(?:\.|ридж(?:и|а|ей|ам|ами|ах)?)?)$/u,
    containerType: 'cartridge',
    dosageForm: 'injection',
  },
  {
    pattern: /^(блистер(?:ы|а|е|ов|ам|ами|ах)?)$/u,
    containerType: 'blister',
  },
  {
    pattern: /^(туб(?:а|ы|е|у|ой|ами|ах)?|туб\.?)$/u,
    containerType: 'tube',
  },
  {
    pattern: /^(тюбик(?:а|и|е|у|ом|ами|ах)?(?:-капельниц[а-я-]*)?)$/u,
    containerType: 'tube',
  },
  {
    pattern: /^(бутылк(?:а|и|е|у|ой|ами|ах)?)$/u,
    containerType: 'bottle',
  },
  {
    pattern: /^(пакетик[а-я]*|пакет\.?|пакеты|паке\.|саше|стик[а-я]*)$/u,
    containerType: 'sachet',
  },
];

// Route-of-administration signals that survive in the raw query but get
// normalized away (e.g. "р-р.инф." collapses to "раствор", losing the
// infusion qualifier). Detected from rawQuery so the dosage_form_route
// attribute can preserve them alongside dosage_form. Order matters:
// infusion patterns (with "инф") must come before injection patterns to
// avoid "д/инф" partial-matching as injection.
// "р-р" / "р/р" both appear in pharmacy listings; treat them as equivalent.
const RP = String.raw`р\s*[-/]\s*р`;
const DOSAGE_FORM_ROUTE_PATTERNS = [
  { route: 'infusion', pattern: new RegExp(`${RP}\\.?\\s*д\\s*\\/\\s*инф[а-я]*\\.?`, 'iu') },
  { route: 'infusion', pattern: new RegExp(`${RP}\\.?\\s*для\\s*\\/?\\s*инф[а-я]*\\.?`, 'iu') },
  { route: 'infusion', pattern: new RegExp(`${RP}\\.?\\s*инф[а-я]*\\.?`, 'iu') },
  { route: 'infusion', pattern: /д\s*\/\s*инф[а-я]*\.?/iu },
  { route: 'infusion', pattern: /раствор\s+для\s+(?:внутривенн[а-я]*\s+)?инфузи[а-я]*/iu },
  { route: 'infusion', pattern: /(?<![а-я])инфуз(?!иол)[а-я]*/iu },
  // Negative lookahead must exclude "инф" (infusion) AND "инг" (inhalation)
  // so neither route gets misclassified as injection.
  { route: 'injection', pattern: new RegExp(`${RP}\\.?\\s*д\\s*\\/\\s*ин(?![фг])[а-я]*\\.?`, 'iu') },
  { route: 'injection', pattern: new RegExp(`${RP}\\.?\\s*д\\s*\\/\\s*в\\.?\\s*в\\.?`, 'iu') },
  { route: 'injection', pattern: new RegExp(`${RP}\\.?\\s*д\\s*\\/\\s*п\\s*\\/\\s*к`, 'iu') },
  {
    route: 'injection',
    pattern: new RegExp(`${RP}\\.?\\s*для\\s+(?:в\\s*\\/\\s*[вм]|п\\s*\\/\\s*к)`, 'iu'),
  },
  { route: 'injection', pattern: /д\s*\/\s*ин(?!г|ф)[а-я]*\.?/iu },
  {
    route: 'injection',
    pattern:
      /раствор\s+для\s+(?:инъекци[а-я]*|внутривенн[а-я]*\s+(?:и\s+внутримышечн[а-я]*\s+)?введен[а-я]*|внутримышечн[а-я]*\s+введен[а-я]*)/iu,
  },
  { route: 'injection', pattern: /(?<![а-я])инъек[а-я]*/iu },
  { route: 'injection', pattern: /(?<![а-я])ин-екц[а-я]*/iu },
];

function detectDosageFormRoute(rawQuery) {
  const text = String(rawQuery || '')
    .toLowerCase()
    .replace(/ё/g, 'е');
  if (!text) return null;
  for (const { route, pattern } of DOSAGE_FORM_ROUTE_PATTERNS) {
    if (pattern.test(text)) return route;
  }
  return null;
}

// JavaScript's \b is ASCII-only and treats Cyrillic letters as non-word
// characters, so a leading \b never matches before Cyrillic stems. We use a
// Unicode-aware negative lookbehind to ensure these stems only match at a real
// word boundary — otherwise "игл" matches inside "Сиглетик", "марл" inside
// "Марлин", etc., and the row gets misclassified as a device/other product
// (which forces dosage_form, strengths, and volumes to null).
const NOT_LETTER_BEHIND = '(?<!\\p{L})';
const stem = (pattern) => new RegExp(`${NOT_LETTER_BEHIND}${pattern}`, 'iu');

const PRODUCT_TYPE_PATTERNS = {
  other: [
    stem('презерватив[а-я]*'),
    stem('тест.?полос'),
    stem('test.?strip'),
    stem('гель-?смазк[а-я]*'),
    stem('смазк[а-я]*'),
    /\broll\s*on\b/iu,
    /\bролл?\s*он\b/iu,
    /\bdeo\b/iu,
    stem('подгузник[а-яё]*'),
    stem('трусик[а-яё]*'),
    stem('тампон[а-яё]*'),
    // Gauze: enumerate noun + adjective inflections instead of `марл[а-яё]+`
    // so trade names like "МАРЛИН" don't get classified as consumer goods.
    /(?<!\p{L})марл(?:я|и|е|ю|ей|ёй|евый|евая|евое|евые|евыми|евых|евой|евою|евую|евом|евом)(?!\p{L})/iu,
    stem('пробирк[а-яё]*'),
    stem('предметное.стекло'),
    stem('покровное.стекло'),
    stem('салфетк[а-яё]*'),
    stem('прокладк[а-яё]*'),
    stem('гигиенич[а-яё]*'),
    stem('гиг\\.?\\s*сред[а-яё]*'),
    stem('бутыл[а-яё]+\\s+с\\s+соск'),
    stem('соск[а-яё]+'),
    /\bpetri\s*dish/iu,
    stem('чашк[аеёиою]\\s+петри'),
    /\bmommy'?s?\b/iu,
  ],
  devicePrimary: [
    stem('игл[а-я]*'),
    stem('шприц(?!-?\\s*руч)(?:[а-я]*)?'),
    stem('система'),
    stem('катетер(?:[а-я]*)?'),
    stem('термометр(?:[а-я]*)?'),
    stem('тонометр(?:[а-я]*)?'),
    stem('небулайзер(?:[а-я]*)?'),
    stem('бандаж(?:[а-я]*)?'),
    stem('костыл[а-яё]*'),
    stem('тест[-\\s.]?кассет[а-яё]*'),
  ],
  deviceAccessory: [stem('аппликатор\\s+для\\s+кожи')],
};

function normalizeLatinHomoglyphs(text) {
  return String(text || '').replace(/\S+/g, (word) => {
    if (/[\u0400-\u04ff]/u.test(word) && /[a-zA-Z]/u.test(word)) {
      return word.replace(LATIN_HOMOGLYPH_RE, (char) => LATIN_TO_CYRILLIC[char] || char);
    }
    return word;
  });
}

function normalizeSqlTerm(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .trim();
}

function normalizeTradeNameAbbrevToken(token) {
  const normalized = String(token || '').toLowerCase().replace(/ё/g, 'е');
  return TRADE_NAME_ABBREV_TOKEN_ALIASES.get(normalized) || normalized;
}

function normalizeFormTokenValue(token) {
  const cleaned = normalizeSqlTerm(token).replace(/[.,]+$/gu, '');
  if (!cleaned) return '';

  for (const [pattern, normalized] of MEDICINE_FORM_NORMALIZERS) {
    if (pattern.test(cleaned)) return normalized;
  }

  return cleaned;
}

function normalizeAttachedUnit(unitToken) {
  const normalized = normalizeMedicineToken(unitToken);
  return MEDICINE_UNIT_TOKENS.has(normalized) ? normalized : '';
}

function normalizeNumberUnitPair(part) {
  const match = part.match(/^(\d+(?:\.\d+)?)([a-zа-яё]+)$/u);
  if (!match) return null;
  const normalizedUnit = normalizeAttachedUnit(match[2]);
  return normalizedUnit ? `${match[1]} ${normalizedUnit}` : null;
}

function parseContainerType(token) {
  const cleaned = normalizeSqlTerm(token).replace(/[.,]+$/gu, '');

  for (const entry of CONTAINER_NORMALIZERS) {
    if (entry.pattern.test(cleaned)) return entry;
  }

  return null;
}

function normalizeRawSegment(segment) {
  const value = normalizeSqlTerm(segment).replace(/[.,]+$/gu, '');
  if (!value) return '';

  if (value.includes('+')) {
    const normalizedParts = value
      .split('+')
      .map((part) => normalizeRawSegment(part))
      .filter(Boolean);

    if (normalizedParts.length) return normalizedParts.join(' + ');
  }

  const slashAttachedUnitMatch = value.match(
    /^(\d+(?:\.\d+)?[a-zа-яё]+(?:\/\d+(?:\.\d+)?[a-zа-яё]+)+)(?:\/([a-zа-яё]+))?$/u,
  );
  if (slashAttachedUnitMatch) {
    const numeratorParts = slashAttachedUnitMatch[1].split('/').map(normalizeNumberUnitPair);
    const trailingUnitRaw = slashAttachedUnitMatch[2];
    const trailingUnit = trailingUnitRaw ? normalizeAttachedUnit(trailingUnitRaw) : null;

    if (numeratorParts.every(Boolean) && (!trailingUnitRaw || trailingUnit)) {
      return trailingUnit
        ? `${numeratorParts.join('/')}/${trailingUnit}`
        : numeratorParts.join('/');
    }
  }

  const packMatch = value.match(/^n(\d+)$/u);
  if (packMatch) return `n ${packMatch[1]}`;

  const percentMatch = value.match(/^(\d+(?:\.\d+)?)(%|проц)$/u);
  if (percentMatch) return `${percentMatch[1]}%`;

  const dosageRatioWithDetachedDenominatorUnitMatch = value.match(
    /^(\d+(?:\.\d+)?)([a-zа-яё]+)\/(\d+(?:\.\d+)?)$/u,
  );
  if (dosageRatioWithDetachedDenominatorUnitMatch) {
    const numeratorUnit = normalizeAttachedUnit(dosageRatioWithDetachedDenominatorUnitMatch[2]);
    if (numeratorUnit) {
      return `${dosageRatioWithDetachedDenominatorUnitMatch[1]} ${numeratorUnit}/${dosageRatioWithDetachedDenominatorUnitMatch[3]}`;
    }
  }

  const dosageRatioMatch = value.match(
    /^(\d+(?:\.\d+)?(?:\/\d+(?:\.\d+)?)*)([a-zа-яё]+)\/(\d+(?:\.\d+)?)?([a-zа-яё]+)$/u,
  );
  if (dosageRatioMatch) {
    const [, numerator, numeratorUnitRaw, denominatorValue, denominatorUnitRaw] = dosageRatioMatch;
    const numeratorUnit = normalizeAttachedUnit(numeratorUnitRaw);
    const denominatorUnit = normalizeAttachedUnit(denominatorUnitRaw);
    if (numeratorUnit && denominatorUnit) {
      const denominator = denominatorValue
        ? `${denominatorValue} ${denominatorUnit}`
        : denominatorUnit;
      return `${numerator} ${numeratorUnit}/${denominator}`;
    }
  }

  const unitRatioWithDenominatorValueMatch = value.match(
    /^([a-zа-яё]+)\/(\d+(?:\.\d+)?)([a-zа-яё]+)$/u,
  );
  if (unitRatioWithDenominatorValueMatch) {
    const numeratorUnit = normalizeAttachedUnit(unitRatioWithDenominatorValueMatch[1]);
    const denominatorUnit = normalizeAttachedUnit(unitRatioWithDenominatorValueMatch[3]);
    if (numeratorUnit && denominatorUnit) {
      return `${numeratorUnit}/${unitRatioWithDenominatorValueMatch[2]} ${denominatorUnit}`;
    }
  }

  const multiValueAttachedUnitMatch = value.match(
    /^(\d+(?:\.\d+)?(?:\/\d+(?:\.\d+)?)+)([a-zа-яё]+)$/u,
  );
  if (multiValueAttachedUnitMatch) {
    const normalizedUnit = normalizeAttachedUnit(multiValueAttachedUnitMatch[2]);
    if (normalizedUnit) return `${multiValueAttachedUnitMatch[1]} ${normalizedUnit}`;
  }

  const attachedUnitMatch = value.match(/^(\d+(?:\.\d+)?)([a-zа-яё]+)$/u);
  if (attachedUnitMatch) {
    const normalizedUnit = normalizeAttachedUnit(attachedUnitMatch[2]);
    if (normalizedUnit) return `${attachedUnitMatch[1]} ${normalizedUnit}`;
  }

  const normalizedUnit = normalizeAttachedUnit(value);
  if (normalizedUnit) return normalizedUnit;

  return value;
}

function normalizeMedicineQuery(rawQuery) {
  const prepared = normalizeLatinHomoglyphs(normalizeMedicineFormPhrases(rawQuery))
    // Collapse "анти-Ха МЕ" / "анти-Xa МЕ" / "anti-Xa IU" modifiers to bare
    // "МЕ". The activity qualifier blocks the strength tokenizer (NUMBER must
    // be followed by UNIT), so anticoagulants priced per anti-Xa IU never
    // parse their strength. Both the referent_prices input and the medicines
    // DB store strength this way, so the collapse stays symmetric.
    .replace(/анти[-\s]*(?:ха|xa)\s*ме/giu, 'МЕ')
    .replace(/anti[-\s]*xa\s*(?:iu|me)/giu, 'МЕ')
    // Аnti-Trypsin Equivalents: aprotinin-family drugs (Контрикал, Гордокс,
    // Апростад…) are dosed in АТрЕ / ATpE. Treat as МЕ for symmetric parsing.
    // \b is ASCII-only and Cyrillic letters count as non-word, so the
    // boundary never matches before/after `атре`; use Unicode-aware
    // lookbehind / lookahead so the stem only matches as a standalone token.
    .replace(/(?<!\p{L})атре(?!\p{L})/giu, 'МЕ')
    .replace(/(?<!\p{L})atpe(?!\p{L})/giu, 'МЕ')
    .replace(
      /-\s*(\d+(?:\.\d+)?)(?=(?:\s+(?!\1\s+(?:мг|мкг|г|%)(?:\b|\/))[\p{L}\d.-]+){0,6}\s+\1\s+(?=(?:мг|мкг|г|%)(?:\b|\/)))/giu,
      ' ',
    )
    .replace(/(\d),(\d)/gu, '$1.$2')
    .replace(/(\d)\s*[х×x]\s*(\d)/gu, '$1x$2')
    .replace(/(\d+)(мм|см|м)\s*[хx×]\s*(\d+)/gu, '$1 $2 х $3')
    .replace(/\bsoft\s*gels?\b/giu, 'softgel')
    .replace(/\bveg\s*caps(?:ule)?s?\b/giu, 'vegcaps')
    .replace(/\b(\d{1,2}(?:\s+\d{3})+|[1-9]\d{2}(?:\s+0{3})+)\b/gu, (value) =>
      value.replace(/\s+/gu, ''),
    )
    .replace(/№\s*(\d+)/gu, '')
    .replace(/№/gu, '')
    .replace(/\\/gu, '/')
    .replace(/[,:;!?()[\]{}"'`«»]+/gu, ' ')
    .replace(/(?<!\d)\.(?!\d)/gu, ' ')
    .replace(/(?<=\p{L})\.(?=\d)/gu, ' ')
    // Split Cyrillic-letter\u2192digit boundaries (e.g. "\u043a\u0440\u0435\u043c15\u0433" \u2192 "\u043a\u0440\u0435\u043c 15\u0433") so
    // glued dosage forms / measurements get tokenized. Skip the boundary when
    // the run of Cyrillic letters is a single character (e.g. "\u04143", "\u041212",
    // "\u041a2") \u2014 those are vitamin / chemistry suffixes that belong to the
    // preceding brand or descriptor token, not free-floating numbers.
    .replace(/(?<=[\u0400-\u04ff]{2})(?=\d)/gu, ' ')
    // Split BRAND-<digits> abbreviations (e.g. "\u0410\u0417\u0418\u0422\u041e\u041a\u041e\u041c-500", "\u0421\u0423\u041c\u0410\u041c\u0415\u0414-250")
    // into BRAND + NUMBER so the dose can be parsed as strength. Require \u22654
    // letters before the hyphen and \u22652 digits after to preserve ingredient/
    // vitamin patterns like "\u0414-3", "\u0412-12", "\u03c9-3", "\u043e\u043c\u0435\u0433\u0430-3".
    .replace(/([\p{L}]{4,})-(\d{2,})(?![\p{L}\d])/gu, '$1 $2')
    // Expand pharmacy "<digits>\u0414" abbreviation to "<digits> \u0434\u043e\u0437" (e.g.
    // "200\u0414" \u2192 "200 \u0434\u043e\u0437" for inhalers/aerosols). Negative lookahead avoids
    // breaking "\u04143", "\u0414-3", "200\u0434\u0437" \u2014 only fires when "\u0434" is the trailing
    // standalone abbreviation.
    .replace(/(\d+)\u0434(?![\p{L}\d])/giu, '$1 \u0434\u043e\u0437')
    .replace(
      /(?<![а-яёa-z0-9])([а-яё]{1,2})\/([а-яё]{1,4})(?![а-яёa-z0-9])/giu,
      (match, left, right) => {
        const leftNorm = String(left).toLowerCase().replace(/ё/g, 'е');
        const rightNorm = String(right).toLowerCase().replace(/ё/g, 'е');
        if (MEDICINE_UNIT_TOKENS.has(leftNorm) || MEDICINE_UNIT_TOKENS.has(rightNorm)) return match;
        // Preserve "<short>/<dosage form>" (e.g. "д/сусп", "д/инг", "д/инф")
        // by surfacing the dosage-form token. Otherwise it gets stripped and
        // the parser misclassifies "пор. д/сусп." as plain powder instead of
        // suspension (the final form for sale).
        if (MEDICINE_FORM_TOKENS.has(rightNorm)) return ` ${rightNorm} `;
        return ' ';
      },
    )
    .replace(/\s+/gu, ' ')
    .trim();

  if (!prepared) return '';

  return prepared
    .split(' ')
    .map(normalizeRawSegment)
    .filter(Boolean)
    .join(' ')
    .replace(/\s*\+\s*/gu, ' + ')
    .replace(/(\d+(?:\.\d+)?)\s+%/gu, '$1%')
    .replace(/(\d+(?:\.\d+)?)\s+([\p{L}%]+)\s+\/\s+(\d+(?:\.\d+)?)\s+([\p{L}%]+)/gu, '$1 $2/$3 $4')
    .replace(/(\d+(?:\.\d+)?)\s+([\p{L}%]+)\s+\/\s+([\p{L}%]+)/gu, '$1 $2/$3')
    .replace(/\s+/gu, ' ')
    .trim();
}

function classifyWordToken(token) {
  if (token === 'n') {
    return { type: 'COUNT_MARKER', normalizedValue: token };
  }

  if (/^\d+x\d+$/u.test(token)) {
    const [left, right] = token.split('x').map((value) => Number.parseInt(value, 10));
    return {
      type: 'COUNT_MULTIPLIER',
      normalizedValue: token,
      left,
      right,
      count: Number.isFinite(left) && Number.isFinite(right) ? left * right : null,
    };
  }

  const container = parseContainerType(token);
  const dosageForm = parseDosageForm(token);
  if (dosageForm) {
    const normalizedValue = normalizeFormTokenValue(token);
    return {
      type: 'DOSAGE_FORM',
      normalizedValue,
      dosageForm,
      dosageFormSource:
        container?.dosageForm === dosageForm ? 'inferred_from_container' : 'explicit',
      containerType: container?.containerType || null,
      priority: MEDICINE_FORM_PRIORITIES.get(normalizedValue) || 0,
    };
  }

  if (container) {
    return {
      type: 'CONTAINER',
      normalizedValue: container.containerType,
      containerType: container.containerType,
    };
  }

  const normalizedToken = normalizeMedicineToken(token);
  if (MEDICINE_UNIT_TOKENS.has(normalizedToken)) {
    return {
      type: 'UNIT',
      normalizedValue: normalizedToken,
      unitFamily: UNIT_FAMILY_BY_VALUE.get(normalizedToken) || 'other',
    };
  }

  if (!normalizedToken) {
    return {
      type: 'WORD',
      normalizedValue: '',
    };
  }

  return {
    type: 'WORD',
    normalizedValue: normalizedToken,
  };
}

function tokenizeNormalizedQuery(normalizedText) {
  if (!normalizedText) return [];

  return [...normalizedText.matchAll(TOKEN_RE)].map((match) => {
    const value = match[0];
    const start = match.index || 0;
    const end = start + value.length;

    if (value === '%') {
      return { type: 'PERCENT', value, normalizedValue: value, start, end };
    }

    if (value === '/') {
      return { type: 'SLASH', value, normalizedValue: value, start, end };
    }

    if (value === '+') {
      return { type: 'PLUS', value, normalizedValue: value, start, end };
    }

    if (/^\d+(?:\.\d+)?$/u.test(value)) {
      return {
        type: 'NUMBER',
        value,
        normalizedValue: value,
        numericValue: Number.parseFloat(value),
        start,
        end,
      };
    }

    return {
      value,
      start,
      end,
      ...classifyWordToken(value),
    };
  });
}

function tokenizeMedicineQuery(rawQuery) {
  return tokenizeNormalizedQuery(normalizeMedicineQuery(rawQuery));
}

// Collect normalized tokens from parenthesized segments that look like
// vendor/manufacturer abbreviations or other free-text annotations
// (e.g. "(ника ф.)", "(апельсин)", "(железа 3)", "(forte)"). A paren is
// treated as noise only when its content has plain WORD/NUMBER tokens and no
// units, dosage forms, slashes, or count multipliers — spans containing real
// dosage/pack/measurement signals are left alone. Country names
// (e.g. "(США)") are still added here but get re-extracted upstream by
// extractVendorCountryFromTokens before this filter is applied.
function collectParenthesizedNoiseTokens(rawQuery) {
  const text = String(rawQuery || '');
  const noise = new Set();
  if (!text || !text.includes('(')) return noise;

  PAREN_GROUP_RE.lastIndex = 0;
  let match;
  while ((match = PAREN_GROUP_RE.exec(text)) !== null) {
    const inner = match[1];
    if (!inner || !inner.trim()) continue;
    const innerTokens = tokenizeMedicineQuery(inner);
    if (!innerTokens.length) continue;
    const allAnnotationTokens = innerTokens.every(
      (token) =>
        (token.type === 'WORD' && token.normalizedValue) ||
        (token.type === 'NUMBER' && Number.isFinite(token.numericValue)),
    );
    if (!allAnnotationTokens) continue;
    for (const token of innerTokens) {
      noise.add(token.normalizedValue || token.value);
    }
  }
  return noise;
}

function buildMeasurementNode(numberToken, unitToken, startIndex, endIndex) {
  return {
    text: `${numberToken.value} ${unitToken.normalizedValue}`,
    value: Number.parseFloat(numberToken.value),
    unit: unitToken.normalizedValue,
    startIndex,
    endIndex,
  };
}

function buildSimpleStrengthNode(values, unit, startIndex, endIndex) {
  // DB stores multi-value combination strengths with the unit duplicated on
  // both sides of the slash (e.g. "5 мг/10 мг"). Match that format so strict
  // strength:= filters in Typesense hit. Single-value and percent stay compact.
  let text;
  if (unit === '%') {
    text = `${values.join('/')}%`;
  } else if (values.length > 1) {
    text = values.map((value) => `${value} ${unit}`).join('/');
  } else {
    text = `${values[0]} ${unit}`;
  }
  return {
    kind: 'simple',
    text,
    values,
    value: values.length === 1 ? values[0] : null,
    unit,
    startIndex,
    endIndex,
  };
}

function buildCombinationStrengthNode(components, startIndex, endIndex) {
  return {
    kind: 'combination',
    text: components.map((component) => component.text).join(' + '),
    components: components.map((component) => ({
      value: component.value,
      unit: component.unit,
    })),
    startIndex,
    endIndex,
  };
}

function buildRatioStrengthNode(values, unit, denominator, startIndex, endIndex) {
  const denominatorText =
    denominator.value == null ? denominator.unit : `${denominator.value} ${denominator.unit}`;

  return {
    kind: 'ratio',
    text: `${values.join('/')} ${unit}/${denominatorText}`,
    values,
    value: values.length === 1 ? values[0] : null,
    unit,
    denominator,
    startIndex,
    endIndex,
  };
}

function collectNumericSequence(tokens, startIndex) {
  if (tokens[startIndex]?.type !== 'NUMBER') return null;

  const values = [Number.parseFloat(tokens[startIndex].value)];
  let nextIndex = startIndex + 1;

  while (tokens[nextIndex]?.type === 'SLASH' && tokens[nextIndex + 1]?.type === 'NUMBER') {
    values.push(Number.parseFloat(tokens[nextIndex + 1].value));
    nextIndex += 2;
  }

  return { values, nextIndex };
}

function buildPercentStrengthNode(tokens, startIndex) {
  const sequence = collectNumericSequence(tokens, startIndex);
  if (!sequence || tokens[sequence.nextIndex]?.type !== 'PERCENT') return null;

  return buildSimpleStrengthNode(sequence.values, '%', startIndex, sequence.nextIndex);
}

function buildPlusSeparatedSharedDenominatorRatioStrength(tokens, startIndex) {
  if (tokens[startIndex]?.type !== 'NUMBER' || tokens[startIndex + 1]?.type !== 'UNIT') {
    return null;
  }

  const values = [Number.parseFloat(tokens[startIndex].value)];
  const sharedUnit = tokens[startIndex + 1].normalizedValue;
  let cursor = startIndex + 2;

  while (tokens[cursor]?.type === 'PLUS') {
    const numberToken = tokens[cursor + 1];
    const unitToken = tokens[cursor + 2];
    if (numberToken?.type !== 'NUMBER' || unitToken?.type !== 'UNIT') return null;
    if (unitToken.normalizedValue !== sharedUnit) return null;

    values.push(Number.parseFloat(numberToken.value));
    cursor += 3;
  }

  if (values.length < 2 || tokens[cursor]?.type !== 'SLASH') return null;

  const denominatorNumberToken = tokens[cursor + 1];
  const denominatorUnitToken = tokens[cursor + 2];
  if (
    denominatorNumberToken?.type !== 'NUMBER' ||
    denominatorUnitToken?.type !== 'UNIT' ||
    denominatorUnitToken.normalizedValue === sharedUnit
  ) {
    return null;
  }

  return buildRatioStrengthNode(
    values,
    sharedUnit,
    {
      value: Number.parseFloat(denominatorNumberToken.value),
      unit: denominatorUnitToken.normalizedValue,
    },
    startIndex,
    cursor + 2,
  );
}

function buildMultiComponentRatioStrength(tokens, startIndex) {
  if (tokens[startIndex]?.type !== 'NUMBER') return null;

  const components = [];
  let cursor = startIndex;

  const firstNum = tokens[cursor];
  const firstUnit = tokens[cursor + 1];
  if (firstUnit?.type !== 'UNIT') return null;

  components.push(firstNum);
  const sharedUnit = firstUnit.normalizedValue;
  cursor += 2;

  while (
    tokens[cursor]?.type === 'SLASH' &&
    tokens[cursor + 1]?.type === 'NUMBER' &&
    tokens[cursor + 2]?.type === 'UNIT' &&
    tokens[cursor + 2].normalizedValue === sharedUnit
  ) {
    components.push(tokens[cursor + 1]);
    cursor += 3;
  }

  if (components.length < 2 || tokens[cursor]?.type !== 'SLASH') return null;

  if (
    tokens[cursor + 1]?.type === 'NUMBER' &&
    tokens[cursor + 2]?.type === 'UNIT' &&
    tokens[cursor + 2].normalizedValue !== sharedUnit
  ) {
    return buildRatioStrengthNode(
      components.map((c) => Number.parseFloat(c.value)),
      sharedUnit,
      {
        value: Number.parseFloat(tokens[cursor + 1].value),
        unit: tokens[cursor + 2].normalizedValue,
      },
      startIndex,
      cursor + 2,
    );
  }

  if (tokens[cursor + 1]?.type === 'UNIT' && tokens[cursor + 1].normalizedValue !== sharedUnit) {
    return buildRatioStrengthNode(
      components.map((c) => Number.parseFloat(c.value)),
      sharedUnit,
      {
        value: null,
        unit: tokens[cursor + 1].normalizedValue,
      },
      startIndex,
      cursor + 1,
    );
  }

  return null;
}

function buildStrengthNode(tokens, startIndex) {
  const sequence = collectNumericSequence(tokens, startIndex);
  if (!sequence) return null;

  const numeratorUnitToken = tokens[sequence.nextIndex];
  if (numeratorUnitToken?.type !== 'UNIT') return null;

  if (tokens[sequence.nextIndex + 1]?.type === 'SLASH') {
    const denominatorNumberToken = tokens[sequence.nextIndex + 2];
    const denominatorUnitToken = tokens[sequence.nextIndex + 3];

    if (
      denominatorNumberToken?.type === 'NUMBER' &&
      denominatorUnitToken?.type === 'UNIT' &&
      denominatorUnitToken.normalizedValue !== numeratorUnitToken.normalizedValue
    ) {
      return buildRatioStrengthNode(
        sequence.values,
        numeratorUnitToken.normalizedValue,
        {
          value: Number.parseFloat(denominatorNumberToken.value),
          unit: denominatorUnitToken.normalizedValue,
        },
        startIndex,
        sequence.nextIndex + 3,
      );
    }

    if (denominatorNumberToken?.type === 'UNIT') {
      return buildRatioStrengthNode(
        sequence.values,
        numeratorUnitToken.normalizedValue,
        {
          value: null,
          unit: denominatorNumberToken.normalizedValue,
        },
        startIndex,
        sequence.nextIndex + 2,
      );
    }
  }

  return buildSimpleStrengthNode(
    sequence.values,
    numeratorUnitToken.normalizedValue,
    startIndex,
    sequence.nextIndex,
  );
}

function buildSingleStrengthComponent(tokens, startIndex) {
  const percentStrength = buildPercentStrengthNode(tokens, startIndex);
  if (percentStrength) return percentStrength;

  const strengthNode = buildStrengthNode(tokens, startIndex);
  if (!strengthNode || strengthNode.kind !== 'simple' || strengthNode.value == null) return null;
  if (UNIT_FAMILY_BY_VALUE.get(strengthNode.unit) === 'volume') return null;
  return strengthNode;
}

function buildCombinationStrengthCandidate(tokens, startIndex) {
  const firstComponent = buildSingleStrengthComponent(tokens, startIndex);
  if (!firstComponent) return null;

  const components = [firstComponent];
  let cursor = firstComponent.endIndex + 1;

  while (tokens[cursor]?.type === 'PLUS') {
    const nextComponent = buildSingleStrengthComponent(tokens, cursor + 1);
    if (!nextComponent) break;
    components.push(nextComponent);
    cursor = nextComponent.endIndex + 1;
  }

  if (components.length < 2) return null;
  return buildCombinationStrengthNode(components, startIndex, components.at(-1).endIndex);
}

function isMeaningfulTradeNameWordToken(token, consumedIndexes = null, index = null) {
  if (token?.type !== 'WORD') return false;
  if (consumedIndexes && index != null && consumedIndexes.has(index)) return false;

  const normalizedToken = token.normalizedValue || '';
  if (!normalizedToken) return false;

  return (
    !MEDICINE_DESCRIPTOR_TOKENS.has(normalizedToken) &&
    !MEDICINE_FORM_TOKENS.has(normalizedToken) &&
    !MEDICINE_UNIT_TOKENS.has(normalizedToken) &&
    !PARSER_NOISE_TOKENS.has(normalizedToken)
  );
}

function shouldKeepNumberAsBrandToken(tokens, index, consumedIndexes) {
  if (consumedIndexes.has(index)) return false;

  const previous = tokens[index - 1];
  const next = tokens[index + 1];
  const hasMeaningfulPrevious = isMeaningfulTradeNameWordToken(
    previous,
    consumedIndexes,
    index - 1,
  );
  const hasMeaningfulNext = isMeaningfulTradeNameWordToken(next, consumedIndexes, index + 1);

  if (next?.type === 'WORD' && !hasMeaningfulNext) return false;
  return hasMeaningfulPrevious || hasMeaningfulNext;
}

function isVitaminDTradeNameToken(token) {
  return ['д-3', 'д3', 'd-3', 'd3'].includes(String(token || '').toLowerCase());
}

function isLevothyroxineTradeName(tradeNameTokens) {
  const normalizedTradeTokens = (tradeNameTokens || []).map((token) =>
    String(token || '').toLowerCase(),
  );

  return normalizedTradeTokens.some((token) => /^l-тироксин$/iu.test(token));
}

function maybeInferVitaminDStrength({
  tokens,
  consumedIndexes,
  tokenRoles,
  tradeNameTokens,
  packCount,
  strengthCandidates,
}) {
  if (strengthCandidates.length > 0) return;

  const normalizedTradeTokens = (tradeNameTokens || []).map((token) =>
    String(token || '').toLowerCase(),
  );
  const isVitaminD =
    normalizedTradeTokens[0] === 'витамин' &&
    normalizedTradeTokens.some((token) => isVitaminDTradeNameToken(token));

  if (!isVitaminD) return;

  const candidateIndexes = [];

  for (let index = 0; index < tokens.length; index += 1) {
    if (consumedIndexes.has(index)) continue;

    const token = tokens[index];
    if (token?.type !== 'NUMBER') continue;
    if (!Number.isFinite(token.numericValue) || token.numericValue <= 0) continue;
    if (packCount != null && token.numericValue === packCount) continue;

    candidateIndexes.push(index);
  }

  const strengthIndex = candidateIndexes.find((index) => {
    const value = tokens[index].numericValue;
    return value >= 400 && value <= 50000;
  });

  if (strengthIndex == null) return;

  const strengthNode = buildSimpleStrengthNode(
    [tokens[strengthIndex].numericValue],
    'ме',
    strengthIndex,
    strengthIndex,
  );
  strengthCandidates.push(strengthNode);
  consumedIndexes.add(strengthIndex);
  tokenRoles.set(strengthIndex, 'strength');

  if (
    packCount != null &&
    candidateIndexes.length >= 2 &&
    candidateIndexes[0] !== strengthIndex &&
    tokens[candidateIndexes[0]].numericValue < 10 &&
    tokens[candidateIndexes[0] + 1]?.type === 'DOSAGE_FORM'
  ) {
    tokenRoles.set(candidateIndexes[0], 'trade_name');
  }
}

// Oral solid forms (tablet, capsule, etc.) where pharmacy listings often
// abbreviate the strength as a bare number adjacent to the form token. The
// implicit unit is usually мг — e.g. "АЗИТОКОМ-500 ТАБ №3" → 500 мг,
// "Сумамед 250 капс №6" → 250 мг. L-тироксин tablets are conventionally listed
// in micrograms, so bare "100" maps to 100 мкг for that brand.
const ORAL_SOLID_FORMS_WITH_IMPLICIT_MG = new Set([
  'tablet',
  'capsule',
  'pastille',
  'granule',
]);

function maybeInferOralSolidStrength({
  tokens,
  dosageForm,
  consumedIndexes,
  tokenRoles,
  tradeNameTokens,
  packCount,
  strengthCandidates,
}) {
  if (!dosageForm || !ORAL_SOLID_FORMS_WITH_IMPLICIT_MG.has(dosageForm)) return;
  if (strengthCandidates.length > 0) return;

  const candidateIndexes = [];
  for (let index = 0; index < tokens.length; index += 1) {
    if (consumedIndexes.has(index)) continue;
    const token = tokens[index];
    if (token?.type !== 'NUMBER') continue;
    if (!Number.isFinite(token.numericValue)) continue;
    if (!Number.isInteger(token.numericValue)) continue;
    if (token.numericValue < 25 || token.numericValue > 5000) continue;
    if (packCount != null && token.numericValue === packCount) continue;
    candidateIndexes.push(index);
  }

  if (candidateIndexes.length !== 1) return;

  const strengthIndex = candidateIndexes[0];
  const inferredUnit =
    dosageForm === 'tablet' && isLevothyroxineTradeName(tradeNameTokens) ? 'мкг' : 'мг';
  const strengthNode = buildSimpleStrengthNode(
    [tokens[strengthIndex].numericValue],
    inferredUnit,
    strengthIndex,
    strengthIndex,
  );
  strengthCandidates.push(strengthNode);
  consumedIndexes.add(strengthIndex);
  tokenRoles.set(strengthIndex, 'strength');

  // Trade-name tokens were collected from residue earlier — drop the just-
  // promoted strength value so it doesn't appear in both fields.
  if (Array.isArray(tradeNameTokens)) {
    const promotedValue = String(tokens[strengthIndex].value);
    for (let i = tradeNameTokens.length - 1; i >= 0; i -= 1) {
      if (tradeNameTokens[i] === promotedValue) tradeNameTokens.splice(i, 1);
    }
  }
}

function hasRepeatedStrengthNumberLater(tokens, index) {
  const token = tokens[index];
  if (token?.type !== 'NUMBER') return false;

  for (let cursor = index + 1; cursor < tokens.length - 1; cursor += 1) {
    if (tokens[cursor]?.type !== 'NUMBER') continue;
    if (tokens[cursor].value !== token.value) continue;

    const next = tokens[cursor + 1];
    if (next?.type !== 'UNIT') continue;
    const unitFamily = UNIT_FAMILY_BY_VALUE.get(next.normalizedValue);
    if (unitFamily === 'mass' || unitFamily === 'percent' || next.normalizedValue === '%') {
      return true;
    }
  }

  return false;
}

function hasPrefilledSyringeSignal(rawQuery, normalizedText) {
  const text = `${rawQuery || ''} ${normalizedText || ''}`;
  return SYRINGE_RE.test(text) && PREFILLED_RE.test(text);
}

const SOLVENT_LOOKBACK_TOKENS = 8;

function lowerToken(token) {
  return String(token?.value || '').toLowerCase().replace(/ё/g, 'е');
}

function dropCandidatesMatching(candidates, tokenRoles, predicate) {
  for (let i = candidates.length - 1; i >= 0; i -= 1) {
    const candidate = candidates[i];
    if (!predicate(candidate)) continue;
    for (let ci = candidate.startIndex; ci <= candidate.endIndex; ci += 1) {
      tokenRoles.delete(ci);
    }
    candidates.splice(i, 1);
  }
}

function hasTokenWithPrefixInRange(tokens, prefixRe, fromIndex, toIndex) {
  for (let index = fromIndex; index < toIndex; index += 1) {
    if (prefixRe.test(lowerToken(tokens[index]))) return true;
  }
  return false;
}

function isSolventVolumeCandidate(volume, tokens) {
  if (!volume || volume.unit !== 'мл') return false;
  const startIndex = volume.startIndex ?? 0;
  return hasTokenWithPrefixInRange(
    tokens,
    /^растворител/u,
    Math.max(0, startIndex - SOLVENT_LOOKBACK_TOKENS),
    startIndex,
  );
}

function findSolventClauseStartIndex(tokens) {
  for (let index = 0; index < tokens.length; index += 1) {
    if (!/^растворител/u.test(lowerToken(tokens[index]))) continue;
    if (
      hasTokenWithPrefixInRange(
        tokens,
        /^комплект/u,
        Math.max(0, index - SOLVENT_LOOKBACK_TOKENS),
        index,
      )
    ) {
      return index;
    }
  }
  return null;
}

function toPublicStrengthNode(strength) {
  if (!strength) return null;

  if (strength.kind === 'combination') {
    return {
      kind: strength.kind,
      text: strength.text,
      components: strength.components,
    };
  }

  return {
    kind: strength.kind,
    text: strength.text,
    values: strength.values,
    value: strength.value,
    unit: strength.unit,
    ...(strength.denominator ? { denominator: strength.denominator } : {}),
  };
}

function toPublicMeasurementNode(measurement) {
  if (!measurement) return null;

  const node = {
    text: measurement.text,
    value: measurement.value,
    unit: measurement.unit,
  };

  if (measurement.dimension2) {
    node.dimension2 = measurement.dimension2;
  }

  return node;
}

function dedupePublicNodes(nodes) {
  const seen = new Set();
  return nodes.filter((node) => {
    const key = JSON.stringify(node);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function classifyProductType(rawQuery, normalizedText, { dosageForm, strengths, volumes } = {}) {
  const text = `${rawQuery || ''} ${normalizedText || ''}`.trim();
  const PHARMA_STRENGTH_UNITS = new Set(['мг', 'мкг', '%', 'ед', 'ме']);
  const hasPharmaStrength = (strengths || []).some(
    (s) =>
      (s.kind === 'simple' && PHARMA_STRENGTH_UNITS.has(s.unit)) ||
      s.kind === 'ratio' ||
      s.kind === 'combination',
  );
  const hasLiquidVolume = (volumes || []).some((v) => v.unit === 'мл' || v.unit === 'л');
  const hasInjectableRouteSignal = /инъекц|подкож|внутримыш|внутривен|введ/iu.test(text);
  const hasPrefilledSignal = PREFILLED_RE.test(text);
  const hasSyringeSignal = SYRINGE_RE.test(text);
  const hasInjectableMedicineSignal =
    dosageForm === 'injection' ||
    hasInjectableRouteSignal ||
    (hasSyringeSignal && hasPrefilledSignal);

  for (const pattern of PRODUCT_TYPE_PATTERNS.other) {
    if (pattern.test(text)) return 'other';
  }

  if (dosageForm && hasSyringeSignal && hasPrefilledSignal) return 'medicine';
  if (hasPharmaStrength && hasInjectableMedicineSignal) return 'medicine';

  for (const pattern of PRODUCT_TYPE_PATTERNS.devicePrimary) {
    if (pattern.test(text)) return 'device';
  }

  if (dosageForm) return 'medicine';

  for (const pattern of PRODUCT_TYPE_PATTERNS.deviceAccessory) {
    if (pattern.test(text)) return 'device';
  }

  if (hasPharmaStrength || hasLiquidVolume) {
    return 'medicine';
  }

  return null;
}

function isBrandOnlyProductType(productType) {
  return productType === 'device' || productType === 'other';
}

// Pairs where both forms appear explicitly but only the first should win.
// e.g. "пор. д/сусп." (powder for suspension) is sold/stored as suspension,
// so keep suspension and drop powder regardless of encounter order.
const EXPLICIT_DOSAGE_FORM_KEEP_PAIRS = new Set([
  'spray|suspension',
  'enema|solution',
  'aerosol|inhaler',
  'suspension|powder',
  // "р-р д/внутрь и инг" (solution sold both for oral use and inhalation,
  // e.g. Лазолван 7,5 мг/мл): catalog rows store this as solution/drops, so
  // a trailing "инг" route hint must not override the primary solution form.
  // The reverse direction (genuine inhalers) never carries a "р-р" token —
  // "р-р д/инг" / "д/инг" are pre-normalized to bare " инг ".
  'solution|inhaler',
]);

function shouldKeepCurrentDosageForm({
  currentDosageForm,
  currentSource,
  nextDosageForm,
  nextSource,
}) {
  if (currentSource !== 'explicit' || nextSource !== 'explicit') return false;
  return EXPLICIT_DOSAGE_FORM_KEEP_PAIRS.has(`${currentDosageForm}|${nextDosageForm}`);
}

function shouldOverrideDosageFormForFinalForm(currentDosageForm, nextDosageForm) {
  return currentDosageForm === 'powder' && nextDosageForm === 'suspension';
}

function formatNormalizedNumber(value) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return String(value || '');
  return Number.isInteger(numericValue) ? String(Math.trunc(numericValue)) : String(numericValue);
}

function buildSameUnitSlashStrength(normalizedText) {
  const match = String(normalizedText || '').match(
    /(?:^|[^\p{L}\p{N}])(\d+(?:\.\d+)?)\s*(мг|мкг|г|ме|ед)\s*\/\s*(\d+(?:\.\d+)?)\s*\2(?=$|[^\p{L}\p{N}])/iu,
  );
  if (!match) return null;

  const leftValue = Number.parseFloat(match[1]);
  const rightValue = Number.parseFloat(match[3]);
  const unit = match[2].toLowerCase();
  if (!Number.isFinite(leftValue) || !Number.isFinite(rightValue)) return null;

  return {
    kind: 'simple',
    text: `${formatNormalizedNumber(leftValue)} ${unit}/${formatNormalizedNumber(rightValue)} ${unit}`,
    values: [leftValue, rightValue],
    value: null,
    unit,
  };
}

function mergeSameUnitSlashStrength(strengths, normalizedText) {
  if (!normalizedText || !normalizedText.includes('/')) return strengths;
  const slashStrength = buildSameUnitSlashStrength(normalizedText);
  if (!slashStrength) return strengths;

  const sameValuesAlreadyPresent = (strength) =>
    strength &&
    strength.unit === slashStrength.unit &&
    Array.isArray(strength.values) &&
    strength.values.length === slashStrength.values.length &&
    strength.values.every((value, index) => value === slashStrength.values[index]);

  // Already represented (as either a multi-value simple or as a ratio
  // with matching numerator values, e.g. inhalation per-dose ratios).
  if (strengths.some(sameValuesAlreadyPresent)) return strengths;

  // Combination tablets / capsules expressed as duplicated-unit slash
  // (e.g. "4 мг/10 мг", "75 мг/15.2 мг") describe distinct active
  // components and should stay as individual simple strengths. The merge
  // only applies when the parser dedupe collapsed an equal-value
  // split-vial pattern (e.g. "25 мг/25 мг") into a single strength. For
  // other units (ме, ед, г, мкг) the slash form is canonically stored as
  // a single multi-value simple, so merge unconditionally.
  const slashValues = slashStrength.values;
  const allValuesEqual = slashValues.every((value) => value === slashValues[0]);
  const separateSimples = strengths.filter(
    (strength) =>
      strength?.kind === 'simple' &&
      strength.unit === slashStrength.unit &&
      strength.value != null &&
      slashValues.includes(strength.value),
  );
  const hasDistinctSeparates = separateSimples.length >= 2;
  if (slashStrength.unit === 'мг' && hasDistinctSeparates && !allValuesEqual) {
    return strengths;
  }

  const slashValuesSet = new Set(slashValues.map((value) => `${value}`));
  const filtered = strengths.filter(
    (strength) =>
      !(
        strength?.kind === 'simple' &&
        strength.unit === slashStrength.unit &&
        strength.value != null &&
        slashValuesSet.has(`${strength.value}`)
      ),
  );

  return [slashStrength, ...filtered];
}

function inferInhalationPerDoseStrengths(strengths, normalizedText, dosageForm) {
  if (dosageForm !== 'aerosol' && dosageForm !== 'inhaler') return strengths;
  if (
    !/(?:^|[^\p{L}\p{N}])доз(?:ир)?(?=$|[^\p{L}\p{N}])[^\d]{0,24}\d+(?:\.\d+)?\s*\/\s*\d/iu.test(
      normalizedText || '',
    )
  ) {
    return strengths;
  }

  return strengths.map((strength) => {
    const values = Array.isArray(strength?.values) ? strength.values : [];
    if (
      strength?.kind !== 'simple' ||
      values.length < 2 ||
      strength.value != null ||
      !strength.unit
    ) {
      return strength;
    }

    const unit = String(strength.unit).toLowerCase();
    if (unit !== 'мкг' && unit !== 'мг') return strength;

    return {
      ...strength,
      kind: 'ratio',
      text: `${values.map(formatNormalizedNumber).join('/')} ${unit}/доз`,
      denominator: { value: null, unit: 'доз' },
    };
  });
}

// Listings like "Азмасол ... 100мкг/200 доз" glue the per-dose mass and the
// total dose count into one ratio "100 мкг/200 доз". The product semantic is
// "100 mcg per single dose, 200 doses per container" — i.e. the "200 доз" is
// volume, not the strength's denominator. Indexed catalog rows store strength
// as "100 мкг/доз" and volume as "200 доз". Without simplification, the
// strict Typesense filter `strength:="100 мкг/200 доз"` excludes those rows.
function simplifyInhalationDoseRatios(strengths, volumes, dosageForm) {
  if (dosageForm !== 'aerosol' && dosageForm !== 'inhaler' && dosageForm !== 'spray') {
    return { strengths, volumes };
  }

  const newStrengths = [];
  const newVolumes = [...(volumes || [])];

  const MASS_NUMERATOR_UNITS = new Set(['мг', 'мкг']);

  for (const strength of strengths || []) {
    if (
      strength?.kind === 'ratio' &&
      MASS_NUMERATOR_UNITS.has(String(strength.unit || '').toLowerCase()) &&
      strength.denominator?.unit === 'доз' &&
      Number.isFinite(strength.denominator.value) &&
      strength.denominator.value > 1
    ) {
      const doseCount = strength.denominator.value;
      const alreadyHasDoseVolume = newVolumes.some(
        (volume) => volume?.unit === 'доз' && volume?.value === doseCount,
      );
      if (!alreadyHasDoseVolume) {
        newVolumes.push({
          text: `${formatNormalizedNumber(doseCount)} доз`,
          value: doseCount,
          unit: 'доз',
        });
      }

      const numeratorText = Array.isArray(strength.values)
        ? strength.values.map(formatNormalizedNumber).join('/')
        : formatNormalizedNumber(strength.value);
      newStrengths.push({
        ...strength,
        text: `${numeratorText} ${strength.unit}/доз`,
        denominator: { value: null, unit: 'доз' },
      });
    } else {
      newStrengths.push(strength);
    }
  }

  return { strengths: newStrengths, volumes: newVolumes };
}

function recoverHyphenatedEnemaTradeName(tokens) {
  const firstToken = tokens?.[0];
  if (!firstToken || firstToken.type !== 'DOSAGE_FORM' || firstToken.dosageForm !== 'enema') {
    return null;
  }

  const value = String(firstToken.normalizedValue || firstToken.value || '').toLowerCase();
  if (!value.includes('-')) return null;

  const [leadingToken] = value.split('-').filter(Boolean);
  return leadingToken && leadingToken.length >= 2 ? leadingToken : null;
}

function parseMedicineQuery(rawQuery) {
  const normalizedText = normalizeMedicineQuery(rawQuery);
  const tokens = tokenizeNormalizedQuery(normalizedText);
  const consumedIndexes = new Set();
  const tokenRoles = new Map();
  const consumeRange = (startIndex, endIndex, role) => {
    for (let i = startIndex; i <= endIndex; i += 1) {
      consumedIndexes.add(i);
      tokenRoles.set(i, role);
    }
  };
  const strengthCandidates = [];
  const volumeCandidates = [];
  let dosageForm = null;
  let dosageFormToken = null;
  let dosageFormSource = null;
  let containerType = null;
  let packCount = null;

  // Extract pack count from №N patterns directly from raw query (last one wins)
  for (const match of (rawQuery || '').matchAll(/№\s*(\d+)/gu)) {
    packCount = Number.parseInt(match[1], 10);
  }

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];

    if (token.type === 'COUNT_MARKER') {
      const nextToken = tokens[index + 1];
      if (
        nextToken?.type === 'NUMBER' &&
        Number.isFinite(nextToken.numericValue) &&
        Number.isInteger(nextToken.numericValue) &&
        nextToken.numericValue > 0
      ) {
        if (packCount == null) {
          packCount = nextToken.numericValue;
        }
        consumedIndexes.add(index);
        consumedIndexes.add(index + 1);
        tokenRoles.set(index, 'pack');
        tokenRoles.set(index + 1, 'pack');
        index += 1;
        continue;
      }
      consumedIndexes.add(index);
      tokenRoles.set(index, 'pack');
      continue;
    }

    if (token.type === 'COUNT_MULTIPLIER') {
      const nextToken = tokens[index + 1];
      if (nextToken?.type === 'UNIT') {
        volumeCandidates.push(
          buildMeasurementNode(
            { value: token.normalizedValue, normalizedValue: null },
            { normalizedValue: nextToken.normalizedValue },
            index,
            index + 1,
          ),
        );
        consumedIndexes.add(index);
        consumedIndexes.add(index + 1);
        tokenRoles.set(index, 'volume');
        tokenRoles.set(index + 1, 'volume');
        index += 1;
        continue;
      }
      if (packCount == null && Number.isFinite(token.count) && token.count > 0) {
        packCount = token.count;
      }
      consumedIndexes.add(index);
      tokenRoles.set(index, 'pack');
      continue;
    }

    if (token.type === 'DOSAGE_FORM') {
      const sourcePriority = token.dosageFormSource === 'explicit' ? 2 : 1;
      const currentSourcePriority =
        dosageFormSource === 'explicit'
          ? 2
          : dosageFormSource === 'inferred_from_container'
            ? 1
            : 0;
      const keepCurrentDosageForm = shouldKeepCurrentDosageForm({
        currentDosageForm: dosageForm,
        currentSource: dosageFormSource,
        nextDosageForm: token.dosageForm,
        nextSource: token.dosageFormSource,
      });

      const overrideForFinalForm = shouldOverrideDosageFormForFinalForm(
        dosageForm,
        token.dosageForm,
      );

      if (
        !keepCurrentDosageForm &&
        (overrideForFinalForm ||
          !dosageFormToken ||
          sourcePriority > currentSourcePriority ||
          (sourcePriority === currentSourcePriority && token.priority >= dosageFormToken.priority))
      ) {
        dosageForm = token.dosageForm;
        dosageFormToken = token;
        dosageFormSource = token.dosageFormSource;
      }

      if (!containerType && token.containerType) {
        containerType = token.containerType;
      }

      consumedIndexes.add(index);
      tokenRoles.set(index, 'dosage_form');
      continue;
    }

    if (token.type === 'CONTAINER') {
      if (!containerType) containerType = token.containerType;
      consumedIndexes.add(index);
      tokenRoles.set(index, 'container');
    }
  }

  for (let index = 0; index < tokens.length; index += 1) {
    if (consumedIndexes.has(index)) continue;

    const token = tokens[index];

    if (token.type !== 'NUMBER') continue;

    // Dimension notation: NUMBER UNIT(length) х NUMBER UNIT(length)
    if (
      tokens[index + 1]?.type === 'UNIT' &&
      UNIT_FAMILY_BY_VALUE.get(tokens[index + 1].normalizedValue) === 'length' &&
      tokens[index + 2]?.type === 'WORD' &&
      (tokens[index + 2].normalizedValue === 'х' || tokens[index + 2].normalizedValue === 'x') &&
      tokens[index + 3]?.type === 'NUMBER' &&
      tokens[index + 4]?.type === 'UNIT' &&
      UNIT_FAMILY_BY_VALUE.get(tokens[index + 4].normalizedValue) === 'length'
    ) {
      const dimensionText = `${token.value} ${tokens[index + 1].normalizedValue} х ${tokens[index + 3].value} ${tokens[index + 4].normalizedValue}`;
      volumeCandidates.push({
        text: dimensionText,
        value: Number.parseFloat(token.value),
        unit: tokens[index + 1].normalizedValue,
        dimension2: {
          value: Number.parseFloat(tokens[index + 3].value),
          unit: tokens[index + 4].normalizedValue,
        },
        startIndex: index,
        endIndex: index + 4,
      });
      consumeRange(index, index + 4, 'volume');
      index = index + 4;
      continue;
    }

    const combinationStrength = buildCombinationStrengthCandidate(tokens, index);
    if (combinationStrength) {
      strengthCandidates.push(combinationStrength);
      consumeRange(combinationStrength.startIndex, combinationStrength.endIndex, 'strength');
      index = combinationStrength.endIndex;
      continue;
    }

    const plusSeparatedSharedDenominatorRatio =
      buildPlusSeparatedSharedDenominatorRatioStrength(tokens, index);
    if (plusSeparatedSharedDenominatorRatio) {
      strengthCandidates.push(plusSeparatedSharedDenominatorRatio);
      for (
        let consumedIndex = plusSeparatedSharedDenominatorRatio.startIndex;
        consumedIndex <= plusSeparatedSharedDenominatorRatio.endIndex;
        consumedIndex += 1
      ) {
        consumedIndexes.add(consumedIndex);
        tokenRoles.set(consumedIndex, 'strength');
      }
      index = plusSeparatedSharedDenominatorRatio.endIndex;
      continue;
    }

    const percentStrength = buildPercentStrengthNode(tokens, index);
    if (percentStrength) {
      strengthCandidates.push(percentStrength);
      consumeRange(percentStrength.startIndex, percentStrength.endIndex, 'strength');
      index = percentStrength.endIndex;
      continue;
    }

    const multiComponentRatio = buildMultiComponentRatioStrength(tokens, index);
    if (multiComponentRatio) {
      strengthCandidates.push(multiComponentRatio);
      consumeRange(multiComponentRatio.startIndex, multiComponentRatio.endIndex, 'strength');
      index = multiComponentRatio.endIndex;
      continue;
    }

    if (
      packCount == null &&
      tokens[index + 1]?.type === 'DOSAGE_FORM' &&
      COUNT_BEFORE_FORM_DOSAGE_FORMS.has(tokens[index + 1].dosageForm) &&
      Number.isFinite(token.numericValue) &&
      Number.isInteger(token.numericValue) &&
      token.numericValue > 0 &&
      !hasRepeatedStrengthNumberLater(tokens, index)
    ) {
      packCount = token.numericValue;
      consumedIndexes.add(index);
      tokenRoles.set(index, 'pack');
      continue;
    }

    const strengthNode = buildStrengthNode(tokens, index);

    if (!strengthNode) continue;

    const unitFamily = UNIT_FAMILY_BY_VALUE.get(strengthNode.unit);
    const isDoseCount = strengthNode.kind === 'simple' && strengthNode.unit === 'доз';
    const isVolumeNode =
      strengthNode.kind === 'simple' &&
      (unitFamily === 'volume' || unitFamily === 'length' || isDoseCount);
    if (isVolumeNode) {
      volumeCandidates.push(
        buildMeasurementNode(
          { value: String(strengthNode.value), normalizedValue: null },
          { normalizedValue: strengthNode.unit },
          strengthNode.startIndex,
          strengthNode.endIndex,
        ),
      );
    } else {
      strengthCandidates.push(strengthNode);
    }

    consumeRange(
      strengthNode.startIndex,
      strengthNode.endIndex,
      isVolumeNode ? 'volume' : 'strength',
    );
    index = strengthNode.endIndex;
  }

  const PRECISE_STRENGTH_UNITS = new Set(['мг', 'мкг', '%']);
  const TOPICAL_PACKAGE_FORMS = new Set(['cream', 'ointment', 'gel', 'paste']);
  const hasPreciserStrength = strengthCandidates.some(
    (s) =>
      (s.kind === 'ratio' && UNIT_FAMILY_BY_VALUE.get(s.denominator?.unit) === 'volume') ||
      (s.kind === 'ratio' && UNIT_FAMILY_BY_VALUE.get(s.denominator?.unit) === 'dose') ||
      (s.kind === 'simple' && PRECISE_STRENGTH_UNITS.has(s.unit)) ||
      (s.kind === 'combination' && s.components?.some((c) => PRECISE_STRENGTH_UNITS.has(c.unit))),
  );
  const isTopicalForm = TOPICAL_PACKAGE_FORMS.has(dosageForm);
  if (hasPreciserStrength || isTopicalForm) {
    for (let i = strengthCandidates.length - 1; i >= 0; i -= 1) {
      const s = strengthCandidates[i];
      if (s.kind === 'simple' && (s.unit === 'г' || s.unit === 'л')) {
        volumeCandidates.push(
          buildMeasurementNode(
            { value: String(s.value), normalizedValue: null },
            { normalizedValue: s.unit },
            s.startIndex,
            s.endIndex,
          ),
        );
        for (let ci = s.startIndex; ci <= s.endIndex; ci += 1) {
          tokenRoles.set(ci, 'volume');
        }
        strengthCandidates.splice(i, 1);
      }
    }
  }

  // Infer injection form when a dose-unit/mL ratio strength is present and no
  // explicit injection form was found (e.g. bare р-р with 300 ед/1.5 мл).
  const DOSE_UNITS = new Set(['ед', 'ме']);
  const hasDoseRatioPerMl = strengthCandidates.some(
    (s) => s.kind === 'ratio' && DOSE_UNITS.has(s.unit) && s.denominator?.unit === 'мл',
  );
  if (hasDoseRatioPerMl && dosageForm !== 'injection') {
    dosageForm = 'injection';
    dosageFormSource = 'inferred_from_strength';
  }

  dropCandidatesMatching(volumeCandidates, tokenRoles, (v) =>
    isSolventVolumeCandidate(v, tokens),
  );

  const solventClauseStartIndex = findSolventClauseStartIndex(tokens);
  if (solventClauseStartIndex != null) {
    const isAfterSolventClause = (c) => (c.startIndex ?? 0) >= solventClauseStartIndex;
    dropCandidatesMatching(strengthCandidates, tokenRoles, isAfterSolventClause);
    dropCandidatesMatching(volumeCandidates, tokenRoles, isAfterSolventClause);

    for (let index = solventClauseStartIndex; index < tokens.length; index += 1) {
      consumedIndexes.add(index);
      if (!tokenRoles.has(index)) tokenRoles.set(index, 'solvent');
    }
  }

  // Prefilled syringes commonly list total dose + fill volume:
  // "4000 МЕ 0.4 мл предварительно заполненные шприцы" → "4000 МЕ/0.4 мл".
  // Keep the generic concentration inference below for insulin-style listings:
  // "100 ед" + "3 мл" → "100 ед/мл" + "3 мл".
  const hasVolumeMl = volumeCandidates.some((v) => v.unit === 'мл');
  const prefilledSyringeSignal = hasPrefilledSyringeSignal(rawQuery, normalizedText);
  const prefilledSyringeMlVolumes = prefilledSyringeSignal
    ? volumeCandidates.filter((v) => v.unit === 'мл' && v.value != null)
    : [];
  if (prefilledSyringeMlVolumes.length === 1) {
    const syringeVolume = prefilledSyringeMlVolumes[0];
    for (let i = 0; i < strengthCandidates.length; i += 1) {
      const s = strengthCandidates[i];
      if (s.kind === 'simple' && DOSE_UNITS.has(s.unit)) {
        strengthCandidates[i] = buildRatioStrengthNode(
          s.values,
          s.unit,
          { value: syringeVolume.value, unit: 'мл' },
          s.startIndex,
          syringeVolume.endIndex,
        );
      }
    }
  } else if (hasVolumeMl) {
    for (let i = 0; i < strengthCandidates.length; i += 1) {
      const s = strengthCandidates[i];
      if (s.kind === 'simple' && DOSE_UNITS.has(s.unit)) {
        strengthCandidates[i] = buildRatioStrengthNode(
          s.values,
          s.unit,
          { value: null, unit: 'мл' },
          s.startIndex,
          s.endIndex,
        );
      }
    }
  }

  // Infer per-dose concentration when the Russian preposition "по" connects a
  // mass strength to a dose-count: "100 мкг по 200 доз" → "100 мкг/доз" +
  // "200 доз". The explicit "по" is the disambiguating signal — without it,
  // bare "X mass + Y доз" stays simple (e.g. Паллада-НС "665 мкг, 30 мл (240 доз)").
  const MASS_STRENGTH_UNITS = new Set(['мкг', 'мг', 'г']);
  for (let i = 0; i < strengthCandidates.length; i += 1) {
    const s = strengthCandidates[i];
    if (s.kind !== 'simple' || !MASS_STRENGTH_UNITS.has(s.unit)) continue;

    const connector = tokens[s.endIndex + 1];
    const denominatorNumber = tokens[s.endIndex + 2];
    const denominatorUnit = tokens[s.endIndex + 3];

    if (
      connector?.type === 'WORD' &&
      connector.value === 'по' &&
      denominatorNumber?.type === 'NUMBER' &&
      denominatorUnit?.type === 'UNIT' &&
      denominatorUnit.normalizedValue === 'доз'
    ) {
      strengthCandidates[i] = buildRatioStrengthNode(
        s.values,
        s.unit,
        { value: null, unit: 'доз' },
        s.startIndex,
        s.endIndex,
      );
    }
  }

  const tradeNameEntries = [];
  for (let index = 0; index < tokens.length; index += 1) {
    if (consumedIndexes.has(index)) continue;

    const token = tokens[index];
    if (token.type === 'WORD') {
      const normalizedToken = token.normalizedValue || '';
      if (isMeaningfulTradeNameWordToken(token)) {
        tradeNameEntries.push({ index, value: normalizedToken, isTradeName: true });
      } else if (!normalizedToken && token.value.length === 1) {
        tradeNameEntries.push({ index, value: token.value, isTradeName: false });
      }
      continue;
    }

    if (token.type === 'CONTAINER' || token.type === 'DOSAGE_FORM') continue;

    if (token.type === 'NUMBER' && shouldKeepNumberAsBrandToken(tokens, index, consumedIndexes)) {
      tradeNameEntries.push({ index, value: token.value, isTradeName: true });
    }
  }

  const tradeNameIndexes = new Set(
    tradeNameEntries.filter((entry) => entry.isTradeName).map((entry) => entry.index),
  );
  const residueTokens = [];
  for (const entry of tradeNameEntries) {
    if (entry.isTradeName) {
      residueTokens.push(entry.value);
      tokenRoles.set(entry.index, 'trade_name');
    } else if (tradeNameIndexes.has(entry.index - 1) || tradeNameIndexes.has(entry.index + 1)) {
      residueTokens.push(entry.value);
      tokenRoles.set(entry.index, 'trade_name');
    }
  }

  const uniqueResidueTokens = [...new Set(residueTokens)];
  const {
    canonical: vendorCountry,
    matchedTokens: vendorCountryTokens,
    remainingTokens: tradeNameResidueTokens,
  } = extractVendorCountryFromTokens(uniqueResidueTokens);
  const parenNoiseTokens = collectParenthesizedNoiseTokens(rawQuery);
  const filteredResidueTokens = parenNoiseTokens.size
    ? tradeNameResidueTokens.filter((token) => !parenNoiseTokens.has(token))
    : tradeNameResidueTokens;
  if (parenNoiseTokens.size) {
    for (const [tokenIndex, role] of tokenRoles) {
      if (role !== 'trade_name') continue;
      const value = tokens[tokenIndex]?.normalizedValue;
      if (value && parenNoiseTokens.has(value)) tokenRoles.delete(tokenIndex);
    }
  }
  const cyrillicTokenSet = new Set(filteredResidueTokens.filter((t) => /[\u0400-\u04ff]/u.test(t)));
  const tradeNameTokens = filteredResidueTokens
    .filter((token) => {
    if (/[\u0400-\u04ff]/u.test(token)) return true;
    const transliterated = transliterateLatinToCyrillic(token);
    return !cyrillicTokenSet.has(transliterated);
    })
    .map((token) => normalizeTradeNameAbbrevToken(token));

  maybeInferVitaminDStrength({
    tokens,
    consumedIndexes,
    tokenRoles,
    tradeNameTokens,
    packCount,
    strengthCandidates,
  });

  maybeInferOralSolidStrength({
    tokens,
    dosageForm,
    consumedIndexes,
    tokenRoles,
    tradeNameTokens,
    packCount,
    strengthCandidates,
  });

  if (
    packCount == null &&
    strengthCandidates.length === 0 &&
    volumeCandidates.some((volume) => volume.unit === 'мл') &&
    hasPrefilledSyringeSignal(rawQuery, normalizedText)
  ) {
    packCount = 1;
  }

  const dosageFormRoute = detectDosageFormRoute(rawQuery);

  // For infusion bags, injection ampoules, or injectable-looking vials written as a bare ratio
  // (e.g. "500 мг/100 мл" with no separate "100 мл"), the ratio's
  // denominator value IS the package volume. Promote it to volumes so
  // downstream consumers see the package size. Skip oral suspensions/
  // syrups, where the denominator is a per-dose reference (e.g. "5 мл").
  const isInjectableContext =
    dosageFormRoute === 'infusion' ||
    dosageFormRoute === 'injection' ||
    dosageForm === 'injection' ||
    dosageForm === 'infusion' ||
    (dosageForm === 'solution' &&
      dosageFormSource === 'inferred_from_container' &&
      containerType === 'vial');
  if (isInjectableContext && volumeCandidates.length === 0) {
    for (const strength of strengthCandidates) {
      if (strength.kind !== 'ratio') continue;
      const denominator = strength.denominator;
      if (denominator?.value == null) continue;
      if (UNIT_FAMILY_BY_VALUE.get(denominator.unit) !== 'volume') continue;
      volumeCandidates.push({
        text: `${denominator.value} ${denominator.unit}`,
        value: denominator.value,
        unit: denominator.unit,
        startIndex: strength.startIndex,
        endIndex: strength.endIndex,
      });
    }
  }

  let strengths = dedupePublicNodes(strengthCandidates.map(toPublicStrengthNode).filter(Boolean));
  strengths = mergeSameUnitSlashStrength(strengths, normalizedText);
  strengths = inferInhalationPerDoseStrengths(strengths, normalizedText, dosageForm);
  let volumes = dedupePublicNodes(volumeCandidates.map(toPublicMeasurementNode).filter(Boolean));
  ({ strengths, volumes } = simplifyInhalationDoseRatios(strengths, volumes, dosageForm));
  volumes = dedupePublicNodes(volumes);
  const productType = classifyProductType(rawQuery, normalizedText, {
    dosageForm,
    strengths,
    volumes,
  });
  if (!tradeNameTokens.length) {
    const recoveredTradeName = recoverHyphenatedEnemaTradeName(tokens);
    if (recoveredTradeName) tradeNameTokens.push(recoveredTradeName);
  }
  const tradeNameText = tradeNameTokens.join(' ').trim() || null;

  const annotatedTokens = tokens.map((token, index) => ({
    ...token,
    role: tokenRoles.get(index) || null,
  }));

  if (isBrandOnlyProductType(productType)) {
    // Strip pack-count multipliers (e.g. "3x10", "1x1") from the full trade name text
    let fullTradeName = normalizedText || null;
    if (fullTradeName) {
      for (const [idx, role] of tokenRoles) {
        if (role === 'pack' && tokens[idx]?.type === 'COUNT_MULTIPLIER') {
          const v = tokens[idx].normalizedValue || tokens[idx].value;
          if (v) fullTradeName = fullTradeName.replace(v, '').replace(/\s+/gu, ' ').trim();
        }
      }
    }
    return {
      rawQuery: rawQuery || '',
      normalizedText,
      tokens: annotatedTokens,
      residueTokens: tradeNameTokens,
      attributes: {
        trade_name_text: fullTradeName,
        trade_name_tokens: tradeNameTokens.map((token) => normalizeTradeNameAbbrevToken(token)),
        dosage_form: null,
        dosage_form_token: null,
        dosage_form_source: null,
        dosage_form_route: null,
        container_type: null,
        product_type: productType,
        vendor_country_text: vendorCountry,
        vendor_country_tokens: vendorCountryTokens,
        strengths: [],
        volumes: [],
        pack_count: packCount,
      },
    };
  }

  return {
    rawQuery: rawQuery || '',
    normalizedText,
    tokens: annotatedTokens,
    residueTokens: tradeNameTokens,
    attributes: {
      trade_name_text: tradeNameText,
      trade_name_tokens: tradeNameTokens.map((token) => normalizeTradeNameAbbrevToken(token)),
      dosage_form: dosageForm || null,
      dosage_form_token: dosageFormToken?.normalizedValue || null,
      dosage_form_source: dosageFormSource,
      dosage_form_route: dosageFormRoute,
      container_type: containerType,
      product_type: productType,
      vendor_country_text: vendorCountry,
      vendor_country_tokens: vendorCountryTokens,
      strengths,
      volumes,
      pack_count: packCount,
    },
  };
}

module.exports = {
  normalizeMedicineQuery,
  parseMedicineQuery,
  tokenizeMedicineQuery,
};
