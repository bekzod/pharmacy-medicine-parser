# Pharmacy Medicine Parsing

This context turns noisy pharmacy catalog text into medicine attributes and lookup intent while preserving the commercial identity needed for matching.

## Language

**Medicine Query**:
A raw pharmacy catalog or user string that may contain a trade name, dosage form, measurements, pack information, annotations, and vendor country.
_Avoid_: Search string, product text

**Medicine Language**:
The shared lexical conventions that canonicalize pharmacy abbreviations, routes, dosage-form phrases, measurement notation, and known source aliases.
_Avoid_: Fuzzy rules, parser rewrites

**Trade Identity**:
The normalized commercial-name tokens that remain after medicine attributes, annotations, and vendor country are removed from a Medicine Query.
_Avoid_: Residue, brand text

**Dosage Form**:
The canonical physical form in which the medicine is sold or administered.
_Avoid_: Form token, product shape

**Strength**:
The active amount or concentration represented by a medicine measurement.
_Avoid_: Dose, potency text

**Package Measurement**:
The physical amount or dose count contained in the sold package.
_Avoid_: Volume when the unit may be mass, length, or count

**Lookup Profile**:
A structured, trade-only, or brand-only interpretation of a Medicine Query used to build search intent.
_Avoid_: Search mode, query variant

## Relationships

- A **Medicine Query** produces exactly one **Trade Identity** and zero or more **Strength** and **Package Measurement** values.
- The **Medicine Language** canonicalizes a **Medicine Query** before its attributes are parsed.
- A **Medicine Query** may identify one **Dosage Form**.
- A **Lookup Profile** contains one interpretation of a **Medicine Query**.

## Example dialogue

> **Dev:** "Should `500 мг` remain in the **Trade Identity** for `Амоксициллин 500 мг таб №20`?"
> **Domain expert:** "No. It is the **Strength**; the **Trade Identity** is `амоксициллин`, while `таб` identifies the **Dosage Form**."

## Flagged ambiguities

- "volume" historically names every package measurement in the public envelope, including mass, length, and dose-count units; use **Package Measurement** in domain discussion while preserving the compatibility field name `volumes`.
