/**
 * Landed-cost model — the single source of the arithmetic.
 *
 * Moved here from tools/landed-cost.mjs so the same model can run in two places:
 * as a command-line check used by the article pipeline, and in the browser on the
 * calculator page. Duplicating the maths instead would let the page and the
 * article pipeline drift, and a reader recomputing our published figure would get
 * a different answer from our own tool.
 *
 * Plain ESM, no dependencies, no Node built-ins, so it can be imported by an
 * Astro island or inlined into a page script.
 *
 * Model:
 *   duty per unit      = FOB x (MFN rate + Section 301 rate + other rate)
 *   landed cost / unit = FOB + duty per unit + freight per unit + insurance
 *
 * Everything is expressed per unit and per container, because that is the only
 * form a seller can act on.
 *
 * @typedef {object} Scenario
 * @property {number} fobUnit              free-on-board value per unit
 * @property {number} unitsPerContainer
 * @property {number} mfnRate              most-favoured-nation duty rate, as a decimal
 * @property {number} section301Rate       additional listed-tariff rate, as a decimal
 * @property {number} [otherDutyRate]      any further ad valorem duty, as a decimal
 * @property {number} [freightPerContainer]
 * @property {number} [insuranceRate]      as a decimal of FOB
 */

/**
 * @param {Scenario} s
 */
export function landedCost(s) {
  const {
    fobUnit,
    unitsPerContainer,
    mfnRate,
    section301Rate,
    otherDutyRate = 0,
    freightPerContainer = 0,
    insuranceRate = 0,
  } = s;

  const dutyRate = mfnRate + section301Rate + otherDutyRate;
  const dutyPerUnit = fobUnit * dutyRate;
  const freightPerUnit = unitsPerContainer > 0 ? freightPerContainer / unitsPerContainer : 0;
  const insurancePerUnit = fobUnit * insuranceRate;

  const landedPerUnit = fobUnit + dutyPerUnit + freightPerUnit + insurancePerUnit;

  return {
    dutyRate,
    dutyPerUnit,
    dutyPerContainer: dutyPerUnit * unitsPerContainer,
    freightPerUnit,
    landedPerUnit,
    landedPerContainer: landedPerUnit * unitsPerContainer,
    /** What the duty adds on top of the goods, as a share of FOB. */
    dutyShareOfFob: fobUnit > 0 ? dutyPerUnit / fobUnit : 0,
  };
}

/** Percentage delta of b against a, e.g. the effect of an exclusion expiring. */
export function delta(a, b) {
  return {
    dutyPerUnit: b.dutyPerUnit - a.dutyPerUnit,
    dutyPerContainer: b.dutyPerContainer - a.dutyPerContainer,
    landedPerUnit: b.landedPerUnit - a.landedPerUnit,
    landedPct: a.landedPerUnit === 0 ? 0 : (b.landedPerUnit - a.landedPerUnit) / a.landedPerUnit,
  };
}

export const money = (n) => "$" + n.toFixed(n < 10 ? 3 : 2);
export const pct = (n) => (n * 100).toFixed(1) + "%";
