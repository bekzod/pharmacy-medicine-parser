class ParseState {
  constructor({ rawQuery, normalizedText, tokens }) {
    this.rawQuery = rawQuery || '';
    this.normalizedText = normalizedText || '';
    this.tokens = tokens || [];
    this.consumedIndexes = new Set();
    this.tokenRoles = new Map();
    this.strengthCandidates = [];
    this.volumeCandidates = [];
    this.dosageForm = null;
    this.dosageFormToken = null;
    this.dosageFormSource = null;
    this.containerType = null;
    this.packCount = null;
  }

  hasConsumed(index) {
    return this.consumedIndexes.has(index);
  }

  consume(index, role) {
    this.consumedIndexes.add(index);
    if (role != null) this.tokenRoles.set(index, role);
  }

  consumeRange(startIndex, endIndex, role) {
    for (let index = startIndex; index <= endIndex; index += 1) {
      this.consume(index, role);
    }
  }

  setRole(index, role) {
    this.tokenRoles.set(index, role);
  }

  clearRole(index) {
    this.tokenRoles.delete(index);
  }

  addStrength(node) {
    this.strengthCandidates.push(node);
  }

  replaceStrength(index, node) {
    this.strengthCandidates[index] = node;
  }

  removeStrength(index) {
    return this.strengthCandidates.splice(index, 1)[0] || null;
  }

  addVolume(node) {
    this.volumeCandidates.push(node);
  }

  removeVolume(index) {
    return this.volumeCandidates.splice(index, 1)[0] || null;
  }

  dropCandidates(kind, predicate) {
    const candidates = kind === 'strength' ? this.strengthCandidates : this.volumeCandidates;
    for (let index = candidates.length - 1; index >= 0; index -= 1) {
      const candidate = candidates[index];
      if (!predicate(candidate)) continue;
      for (
        let tokenIndex = candidate.startIndex;
        tokenIndex <= candidate.endIndex;
        tokenIndex += 1
      ) {
        this.clearRole(tokenIndex);
      }
      candidates.splice(index, 1);
    }
  }

  setPackCount(value, { onlyIfEmpty = false } = {}) {
    if (onlyIfEmpty && this.packCount != null) return;
    this.packCount = value;
  }

  setContainerType(value, { onlyIfEmpty = true } = {}) {
    if (onlyIfEmpty && this.containerType) return;
    this.containerType = value;
  }

  considerDosageFormToken(token, {
    shouldKeepCurrentDosageForm,
    shouldOverrideDosageFormForFinalForm,
  }) {
    const sourcePriority = token.dosageFormSource === 'explicit' ? 2 : 1;
    const currentSourcePriority =
      this.dosageFormSource === 'explicit'
        ? 2
        : this.dosageFormSource === 'inferred_from_container'
          ? 1
          : 0;
    const keepCurrentDosageForm = shouldKeepCurrentDosageForm({
      currentDosageForm: this.dosageForm,
      currentSource: this.dosageFormSource,
      nextDosageForm: token.dosageForm,
      nextSource: token.dosageFormSource,
    });

    const overrideForFinalForm = shouldOverrideDosageFormForFinalForm(
      this.dosageForm,
      token.dosageForm,
    );

    if (
      !keepCurrentDosageForm &&
      (overrideForFinalForm ||
        !this.dosageFormToken ||
        sourcePriority > currentSourcePriority ||
        (sourcePriority === currentSourcePriority &&
          token.priority >= this.dosageFormToken.priority))
    ) {
      this.dosageForm = token.dosageForm;
      this.dosageFormToken = token;
      this.dosageFormSource = token.dosageFormSource;
    }
  }

  annotatedTokens() {
    return this.tokens.map((token, index) => ({
      ...token,
      role: this.tokenRoles.get(index) || null,
    }));
  }
}

module.exports = { ParseState };
