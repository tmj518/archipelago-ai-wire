#!/usr/bin/env node
/**
 * Container suitability clock — what a lapsed 21-day window costs, per container.
 *
 * Spec v1.3 §7 requires an article's cost arithmetic to come from a model, not
 * from prose. Every per-container figure in the container-suitability article
 * comes from here.
 *
 * THE RULE THIS IMPLEMENTS
 * GACC Announcement No. 136 of 2026, published 8 September 2026, effective
 * 1 October 2026, on container suitability inspection for exported perishable
 * and frozen food. Its operative constraint is a clock, not a fee:
 *
 *   - the carrier, the stuffing unit or its agent applies through the China
 *     International Trade Single Window BEFORE loading, uploading an Export
 *     Container Suitability Compliance Declaration;
 *   - the result is valid for 21 days and lapses automatically;
 *   - the 21 days run from the moment the passed container enters the qualified
 *     database to the moment of the EXPORT DECLARATION — the official work
 *     guidance states that boundary explicitly, so ocean transit is outside the
 *     clock and port waiting before declaration is inside it;
 *   - at declaration the customs system validates the result against the
 *     container number, and a failed validation rejects the declaration.
 *
 *   capital cost of the lapse = goods value x funding rate x days / 365
 *   storage and reefer power = storage per day x days
 *   operating cost of lapse  = capital cost + storage
 *
 * WHAT IS PUBLISHED AND WHAT IS THE READER'S
 * The 21 days, the effective date and the two statutory fine maxima are
 * published. The goods value, the funding rate, the number of days late and the
 * daily storage and reefer power charge are the reader's own. This is why the
 * model reports a grid rather than one number, and why every currency figure it
 * prints is RMB: the regulation states its penalties in RMB and a Chinese
 * terminal quotes reefer storage in RMB, so no exchange rate is introduced.
 *
 * WHY THE FINE IS THE WRONG THING TO PLAN AROUND
 * The maxima are CNY 100,000 for using a container that was never inspected and
 * CNY 200,000 for using one that failed. Both are per container and both are
 * caps on a penalty, not a price. The number that recurs, on every box, is the
 * cost of letting the clock run out — and it falls on the two habits that
 * normally reduce freight cost: stuffing early to hold a booking, and
 * consolidating several SKUs into one container.
 *
 * Usage
 *   node tools/suitability-clock.mjs                          # the grid
 *   node tools/suitability-clock.mjs --value=800000 --days=14 # pin one case
 *   node tools/suitability-clock.mjs --json
 */

import { licenceHoldCost } from "./hold-cost.mjs";

// -------------------------------------------------------------- the published

/** Validity of a passed suitability result, GACC Announcement No. 136 of 2026. */
export const VALIDITY_DAYS = 21;

/** Effective date of the announcement. */
export const EFFECTIVE_DATE = "2026-10-01";

/** Publication date of the announcement. */
export const PUBLISHED_DATE = "2026-09-08";

/**
 * Statutory maxima, Regulation on the Implementation of the Law of the PRC on
 * Import and Export Commodity Inspection, Article 51. Per container.
 */
export const FINE_NEVER_INSPECTED_CNY = 100_000;
export const FINE_FAILED_INSPECTION_CNY = 200_000;

/**
 * The scope moved from 6 HS headings to 13-digit commodity codes, per the
 * official work guidance circulated with the announcement. Recorded because it
 * is the difference between "check the chapter" and "check the line".
 */
export const PRIOR_SCOPE_HEADINGS = 6;

// ------------------------------------------------------------------- the maths

const round = (n, dp = 2) => Number(n.toFixed(dp));

/**
 * Cost of a window that lapsed before the export declaration.
 *
 * The goods are already in the box and the box cannot be declared, so the
 * shipment value is committed capital and the storage meter is running. The
 * arithmetic is the hold-cost model's, imported rather than re-implemented: a
 * shipment frozen by a rule is the same problem as a shipment frozen by a
 * licence, and two copies of that sum would let the published figure and the
 * model disagree.
 *
 * @param {{ shipmentValueCny: number, fundingRate: number, daysLate: number, storagePerDayCny?: number }} s
 */
export function lapseCost({ shipmentValueCny, fundingRate, daysLate, storagePerDayCny = 0 }) {
  const held = licenceHoldCost({
    shipmentValue: shipmentValueCny,
    fundingRate,
    days: daysLate,
    storagePerDay: storagePerDayCny,
  });
  return {
    shipmentValueCny,
    fundingRatePct: round(fundingRate * 100, 2),
    daysLate,
    capitalCostCny: round(held.capitalCost),
    storageCny: round(held.storage),
    totalCny: round(held.total),
    // What the lapse costs as a share of the goods it is holding.
    costAsShareOfValuePct: round((held.total / shipmentValueCny) * 100, 3),
    // The same cost read against the smaller statutory maximum.
    shareOfSmallerFinePct: round((held.total / FINE_NEVER_INSPECTED_CNY) * 100, 2),
  };
}

/**
 * Where a container stands against the clock.
 *
 * `daysUsed` is measured to the export declaration, not to loading and not to
 * sailing, because that is the boundary the official guidance states. A box
 * that has been inspected and not yet declared is consuming the window; a box
 * already declared is not.
 *
 * @param {{ daysUsed: number }} s
 */
