/**
 * Export duty model — the duty charged on the way out of China.
 *
 * The problem it solves: every landed-cost model a buyer builds starts at the
 * FOB price and adds the importing country's tariff. China also charges export
 * duties, on 107 goods, and for raw and semi-finished metals those rates run
 * to 30 and 40 percent. A buyer comparing a raw material against a processed
 * form of the same metal is comparing the two sides of that schedule, usually
 * without knowing it exists.
 *
 *   export duty = FOB value x export duty rate
 *   landed duty = export duty + (FOB + freight + insurance) x import duty rate
 *
 * FOB value, freight and the importing country's rate are inputs. Export duty
 * rates are the published 2026 figures.
 *
 * Run:  node tools/export-duty.mjs
 */

/**
 * @param {{ fob: number, exportDutyRate: number, importDutyRate?: number, freightInsurance?: number }} s
 */
export function exportDuty(s) {
  const { fob, exportDutyRate, importDutyRate = 0, freightInsurance = 0 } = s;
  const exportDutyAmount = fob * exportDutyRate;
  const customsValue = fob + freightInsurance;
  const importDutyAmount = customsValue * importDutyRate;
  const totalDuty = exportDutyAmount + importDutyAmount;
  // The export duty is paid in China and passed through in the FOB price.
  const landedBeforeDuty = fob + freightInsurance;
  const landed = landedBeforeDuty + totalDuty;
  return {
    exportDutyAmount,
    importDutyAmount,
    totalDuty,
    landed,
    exportShare: totalDuty === 0 ? 0 : exportDutyAmount / totalDuty,
    dutyAsShareOfFob: totalDuty / fob,
  };
}

const money = (n) =>
  "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct = (n) => (n * 100).toFixed(1) + "%";

/**
 * Export duty rates from the 2026 export goods tariff schedule (附3), effective
 * 1 January 2026. Import duty rates are the destination country's; the figures
 * used here are stated in the row so the comparison stays auditable.
 */
const CASES = [
  {
    label: "Copper cathode (unwrought), 10% provisional export duty, 0% US import duty",
    fob: 8000, exportDutyRate: 0.1, importDutyRate: 0,
    note: "HTSUS 7403.11 general rate is Free",
  },
  {
    label: "Copper wire and strip (wrought), 0% provisional export duty, 0% US import duty",
    fob: 8600, exportDutyRate: 0, importDutyRate: 0,
    note: "rows 51-71, every wrought copper line carries a 0% provisional rate",
  },
  {
    label: "Ferrochrome (40% export duty, no provisional rate), 0% US import duty",
    fob: 1200, exportDutyRate: 0.4, importDutyRate: 0,
    note: "the announcement names ferrochrome as the lead example of the 107",
  },
  {
    label: "Unwrought aluminium (30% export duty, no provisional rate), Section 232 at 25%",
    fob: 2600, exportDutyRate: 0.3, importDutyRate: 0.25, freightInsurance: 120,
    note: "illustrative import rate; substitute your destination's",
  },
  {
    label: "Aluminium extrusions (20% nominal, 0% provisional), Section 232 at 25%",
    fob: 3200, exportDutyRate: 0, importDutyRate: 0.25, freightInsurance: 140,
    note: "rows 81-100, every wrought aluminium line carries a 0% provisional rate",
  },
];

if (process.argv[1]?.endsWith("export-duty.mjs")) {
  console.log("Export duty: the charge on the way out of China");
  console.log("(export duty rates are published 2026 figures; FOB values and import rates are inputs)\n");

  for (const c of CASES) {
    const r = exportDuty(c);
    console.log(c.label);
    console.log(`  FOB ...................... ${money(c.fob)}`);
    console.log(`  Chinese export duty ...... ${money(r.exportDutyAmount)}  (${pct(c.exportDutyRate)})`);
    console.log(`  Import duty .............. ${money(r.importDutyAmount)}  (${pct(c.importDutyRate)})`);
    console.log(`  Total duty ............... ${money(r.totalDuty)}`);
    console.log(`  Landed ................... ${money(r.landed)}`);
    console.log(`  Export duty share of duty  ${pct(r.exportShare)}`);
    console.log(`  ${c.note}`);
    console.log("");
  }

  console.log("The comparison that matters");
  const raw = exportDuty({ fob: 8000, exportDutyRate: 0.1, importDutyRate: 0 });
  const wrought = exportDuty({ fob: 8600, exportDutyRate: 0, importDutyRate: 0 });
  console.log(`  Copper cathode at ${money(8000)} FOB ....... total duty ${money(raw.totalDuty)}`);
  console.log(`  Copper wire at ${money(8600)} FOB .......... total duty ${money(wrought.totalDuty)}`);
  console.log(`  ${money(800)} of duty exists on one form of the metal and not the other.`);
  console.log(`  For a 10-tonne order that is ${money(8000)} — decided by the shape of the metal, not its weight.`);
  console.log("");
}
