/**
 * Export-rebate passthrough model.
 *
 * The problem it solves: China's export VAT rebate is a domestic tax
 * instrument, but the buyer sees it as a price. When the rebate rate falls by
 * N percentage points, the exporter's net receipt on the same invoice falls by
 * roughly N% of the export value. How much of that reaches the buyer's quote
 * is a negotiation parameter, not a law of nature — so passthrough is an
 * explicit input here rather than an assumption buried in the arithmetic.
 *
 *   exporter loss per unit   = FOB x (rebate before - rebate after)
 *   buyer price increase     = exporter loss per unit x passthrough
 *
 * Nothing in this file is a claim about any exporter's actual costing. It is a
 * conversion from percentage points to money.
 *
 * Run:  node tools/rebate-passthrough.mjs
 */

/**
 * @param {{ fobUnit: number, units: number, rebateBefore: number, rebateAfter: number, passthrough?: number }} s
 *        rates as decimals, e.g. 0.09 for 9%
 */
export function rebatePassthrough(s) {
  const { fobUnit, units, rebateBefore, rebateAfter, passthrough = 1 } = s;
  const pointsLost = rebateBefore - rebateAfter;
  const exporterLossPerUnit = fobUnit * pointsLost;
  const priceIncreasePerUnit = exporterLossPerUnit * passthrough;
  const fobNew = fobUnit + priceIncreasePerUnit;

  return {
    pointsLost,
    exporterLossPerUnit,
    priceIncreasePerUnit,
    fobNew,
    priceIncreasePct: fobUnit === 0 ? 0 : priceIncreasePerUnit / fobUnit,
    exporterLossPerShipment: exporterLossPerUnit * units,
    buyerCostPerShipment: priceIncreasePerUnit * units,
  };
}

const money = (n) => "$" + n.toFixed(n < 10 ? 4 : 2);
const pct = (n) => (n * 100).toFixed(1) + "%";

/** Battery-cell example, decided entirely by the announced rate path. */
const FOB = 40.0;
const UNITS = 1000;

const CASES = [
  { label: "Step 1 — rebate cut 9% to 6%, from 1 April 2026", fobUnit: FOB, units: UNITS, rebateBefore: 0.09, rebateAfter: 0.06, passthrough: 1 },
  { label: "Step 2 — rebate abolished, from 1 January 2027", fobUnit: FOB, units: UNITS, rebateBefore: 0.06, rebateAfter: 0.0, passthrough: 1 },
  { label: "Both steps, full passthrough", fobUnit: FOB, units: UNITS, rebateBefore: 0.09, rebateAfter: 0.0, passthrough: 1 },
  { label: "Both steps, half passthrough (exporter absorbs the rest)", fobUnit: FOB, units: UNITS, rebateBefore: 0.09, rebateAfter: 0.0, passthrough: 0.5 },
];

if (process.argv[1]?.endsWith("rebate-passthrough.mjs")) {
  console.log("Export VAT rebate: from percentage points to money on the invoice");
  console.log(`(worked example: FOB ${money(FOB)} per unit, ${UNITS.toLocaleString("en-US")} units per shipment)\n`);

  for (const c of CASES) {
    const r = rebatePassthrough(c);
    console.log(c.label);
    console.log(`  Rebate points lost ....... ${(r.pointsLost * 100).toFixed(1)} points`);
    console.log(`  Exporter loss per unit ... ${money(r.exporterLossPerUnit)}`);
    console.log(`  FOB per unit ............. ${money(c.fobUnit)} -> ${money(r.fobNew)}  (+${pct(r.priceIncreasePct)})`);
    console.log(`  Exporter loss/shipment ... ${money(r.exporterLossPerShipment)}`);
    console.log(`  Buyer cost/shipment ...... ${money(r.buyerCostPerShipment)}`);
    console.log("");
  }
}
