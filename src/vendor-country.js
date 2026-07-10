const { normalizeSqlTerm } = require('./medicine-lookup-common');

const VENDOR_TABLE_COUNTRIES = [
  'австралия',
  'австрия',
  'азербайджан',
  'албания',
  'аргентина',
  'армения',
  'бангладеш',
  'беларусь',
  'бельгия',
  'болгария',
  'босния и герцеговина',
  'бразилия',
  'великобритания',
  'венгрия',
  'вьетнам',
  'германия',
  'гонконг',
  'греция',
  'грузия',
  'дания',
  'доминиканская республика',
  'египет',
  'израиль',
  'индия',
  'индонезия',
  'иордания',
  'иран',
  'ирландия',
  'исландия',
  'испания',
  'италия',
  'казахстан',
  'канада',
  'кипр',
  'китай',
  'колумбия',
  'куба',
  'кыргызстан',
  'латвия',
  'литва',
  'люксембург',
  'македония',
  'малайзия',
  'мальта',
  'мексика',
  'молдова',
  'нидерланды',
  'новая зеландия',
  'норвегия',
  'оаэ',
  'пакистан',
  'палестина',
  'польша',
  'португалия',
  'пуэрто рико',
  'россия',
  'румыния',
  'сан-марино',
  'саудовская аравия',
  'северная корея',
  'сербия',
  'сингапур',
  'словакия',
  'словения',
  'сша',
  'таджикистан',
  'таиланд',
  'тайвань',
  'турция',
  'узбекистан',
  'украина',
  'финляндия',
  'франция',
  'хорватия',
  'черногория',
  'чешская республика',
  'чили',
  'швейцария',
  'швеция',
  'шри-ланка',
  'эстония',
  'юар',
  'южная корея',
  'япония',
];

const COUNTRY_ALIAS_GROUPS = [
  ['индия', 'india', 'indiya', 'yndyya', 'ин', 'хиндистон'],
  ['узбекистан', 'uzbekistan', 'uzbekiston', 'uz', 'uzb', 'узб', 'узбекистон'],
  ['китай', 'china', 'cn', 'кнр', 'хитой'],
  [
    'сша',
    'usa',
    'us',
    'united states',
    'united states of america',
    'сша америка',
    'соединенные штаты',
    'соединенные штаты америки',
    'аксш',
  ],
  [
    'россия',
    'russia',
    'rf',
    'рф',
    'российская федерация',
    'россия федерацияси',
    'русия',
  ],
  ['турция', 'turkey', 'туркия'],
  ['германия', 'germany', 'олмония'],
  ['франция', 'france', 'фаронса'],
  ['италия', 'italy', 'итальян'],
  ['испания', 'spain'],
  ['украина', 'ukraine'],
  ['беларусь', 'belarus', 'белоруссия', 'белорусия', 'беларусия', 'беларус'],
  ['казахстан', 'kazakhstan', 'қозоғистон', 'козогистон'],
  ['кыргызстан', 'kyrgyzstan', 'киргизия', 'қирғизистон', 'киргизистон'],
  ['таджикистан', 'tajikistan', 'тожикистон'],
  ['армения', 'armenia', 'арманистон'],
  ['грузия', 'georgia', 'гуржистон'],
  ['польша', 'poland', 'полша'],
  ['швейцария', 'switzerland', 'швецария'],
  ['словения', 'slovenia'],
  ['венгрия', 'hungary', 'мажористон'],
  [
    'южная корея',
    'корея',
    'корея южная',
    'республика корея',
    'south korea',
    'korea',
    'жанубий корея',
  ],
  ['япония', 'japan', 'япон'],
  ['пакистан', 'pakistan', 'покистон'],
  ['египет', 'egypt', 'миср'],
  ['иран', 'iran', 'эрон'],
  ['ирак', 'iraq', 'ироқ', 'ирок'],
  ['израиль', 'israel', 'исроил'],
  ['великобритания', 'uk', 'united kingdom', 'англия', 'анг', 'британия', 'буюк британия'],
  ['австрия', 'austria'],
  ['нидерланды', 'netherlands', 'голландия', 'нидерландия'],
  ['финляндия', 'finland'],
  ['швеция', 'sweden'],
  ['норвегия', 'norway'],
  ['чешская республика', 'czech republic', 'чехия'],
  ['словакия', 'slovakia'],
  ['болгария', 'bulgaria'],
  ['румыния', 'romania', 'руминия'],
  ['сан-марино', 'san marino', 'сан марино'],
  ['хорватия', 'croatia'],
  ['сербия', 'serbia'],
  ['бельгия', 'belgium'],
  ['ирландия', 'ireland'],
  ['португалия', 'portugal'],
  ['греция', 'greece', 'юнонистон'],
  ['таиланд', 'thailand', 'тайланд', 'тайлянд'],
  ['тайвань', 'taiwan', 'tayvan'],
  ['вьетнам', 'vietnam'],
  ['малайзия', 'malaysia'],
  ['индонезия', 'indonesia'],
  ['сингапур', 'singapore'],
  ['канада', 'canada'],
  ['мексика', 'mexico'],
  ['бразилия', 'brazil'],
  ['аргентина', 'argentina'],
  ['австралия', 'australia'],
  ['оаэ', 'uae', 'united arab emirates', 'араб амирликлари'],
];

