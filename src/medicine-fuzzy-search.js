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

const MEDICINE_FORM_PHRASE_NORMALIZERS = [
  // "500.000.ЕД" / "50.000.МЕ" / "1.000.000.МЕ" — English-style thousand
  // separators in international-unit doses. Real decimals don't sport a
  // dot-3digits-dot signature, so it's safe to flatten the numeric run and
  // replace the trailing dot with a space. Without this, the dots get
  // interpreted as decimal points and the dose collapses to its leading
  // segment ("500.000.ЕД" → 500 ЕД).
  [/\b(\d+(?:\.\d{3})+)\.(?=[\p{L}])/gu, (match, digits) => `${digits.replace(/\./g, '')} `],
  // "1.000.000 МЕ" / "50.000 МЕ" — same notation but with a space (instead
  // of a trailing dot) before the unit. Only flatten when there are two or
  // more 3-digit segments (e.g. millions) to stay clear of ambiguous cases
  // like "0.500 мг" where the fractional part is just trailing zeros.
  [/\b(\d+(?:\.\d{3}){2,})(?=\s)/gu, (match) => match.replace(/\./g, '')],
  // "25.000ЕД" / "10.000МЕ" — value and unit glued together with a thousand
  // separator dot. ЕД (units), МЕ (international units) and IU are integer-
  // only domains, so a single ".XYZ" segment between the leading digit and
  // the unit token is unambiguously thousands. Insert a space and flatten.
  [
    /\b(\d+(?:\.\d{3})+)(?=\s*(?:ме|ед|iu)(?:\W|$))/giu,
    (match) => `${match.replace(/\./g, '')} `,
  ],
  // "амп. (пласт.)" / "флак. (пласт)" — parenthetical material descriptor
  // for the ampoule/flacon, not a separate dosage form. Drop the
  // parenthetical so "пласт" doesn't get treated as a transdermal patch.
  [/(амп|флак|шприц[а-я]*)\.?\s*\(\s*пласт\.?\s*\)/gu, '$1'],
  // Standalone "г/х" / "г.х" salt-suffix abbreviation (гидрохлорид). Without
  // this, "г" gets tokenized as a mass unit and "х" survives as a 1-letter
  // brand-token residue, polluting trade_name (e.g. "Папаверин Г/Х" →
  // trade_name="папаверин х"). Word-boundary guards keep ratio expressions
  // like "5мг/мл" untouched.
  [/(?<![а-яёa-z0-9])г\s*[\/.]\s*х(?![а-яёa-z0-9])/gu, ' '],
  [/со\s+вкусом\s+/gu, ' '],
  [/со\s+вкус\.?\s+/gu, ' '],
  [/с\s+сахар\.?/gu, ' '],
  [/к\s*-\s*та/gu, ' '],
  [/для\s+детей/gu, ' '],
  [/для\s+взрослых/gu, ' '],
  [/по\s+\d+\s+шт\.?/gu, ' '],
  [/доктор\s+мом\s+сон/gu, 'доктор момсон'],
  [/одно(?:разов[а-я]*)?\.?\s+прим(?:\.|ен[а-я]*)?/gu, ' '],
  [/\(?\s*с\s+раст\s*-\s*л[яья]+\s*\)?/gu, ' '],
  [/растительн[а-я]*\s+от\s+кашл[яа]/gu, ' '],
  [/упаковк[а-я]*\s+контурн[а-я]*\s+ячейков[а-я]*/gu, ' блистер '],
  [/контейнер[а-я]*\s+полипропиленов[а-я]*/gu, ' '],
  [/капсул[а-я]*\s+с\s+модифицированн[а-я]*\s+высвобождени[а-я]*/gu, 'капс'],
  [/таблетк[а-я]*\s+с\s+модифицированн[а-я]*\s+высвобождени[а-я]*/gu, 'таб'],
  [/таблетк[а-я]*\s+пролонгированн[а-я]*\s+действи[а-я]*/gu, 'таб'],
  [/таблетк[а-я]*\s+жевательн[а-я]*/gu, 'таб'],
  [/суппозитори[а-я]*(?:\s+ректальн[а-я]*|\s+вагинальн[а-я]*)?/gu, 'супп'],
  [/пастилк[а-я]*/gu, ' пастилки '],
  [/пастил(?!к)[а-я]*/gu, 'паст'],
  [/гранул[а-я]*\s+шипуч[а-я]*/gu, 'гран'],
  [
    /гранул[а-я]*\s+для\s+приготовлен[а-я]*\s+суспензи[а-я]*(?:\s+для\s+прием[а-я]*\s+внутр[а-я]*)?/gu,
    'гран',
  ],
  [/гел[а-я]*\s+для\s+носов[а-я]*\s+полост[а-я]*/gu, 'гель'],
  [/аэрозол[а-я]*\s+для\s+ингаляци[а-я]*/gu, 'инг'],
  [/ингаляционн[а-я]*\s+раствор[а-я]*\s+для\s+распылени[а-я]*/gu, 'инг'],
  [
    /порошок\s+лиофилизирован[а-я]*\s+для\s+приготовлен[а-я]*\s+раствор[а-я]*\s+для\s+инъекци[а-я]*/gu,
    ' пор ',
  ],
  [/лиофилизат\s+для\s+внутривенн[а-я]*\s+и\s+внутримышечн[а-я]*\s+введен[а-я]*/gu, ' пор '],
  [/порошок\s+для\s+приготовлен[а-я]*\s+инъекционн[а-я]*\s+р\s*[- ]\s*р[а-я]*/gu, ' пор '],
  [/порошок\s+для\s+приготовлен[а-я]*\s+раствор[а-я]*(?:\s+для\s+инъекци[а-я]*)?/gu, ' пор '],
  [
    /порошок\s+для\s+приготовлен[а-я]*\s+суспензи[а-я]*(?:\s+для\s+прием[а-я]*\s+внутр[а-я]*)?/gu,
    ' пор ',
  ],
  // Negative lookahead must exclude both "инф" (infusion, line below) and
  // "инг" (inhalation, lines 211-213) so they don't get rewritten as "амп".
  [/р\s*-\s*р\.?\s*д\s*\/\s*ин(?![фг])[а-я]*\.?/gu, ' амп '],
  [/р\s*-\s*р\.?\s*д\s*\/\s*инф[а-я]*\.?/gu, ' раствор '],
  [/р\s*-\s*р\.?\s*для\s*\/\s*инф[а-я]*\.?/gu, ' раствор '],
  [/р\s*-\s*р\.?\s*для\s*инф[а-я]*\.?/gu, ' раствор '],
  [/р\s*-\s*р\.?\s*инф[а-я]*\.?/gu, ' раствор '],
  [/р\s*-\s*р\.?\s*д\s*\/\s*в\.?\s*в\.?/gu, ' амп '],
  [/р\s*-\s*р\.?\s*д\s*\/\s*п\s*\/\s*к\.?\s*ин\.?/gu, ' амп '],
  [/р\s*-\s*р\.?\s*для\s+(?:в\s*\/\s*[вм]|п\s*\/\s*к)\.?\.?\s*(?:введ[а-я]*\.?)?/gu, ' амп '],
  [/р\s*-\s*р\.?\s*для\s+подкож[а-я]*\.?\s*(?:введ[а-я]*\.?)?/gu, ' амп '],
  [/для\s+подкож[а-я]*\.?\s*(?:введ[а-я]*\.?)?/gu, ' '],
  [/д\s*\/\s*пр\.?\s+р\s*-\s*р[а-я]*\s+д\s*\/\s*ин(?!ф)\.?/gu, ' '],
  [/д\s*\/\s*пр\.?\s+р\s*-\s*р[а-я]*\s+д\s*\/\s*инф\.?/gu, ' '],
  [/д\s*\/\s*пр\.?\s+р\s*-\s*р[а-я]*/gu, ' '],
  [/д\s*\/\s*пр\.?\s+сусп[а-я]*\.?/gu, ' '],
  [/д\s*\/\s*ин(?!г|ф)[а-я]*\.?/gu, ' '],
  [/д\s*\/\s*инф[а-я]*\.?/gu, ' '],
  [/пор\.?\s*д\s*\/\s*ин[а-я]*\.?/gu, ' '],
  [/раствор\s+для\s+инъекци[а-я]*/gu, ' '],
  [/раствор\s+для\s+внутривенн[а-я]*\s+введен[а-я]*/gu, ' '],
  [/раствор\s+для\s+внутривенн[а-я]*\s+и\s+внутримышечн[а-я]*\s+введен[а-я]*/gu, ' '],
  [/раствор\s+для\s+внутримышечн[а-я]*\s+введен[а-я]*/gu, ' '],
  [/раствор\s+для\s+инфузи[а-я]*/gu, ' инфуз '],
  [/раствор\s+для\s+внутривенн[а-я]*\s+инфузи[а-я]*/gu, ' инфуз '],
  [/раствор\s+для\s+прием[а-я]*\s+внутр[а-я]*/gu, ' '],
  [/р\s*-\s*р\.?\s*д\s*\/\s*прием[а-я]*\s+внутр[а-я]*/gu, ' раствор '],
  [/концентрат\s+д\s*\/\s*приг\.?\s*р\s*-\s*р[а-я]*/gu, ' раствор '],
  [/конц\.?\s*д\s*\/\s*приг\.?\s*р\s*-\s*р[а-я]*/gu, ' раствор '],
  [/р\s*-\s*р\.?\s*д\s*\/\s*внутр(?:ь|\.?)/gu, ' раствор '],
  [/р\s*-\s*р\.?\s*д\s*\/\s*пр\.?\s*внутр(?:ь|\.?)/gu, ' раствор '],
  [/р\s*-\s*р\.?\s*орал\.?/gu, ' раствор '],
  [/р\s*-\s*р\.?\s*д\s*\/\s*ингаляци[а-я]*/gu, ' инг '],
  [/р\s*-\s*р\.?\s*для\s*ингаляци[а-я]*/gu, ' инг '],
  [/д\s*\/\s*ингаляци[а-я]*/gu, ' инг '],
  [/раствор\s+для\s+полоскан[а-я]*/gu, ' '],
  [/раствор\s+для\s+наружн[а-я]*\s+применен[а-я]*/gu, ' '],
  [/раствор\s+для\s+местн[а-я]*\s+применен[а-я]*/gu, ' '],
  [/суспензи[а-я]*\s+для\s+прием[а-я]*\s+внутр[а-я]*/gu, ' сусп '],
  [/таблетк[а-я]*\s+диспергир[а-я]*\s+в\s+полост[а-я]*\s+рт[а-я]*/gu, 'таб'],
  [/таблетк[а-я]*\s+для\s+рассасыван[а-я]*\s+блистер[а-я]*/gu, 'таб'],
  [/таблетк[а-я]*\s+для\s+рассасыван[а-я]*/gu, 'таб'],
  [/таб(?:\.|л\.?|летк[а-я]*)?\s*п\s*\/\s*о\.?/gu, 'таб'],
  [/таблетк[а-я]*\s*,?\s*покрыт[а-я]*\s+пленочн[а-я]*\s+оболочк[а-я]*/gu, 'таб'],
  [/таблетк[а-я]*\s*,?\s*покрыт[а-я]*\s+оболочк[а-я]*/gu, 'таб'],
  [
    /таблетк[а-я]*\s*,?\s*покрыт[а-я]*\s+кишечнорастворим[а-я]*\s+пленочн[а-я]*\s+оболочк[а-я]*/gu,
    'таб',
  ],
  [
    /таблетк[а-я]*\s*,?\s*покрыт[а-я]*\s+пленочн[а-я]*\s+кишечнорастворим[а-я]*\s+оболочк[а-я]*/gu,
    'таб',
  ],
  [/капсул[а-я]*\s+кишечнорастворим[а-я]*/gu, 'капс'],
  [/аэр\.?\s*д\s*\/\s*инг\.?/gu, 'аэрозоль'],
  [/спрей\s+орал[а-я]*/gu, 'спрей'],
  [/орал[а-я]*\s+спрей/gu, 'спрей'],
  [/спрей\s+назал[а-я]*(?:\s+раствор)?/gu, 'спрей'],
  [/капсул[а-я]*\s+кишечнорастворим[а-я]*\s+блистер[а-я]*/gu, 'капс'],
  [/спрей\s+для\s+ротов[а-я]*\s+полост[а-я]*/gu, 'спрей'],
  [/капл[а-я]*\s+для\s+прием[а-я]*\s+внутр[а-я]*/gu, 'капли'],
  [/сироп\s+для\s+прием[а-я]*\s+внутр[а-я]*/gu, 'сироп'],
  [/небул[а-я]*/gu, ' инг '],
  // Generic route-abbreviation cleanup. Runs AFTER the specific route→form
  // mappings above (e.g. "р-р д/п/к ин." → "амп") so those still get priority.
  [/(?<![а-яё])[а-я]\s*\/\s*[а-я](?:\s*\/\s*[а-я])+\.?(?:\s+введ[а-я]*\.?)?/gu, ' '],
  [/(?<![а-яё])(?:в\s*\/\s*в|в\s*\/\s*м|п\s*\/\s*к)\.?\.?\s*введ[а-я]*\.?/gu, ' '],
];

function normalizeMedicineFormPhrases(value) {
  let normalized = String(value || '')
    .toLowerCase()
    .replace(/ё/g, 'е');

  for (const [pattern, replacement] of MEDICINE_FORM_PHRASE_NORMALIZERS) {
    normalized = normalized.replace(pattern, replacement);
  }

  return normalized;
}

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

    if (matched) {
      continue;
    }

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

  const variants = [];

  for (const [pattern, replacement] of replacements) {
    const phoneticVariant = normalizeQuery(normalized.replace(pattern, replacement));
    if (phoneticVariant && phoneticVariant !== normalized) {
      variants.push(phoneticVariant);
    }
  }

  return [...new Set(variants)];
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
      ].filter((variant) => variant.length > 0),
    ),
  ];
}

module.exports = {
  buildQueryVariants,
  normalizeMedicineFormPhrases,
  normalizeQuery,
  transliterateLatinToCyrillic,
};
