#!/usr/bin/env node
/**
 * EU steel tariff-rate quota cost: the duty per tonne, in and out of quota.
 *
 * Spec v1.3 §7 requires an article's cost arithmetic to come from a model, not
 * from prose. Every per-tonne figure in the steel-quota article comes from here.
 *
 * THE RULE THIS IMPLEMENTS
 * Regulation (EU) 2026/1384 of 17 June 2026 (OJ L, 2026/1384, 24.6.2026),
 * applicable from 1 July 2026, replaced the steel safeguard in Implementing
 * Regulation (EU) 2019/159. It opens tariff-rate quotas totalling 18,345,922
 * tonnes a year across 26 product categories and sets the out-of-quota duty at
 * 50 % ad valorem, up from 25 %. Implementing Regulation (EU) 2026/1457 of
 * 29 June 2026 allocates that total by category and origin; its Annex I is the
 * source of every quota volume in CHINA_QUOTAS below.
 *
 *   duty per tonne        = rate x CIF value per tonne
 *   in-quota duty         = 0
 *   quota rent per tonne  = rate x CIF value per tonne
 *       The rent is what an in-quota allocation is worth per tonne, because
 *       holding it avoids exactly the duty that would otherwise be payable.
 *       It is the number that turns a quota into a priced asset.
 *
 * WHAT IS NOT PUBLISHED, AND WHY THE CIF INPUT IS THE READER'S
 * The regulation fixes a percentage, never a price. So a per-tonne figure needs
 * a value per tonne, which is the importer's own entry value, not a published
 * number. This model therefore takes CIF as an input and reports a grid rather
 * than pretending to a single answer.
 *
 * THREE THINGS COMPETITORS GET WRONG, ENCODED HERE
 *   1. China's country-specific quotas cover only a few of the 26 categories.
 *      In category 1.A, which is close to a third of the total quota volume,
 *      China has no named allocation at all.
 *   2. China's named allocations are MFN-only. The FTA half of each quota is
 *      closed to it, so the effective number is the MFN column alone.
 *   3. The residual "other countries" pool in 1.A is 22,256.02 tonnes a year,
 *      which is 5,564.01 tonnes per quarter, shared by every supplier without a
 *      named allocation. That is the whole fallback.
 *
 * Usage
 *   node tools/steel-trq.mjs                          # China table, duty grid
 *   node tools/steel-trq.mjs --cif=700                # pin one CIF value
 *   node tools/steel-trq.mjs --cif=700 --tonnes=500   # and a shipment size
 *   node tools/steel-trq.mjs --json
 */

// ---------------------------------------------------------------- the inputs

/** Out-of-quota duty, Reg (EU) 2026/1384 recital 16 and Annex I. */
export const OUT_OF_QUOTA_RATE = 0.5;

/** Total annual TRQ across all 26 categories, Reg (EU) 2026/1384 recital 18. */
export const TOTAL_TRQ_TONNES = 18_345_922;

/** 26 categories, Reg (EU) 2026/1384 Article 1 and Annex I. */
export const CATEGORY_COUNT = 26;

/**
 * Delegated-act floor and ceiling on the total, Article 8(1). Recorded because
 * the Commission can move the whole quota inside this band without new primary
 * legislation, which is a planning risk rather than a curiosity.
 */
export const TRQ_FLOOR_TONNES = 14_400_000;
export const TRQ_CEILING_TONNES = 22_200_000;

/**
 * China's country-specific allocations, taken row by row from Annex I of
 * Implementing Regulation (EU) 2026/1457. Every one is MFN-only: the FTA column
 * is 0.00 in all four rows, because China has no FTA with the EU touching these
 * categories.
 *
 * `quarterly` is the same volume in each of the four quarters, so the annual
 * figure is exactly four times it. That is a property of this allocation, not
 * an assumption: the annex publishes identical figures for all four quarters.
 */
export const CHINA_QUOTAS = {
  "4.B": {
    description: "Metallic coated sheets (hot-dipped galvanised)",
    cnCodes: ["7210 20 00", "7210 30 00", "7210 90 80", "7212 20 00", "7212 50 30", "7212 50 40", "7212 50 90", "7225 91 00", "7226 99 10"],
    orderNumber: "09.9838",
    annual: 182_996.85,
    mfn: 182_996.85,
    fta: 0,
    quarterly: 45_749.21,
  },
  "3.B": {
    description: "Electrical steel, grain-oriented",
    cnCodes: ["7225 19 90", "7226 19 80"],
    orderNumber: "09.9828",
    annual: 47_351.25,
    mfn: 47_351.25,
    fta: 0,
    quarterly: 11_837.81,
  },
  "1.B": {
    description: "Flat-rolled steel, 7212 60 00 only",
    cnCodes: ["7212 60 00"],
    orderNumber: "09.9816",
    annual: 142.36,
    mfn: 142.36,
    fta: 0,
    quarterly: 35.59,
  },
  "3.A": {
    description: "Magnetic sheets other than grain-oriented electrical steel",
    cnCodes: ["7209 16 10", "7209 17 10", "7209 18 10", "7209 26 10", "7209 27 10", "7209 28 10"],
    orderNumber: "09.9826",
    annual: 19.91,
    mfn: 19.91,
    fta: 0,
    quarterly: 4.98,
  },
};