const COUNTRY_ALIAS_TO_CANONICAL = new Map();

for (const country of VENDOR_TABLE_COUNTRIES) {
  COUNTRY_ALIAS_TO_CANONICAL.set(normalizeSqlTerm(country), normalizeSqlTerm(country));
}

for (const aliases of COUNTRY_ALIAS_GROUPS) {
  const canonical = aliases[0];
  for (const alias of aliases) {
    COUNTRY_ALIAS_TO_CANONICAL.set(normalizeSqlTerm(alias), canonical);
  }
}

function normalizeVendorCountry(value) {
  const normalized = normalizeSqlTerm(value);
  if (!normalized) return null;
  return COUNTRY_ALIAS_TO_CANONICAL.get(normalized) || null;
}

function getVendorCountrySearchTerms(value) {
  const canonical = normalizeVendorCountry(value);
  if (!canonical) return [];

  return [
    canonical,
    ...[...COUNTRY_ALIAS_TO_CANONICAL.entries()]
      .filter(([, aliasCanonical]) => aliasCanonical === canonical)
      .map(([alias]) => alias),
  ].filter((term, index, terms) => term && terms.indexOf(term) === index);
}

function extractVendorCountryFromTokens(tokens) {
  const values = Array.isArray(tokens)
    ? tokens
        .map((token) => normalizeSqlTerm(token))
        .filter(Boolean)
    : [];
  if (!values.length) {
    return { canonical: null, text: null, matchedTokens: [], remainingTokens: [] };
  }

  for (let size = Math.min(3, values.length); size >= 1; size -= 1) {
    const suffixTokens = values.slice(-size);
    const suffixText = suffixTokens.join(' ');
    const suffixCanonical = normalizeVendorCountry(suffixText);
    if (suffixCanonical) {
      return {
        canonical: suffixCanonical,
        text: suffixText,
        matchedTokens: suffixTokens,
        remainingTokens: values.slice(0, -size),
      };
    }

    const prefixTokens = values.slice(0, size);
    const prefixText = prefixTokens.join(' ');
    const prefixCanonical = normalizeVendorCountry(prefixText);
    if (prefixCanonical) {
      return {
        canonical: prefixCanonical,
        text: prefixText,
        matchedTokens: prefixTokens,
        remainingTokens: values.slice(size),
      };
    }
  }

  return { canonical: null, text: null, matchedTokens: [], remainingTokens: values };
}

function vendorCountryMatches(parsedCountry, candidateCountry) {
  const normalizedParsed = normalizeVendorCountry(parsedCountry);
  const normalizedCandidate = normalizeVendorCountry(candidateCountry);
  return Boolean(normalizedParsed && normalizedCandidate && normalizedParsed === normalizedCandidate);
}

module.exports = {
  extractVendorCountryFromTokens,
  getVendorCountrySearchTerms,
  normalizeVendorCountry,
  vendorCountryMatches,
};
