/**
 * Duty-guarantee cost model.
 *
 * Why this exists: a missing origin certificate is usually described as a
 * paperwork problem. It is a working-capital problem, and it has a price.
 *
 * Under the arrangement this models, an importer who wants goods released
 * before China's customs can verify the electronic origin data must lodge a
 * duty guarantee. The guarantee is refunded once the data is confirmed — so
 * the real cost is the funding cost of that cash for however many days it is
 * tied up.
 *
 *   guarantee amount = dutiable value x duty rate
 *   cost of guarantee = guarantee amount x annual funding rate x days / 365
 *
 * Duty rate and funding rate are the reader's own inputs. Nothing here is a
 * claim about market rates.
 *
 * Run:  node tools/guarantee-cost.mjs
 */

/**
 * @param {{ dutiableValue: number, dutyRate: number, fundingRate: number, days: number }} s
 */
export function guaranteeCost(s) {
  const { dutiableValue, dutyRate, fundingRate, days } = s;
  const guarantee = dutiableValue * dutyRate;
  const cost = guarantee * fundingRate * (days / 365);

  return {
    guarantee,
    cost,
    costBpsOfValue: dutiableValue === 0 ? 0 : cost / dutiableValue,
  };
}

const money = (n) => "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const CASES = [
  { label: "40HQ of consumer goods", dutiableValue: 60000, dutyRate: 0.10, fundingRate: 0.12, days: 45 },
  { label: "LCL trial shipment", dutiableValue: 8000, dutyRate: 0.10, fundingRate: 0.12, days: 45 },
  { label: "Three containers, peak season", dutiableValue: 180000, dutyRate: 0.10, fundingRate: 0.12, days: 90 },
];

if (process.argv[1]?.endsWith("guarantee-cost.mjs")) {
  console.log("Cost of a duty guarantee while origin data is unresolved");
  console.log("(duty rate 10% and funding cost 12%/yr are illustrative inputs — substitute your own)\n");

  for (const c of CASES) {
    const r = guaranteeCost(c);
    console.log(c.label);
    console.log(`  Dutiable value ............ ${money(c.dutiableValue)}`);
    console.log(`  Duty rate ................. ${(c.dutyRate * 100).toFixed(1)}%`);
    console.log(`  Guarantee lodged .......... ${money(r.guarantee)}`);
    console.log(`  Days tied up .............. ${c.days}`);
    console.log(`  Funding cost .............. ${money(r.cost)}  (${(r.costBpsOfValue * 10000).toFixed(1)} bps of shipment value)`);
    console.log("");
  }
}
