/**
 * Landed-cost model — the command-line check.
 *
 * The arithmetic itself now lives in src/lib/models.mjs, because the calculator
 * page runs the same model in the browser. Two copies of the maths would let the
 * published figure and the page disagree, and a reader recomputing our number
 * would get a different answer from our own tool. Imported here rather than
 * duplicated.
 *
 * Run:  node tools/landed-cost.mjs
 */

import { landedCost, delta, money, pct } from "../src/lib/models.mjs";

export { landedCost, delta };

/**
 * Worked examples used in the Section 301 exclusion article.
 *
 * Sourcing discipline: the only externally-verifiable input here is the
 * Section 301 rate (25% on Lists 1-3, 7.5% on List 4A — see the article's
 * source list). FOB, units per container and MFN are the reader's own inputs,
 * so the examples set MFN to 0 and isolate the Section 301 impact. Nothing in
 * this block is presented as a fact about the market.
 */
const CASES = [
  {
    label: "DC motor, List 3 (25%)",
    excluded: { fobUnit: 12.0, unitsPerContainer: 5000, mfnRate: 0, section301Rate: 0 },
    cliff: { fobUnit: 12.0, unitsPerContainer: 5000, mfnRate: 0, section301Rate: 0.25 },
  },
  {
    label: "Insulated wire with connectors, List 3 (25%)",
    excluded: { fobUnit: 0.9, unitsPerContainer: 60000, mfnRate: 0, section301Rate: 0 },
    cliff: { fobUnit: 0.9, unitsPerContainer: 60000, mfnRate: 0, section301Rate: 0.25 },
  },
  {
    label: "LCD module, List 4A (7.5%)",
    excluded: { fobUnit: 48.0, unitsPerContainer: 900, mfnRate: 0, section301Rate: 0 },
    cliff: { fobUnit: 48.0, unitsPerContainer: 900, mfnRate: 0, section301Rate: 0.075 },
  },
];

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("landed-cost.mjs")) {
  console.log("Section 301 exclusion cliff — duty impact per unit and per container");
  console.log("(FOB and MFN assumptions are per case; freight excluded — see notes)\n");

  for (const c of CASES) {
    const a = landedCost(c.excluded);
    const b = landedCost(c.cliff);
    const d = delta(a, b);

    console.log(c.label);
    console.log(`  FOB per unit ............... ${money(c.excluded.fobUnit)}`);
    console.log(`  Units per 40HQ ............. ${c.excluded.unitsPerContainer.toLocaleString("en-US")}`);
    console.log(`  MFN rate ................... ${pct(c.excluded.mfnRate)}`);
    console.log(`  With exclusion: duty/unit .. ${money(a.dutyPerUnit)}   duty/container ${money(a.dutyPerContainer)}`);
    console.log(`  After cliff:    duty/unit .. ${money(b.dutyPerUnit)}   duty/container ${money(b.dutyPerContainer)}`);
    console.log(`  Increase:       duty/unit .. ${money(d.dutyPerUnit)}   duty/container ${money(d.dutyPerContainer)}`);
    console.log(`  Landed cost per unit ....... ${money(a.landedPerUnit)} -> ${money(b.landedPerUnit)}  (+${pct(d.landedPct)})`);
    console.log("");
  }
}
