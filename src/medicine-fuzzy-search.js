const {
  normalizeMedicineLanguage: normalizeMedicineFormPhrases,
} = require('./medicine-language');

const LATIN_TO_CYRILLIC_LAYOUT = {
  q: 'й',
  w: 'ц',
  e: 'у',
  r: 'к',
  t: 'е',
  y: 'н',
  u: 'г',
  i: 'ш',
  o: 'щ',
  p: 'з',
  '[': 'х',
  ']': 'ъ',
  a: 'ф',
  s: 'ы',
  d: 'в',
  f: 'а',
  g: 'п',
  h: 'р',
  j: 'о',
  k: 'л',
  l: 'д',
  ';': 'ж',
  "'": 'э',
  z: 'я',
  x: 'ч',
  c: 'с',
  v: 'м',
  b: 'и',
  n: 'т',
  m: 'ь',
  ',': 'б',
  '.': 'ю',
  '/': '.',
};

const LATIN_TO_CYRILLIC_TRANSLIT_MULTI = [
  ['shch', 'щ'],
  ['yo', 'ё'],
  ['yu', 'ю'],
  ['ya', 'я'],
  ['ye', 'е'],
  ['zh', 'ж'],
  ['kh', 'х'],
  ['ts', 'ц'],
  ['ch', 'ч'],
  ['sh', 'ш'],
];

const LATIN_TO_CYRILLIC_TRANSLIT_SINGLE = {
  a: 'а',
  b: 'б',
  c: 'с',
  d: 'д',
  e: 'е',
  f: 'ф',
  g: 'г',
  h: 'х',
  i: 'и',
  j: 'ж',
  k: 'к',
  l: 'л',
  m: 'м',
  n: 'н',
  o: 'о',
  p: 'п',
  q: 'к',
  r: 'р',
  s: 'с',
  t: 'т',
  u: 'у',
  v: 'в',
  w: 'в',
  x: 'кс',
  y: 'й',
  z: 'з',
};

const CYRILLIC_TO_LATIN_HOMOGLYPH = {
  а: 'a',
  е: 'e',
  о: 'o',
  р: 'p',
  с: 'c',
  у: 'y',
  х: 'x',
  к: 'k',
  в: 'b',
  м: 'm',
  н: 'h',
  т: 't',
  А: 'A',
  В: 'B',
  Е: 'E',
  К: 'K',
  М: 'M',
  Н: 'H',
  О: 'O',
  Р: 'P',
  С: 'C',
  Т: 'T',
  Х: 'X',
};
const CYRILLIC_HOMOGLYPH_RE = /[аеорсухквмнтАВЕКМНОРСТХ]/g;

const LATIN_MEDICINE_PHONETIC_REPLACEMENTS = [
  [/si(?=t)/gu, 'ce'],
  [/se(?=t)/gu, 'ce'],
  [/ph/gu, 'f'],
];

const CYRILLIC_MEDICINE_PHONETIC_REPLACEMENTS = [
  [/си(?=т)/gu, 'це'],
  [/се(?=т)/gu, 'це'],
];

function normalizeLatinDominantMixedScriptTokens(value) {
  return String(value || '').replace(/[\p{L}\p{N}]+/gu, (word) => {
    const latinCount = (word.match(/[a-z]/giu) || []).length;
    const cyrillicCount = (word.match(/[\u0400-\u04ff]/gu) || []).length;
    if (!latinCount || !cyrillicCount || latinCount <= cyrillicCount) return word;
    return word.replace(CYRILLIC_HOMOGLYPH_RE, (char) => CYRILLIC_TO_LATIN_HOMOGLYPH[char] || char);
  });
}

