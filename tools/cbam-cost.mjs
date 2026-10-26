#!/usr/bin/env node
/**
 * CBAM certificate cost per tonne of imported iron/steel or aluminium.
 *
 * Spec v1.3 §7: an article's cost arithmetic comes from a model, not from
 * prose. Every published article that quotes a per-tonne CBAM figure quotes
 * this model's output.
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
 *
 * Usage
 *   node tools/cbam-cost.mjs                      # China, both published prices
 *   node tools/cbam-cost.mjs --cn=7208 --mass=1000
 *   node tools/cbam-cost.mjs --json
 */

// ------------------------------------------------------- model and tables
// The model, the Annex I default values, the benchmarks, the phase-in factors and
// the published certificate prices all live in src/lib/cbam.mjs, because the
// calculator page runs the same model in a browser. Two copies would let a
// published per-tonne figure and the page disagree.
//
// Imported AND re-exported, not re-exported alone: `export ... from` creates no
// local binding, and the CLI below reads PRICES and ASSUMED_PRICE_NOTE directly.
import {
  PHASE_IN,
  MARKUP,
  PRICES,
  ASSUMED_PRICE_NOTE,
  CHINA_DEFAULTS,
  CHINA_BENCHMARKS,
  perTonne,
  table,
  trajectory,
} from "../src/lib/cbam.mjs";

export {
  PHASE_IN,
  MARKUP,
  PRICES,
  ASSUMED_PRICE_NOTE,
  CHINA_DEFAULTS,
  CHINA_BENCHMARKS,
  perTonne,
  table,
  trajectory,
};

// ---------------------------------------------------------------------- CLI

function main(argv) {
  const arg = (name) =>
    argv.find((a) => a.startsWith(`--${name}=`))?.split("=").slice(1).join("=");
  const json = argv.includes("--json");
  const cn = arg("cn");
  const mass = arg("mass") ? Number(arg("mass")) : null;
  const priceArg = arg("price") ? Number(arg("price")) : null;

  if (cn) {
    const prices = priceArg ? { "as supplied": { price: priceArg } } : PRICES;
    const out = Object.entries(prices).map(([label, p]) => ({
      quarter: label,
      ...perTonne({ cn, price: p.price }),
    }));
    console.log(json ? JSON.stringify(out, null, 2) : renderOne(out, mass));
    return 0;
  }

  const rows = Object.entries(PRICES).map(([quarter, p]) => ({
    quarter,
    rows: table(p.price),
  }));
  console.log(json ? JSON.stringify(rows, null, 2) : renderAll(rows));
  return 0;
}

function renderOne(out, mass) {
  const lines = [];
  for (const r of out) {
    lines.push(
      ``,
      `CN ${r.cn} — ${r.description}`,
      `  default value (corrected Annex I)      ${r.defaultValue} tCO2eq/t`,
      `  x (1 + ${r.markupPct}% mark-up, ${r.year})            ${r.embedded} tCO2eq/t`,
      `  benchmark BMg (Column B, route)        ${r.benchmark} tCO2e/t`,
      `  x CBAM factor ${r.cbamFactorPct}% x CSCF ${r.cscf}        SEFA ${r.sefa} tCO2e/t`,
      `  chargeable emissions                   ${r.chargeable} tCO2eq/t`,
      `  x ${r.price} EUR/tCO2e (${r.quarter})          EUR ${r.eurPerTonne} per tonne`,
      `  free-allocation adjustment removes     ${r.faaShareOfBillPct}% of the bill`,
    );
    if (mass) {
      lines.push(
        `  x ${mass} tonnes                          EUR ${(r.eurPerTonne * mass).toLocaleString("en-US", { maximumFractionDigits: 0 })}`,
      );
    }
  }
  return lines.join("\n");
}

function renderAll(groups) {
  const key = Object.keys(CHINA_DEFAULTS);
  const head = [
    "CN".padEnd(12),
    "DV".padStart(6),
    "x1.10".padStart(7),
    "BMg".padStart(6),
    "SEFA".padStart(8),
    "tCO2e/t".padStart(8),
    ...groups.map((g) => g.quarter.padStart(12)),
  ].join(" ");
  const body = key.map((cn) => {
    const cells = groups.map((g) => {
      const r = g.rows.find((x) => x.cn === cn);
      return String(r.eurPerTonne).padStart(12);
    });
    const r0 = groups[0].rows.find((x) => x.cn === cn);
    return [
      cn.padEnd(12),
      String(r0.defaultValue).padStart(6),
      String(r0.embedded).padStart(7),
      String(r0.benchmark).padStart(6),
      String(r0.sefa).padStart(8),
      String(r0.chargeable).padStart(8),
      ...cells,
    ].join(" ");
  });
  return [
    "",
    "China, 2026, EUR per tonne of good. Prices as published by DG TAXUD.",
    `Source: Reg (EU) 2026/1740 Annex I; Reg (EU) 2025/2620 Annex point 5; Guidance Document No. 4 Table 2-1.`,
    "",
    head,
    "-".repeat(head.length),
    ...body,
    "",
    `Note: ${ASSUMED_PRICE_NOTE} is used only where a quarter is named in a forward illustration.`,
    "",
  ].join("\n");
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("cbam-cost.mjs")) {
  process.exit(main(process.argv.slice(2)));
}
