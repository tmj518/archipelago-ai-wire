/**
 * Price-drift budget model.
 *
 * The problem it solves: sourcing budgets are usually built on the implicit
 * assumption that Chinese factory prices drift flat or down, so the cheapest
 * order is the one placed later. When factory-gate prices turn positive, that
 * assumption runs the wrong way and the error is invisible until the quotes
 * arrive.
 *
 *   annual cost increase = annual spend x drift rate x passthrough
 *
 * Drift rate and passthrough are inputs. Two drift figures are useful and they
 * answer different questions: the latest year-on-year reading describes the
 * current quarter, while the year-to-date average describes a full-year
 * budget. Using the spike to budget a whole year overstates it.
 *
 * Run:  node tools/price-drift.mjs
 */

/**
 * @param {{ annualSpend: number, driftRate: number, passthrough?: number, months?: number }} s
 */
export function priceDrift(s) {
  const { annualSpend, driftRate, passthrough = 1, months = 12 } = s;
  const periodDrift = driftRate * (months / 12) * passthrough;
  const increase = annualSpend * periodDrift;
  const newSpend = annualSpend + increase;
  return { periodDrift, increase, newSpend, monthlyIncrease: increase / months };
}

const money = (n) => "$" + n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
const pct = (n) => (n * 100).toFixed(1) + "%";

/** Published PPI figures for August 2026, National Bureau of Statistics. */
const DRIFT = {
  augustYearOnYear: 0.038,
  janToAugAverage: 0.02,
  oilExtractionMoM: 0.104,
  electronicCircuitsMoM: 0.035,
};

const SPEND = 500000;

const CASES = [
  { label: `Full year budgeted on the year-to-date average (${pct(DRIFT.janToAugAverage)})`, driftRate: DRIFT.janToAugAverage },
  { label: `Full year budgeted on the August reading (${pct(DRIFT.augustYearOnYear)})`, driftRate: DRIFT.augustYearOnYear },
  { label: `Half the drift absorbed by the supplier (${pct(DRIFT.janToAugAverage)} at 50% passthrough)`, driftRate: DRIFT.janToAugAverage, passthrough: 0.5 },
  { label: "One quarter, year-to-date average", driftRate: DRIFT.janToAugAverage, months: 3 },
];

if (process.argv[1]?.endsWith("price-drift.mjs")) {
  console.log(`Factory-gate price drift: what it does to a ${money(SPEND)} annual sourcing budget`);
  console.log("(drift rates are the published PPI figures for August 2026; spend and passthrough are inputs)\n");

  for (const c of CASES) {
    const r = priceDrift({ annualSpend: SPEND, ...c });
    console.log(c.label);
    console.log(`  Period drift applied ...... ${pct(r.periodDrift)}`);
    console.log(`  Added cost ................ ${money(r.increase)}`);
    console.log(`  Budget becomes ............ ${money(r.newSpend)}`);
    console.log("");
  }

  console.log("The spread inside one headline");
  const oil = priceDrift({ annualSpend: SPEND, driftRate: DRIFT.oilExtractionMoM, months: 12 });
  const circuits = priceDrift({ annualSpend: SPEND, driftRate: DRIFT.electronicCircuitsMoM, months: 12 });
  console.log(`  Oil extraction ran at ${pct(DRIFT.oilExtractionMoM)} month on month. If that pace held for a year on this spend: ${money(oil.increase)}.`);
  console.log(`  Electronic circuits ran at ${pct(DRIFT.electronicCircuitsMoM)}. Same treatment: ${money(circuits.increase)}.`);
  console.log(`  The headline was ${pct(DRIFT.augustYearOnYear)}. The category, not the headline, is what a buyer's quote follows.`);
  console.log("");
}
