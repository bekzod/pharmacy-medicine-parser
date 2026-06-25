const { normalizeMedicineFormPhrases } = require('../medicine-fuzzy-search');
const {
  MEDICINE_FORM_NORMALIZERS,
} = require('../medicine-dosage-forms');
const {
  MEDICINE_FORM_TOKENS,
  MEDICINE_UNIT_TOKENS,
  normalizeMedicineToken,
} = require('../medicine-name-profile');
const {
  TRADE_NAME_ABBREV_TOKEN_ALIASES,
  normalizeLatinHomoglyphs,
  normalizeSqlTerm,
} = require('../medicine-lookup-common');
const { CONTAINER_NORMALIZERS } = require('./constants');

const RAW_SEGMENT_BASE_REWRITES = [
  [/(\d),(\d)/gu, '$1.$2'],
  [/[.,]+$/gu, ''],
];

const MEDICINE_QUERY_FINAL_REWRITES = [
  [/\s*\+\s*/gu, ' + '],
  [/(\d+(?:\.\d+)?)\s+%/gu, '$1%'],
  [
    /(?<![\p{L}\d])(\d{1,2}(?:\s+\d{3})+)\s+(мкг|мг|мл|кг|г|л|ме|ед)(?![\p{L}\d])/giu,
    (match, value, unit) => `${value.replace(/\s+/gu, '')} ${unit}`,
  ],
  [
    /(\d+(?:\.\d+)?)\s+([\p{L}%]+)\s+\/\s+(\d+(?:\.\d+)?)\s+([\p{L}%]+)/gu,
    '$1 $2/$3 $4',
  ],
  [/(\d+(?:\.\d+)?)\s+([\p{L}%]+)\s+\/\s+([\p{L}%]+)/gu, '$1 $2/$3'],
  [/\s+/gu, ' '],
];

