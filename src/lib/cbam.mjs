/**
 * CBAM certificate cost per tonne of imported iron, steel or aluminium.
 *
 * Moved here from tools/cbam-cost.mjs so the same model can run in two places: the
 * command-line check the article pipeline uses, and the calculator page in the
 * browser. Two copies would let a published per-tonne figure and the page disagree.
 *
 * Plain ESM, no Node built-ins, so a page can inline it.
 *
 * The law it implements, in the order the law applies it:
 *
 *   1  embedded emissions  = country default value for the CN code and the
 *                            country of origin (corrected Annex I, Commission
 *                            Implementing Regulation (EU) 2026/1740, which
 *                            replaced Annex I to Reg (EU) 2025/2621 in its
 *                            entirety and applies from 1 January 2026)
 *                          x (1 + mark-up for the year)
 *                            Reg (EU) 2026/1740, Annex I chapeau: 10 % 2026,
 *                            20 % 2027, 30 % 2028 onwards, steel and aluminium
 *
 *   2  SEFA                = BMg x CBAM factor x CSCF
 *                            Reg (EU) 2025/2620, Annex point 2 and point 5
 *                            (benchmark, Column B for a default-value
 *                            declaration) and Guidance Document No. 4,
 *                            Table 2-1 (CBAM factor, CSCF)
 *
 *   3  chargeable tCO2e/t  = step 1 - step 2
 *
 *   4  EUR/t               = step 3 x CBAM certificate price for the quarter
 *                            of importation (2026), Reg (EU) 2023/956
 *                            Article 21(1a) as inserted by Reg (EU) 2025/2083
 *
 * Two properties of this model are the whole point of the article it feeds:
 *
 *   - The CBAM factor is the share of free allocation STILL IN PLACE, so it is
 *     the share of the benchmark that is DEDUCTED. 97.5 % in 2026 deducts
 *     97.5 % of the benchmark, it does not charge 2.5 % of the bill.
 *   - The factor multiplies the BENCHMARK, never the emissions. The two are
 *     an order of magnitude apart for Chinese material.
 *
 * Deliberately not modelled: the Article 9 deduction for a carbon price paid
 * in the country of origin. The implementing act under Article 9(5) has not
 * been adopted (DEHSt, last updated 28 July 2026), so the deduction is zero
 * for every origin in the 2026 declaration year.
 */

// ------------------------------------------------------------------ tables

/**
 * CBAM factor and CSCF by year. Guidance Document No. 4 (DG TAXUD,
 * 14 August 2026), Table 2-1. Guidance 4 is headed "not legally binding and of
 * an explanatory nature"; the 2026 CSCF is additionally marked "(preliminary)".
 * The definitional cross-reference is Annex point 4 of Reg (EU) 2025/2620.
 */
export const PHASE_IN = {
  2025: { factor: 1.0, cscf: 1.0 },
  2026: { factor: 0.975, cscf: 1.0 },
  2027: { factor: 0.95, cscf: 1.0 },
  2028: { factor: 0.9, cscf: 1.0 },
  2029: { factor: 0.775, cscf: 1.0 },
  2030: { factor: 0.515, cscf: 1.0 },
  2031: { factor: 0.39, cscf: 1.0 },
  2032: { factor: 0.265, cscf: 1.0 },
  2033: { factor: 0.14, cscf: 1.0 },
  2034: { factor: 0.0, cscf: 1.0 },
};

/** Mark-up on the default value, by year and sector. Annex I chapeau. */
export const MARKUP = {
  steel: { 2026: 0.1, 2027: 0.2, 2028: 0.3 },
  aluminium: { 2026: 0.1, 2027: 0.2, 2028: 0.3 },
  fertiliser: { 2026: 0.01, 2027: 0.01, 2028: 0.01 },
};

/**
 * Published CBAM certificate prices. Source: European Commission, DG TAXUD,
 * "Price of CBAM certificates", retrieved 3 October 2026. Q3 2026 is scheduled
 * for publication on 5 October 2026 and Q4 2026 for 4 January 2027; both were
 * still blank on the publication date of this model, so no Q3 or Q4 figure is
 * asserted anywhere.
 */
export const PRICES = {
  "Q1 2026": { price: 75.36, published: "2026-04-07" },
  "Q2 2026": { price: 75.28, published: "2026-07-06" },
};

export const ASSUMED_PRICE_NOTE =
  "assumed — held flat at the Q2 2026 published price to isolate the two legal escalators";

// --------------------------------------------------- China: Annex I defaults
// (corrected Annex I, Reg (EU) 2026/1740, China table; the 2026 mark-up is
// applied by the model, not read from a table column, because the corrected
// annex publishes bare totals and states the mark-up in the chapeau)

