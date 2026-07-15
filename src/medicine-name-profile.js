const { buildQueryVariants } = require('./medicine-fuzzy-search');
const { normalizeMedicineLanguage } = require('./medicine-language');
const {
  MEDICINE_FORM_NORMALIZERS,
  MEDICINE_FORM_PRIORITIES,
  MEDICINE_FORM_TO_DOSAGE_FORMS,
  parseDosageForm,
} = require('./medicine-dosage-forms');
const { normalizeLatinHomoglyphs, normalizeSqlTerm } = require('./medicine-lookup-common');

const MEDICINE_DECIMAL_MARKER = '~';

const MEDICINE_UNIT_NORMALIZERS = [
  [/^(ед|ед\.|единиц[аы]?|units?)$/u, 'ед'],
  [/^(ме|iu|me)$/u, 'ме'],
  [/^(мг|mg|миллиграмм?(?:а|ы|ов|у|ом|е)?)$/u, 'мг'],
  [/^(мкг|mcg|ug|микрограмм?(?:а|ы|ов|у|ом|е)?)$/u, 'мкг'],
  [/^(г|гр|gr|gramm?|грамм?(?:а|ы|ов|у|ом|е)?)$/u, 'г'],
  [/^(кг|kg|килограмм?(?:а|ы|ов|у|ом|е)?)$/u, 'кг'],
  [/^(мл|ml|миллилитр(?:а|ы|ов|у|ом|е)?)$/u, 'мл'],
  [/^(л|l|литр(?:а|ы|ов|у|ом|е)?)$/u, 'л'],
  [/^(доз(?:а|ы|е|у|ой|ами|ах)?)$/u, 'доз'],
  [/^(м|метр(?:а|ы|ов|у|ом|е)?)$/u, 'м'],
  [/^(мм|mm|миллиметр(?:а|ы|ов|у|ом|е)?)$/u, 'мм'],
  [/^(см|cm|сантиметр(?:а|ы|ов|у|ом|е)?)$/u, 'см'],
  [/^(проц|%)$/u, '%'],
  [/^(ч|час(?:а|ы|ов|у|ом|е)?)$/u, 'ч'],
  [/^(сут|сутк(?:а|и|е|у|ой|ам|ами|ах)?)$/u, 'сут'],
];
const MEDICINE_DESCRIPTOR_NORMALIZERS = [
  [/^(гл|гл\.|глаз|глаз\.|глазн[а-я]*)$/u, 'глаз'],
  [/^(уш|уш\.|ушн[а-я]*)$/u, 'уш'],
  [/^(наз|наз\.|назал[а-я]*)$/u, 'наз'],
  [/^(рект|рект\.|ректал[а-я]*)$/u, 'рект'],
  [/^(ваг|ваг\.|вагин|вагин\.|вагинал[а-я]*)$/u, 'вагин'],
  [/^(офтальмологическ[а-я]*)$/u, 'глаз'],
];
const MEDICINE_TOKEN_NORMALIZERS = [
  [/^(?:cp|cр|сp|ср|sr|sр)$/u, 'ср'],
  [/^(?:mr|mр|мr|мр)$/u, 'мр'],
  [/^(?:dsr|dсr|dsр|дsr|dср|дсr|дsр|дср)$/u, 'дср'],
  [/^(?:взр\.?|взросл(?:ый|ая|ое|ые|ого|ому|ым|ых|ой|ую|ыми|ом)?)$/u, 'взр'],
  [/^(?:дет\.?|дет(?:и|ей|ям|ьми|ях|ский|ская|ское|ские|ского|ской|скому|ских))$/u, 'дет'],
  [/^мят[а-я]*$/u, 'мята'],
  [/^лимон[а-я]*$/u, 'лимон'],
  [/^малин[а-я]*$/u, 'малина'],
  [/^клубни[чк][а-я]*$/u, 'клубника'],
  [/^вишн(?!евск)[а-я]*$/u, 'вишня'],
  [/^банан[а-я]*$/u, 'банан'],
  [/^ананас[а-я]*$/u, 'ананас'],
  [/^апельсин[а-я]*$/u, 'апельсин'],
  [/^эвкалипт[а-я-]*$/u, 'эвкалипт'],
  [/^ментол[а-я-]*$/u, 'ментол'],
  [/^медицин[а-я-]*$/u, 'мед'],
  [/^имбир[а-я]*$/u, 'имбирь'],
  [/^гранат[а-я]*$/u, 'гранат'],
  [/^плющ[а-я]*$/u, 'плющ'],
  [/^(?:беби|бейби)$/u, 'бейби'],
  [/^ромашк[а-я]*$/u, 'ромашка'],
  [/^чабрец[а-я]*$/u, 'чабрец'],
  [/^кокос[а-я]*$/u, 'кокос'],
  [/^льн[а-я]*$/u, 'лен'],
  [/^спирт(?:ов[а-я]*)?$/u, 'спирт'],
  [/^гарамиц(?:ин(?:а|ом|у|е)?)?$/u, 'гарамицин'],
  [/^пантенол[а-я]*$/u, 'пантенол'],
  [/^трав(?:ян[а-я]*|ы)?$/u, 'трав'],
  [/^шиповник[а-я]*$/u, 'шиповник'],
  [/^мэн$/u, 'man'],
  [/^(?:вумэн|вумен|воман)$/u, 'woman'],
];
const MEDICINE_NOISE_TOKENS = new Set([
  'в',
  'во',
  'с',
  'сахар',
  'для',
  'и',
  'или',
  'df',
  'gm',
  'lik',
  'pcm',
  'со',
  'по',
  'вкусом',
  'приема',
  'внутрь',
  'перорального',
  'оральный',
  'назальный',
  'носовой',
  'ротовой',
  'наружного',
  'местного',
  'применения',
  'полоскания',
  'подкожного',
  'внутривенных',
  'жевательные',
  'жевательный',
  'шипучие',
  'шипучий',
  'педиатрический',
  'педиатрическая',
  'алюминиевые',
  'полиэтиленовые',
  'дозатором',
  'колпачком',
  'накожная',
  'накожный',
  'кожи',
  'полости',
  'рта',
  'за',
  'покрытые',
  'покрытая',
  'покрытый',
  'кишечнорастворимой',
  'кишечнорастворимые',
  'кишечнорастворимый',
  'порошок',
  'лиофилизат',
  'лиофилизированный',
  'приготовления',
  'инъекций',
  'инъекционного',
  'введения',
  'внутривенного',
  'внутримышечного',
  'внутр',
  'внут',
  'прим',
  'сус',
  'прем',
  'д',
  'введ',
  'р-ра',
  'инфузий',
  'раст',
  'р',
  'ра',
  'блистер',
  'блистеры',
  'блистере',
  'блистерах',
  'оболочка',
  'оболочке',
  'оболочкой',
  'пленочн',
  'пленочная',
  'пленочные',
  'кожей',
  'упаковки',
  'контурные',
  'контурная',
  'ячейковые',
  'ячейковоя',
  'контейнеры',
  'полипропиленовые',
  'туба',
  'тубы',
  'бутылка',
  'банки',
  'бутылки',
  'стеклянные',
  'комплекте',
  'аппликатором',
  'апликатором',
  'аппликатор',
  'апликатор',
  'адаптером',
  'иглой',
  'модель',
  'пэт',
  'распылителем',
  'мерной',
  'стаканчиком',
  'мерным',
  'ложкой',
  'приг',
  'саше',
  'пакетики',
  'стрип',
  'стрипы',
  'фл',
  'упаковка',
  'упаковке',
  'упаковок',
  'флак',
  'шт',
  'штук',
  'ухода',
  'под',
  'бакт',
  'набор',
  'основа',
  'основе',
  'коробка',
  'коробке',
  'коробки',
  'im',
  'iv',
]);
const MEDICINE_NOISE_PATTERNS = [
  /^флак\.?$/u,
  /^флакон(?:ы|а|е|ов|ам|ами|ах)?$/u,
  /^баллон(?:ы|а|е|у|ом|ов|ам|ами|ах)?$/u,
  /^капельниц(?:а|ы|е|у|ей|ам|ами|ах)?$/u,
  /^дозированн[а-я]*$/u,
  /^покрыт[а-я]*$/u,
  /^пленочн[а-я]*$/u,
  /^оболочк[а-я]*$/u,
  /^кишечнорастворим[а-я]*$/u,
  /^пролонгированн[а-я]*$/u,
  /^модифицированн[а-я]*$/u,
  /^высвобождени[а-я]*$/u,
  /^действи[а-я]*$/u,
  /^диспергируем[а-я]*$/u,
  /^дозирующ[а-я]*$/u,
  /^устройств[а-я]*$/u,
  /^шприц(?:[а-я]*)$/u,
  /^стерильн[а-я]*$/u,
  /^однократн[а-я]*$/u,
  /^внутримышечн[а-я]*$/u,
  /^внутрисуставн[а-я]*$/u,
  /^тверд[а-я]*$/u,
  /^гидрохлорид[а-я]*$/u,
  /^антибактериальн[а-я]*$/u,
  /^витамин(?:а|ы|у|ом|е|ов|ам|ами|ах)$/u,
  /^гомеопатич[а-я]*$/u,
  /^прорезыв[а-я]*$/u,
  /^молоч[а-я]*$/u,
  /^зуб[а-я]*$/u,
];

