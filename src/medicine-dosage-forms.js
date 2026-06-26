const UNICODE_NON_WORD = '[^\\p{L}\\p{N}]';

function wholeToken(pattern, flags = 'iu') {
  return new RegExp(`(^|${UNICODE_NON_WORD})${pattern}(?=$|${UNICODE_NON_WORD})`, flags);
}

const MEDICINE_DOSAGE_FORMS = [
  {
    form: 'tablet',
    parsePatterns: [
      wholeToken('таб\\.?'),
      wholeToken('табл\\.?'),
      /таблетк/iu,
      wholeToken('таблет\\.?'),
      wholeToken('драж\\.?'),
      wholeToken('драже'),
      /\btabs?\b/iu,
      /\btablets?\b/iu,
    ],
    profile: {
      token: 'таб',
      priority: 5,
      tokenPatterns: [/^(таб|таб\.|табл\.?|таблетк[а-я]*|tabs?|tablets?)$/u],
    },
  },
  {
    form: 'capsule',
    parsePatterns: [
      wholeToken('капс\\.?'),
      /капсул/iu,
      /\bcaps?\b/iu,
      /\bcapsules?\b/iu,
      /софтгель/iu,
      /софтгел/iu,
      /\bsoftgel[s]?\b/iu,
      /\bsoft-gel[s]?\b/iu,
      /\bvegcaps?\b/iu,
      /\bveg-caps?\b/iu,
    ],
    profile: {
      token: 'капс',
      priority: 5,
      tokenPatterns: [
        /^(капс|капс\.|капсул[а-я]*|caps?|capsules?|софтгел[а-я]*|softgel[s]?|soft-gel[s]?|vegcaps?)$/u,
      ],
    },
  },
  {
    form: 'syrup',
    parsePatterns: [/сироп/iu, wholeToken('сир\\.?')],
    profile: {
      token: 'сироп',
      priority: 4,
      tokenPatterns: [/^(сироп|syrup)$/u],
    },
  },
  {
    form: 'infusion',
    parsePatterns: [
      /р\s*-\s*р\.?\s*д\s*\/\s*инф\.?/iu,
      /р\s*-\s*р\.?\s*для\s*\/\s*инф\.?/iu,
      /инфуз(?!иол)/iu,
      /д\/инф/iu,
      wholeToken('инф\\.?'),
    ],
    profile: {
      token: 'инф',
      priority: 3,
      tokenPatterns: [/^(инф\.?|инфуз(?!иол)[а-я]*)$/u],
    },
  },
  {
    form: 'injection',
    parsePatterns: [
      /р\s*-\s*р\.?\s*д\s*\/\s*и\.?/iu,
      /р\s*-\s*р\.?\s*д\s*\/\s*ин\.?/iu,
      /р\s*-\s*р\.?\s*д\s*\/\s*в\.?\s*в\.?/iu,
      /р\s*-\s*р\.?\s*д\s*\/\s*п\s*\/\s*к\.?\s*ин\.?/iu,
      wholeToken('амп\\.?'),
      /инъекц/iu,
      /шприц/iu,
      /карт(?:\.|ридж)/iu,
      /ампул/iu,
      /ин-екц/iu,
      /д\/ин[ъь]?екц/iu,
      /д\/ин\./iu,
      /д\/в\.?в\.?\s*введ/iu,
      /д\s*\/\s*внут\.?\s*введ/iu,
    ],
    profile: {
      token: 'амп',
      priority: 6,
      tokenPatterns: [/^(амп|амп\.|ампул[а-я]*|ampoules?)$/u],
    },
  },
  {
    form: 'solution',
    parsePatterns: [
      wholeToken('р-р'),
      /раствор/iu,
      wholeToken('конц\\.?'),
      /концентрат/iu,
      /р\s*-\s*р\.?\s*д\s*\/\s*внутр(?:ь|\.(?!\s*введ)|$)/iu,
      /р\s*-\s*р\.?\s*д\s*\/\s*пр\.?\s*внутр(?:ь|\.?)/iu,
      /р\s*-\s*р\.?\s*орал\.?/iu,
      wholeToken('фл\\.?'),
      wholeToken('флак\\.?'),
      /флакон/iu,
      wholeToken('р-ор'),
      /пит\.\s*р-р/iu,
    ],
    profile: {
      token: 'раствор',
      priority: 1,
      tokenPatterns: [
        /^(раствор[а-я]*|solution)$/u,
        /^(фл\.?|флак\.?|флакон[а-я]*)$/u,
        /^(конц\.?|концентрат[а-я]*)$/u,
      ],
    },
  },
  {
    form: 'suspension',
    parsePatterns: [wholeToken('сус\\.?'), wholeToken('сусп\\.?'), /суспензи/iu, wholeToken('суспенз\\.?')],
    profile: {
      token: 'сусп',
      priority: 4,
      tokenPatterns: [/^(сус\.?|сусп\.?|суспенз[а-я]*|suspension)$/u],
    },
  },
  {
    form: 'drops',
    parsePatterns: [
      /капли(?:\s+глаз\.?)?/iu,
      /гл\.?\s*капли/iu,
      /кали\.?\s*глаз/iu,
      /офтальмолог(?:ическ(?:ий|ая|ое|ие)|\.?)?\s*(?:р\s*-\s*р\.?|раствор)/iu,
      wholeToken('капл\\.?'),
      wholeToken('к-ли'),
      /глазн\.?\s*капл/iu,
      /ушн\.?\s*капл/iu,
    ],
    profile: {
      token: 'капли',
      priority: 4,
      tokenPatterns: [/^(капл\.?|капля|капли|к-ли|drops?)$/u],
    },
  },
  {
    form: 'powder',
    parsePatterns: [
      wholeToken('пор\\.?'),
      /порошо/iu,
      wholeToken('порош\\.?'),
      /лиофилизат/iu,
      wholeToken('лиоф\\.?'),
      /лиоф\.?\s*пор/iu,
    ],
    profile: {
      token: 'пор',
      priority: 4,
      tokenPatterns: [/^(пор\.?|порош[а-я]*|powder)$/u],
    },
  },
  {
    form: 'granule',
    parsePatterns: [
      new RegExp(
        `(^|${UNICODE_NON_WORD})гранул(?:[ауые]|ой|ам[и]?|ах)?(?=$|${UNICODE_NON_WORD})`,
        'iu',
      ),
      wholeToken('гран\\.?'),
    ],
    profile: {
      token: 'гран',
      priority: 4,
      tokenPatterns: [/^гранул(?:[ауые]|ой|ам[и]?|ах)?$/u],
    },
  },
  {
    form: 'ointment',
    parsePatterns: [wholeToken('мазь'), wholeToken('маз\\.?'), /линимент/iu],
    profile: {
      token: 'мазь',
      priority: 3,
      tokenPatterns: [/^(мазь|ointment|линимент[а-я]*)$/u],
    },
  },
  {
    form: 'cream',
    parsePatterns: [wholeToken('крем'), wholeToken('кр\\.?')],
    profile: {
      token: 'крем',
      priority: 3,
      tokenPatterns: [/^(крем|cream)$/u],
    },
  },
  {
    form: 'gel',
    parsePatterns: [wholeToken('гель'), wholeToken('гел\\.?')],
    profile: {
      token: 'гель',
      priority: 3,
      tokenPatterns: [/^(гель|гел\.?|геля|гелю|гелем|геле|gel)$/u],
    },
  },
  {
    form: 'lotion',
    parsePatterns: [/лосьон/iu, wholeToken('лось\\.?')],
  },
  {
    form: 'aerosol',
    parsePatterns: [
      /аэр\.?\s*д\s*\/\s*инг\.?/iu,
      /аэрозол/iu,
      wholeToken('аэроз\\.?'),
      wholeToken('аэро\\.?'),
      wholeToken('аэр\\.?'),
      wholeToken('пена'),
    ],
    profile: {
      token: 'аэрозоль',
      priority: 4,
      tokenPatterns: [/^(аэр|аэр\.|аэро|аэро\.|аэроз\.?|аэрозол[а-я]*|aerosol|пен[а-яё]{0,3})$/u],
    },
  },
  {
    form: 'inhaler',
    parsePatterns: [
      /ингалятор/iu,
      /турбухалер/iu,
      wholeToken('инг\\.?'),
      wholeToken('ингал\\.?'),
      /дискхалер/iu,
      /аэролайзер/iu,
      /небул[а-я]*/iu,
    ],
    profile: {
      token: 'инг',
      priority: 4,
      tokenPatterns: [/^(инг|ингал\.?|ингаляци[а-я]*|ингалятор[а-я]*|небул[а-я]*)$/u],
    },
  },
  {
    form: 'spray',
    parsePatterns: [
      /spray/iu,
      wholeToken('спрей'),
      wholeToken('спр\\.?'),
      /назальн\.?\s*спр/iu,
      /спрей\s*назал/iu,
    ],
    profile: {
      token: 'спрей',
      priority: 4,
      tokenPatterns: [/^(спрей|spray)$/u],
    },
  },
  {
    form: 'suppository',
    parsePatterns: [
      /супп\.?(?:\s*рект\.?)?/iu,
      /суппозитори/iu,
      /свеч/iu,
      wholeToken('супп\\.?'),
      /рект\.?\s*супп/iu,
      /ваг\/рект/iu,
    ],
    profile: {
      token: 'супп',
      priority: 5,
      tokenPatterns: [/^(супп|супп\.|суппозитори[а-я]*)$/u],
    },
  },
  { form: 'pessary', parsePatterns: [/пессари/iu, /ваг\.?\s*супп/iu, /вагинальн/iu] },
  { form: 'enema', parsePatterns: [/клизм/iu, /микроклизм/iu, /энема/iu] },
  {
    form: 'patch',
    parsePatterns: [
      /пластыр/iu,
      /(^|[^\p{L}\p{N}])пласт(?!\.?\s*бут)\.?(?=$|[^\p{L}\p{N}])/iu,
      /трансдерм/iu,
    ],
  },
  { form: 'paste', parsePatterns: [wholeToken('паст\\.?'), wholeToken('паста')] },
  {
    form: 'pastille',
    parsePatterns: [
      /пастилк[а-я]*/iu,
      /пастил[а-я]*/iu,
      /леденц/iu,
      /таб\.?\s*д\/рассас/iu,
      /таб\.?\s*д\/рас\./iu,
    ],
    profile: {
      token: 'паст',
      priority: 5,
      tokenPatterns: [/^(пастилк[а-я]*)$/u, /^(пастил[а-я]*)$/u],
    },
  },
  { form: 'lyophilisate', parsePatterns: [/лиоф\.?\s*д\/пр/iu, /лиоф\.\s*пор\.\s*д\/ин/iu] },
  {
    form: 'solution',
    parsePatterns: [wholeToken('жид\\.?'), /жидкост/iu],
    profile: {
      token: 'жид',
      priority: 1,
      tokenPatterns: [/^(жид\.?|жидкост[а-я]*)$/u],
    },
  },
  {
    form: 'mouthwash',
    parsePatterns: [/полоскат/iu, wholeToken('полос\\.?'), /mouthwash/iu],
    profile: {
      token: 'полос',
      priority: 4,
      tokenPatterns: [/^(полос\.?|полоскат[а-я]*)$/u],
    },
  },
];