/**
 * The residual MFN pool in category 1.A, open to every country except those in
 * section 3 of Annex II. This is the only route to duty-free entry for Chinese
 * hot-rolled coil, since China holds no named allocation in that category.
 */
export const RESIDUAL_1A = {
  label: "Otros países / Other countries",
  orderNumber: "09.9600",
  annual: 22_256.02,
  quarterly: 5_564.01,
};

/**
 * Comparison allocations in 1.A, for scale. Turkey and India are the two
 * largest named holders, and both are also large importers of Chinese semis
 * for re-rolling, which is why the quota cut matters beyond the named country.
 */
export const COMPARISON_1A = {
  Turkey: { annual: 642_294.94, orderNumber: "09.9801" },
  India: { annual: 597_274.45, orderNumber: "09.9803" },
  Japan: { annual: 551_539.13, orderNumber: "09.9802" },
  Ukraine: { annual: 483_529.41, orderNumber: "09.9805" },
  Korea: { annual: 461_830.10, orderNumber: "09.9806" },
};

/** The CBAM carbon cost per tonne already published for the same goods. */
export const CBAM_HRC_PER_TONNE = 163.53;

// ------------------------------------------------------------------- maths

const round = (n, dp = 2) => Number(n.toFixed(dp));

/** Duty and quota rent per tonne at a given CIF value per tonne. */
export function perTonne({ cif, rate = OUT_OF_QUOTA_RATE }) {
  const duty = cif * rate;
  return {
    cif,
    ratePct: rate * 100,
    dutyPerTonne: round(duty),
    inQuotaDutyPerTonne: 0,
    quotaRentPerTonne: round(duty),
    // What the quota is worth per tonne as a share of the goods value.
    rentAsShareOfValuePct: round(rate * 100, 1),
  };
}

/** Duty on a shipment, with and without an in-quota allocation. */
export function shipment({ cif, tonnes, rate = OUT_OF_QUOTA_RATE }) {
  const per = perTonne({ cif, rate });
  const outOfQuota = per.dutyPerTonne * tonnes;
  return {
    tonnes,
    cif,
    outOfQuotaDuty: round(outOfQuota),
    inQuotaDuty: 0,
    saving: round(outOfQuota),
    // Goods value, so the duty can be read as a share of the invoice.
    goodsValue: round(cif * tonnes),
  };
}

/** Standalone CBAM context, so the two charges can be placed side by side. */
export function cbamComparison(cif, rate = OUT_OF_QUOTA_RATE) {
  const duty = cif * rate;
  return {
    cif,
    safeguardDutyPerTonne: round(duty),
    cbamPerTonne: CBAM_HRC_PER_TONNE,
    // If the quota duty exceeds the carbon cost, the duty is what an importer
    // should be pricing first. The article's whole point rests on this ratio.
    dutyOverCbam: round(duty / CBAM_HRC_PER_TONNE, 2),
    largerCharge: duty > CBAM_HRC_PER_TONNE ? "safeguard quota duty" : "CBAM carbon cost",
  };
}

// ---------------------------------------------------------------------- CLI