function applyRewriteRules(value, rules) {
  return rules.reduce(
    (normalized, [pattern, replacement]) => normalized.replace(pattern, replacement),
    String(value || ''),
  );
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
  const value = applyRewriteRules(normalizeSqlTerm(segment), RAW_SEGMENT_BASE_REWRITES);
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

  const gluedPieceCountMatch = value.match(/^(\d+)\s*шт(?:ук)?$/u);
  if (gluedPieceCountMatch) return `n ${gluedPieceCountMatch[1]}`;

  const attachedUnitWithSuffixMatch = value.match(
    /^(\d+(?:\.\d+)?)([a-zа-яё]+)-[a-zа-яё0-9]{1,6}$/u,
  );
  if (attachedUnitWithSuffixMatch) {
    const normalizedUnit = normalizeAttachedUnit(attachedUnitWithSuffixMatch[2]);
    if (normalizedUnit) return `${attachedUnitWithSuffixMatch[1]} ${normalizedUnit}`;
  }

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
    .replace(/анти[-\s]*(?:ха|xa)[.\s]*ме/giu, 'МЕ')
    .replace(/anti[-\s]*xa[.\s]*(?:iu|me)/giu, 'МЕ')
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
    .replace(/(\d+(?:\.\d+)?)\s*млн\.?\s*(ме|ед|iu)(?!\p{L})/giu, (_, value, unit) => `${Number(value) * 1000000} ${unit}`)
    .replace(/(?<=\d)['’](?=\d{3}(?!\d))/gu, '')
    .replace(/(\d+(?:\.\d+)?(?:мкг|мг|мл|кг|г|л|ме|ед))_(?=\d)/giu, '$1/')
    .replace(
      /(\d+(?:\.\d+)?)(мкг|мг|г)\s*\/\s*(\d+(?:\.\d+)?)\2\s+\3\s*мл/giu,
      '$1$2/$3мл',
    )
    .replace(/(\d+(?:\.\d+)?)(мкг|мг|мл|кг|г|л|ме|ед|%)\s*\/\s*№(?=\s*\d)/giu, '$1 $2 №')
    .replace(/(\d+(?:\.\d+)?)(мкг|мг)\s*\/\s*(?:д|доз)(?![\p{L}\d])/giu, '$1 $2/доз')
    .replace(/(\d+(?:\.\d+)?)(мкг|мг)\s*\/\s*(\d+)(?![.\p{L}\d])/giu, '$1 $2/$3 доз')
    .replace(/капли\s+в\s+нос/giu, 'капли')
    .replace(/д\s*\/\s*внутр[-\s]*сосуд[а-я]*[.\s-]*внутр[-\s]*полост[а-я]*[.\s-]*введ\.?/giu, ' ')
    .replace(/д\s*\/\s*внут\.?\s*в\s*[-/]\s*м\.?\s*введ\.?/giu, ' ')
    .replace(/д\s*\/\s*при[её]м\.?\s*внут(?:рь?)?\.?/giu, ' ')
    .replace(/д\s*\/\s*п(?!риг)(?:-?го)?/giu, ' ')
    .replace(/(р\s*[-/]\s*р)(?=\d)/giu, '$1 ')
    .replace(/(\d)(мкг|мг|мл|кг|г|л|ме|ед)\s*\/\s+(?=\d)/giu, '$1$2/')
    .replace(/%[./]?(?=\d)/gu, '% ')
    .replace(/(мкг|мг|мл|кг|г|л|%)-(?=\d)/giu, '$1 ')
    .replace(/(\d)\s*[х×x*]\s*(\d)/gu, '$1x$2')
    .replace(/(\d+)\s*x\s*(\d+)(мм|см|м)(?!\p{L})/giu, '$1 $3 х $2 $3')
    .replace(/(?<![\p{L}\d])(\d{1,2})\s*g(?![\p{L}\d])/giu, '$1 g')
    .replace(
      /(\d+(?:\.\d+)?)(мм|см|м)\s*[*хx×]\s*(\d+(?:\.\d+)?)(мм|см|м)?/giu,
      (match, left, leftUnit, right, rightUnit) =>
        `${left} ${leftUnit.toLowerCase()} х ${right} ${(rightUnit || leftUnit).toLowerCase()}`,
    )
    .replace(/\bsoft\s*gels?\b/giu, 'softgel')
    .replace(/\bveg\s*caps(?:ule)?s?\b/giu, 'vegcaps')
    .replace(
      /(?<![\p{L}\d])(\d{1,2}(?:\s+\d{3})+|[1-9]\d{2}(?:\s+0{3})+)(?=(?:мкг|мг|мл|кг|г|л|ме|ед)(?![\p{L}\d])|[^\p{L}\d]|$)/giu,
      (value) => value.replace(/\s+/gu, ''),
    )
    .replace(/№\s*(\d+)/gu, '')
    .replace(/№/gu, '')
    .replace(/\\/gu, '/')
    .replace(/(\d+(?:\.\d+)?\s*(?:мл|л|мг|мкг|г|кг|ме|ед|доз))\*+/giu, '$1 ')
    .replace(/(?<![а-яёa-z0-9])н\s*\/\s*с(?![а-яёa-z0-9])/giu, ' нестер ')
    .replace(/[,:;!?()[\]{}"'`«»]+/gu, ' ')
    .replace(/(?<!\d)\.(?!\d)/gu, ' ')
    .replace(/(?<![\p{L}\d])карри\s+ф\s+а(?![\p{L}\d])/giu, 'carry f a')
    .replace(/(?<![\p{L}\d])фотилфорте(?![\p{L}\d])/giu, 'фотил форте')
    .replace(/д\s*\/\s*при[её]м\s+внут(?:рь?)?/giu, ' ')
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
    .replace(/([\p{L}]{4,})-кап(?=\s*\.?\s*(?:глаз|уш|наз))/giu, '$1 кап')
    .replace(/(?<![\p{L}\d])[hн](\d+(?:\.\d+)?)(?=\s*(?:мг|мкг|г|%)(?![\p{L}\d]))/giu, '$1')
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

  const tokenized = prepared
    .split(' ')
    .map(normalizeRawSegment)
    .filter(Boolean)
    .join(' ');
  return applyRewriteRules(tokenized, MEDICINE_QUERY_FINAL_REWRITES).trim();
}

module.exports = {
  normalizeMedicineQuery,
  normalizeTradeNameAbbrevToken,
  normalizeFormTokenValue,
  parseContainerType,
};
