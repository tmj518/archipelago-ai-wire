/**
 * Hold-cost model — what it costs while goods or listings are frozen.
 *
 * Two situations use the same arithmetic:
 *   - a marketplace listing taken down by a regulator (revenue stops, cost continues)
 *   - a shipment waiting on an export licence (capital is committed, goods cannot move)
 *
 * Both are "the clock is the cost" problems, and both are usually discussed
 * without a number attached. This is the number.
 *
 * All rates and values are the reader's own inputs. Nothing here is a claim
 * about market rates.
 *
 * Run:  node tools/hold-cost.mjs
 */

/**
 * A delisted listing loses contribution margin every day it is down, and
 * costs something one-off to reinstate.
 *
 * @param {{ unitsPerDay: number, unitPrice: number, contributionMargin: number, days: number, reinstatementCost?: number }} s
 */
export function takedownCost(s) {
  const { unitsPerDay, unitPrice, contributionMargin, days, reinstatementCost = 0 } = s;
  const contributionPerUnit = unitPrice * contributionMargin;
  const lostContribution = contributionPerUnit * unitsPerDay * days;
  return {
    contributionPerUnit,
    lostRevenue: unitPrice * unitsPerDay * days,
    lostContribution,
    total: lostContribution + reinstatementCost,
  };
}

/**
 * A shipment stuck waiting on a licence ties up capital. Cost is the funding
 * cost of that capital plus any storage or demurrage incurred.
 *
 * @param {{ shipmentValue: number, fundingRate: number, days: number, storagePerDay?: number }} s
 */
export function licenceHoldCost(s) {
  const { shipmentValue, fundingRate, days, storagePerDay = 0 } = s;
  const capitalCost = shipmentValue * fundingRate * (days / 365);
  const storage = storagePerDay * days;
  return { capitalCost, storage, total: capitalCost + storage };
}

const money = (n) =>
  "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const TAKEDOWN_CASES = [
  { label: "Amazon SKU, 40 units/day at $29.99, 14 days down", unitsPerDay: 40, unitPrice: 29.99, contributionMargin: 0.25, days: 14, reinstatementCost: 0 },
  { label: "Amazon SKU, 40 units/day at $29.99, 45 days down", unitsPerDay: 40, unitPrice: 29.99, contributionMargin: 0.25, days: 45, reinstatementCost: 0 },
  { label: "Marketplace long tail, 5 units/day at $19.99, 30 days down", unitsPerDay: 5, unitPrice: 19.99, contributionMargin: 0.3, days: 30, reinstatementCost: 0 },
];

const HOLD_CASES = [
  { label: "One 40HQ waiting 30 days for a licence", shipmentValue: 120000, fundingRate: 0.09, days: 30, storagePerDay: 0 },
  { label: "One 40HQ waiting 90 days for a licence", shipmentValue: 120000, fundingRate: 0.09, days: 90, storagePerDay: 0 },
  { label: "One 40HQ waiting 90 days, plus port storage", shipmentValue: 120000, fundingRate: 0.09, days: 90, storagePerDay: 45 },
];

if (process.argv[1]?.endsWith("hold-cost.mjs")) {
  console.log("Cost of a frozen listing (25-30% contribution margin assumed as input)\n");
  for (const c of TAKEDOWN_CASES) {
    const r = takedownCost(c);
    console.log(c.label);
    console.log(`  Lost revenue ............ ${money(r.lostRevenue)}`);
    console.log(`  Lost contribution ....... ${money(r.lostContribution)}`);
    console.log(`  Total ................... ${money(r.total)}`);
    console.log("");
  }

  console.log("Cost of capital tied up in a shipment waiting on a licence (9%/yr assumed as input)\n");
  for (const c of HOLD_CASES) {
    const r = licenceHoldCost(c);
    console.log(c.label);
    console.log(`  Shipment value .......... ${money(c.shipmentValue)}`);
    console.log(`  Capital cost ............ ${money(r.capitalCost)}`);
    console.log(`  Storage ................. ${money(r.storage)}`);
    console.log(`  Total ................... ${money(r.total)}`);
    console.log("");
  }
}
