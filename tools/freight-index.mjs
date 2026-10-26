/**
 * Freight-index adjustment model.
 *
 * The problem it solves: container contracts and surcharge formulas rarely
 * name a dollar rate. They name an index — CCFI, SCFI, SEAFI — and say the
 * freight element adjusts with it. That leaves two questions a buyer has to
 * answer, and both are arithmetic rather than opinion:
 *
 *   1. What does an index move of N% do to the freight line, per container
 *      and per unit?
 *   2. If the clause references a composite but the shipment moves on one
 *      lane, how far apart are the two answers?
 *
 * Index points are not rates. The conversion therefore needs a stated freight
 * cost as an input, and that input is the reader's — it is not a claim about
 * the market.
 *
 * Run:  node tools/freight-index.mjs
 */

/**
 * @param {{ baselineIndex: number, currentIndex: number, freightPerContainer: number, passthrough?: number, unitsPerContainer?: number }} s
 */
export function freightAdjustment(s) {
  const {
    baselineIndex,
    currentIndex,
    freightPerContainer,
    passthrough = 1,
    unitsPerContainer = 0,
  } = s;

  const indexChange = (currentIndex - baselineIndex) / baselineIndex;
  const appliedChange = indexChange * passthrough;
  const adjustmentPerContainer = freightPerContainer * appliedChange;
  const newFreightPerContainer = freightPerContainer + adjustmentPerContainer;

  return {
    indexChange,
    appliedChange,
    adjustmentPerContainer,
    newFreightPerContainer,
    adjustmentPerUnit: unitsPerContainer > 0 ? adjustmentPerContainer / unitsPerContainer : null,
  };
}

const money = (n) =>
  "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct = (n) => (n >= 0 ? "+" : "") + (n * 100).toFixed(2) + "%";

/**
 * Index readings are the official published values for the period
 * 2026-09-24 (baseline) to 2026-09-30 (current), from the Shanghai Shipping
 * Research Institute (in Preparation) index pages. Freight cost and container
 * fill are the reader's inputs.
 */
const READINGS = {
  ccfiComposite: { baselineIndex: 1917.68, currentIndex: 1923.93 },
  ccfiEurope: { baselineIndex: 2028.95, currentIndex: 1970.38 },
  ccfiSoutheastAsia: { baselineIndex: 1211.87, currentIndex: 1322.15 },
  scfiComposite: { baselineIndex: 3686.62, currentIndex: 3662.3 },
};

const CASES = [
  { label: "Europe lane, CCFI Europe Service", reading: READINGS.ccfiEurope, freight: 2400, units: 2000 },
  { label: "Southeast Asia lane, CCFI SE Asia Service", reading: READINGS.ccfiSoutheastAsia, freight: 900, units: 4000 },
  { label: "Same Europe shipment, but the clause points at the CCFI composite", reading: READINGS.ccfiComposite, freight: 2400, units: 2000 },
  { label: "Same SE Asia shipment, but the clause points at the SCFI composite", reading: READINGS.scfiComposite, freight: 900, units: 4000 },
];

if (process.argv[1]?.endsWith("freight-index.mjs")) {
  console.log("Container index move -> money on the freight line");
  console.log("(index readings are official published values for 2026-09-24 to 2026-09-30;");
  console.log(" freight cost per container and container fill are reader inputs)\n");

  for (const c of CASES) {
    const r = freightAdjustment({ ...c.reading, freightPerContainer: c.freight, unitsPerContainer: c.units });
    console.log(c.label);
    console.log(`  Index .................... ${c.reading.baselineIndex} -> ${c.reading.currentIndex}  (${pct(r.indexChange)})`);
    console.log(`  Freight per container .... ${money(c.freight)} -> ${money(r.newFreightPerContainer)}`);
    console.log(`  Adjustment per container . ${money(r.adjustmentPerContainer)}`);
    console.log(`  Adjustment per unit ...... ${money(r.adjustmentPerUnit)}  (at ${c.units.toLocaleString("en-US")} units)`);
    console.log("");
  }

  const lane = freightAdjustment({ ...READINGS.ccfiSoutheastAsia, freightPerContainer: 900, unitsPerContainer: 4000 });
  const composite = freightAdjustment({ ...READINGS.ccfiComposite, freightPerContainer: 900, unitsPerContainer: 4000 });
  const gap = lane.adjustmentPerContainer - composite.adjustmentPerContainer;
  console.log("The gap that matters");
  console.log(`  Lane measurement  (SE Asia CCFI) ... ${pct(lane.indexChange)}  -> ${money(lane.adjustmentPerContainer)} per container`);
  console.log(`  Composite measurement (CCFI all) ... ${pct(composite.indexChange)}  -> ${money(composite.adjustmentPerContainer)} per container`);
  console.log(`  Difference ........................ ${money(gap)} per container, ${(lane.indexChange - composite.indexChange) * 100 >= 0 ? "+" : ""}${((lane.indexChange - composite.indexChange) * 100).toFixed(2)} points`);
  console.log("");
}
