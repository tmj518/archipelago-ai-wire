/**
 * What counts as a figure worth building an article from.
 *
 * ## Why this exists
 *
 * The old rule was "five figures", and any five records satisfied it - including a publication date
 * (`value: "24 September 2026"`) and a document number (`value: "C/2026/6637"`). Those are real records and they
 * are not data: an article whose five "figures" are three dates and two case numbers has nothing to convert into a
 * cost, and the gate waved it through.
 *
 * The operator lowered the count to two on 2026-10-17 because five was stopping runs on days when the documents
 * genuinely held only three or four usable numbers - and asked, in the same breath, that dates and document
 * numbers stop counting. Those two changes only work together: lowering the number while still counting dates
 * would make the gate weaker, and keeping the number while excluding dates would make it stricter than intended.
 *
 * ## The test
 *
 * A substantive figure has a numeric value and a unit that names something a buyer pays:
 *
 *   a percentage, a rate, a duty, a tariff
 *   an amount in a currency
 *   a quantity, a weight, a volume
 *   a duration that carries a cost - days of delay, months of retroactivity
 *
 * A date, a document number, an article number or a bare identifier has a non-numeric value, so it fails on the
 * first clause. That is the whole filter, and it is deliberately blunt: `value: "24 September 2026"` does not parse
 * as a number, and neither does `C/2026/6637`.
 */
import { MIN_SUBSTANTIVE } from "./figure-limits.mjs";

/** Units that name something with a commercial consequence. */
const SUBSTANTIVE_UNIT = new RegExp(
  [
    "percent",
    "%",
    "\\brate\\b",
    "\\bduty\\b",
    "\\btariff\\b",
    "\\bcharge\\b",
    "\\bfee\\b",
    "\\bcost\\b",
    "\\bprice\\b",
    "\\bvalue\\b",
    "\\bamount\\b",
    "\\bmargin\\b",
    "\\bthreshold\\b",
    "\\bUSD\\b",
    "\\bEUR\\b",
    "\\bRMB\\b",
    "\\bCNY\\b",
    "\\bdollars?\\b",
    "\\beuros?\\b",
    "\\byuan\\b",
    "\\btonnes?\\b",
    "\\btons?\\b",
    "\\bkg\\b",
    "\\bkilograms?\\b",
    "\\bunits?\\b",
    "\\bcontainers?\\b",
    "\\bshipments?\\b",
    "\\bTEU\\b",
    "\\bvolume\\b",
    "\\bquantity\\b",
    "\\bdays?\\b",
    "\\bweeks?\\b",
    "\\bmonths?\\b",
  ].join("|"),
  "i",
);

/** A value parses as a number after stripping the separators a figure tends to carry. */
export function numericValue(value) {
  const raw = String(value ?? "")
    .replace(/[,%\s$€¥]/g, "")
    .replace(/^\+/, "");
  if (!/^\d+(?:\.\d+)?$/.test(raw)) return null;
  return Number(raw);
}

/**
 * Is this record a figure an article can be built on?
 *
 * Both halves are required: a number, and a unit that names a cost. A record with a number and a unit of
 * "September 2026" is a date that happens to be written as digits, and one with "percent" and a value of
 * "C/2026/6637" is a document number that happens to mention a percentage elsewhere.
 */
export function isSubstantive(fig) {
  if (numericValue(fig?.value) === null) return false;
  return SUBSTANTIVE_UNIT.test(String(fig?.unit ?? ""));
}

/** The records that count, in order. */
export function substantiveFigures(figures) {
  return (Array.isArray(figures) ? figures : []).filter(isSubstantive);
}

/**
 * Why a set of records does not clear the bar, in words a writer can act on.
 *
 * Returns null when it does clear it.
 */
export function figuresShortfall(figures) {
  const all = Array.isArray(figures) ? figures : [];
  const good = substantiveFigures(all);
  if (good.length >= MIN_SUBSTANTIVE) return null;
  const rejected = all.filter((f) => !isSubstantive(f));
  const reasons = rejected.slice(0, 3).map((f) => {
    const numeric = numericValue(f?.value) !== null;
    return numeric
      ? `"${String(f.value).slice(0, 20)}" has a number but its unit is not a cost (${String(f.unit ?? "").slice(0, 40)})`
      : `"${String(f.value ?? "").slice(0, 28)}" is not a number - a date, a document number or an identifier`;
  });
  return {
    have: good.length,
    need: MIN_SUBSTANTIVE,
    total: all.length,
    detail:
      `only ${good.length} substantive figure(s), ${MIN_SUBSTANTIVE} required` +
      (reasons.length ? ` — ${reasons.join("; ")}` : ""),
  };
}