/** CN -> [description, default value total tCO2eq/t, mark-up sector] */
export const CHINA_DEFAULTS = {
  7208: ["Flat-rolled non-alloy steel, 600 mm or more, hot-rolled, in coils", 3.187, "steel"],
  "7207 11 11": ["Semi-finished non-alloy free-cutting steel", 3.169, "steel"],
  7209: ["Flat-rolled non-alloy steel, 600 mm or more, cold-rolled", 3.205, "steel"],
  7210: ["Flat-rolled non-alloy steel, 600 mm or more, clad, plated or coated", 3.205, "steel"],
  7213: ["Wire rod, hot-rolled, in irregularly wound coils", 3.169, "steel"],
  "7214 20 00": ["Bars and rods with indentations or ribs (rebar)", 3.169, "steel"],
  7216: ["Angles, shapes and sections of iron or non-alloy steel", 3.169, "steel"],
  "7225 11 00": ["Flat-rolled silicon-electrical steel, 600 mm or more, grain-oriented", 8.09, "steel"],
  "7304 11 00": ["Seamless line pipe for oil and gas, stainless", 7.005, "steel"],
  "7304 19": ["Seamless line pipe for oil and gas, other", 2.68, "steel"],
  7305: ["Other tubes and pipes, circular, external diameter over 406.4 mm", 2.5, "steel"],
  "7306 19 00": ["Other tubes and pipes, welded, circular", 2.5, "steel"],
  7308: ["Structures and parts of structures, of iron or steel", 3.169, "steel"],
  "7318 15": ["Screws, bolts, nuts and similar articles, of iron or steel", 3.169, "steel"],
  "7318 16": ["Screws, bolts, nuts and similar articles, of stainless steel", 4.5, "steel"],
  7601: ["Unwrought aluminium", 13.106, "aluminium"],
  7603: ["Aluminium powders and flakes", 13.106, "aluminium"],
  "7604 10 10": ["Aluminium bars, rods and profiles, of non-alloy aluminium", 13.1, "aluminium"],
  7605: ["Aluminium wire", 13.1, "aluminium"],
  7606: ["Aluminium plates, sheets and strip, thickness over 0.2 mm", 13.1, "aluminium"],
  7607: ["Aluminium foil, thickness not exceeding 0.2 mm", 13.1, "aluminium"],
  7608: ["Aluminium tubes and pipes", 13.1, "aluminium"],
  "7610 10 00": ["Aluminium structures, doors, windows and their frames", 13.1, "aluminium"],
};

/** CN -> benchmark BMg tCO2eq/t. Reg (EU) 2025/2620, Annex point 5. */
export const CHINA_BENCHMARKS = {
  "7207 11 11": 1.364,
  7208: 1.37,
  7209: 1.458,
  7210: 1.491,
  7213: 1.364,
  "7214 20 00": 1.364,
  7216: 1.364,
  "7225 11 00": 1.779,
  // No production route in Annex I: benchmarked on the year-dependent value
  // for 2026-27 (Reg (EU) 2025/2620, Annex point 5).
  "7304 11 00": 1.173,
  "7304 19": 1.364,
  7305: 1.458,
  "7306 19 00": 1.458,
  7308: 1.491,
  "7318 15": 1.364,
  "7318 16": 1.364,
  7601: 1.423,
  7603: 1.506,
  "7604 10 10": 1.485,
  7605: 1.485,
  7606: 1.485,
  7607: 1.599,
  7608: 1.493,
  "7610 10 00": 1.493,
};

// ------------------------------------------------------------------- maths

const round = (n, dp = 6) => Number(n.toFixed(dp));

/**
 * One tonne of a good, one year.
 * Returns every intermediate so an article can print the chain, not the answer.
 */
export function perTonne({ cn, year = 2026, price }) {
  const row = CHINA_DEFAULTS[cn];
  if (!row) throw new Error(`CN ${cn} is not in the model's default-value table`);
  const [description, dvTotal, sector] = row;
  const bmg = CHINA_BENCHMARKS[cn];
  if (bmg === undefined) throw new Error(`CN ${cn} has no benchmark in the model`);

  const phase = PHASE_IN[year];
  if (!phase) throw new Error(`no CBAM factor for ${year}`);

  const markup = MARKUP[sector][Math.min(year, 2028)] ?? MARKUP[sector][2028];
  const embedded = dvTotal * (1 + markup);
  const sefa = bmg * phase.factor * phase.cscf;
  const chargeable = embedded - sefa;

  return {
    cn,
    description,
    sector,
    year,
    defaultValue: dvTotal,
    markupPct: markup * 100,
    embedded: round(embedded, 4),
    benchmark: bmg,
    cbamFactorPct: phase.factor * 100,
    cscf: phase.cscf,
    sefa: round(sefa, 5),
    // Five decimals, not four: the article publishes 2.16995, and rounding to four
    // here silently changed a published figure when this model was first moved.
    chargeable: round(chargeable, 5),
    price,
    eurPerTonne: price ? round(chargeable * price, 2) : null,
    // The share of the bill the free-allocation adjustment removes. Derived, and
    // omitted from the first version of this file, which broke the CLI report.
    faaShareOfBillPct: round((sefa / embedded) * 100, 1),
  };
}

/** Every CN code in the table, at one price and year. */
export function table(price, year = 2026) {
  return Object.keys(CHINA_DEFAULTS).map((cn) => perTonne({ cn, year, price }));
}

/**
 * Year-on-year escalator illustration: mark-up up, CBAM factor down.
 *
 * Three years, matching the CLI's own trajectory, which is what the articles
 * print. PHASE_IN carries the full phase-in to 2034 and is left available for a
 * longer view, but this function is not the place to change what the articles
 * already show.
 */
export function trajectory(cn, price) {
  return [2026, 2027, 2028].map((y) => perTonne({ cn, year: y, price }));
}