const MEDICINE_UNIT_TOKENS = new Set(MEDICINE_UNIT_NORMALIZERS.map(([, normalized]) => normalized));
const MEDICINE_FORM_TOKENS = new Set(MEDICINE_FORM_NORMALIZERS.map(([, normalized]) => normalized));
const MEDICINE_DESCRIPTOR_TOKENS = new Set(
  MEDICINE_DESCRIPTOR_NORMALIZERS.map(([, normalized]) => normalized),
);
const MEDICINE_NORMALIZERS = [
  ...MEDICINE_UNIT_NORMALIZERS,
  ...MEDICINE_FORM_NORMALIZERS,
  ...MEDICINE_DESCRIPTOR_NORMALIZERS,
  ...MEDICINE_TOKEN_NORMALIZERS,
];

function normalizePackValue(value) {
  return !value || value === '1' ? null : value;
}

function normalizeMedicineSearchText(name) {
  return normalizeLatinHomoglyphs(normalizeMedicineLanguage(name))
    .replace(/(\d)[.,](\d)/gu, `$1${MEDICINE_DECIMAL_MARKER}$2`)
    .replace(/(\d)\s*(%)/gu, '$1 $2')
    .replace(/(%)(\d)/gu, '$1 $2')
    .replace(/№/gu, ' n ')
    .replace(/(\p{L})(\d)/gu, '$1 $2')
    .replace(/(\d)(\p{L})/gu, '$1 $2')
    .replace(/[.,;:!?()[\]{}"'`«»\\/|+=*_-]+/g, ' ')
    .replace(new RegExp(MEDICINE_DECIMAL_MARKER, 'gu'), '.')
    .replace(/(\d)\s*[xх×]\s*(\d)/gu, '$1x$2')
    .replace(/\b[nн]\s*(\d+)/gu, ' n$1 ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeMedicineIngredientAdjective(token) {
  const match = String(token || '').match(
    /^([a-zа-я-]+?)инов(?:ая|ый|ое|ые|ого|ому|ым|ом|ую|ой|ых|ыми)?$/u,
  );
  if (!match) return '';

  return `${match[1]}ин`;
}

function normalizeMedicineToken(token) {
  const cleaned = normalizeSqlTerm(token);
  if (!cleaned) return '';

  if (/^\d+[.,]\d+$/u.test(cleaned)) {
    return cleaned.replace(',', '.');
  }

  if (/^\d+x\d+$/u.test(cleaned) || /^n\d+$/u.test(cleaned) || /^\d+(?:\.\d+)?$/u.test(cleaned)) {
    return cleaned;
  }

  for (const [pattern, normalized] of MEDICINE_NORMALIZERS) {
    if (pattern.test(cleaned)) return normalized;
  }

  const normalizedIngredientAdjective = normalizeMedicineIngredientAdjective(cleaned);
  if (normalizedIngredientAdjective) return normalizedIngredientAdjective;

  if (MEDICINE_NOISE_PATTERNS.some((pattern) => pattern.test(cleaned))) return '';
  if (MEDICINE_NOISE_TOKENS.has(cleaned)) return '';
  return cleaned;
}

function tokenizeMedicineName(name) {
  const normalized = normalizeMedicineSearchText(name);
  if (!normalized) return [];

  return normalized.split(' ').map(normalizeMedicineToken).filter(Boolean);
}

function normalizeMedicineName(name) {
  return [...new Set(tokenizeMedicineName(name))].sort().join(' ');
}

function hasEquivalentMedicineToken(token, tokenSet) {
  if (!/^[a-z][a-z0-9-]*$/u.test(token)) return false;

  return buildQueryVariants(token).some(
    (variant) => variant !== token && tokenSet.has(normalizeMedicineToken(variant)),
  );
}

function dedupeEquivalentBrandTokens(tokens) {
  const uniqueTokens = [...new Set(tokens)];
  const tokenSet = new Set(uniqueTokens);
  return uniqueTokens.filter((token) => !hasEquivalentMedicineToken(token, tokenSet));
}

function extractMedicineDosageForms(rawName, profileForm = null) {
  const dosageForms = new Set();
  const parsedDosageForm = parseDosageForm(rawName);
  if (parsedDosageForm) dosageForms.add(parsedDosageForm);

  const mappedDosageForms = MEDICINE_FORM_TO_DOSAGE_FORMS.get(profileForm);
  if (mappedDosageForms) {
    for (const dosageForm of mappedDosageForms) {
      dosageForms.add(dosageForm);
    }
  }

  return [...dosageForms];
}

function hasJoinedMedicineTokenSequence(normalizedName, left, right) {
  if (!left || !right) return false;

  return (
    normalizedName.includes(`${left}${right}`) ||
    normalizedName.includes(`${left}-${right}`)
  );
}

function extractPrefixedMedicineNumericToken(normalizedName, value) {
  if (!value) return '';

  const match = normalizedName.match(
    new RegExp(`(^|[^\\p{L}\\p{N}])([a-zа-я])${value}(?=$|[^\\p{L}\\p{N}])`, 'u'),
  );
  return match ? `${match[2]}${value}` : '';
}

function extractMedicineProfile(name) {
  const tokens = tokenizeMedicineName(name);
  const normalizedName = normalizeSqlTerm(name);
  const canonicalTokens = [
    ...new Set(tokens.filter((token) => !/^n\d+$/u.test(token) && !/^\d+x\d+$/u.test(token))),
  ].sort();
  const brandTokens = [];
  const strengthTokens = new Set();
  const pairedStrengthNumbers = new Set();
  const standaloneStrengthNumberGroups = [];
  let pendingStandaloneStrengthNumbers = [];
  let form = null;
  let formPriority = -1;
  let pack = null;
  let packSize = null;

  const flushStandaloneStrengthNumbers = () => {
    if (pendingStandaloneStrengthNumbers.length) {
      standaloneStrengthNumberGroups.push(pendingStandaloneStrengthNumbers);
      pendingStandaloneStrengthNumbers = [];
    }
  };

  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    const previous = tokens[i - 1];
    const next = tokens[i + 1];
    const previousBrandToken = brandTokens[brandTokens.length - 1];
    const nextEndsBrandPhrase =
      !next ||
      MEDICINE_FORM_TOKENS.has(next) ||
      MEDICINE_DESCRIPTOR_TOKENS.has(next) ||
      /^n\d+$/u.test(next) ||
      /^\d+x\d+$/u.test(next);

    if (
      token === 'д' &&
      /^\d+(?:\.\d+)?$/u.test(next || '') &&
      (previous === 'витамин' || previous === 'детрисин' || previous === undefined)
    ) {
      flushStandaloneStrengthNumbers();
      continue;
    }

    const nPackMatch = token.match(/^n(\d+)$/u);
    if (nPackMatch) {
      flushStandaloneStrengthNumbers();
      const normalizedPack = nPackMatch[1];
      const parsedPack = Number.parseInt(normalizedPack, 10);
      if (Number.isFinite(parsedPack) && parsedPack > 0) {
        packSize = parsedPack;
      }
      pack = normalizePackValue(normalizedPack);
      continue;
    }

    const mulPackMatch = token.match(/^(\d+)x(\d+)$/u);
    if (mulPackMatch) {
      flushStandaloneStrengthNumbers();
      const left = Number.parseInt(mulPackMatch[1], 10);
      const right = Number.parseInt(mulPackMatch[2], 10);
      if (Number.isFinite(left) && Number.isFinite(right) && left > 0 && right > 0) {
        const multipliedPack = left * right;
        if (!packSize) {
          packSize = multipliedPack;
        }
        if (!pack) {
          pack = normalizePackValue(String(multipliedPack));
        }
      }
      continue;
    }

    if (MEDICINE_FORM_TOKENS.has(token)) {
      flushStandaloneStrengthNumbers();
      const priority = MEDICINE_FORM_PRIORITIES.get(token) || 0;
      if (!form || priority >= formPriority) {
        form = token;
        formPriority = priority;
      }
      continue;
    }

    if (MEDICINE_DESCRIPTOR_TOKENS.has(token)) {
      flushStandaloneStrengthNumbers();
      continue;
    }

    if (MEDICINE_UNIT_TOKENS.has(token)) {
      flushStandaloneStrengthNumbers();
      if (previous && /^\d+(?:\.\d+)?$/u.test(previous)) {
        strengthTokens.add(`${previous} ${token}`);
        pairedStrengthNumbers.add(previous);
      }
      continue;
    }

    if (/^\d+(?:\.\d+)?$/u.test(token)) {
      const joinedWithPrevious =
        previous &&
        hasJoinedMedicineTokenSequence(normalizedName, previous, token) &&
        previous !== 'д' &&
        !MEDICINE_UNIT_TOKENS.has(previous) &&
        !MEDICINE_FORM_TOKENS.has(previous) &&
        !MEDICINE_DESCRIPTOR_TOKENS.has(previous);
      const prefixedNumericToken = extractPrefixedMedicineNumericToken(normalizedName, token);
      const prefixedNumericIsVitaminCode =
        prefixedNumericToken && normalizedName.includes(`${prefixedNumericToken} витамин`);

      if (previous === 'д' && previousBrandToken === 'д') {
        brandTokens.pop();
        brandTokens.push(`д${token}`);
        continue;
      }

      if (
        prefixedNumericToken &&
        !prefixedNumericIsVitaminCode &&
        !brandTokens.includes(prefixedNumericToken)
      ) {
        brandTokens.push(prefixedNumericToken);
        continue;
      }

      if (
        joinedWithPrevious &&
        previousBrandToken === previous &&
        (/^[a-z]{1,6}$/u.test(previous) || previous.length <= 2)
      ) {
        brandTokens.pop();
        brandTokens.push(`${previous}${token}`);
        continue;
      }

      if (
        joinedWithPrevious &&
        previous !== 'д' &&
        brandTokens.length &&
        nextEndsBrandPhrase
      ) {
        brandTokens.push(token);
        continue;
      }

      if (joinedWithPrevious) {
        continue;
      }

      if (!next || !MEDICINE_UNIT_TOKENS.has(next)) {
        pendingStandaloneStrengthNumbers.push(token);
      }
      continue;
    }

    flushStandaloneStrengthNumbers();
    brandTokens.push(token);
  }

  flushStandaloneStrengthNumbers();

  for (const group of standaloneStrengthNumberGroups) {
    if (group.some((token) => /^0\d*$/u.test(token))) continue;

    for (const numberToken of group) {
      if (!pairedStrengthNumbers.has(numberToken)) {
        strengthTokens.add(numberToken);
      }
    }
  }

  const sortedBrandTokens = dedupeEquivalentBrandTokens(brandTokens).sort();
  const sortedStrengthTokens = [...strengthTokens].sort();
  const dosageForms = extractMedicineDosageForms(name, form);
  const signature = [
    sortedBrandTokens.join(' '),
    sortedStrengthTokens.join(','),
    form || '',
    pack || '',
  ].join('|');

  return {
    tokens,
    canonicalTokens,
    brandTokens: sortedBrandTokens,
    strengthTokens: sortedStrengthTokens,
    form,
    pack,
    packSize,
    dosageForms,
    signature,
  };
}

module.exports = {
  MEDICINE_DESCRIPTOR_TOKENS,
  MEDICINE_FORM_TOKENS,
  MEDICINE_UNIT_TOKENS,
  extractMedicineProfile,
  normalizeMedicineName,
  normalizeMedicineSearchText,
  normalizeMedicineToken,
  tokenizeMedicineName,
};