function main(argv) {
  const arg = (n) => argv.find((a) => a.startsWith(`--${n}=`))?.split("=")[1];
  const json = argv.includes("--json");
  const cifArg = arg("cif") ? Number(arg("cif")) : null;
  const tonnes = arg("tonnes") ? Number(arg("tonnes")) : null;

  const grid = [400, 500, 600, 700, 800];

  if (json) {
    console.log(
      JSON.stringify(
        {
          constants: { OUT_OF_QUOTA_RATE, TOTAL_TRQ_TONNES, CATEGORY_COUNT, RESIDUAL_1A },
          chinaQuotas: CHINA_QUOTAS,
          grid: grid.map((c) => perTonne({ cif: c })),
          comparison: grid.map((c) => cbamComparison(c)),
        },
        null,
        2,
      ),
    );
    return 0;
  }

  console.log("\nEU STEEL TRQ — WHAT AN OUT-OF-QUOTA TONNE COSTS");
  console.log("Reg (EU) 2026/1384 (rate and total) + IR (EU) 2026/1457 (allocations)\n");

  console.log("CHINA'S COUNTRY-SPECIFIC ALLOCATIONS — every one is MFN-only\n");
  console.log("cat   order     annual tonnes   quarterly tonnes   FTA tonnes   product");
  console.log("-".repeat(104));
  let sum = 0;
  for (const [cat, q] of Object.entries(CHINA_QUOTAS)) {
    sum += q.annual;
    console.log(
      `${cat.padEnd(5)} ${q.orderNumber.padEnd(9)} ${q.annual.toLocaleString("en-US").padStart(13)} ` +
        `${q.quarterly.toLocaleString("en-US").padStart(18)} ${String(q.fta).padStart(12)}   ${q.description}`,
    );
  }
  console.log("-".repeat(104));
  console.log(
    `${"TOTAL".padEnd(5)} ${"".padEnd(9)} ${sum.toLocaleString("en-US").padStart(13)}   across ${Object.keys(CHINA_QUOTAS).length} of ${CATEGORY_COUNT} categories`,
  );

  console.log(`\nFor scale, in category 1.A alone (hot-rolled coil):`);
  console.log(`  Turkey  ${COMPARISON_1A.Turkey.annual.toLocaleString("en-US").padStart(12)} t/year   (${COMPARISON_1A.Turkey.orderNumber})`);
  console.log(`  India   ${COMPARISON_1A.India.annual.toLocaleString("en-US").padStart(12)} t/year   (${COMPARISON_1A.India.orderNumber})`);
  console.log(`  China   ${"none".padStart(12)}          — no named allocation in 1.A`);
  console.log(
    `  Residual pool available to China in 1.A: ${RESIDUAL_1A.annual.toLocaleString("en-US")} t/year ` +
      `= ${RESIDUAL_1A.quarterly.toLocaleString("en-US")} t/quarter, shared by every unlisted supplier`,
  );

  console.log("\n\nDUTY AND QUOTA RENT PER TONNE, at 50 % out-of-quota\n");
  console.log("CIF EUR/t   out-of-quota duty   in-quota duty   quota rent (= duty avoided)");
  console.log("-".repeat(84));
  for (const c of grid) {
    const r = perTonne({ cif: c });
    console.log(
      `${String(c).padStart(9)} ${r.dutyPerTonne.toLocaleString("en-US").padStart(19)} ` +
        `${String(r.inQuotaDutyPerTonne).padStart(15)} ${r.quotaRentPerTonne.toLocaleString("en-US").padStart(28)}`,
    );
  }

  if (cifArg) {
    console.log(`\n\nAT A PINNED CIF OF EUR ${cifArg}/t\n`);
    if (tonnes) {
      const s = shipment({ cif: cifArg, tonnes });
      console.log(`  ${tonnes.toLocaleString("en-US")} t shipment`);
      console.log(`    goods value        EUR ${s.goodsValue.toLocaleString("en-US")}`);
      console.log(`    out-of-quota duty  EUR ${s.outOfQuotaDuty.toLocaleString("en-US")}`);
      console.log(`    in-quota duty      EUR ${s.inQuotaDuty.toLocaleString("en-US")}`);
      console.log(`    the allocation is worth EUR ${s.saving.toLocaleString("en-US")} on that shipment`);
    } else {
      const r = perTonne({ cif: cifArg });
      console.log(`  duty per tonne           EUR ${r.dutyPerTonne.toLocaleString("en-US")}`);
      console.log(`  quota rent per tonne     EUR ${r.quotaRentPerTonne.toLocaleString("en-US")}`);
    }
    const cmp = cbamComparison(cifArg);
    console.log(`\n  AGAINST CBAM ON THE SAME TONNE`);
    console.log(`    safeguard quota duty   EUR ${cmp.safeguardDutyPerTonne.toLocaleString("en-US")}/t`);
    console.log(`    CBAM carbon cost       EUR ${cmp.cbamPerTonne.toLocaleString("en-US")}/t`);
    console.log(`    ratio                  ${cmp.dutyOverCbam}x — the larger charge is the ${cmp.largerCharge}`);
  }

  console.log("\nNote: the regulation fixes a percentage, never a price. CIF is the");
  console.log("importer's own entry value, so the per-tonne figure is a table, not a fact.\n");
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("steel-trq.mjs")) {
  process.exit(main(process.argv.slice(2)));
}
