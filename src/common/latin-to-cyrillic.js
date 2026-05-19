const LATIN_TO_CYRILLIC = {
  a: 'а',
  c: 'с',
  e: 'е',
  o: 'о',
  p: 'р',
  x: 'х',
  y: 'у',
  k: 'к',
  A: 'А',
  B: 'В',
  C: 'С',
  E: 'Е',
  H: 'Н',
  K: 'К',
  M: 'М',
  O: 'О',
  P: 'Р',
  T: 'Т',
  X: 'Х',
};

const LATIN_HOMOGLYPH_RE = /[aceopxykABCEHKMOPTX]/g;

module.exports = { LATIN_TO_CYRILLIC, LATIN_HOMOGLYPH_RE };