export function window({ daysUsed }) {
  const remaining = VALIDITY_DAYS - daysUsed;
  return {
    daysUsed,
    daysRemaining: remaining,
    expired: remaining < 0,
    // A result that has expired cannot be renewed in place: the application is
    // made on an empty container, so the box has to come out of the goods.
    remedy: remaining < 0 ? "re-inspection on an empty container" : "none needed",
  };
}

/**
 * The two habits that reduce freight cost, priced against the clock.
 *
 * A consolidated box takes longer to fill and an early-stuffed box holds a
 * booking, so both push the declaration later. This turns that into the number
 * of days each habit can afford before the window closes.
 *
 * @param {{ daysFromPassToDeclaration: number, daysLate: number }} s
 */
export function tradeoff({ daysFromPassToDeclaration, daysLate }) {
  const w = window({ daysUsed: daysFromPassToDeclaration });
  return {
    ...w,
    daysLate,
    // Days of slack left for the practice that delays declaration.
    slackDays: w.daysRemaining,
  };
}

// ----------------------------------------------------------------------- CLI

const money = (n) =>
  "CNY " + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const GRID_DAYS = [7, 14, 21, 30, 45];

function main(argv) {
  const arg = (n) => argv.find((a) => a.startsWith(`--${n}=`))?.split("=")[1];
  const value = arg("value") ? Number(arg("value")) : 800_000;
  const days = arg("days") ? Number(arg("days")) : 14;
  const rate = arg("rate") ? Number(arg("rate")) : 0.04;
  const storage = arg("storage") ? Number(arg("storage")) : 350;

  if (argv.includes("--json")) {
    console.log(
      JSON.stringify(
        {
          published: {
            VALIDITY_DAYS,
            EFFECTIVE_DATE,
            PUBLISHED_DATE,
            FINE_NEVER_INSPECTED_CNY,
            FINE_FAILED_INSPECTION_CNY,
            PRIOR_SCOPE_HEADINGS,
          },
          grid: GRID_DAYS.map((d) =>
            lapseCost({ shipmentValueCny: value, fundingRate: rate, daysLate: d, storagePerDayCny: storage }),
          ),
        },
        null,
        2,
      ),
    );
    return 0;
  }

  console.log("\nCONTAINER SUITABILITY CLOCK — WHAT A LAPSED 21-DAY WINDOW COSTS");
  console.log("GACC Announcement No. 136 of 2026 (8 September 2026, effective 1 October 2026)\n");
  console.log(`  validity .................... ${VALIDITY_DAYS} days, lapsing automatically`);
  console.log("  clock runs .................. pass into the qualified database -> export declaration");
  console.log(`  fine, container never checked ${money(FINE_NEVER_INSPECTED_CNY)} per container (max)`);
  console.log(`  fine, container failed check  ${money(FINE_FAILED_INSPECTION_CNY)} per container (max)`);
  console.log(`  scope before ................ ${PRIOR_SCOPE_HEADINGS} HS headings; now 13-digit commodity codes`);

  console.log("\n\nOPERATING COST OF A LAPSE, PER CONTAINER\n");
  console.log(`  goods value ................. ${money(value)}        (input)`);
  console.log(`  funding rate ................ ${(rate * 100).toFixed(2)}% a year   (input)`);
  console.log(`  storage and reefer power .... ${money(storage)} a day  (input)\n`);
  console.log("  days late   capital cost        storage        total   % of value   % of smaller fine");
  console.log("-".repeat(94));
  for (const d of GRID_DAYS) {
    const r = lapseCost({ shipmentValueCny: value, fundingRate: rate, daysLate: d, storagePerDayCny: storage });
    console.log(
      `${String(d).padStart(9)} ${money(r.capitalCostCny).padStart(18)} ${money(r.storageCny).padStart(14)} ` +
        `${money(r.totalCny).padStart(14)} ${String(r.costAsShareOfValuePct).padStart(11)}% ${String(r.shareOfSmallerFinePct).padStart(16)}%`,
    );
  }

  const pinned = lapseCost({ shipmentValueCny: value, fundingRate: rate, daysLate: days, storagePerDayCny: storage });
  console.log(`\n\nAT ${days} DAYS LATE\n`);
  console.log(`  capital cost ................ ${money(pinned.capitalCostCny)}`);
  console.log(`  storage and power ........... ${money(pinned.storageCny)}`);
  console.log(`  operating cost of the lapse . ${money(pinned.totalCny)}`);
  console.log(`  as a share of the goods ..... ${pinned.costAsShareOfValuePct}%`);
  console.log(
    `  against the smaller fine .... ${pinned.shareOfSmallerFinePct}% of ${money(FINE_NEVER_INSPECTED_CNY)}`,
  );

  console.log("\n\nThe clock, for a box that passed inspection on day 0\n");
  for (const used of [7, 14, 20, 22, 30]) {
    const w = window({ daysUsed: used });
    console.log(
      `  declared ${String(used).padStart(2)} days after the pass  ->  ${String(w.daysRemaining).padStart(3)} days left  ` +
        `${w.expired ? "EXPIRED — " + w.remedy : "valid"}`,
    );
  }

  console.log(
    "\nNote: every currency figure here is RMB, because the regulation states its\n" +
      "penalties in RMB and a Chinese terminal quotes reefer storage in RMB. No\n" +
      "exchange rate is introduced, so none has to be sourced.\n",
  );
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("suitability-clock.mjs")) {
  process.exit(main(process.argv.slice(2)));
}