function normalizeQuery(value) {
  return normalizeLatinDominantMixedScriptTokens(normalizeMedicineFormPhrases(value))
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function convertLatinLayoutToCyrillic(value) {
  return String(value || '')
    .toLowerCase()
    .split('')
    .map((char) => LATIN_TO_CYRILLIC_LAYOUT[char] || char)
    .join('');
}

function transliterateLatinToCyrillic(value) {
  const input = String(value || '').toLowerCase();
  let result = '';
  let index = 0;

  while (index < input.length) {
    let matched = false;

    for (const [latin, cyrillic] of LATIN_TO_CYRILLIC_TRANSLIT_MULTI) {
      if (input.startsWith(latin, index)) {
        result += cyrillic;
        index += latin.length;
        matched = true;
        break;
      }
    }

    if (matched) continue;

    const char = input[index];
    result += LATIN_TO_CYRILLIC_TRANSLIT_SINGLE[char] || char;
    index += 1;
  }

  // In Russian loanwords, л before a consonant is palatalized: л → ль.
  // e.g. salbutamol → сальбутамол, alfentanil → альфентанил, valproate → вальпроат
  // Uses negative lookahead: "л followed by any letter that is NOT a vowel, й, ь, ъ, or л itself"
  // so double-л (allopurinol → аллопуринол) and word-final л are left unchanged.
  return result.replace(/л(?=\p{L})(?![аеёийоуыэюяьъл])/gu, 'ль');
}

function buildMedicinePhoneticVariants(value, replacements) {
  const normalized = normalizeQuery(value);
  if (!normalized) return [];

  return [
    ...new Set(
      replacements
        .map(([pattern, replacement]) => normalizeQuery(normalized.replace(pattern, replacement)))
        .filter((variant) => variant && variant !== normalized),
    ),
  ];
}

function buildLatinMedicinePhoneticVariants(value) {
  return buildMedicinePhoneticVariants(value, LATIN_MEDICINE_PHONETIC_REPLACEMENTS);
}

function buildCyrillicMedicinePhoneticVariants(value) {
  return buildMedicinePhoneticVariants(value, CYRILLIC_MEDICINE_PHONETIC_REPLACEMENTS);
}

function buildQueryVariants(rawQuery) {
  const original = normalizeQuery(rawQuery);
  const layoutConverted = normalizeQuery(convertLatinLayoutToCyrillic(rawQuery));
  const transliterated = normalizeQuery(transliterateLatinToCyrillic(rawQuery));
  const latinPhoneticVariants = [
    ...buildMedicinePhoneticVariants(original, LATIN_MEDICINE_PHONETIC_REPLACEMENTS),
    ...buildMedicinePhoneticVariants(layoutConverted, LATIN_MEDICINE_PHONETIC_REPLACEMENTS),
    ...buildMedicinePhoneticVariants(transliterated, LATIN_MEDICINE_PHONETIC_REPLACEMENTS),
  ];
  const cyrillicPhoneticVariants = [
    ...buildMedicinePhoneticVariants(transliterated, CYRILLIC_MEDICINE_PHONETIC_REPLACEMENTS),
    ...latinPhoneticVariants
      .map((variant) => normalizeQuery(transliterateLatinToCyrillic(variant)))
      .filter(Boolean),
  ].flatMap((variant) => [
    variant,
    ...buildMedicinePhoneticVariants(variant, CYRILLIC_MEDICINE_PHONETIC_REPLACEMENTS),
  ]);

  return [
    ...new Set(
      [
        original,
        layoutConverted,
        transliterated,
        ...cyrillicPhoneticVariants,
        ...latinPhoneticVariants,
      ].filter(Boolean),
    ),
  ];
}

module.exports = {
  buildQueryVariants,
  buildLatinMedicinePhoneticVariants,
  buildCyrillicMedicinePhoneticVariants,
  normalizeMedicineFormPhrases,
  normalizeQuery,
  normalizeLatinDominantMixedScriptTokens,
  transliterateLatinToCyrillic,
  LATIN_TO_CYRILLIC_TRANSLIT_SINGLE,
  LATIN_TO_CYRILLIC_TRANSLIT_MULTI,
};