const DOSAGE_FORM_PATTERNS = MEDICINE_DOSAGE_FORMS.map(({ form, parsePatterns }) => ({
  form,
  patterns: parsePatterns,
}));

const MEDICINE_FORM_NORMALIZERS = MEDICINE_DOSAGE_FORMS.flatMap(({ profile }) => {
  if (!profile) return [];
  return profile.tokenPatterns.map((pattern) => [pattern, profile.token]);
});

const MEDICINE_FORM_PRIORITIES = new Map(
  MEDICINE_DOSAGE_FORMS.filter(({ profile }) => profile?.token).map(({ profile }) => [
    profile.token,
    profile.priority || 0,
  ]),
);

const MEDICINE_FORM_TO_DOSAGE_FORMS = new Map(
  MEDICINE_DOSAGE_FORMS.filter(({ profile }) => profile?.token).map(({ form, profile }) => [
    profile.token,
    [form],
  ]),
);

function parseDosageForm(name) {
  if (!name) return null;
  for (const { form, patterns } of DOSAGE_FORM_PATTERNS) {
    for (const pattern of patterns) {
      if (pattern.test(name)) return form;
    }
  }
  return null;
}

module.exports = {
  MEDICINE_FORM_NORMALIZERS,
  MEDICINE_FORM_PRIORITIES,
  MEDICINE_FORM_TO_DOSAGE_FORMS,
  parseDosageForm,
};
