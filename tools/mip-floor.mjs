/**
 * Minimum-import-price (MIP) duty model.
 *
 * The problem it solves: a MIP is not a tariff rate. It is a floor on the
 * price at which covered goods enter, enforced through the duty calculation.
 * The consequence is counter-intuitive and worth computing rather than
 * describing:
 *
 *   - Documentation filed, entered value below the MIP
 *       specific tariff = MIP - entered value   (the shortfall)
 *   - No documentation filed
 *       specific tariff = the full MIP
 *   - Either way, the ad valorem duty applies on top
 *
 * So the duty is a function of how cheaply the buyer bought. A cheaper
 * invoice does not reduce the landed cost — it converts the saving into duty.
 *
 * The MIP values and rates below are the published figures from Proclamation
 * 11052. Entered value is the reader's input.
 *
 * Run:  node tools/mip-floor.mjs
 */

/**
 * @param {{ enteredValue: number, mip: number, adValoremRate: number, documented?: boolean, otherDutiesRate?: number }} s
 *        enteredValue and mip are per unit (per kg, or per watt for cells and modules)
 */
export function mipDuty(s) {
  const { enteredValue, mip, adValoremRate, documented = true, otherDutiesRate = 0 } = s;

  const shortfall = Math.max(0, mip - enteredValue);
  const specificTariff = documented ? shortfall : mip;
  const adValorem = enteredValue * adValoremRate;
  const otherDuties = enteredValue * otherDutiesRate;
  const totalDuty = specificTariff + adValorem + otherDuties;
  const landed = enteredValue + totalDuty;

  return {
    specificTariff,
    adValorem,
    totalDuty,
    landed,
    effectiveRate: enteredValue === 0 ? Infinity : totalDuty / enteredValue,
  };
}

const money = (n) => "$" + n.toFixed(n < 10 ? 4 : 2);

const AD_VALOREM = 0.15; // Proclamation 11052, clause (4)

const CASES = [
  { label: "Polysilicon, MIP $21/kg, entered at $18/kg, documented", enteredValue: 18, mip: 21, adValoremRate: AD_VALOREM, documented: true },
  { label: "Polysilicon, MIP $21/kg, entered at $18/kg, no documentation", enteredValue: 18, mip: 21, adValoremRate: AD_VALOREM, documented: false },
  { label: "Polysilicon, MIP $21/kg, entered at $21/kg (at the floor)", enteredValue: 21, mip: 21, adValoremRate: AD_VALOREM, documented: true },
  { label: "Solar cells, MIP $0.22/W, entered at $0.16/W, documented", enteredValue: 0.16, mip: 0.22, adValoremRate: AD_VALOREM, documented: true },
  { label: "Solar modules, MIP $0.38/W, entered at $0.30/W, documented", enteredValue: 0.3, mip: 0.38, adValoremRate: AD_VALOREM, documented: true },
];

if (process.argv[1]?.endsWith("mip-floor.mjs")) {
  console.log("Minimum import price: what the floor does to the duty calculation");
  console.log("(MIP values and the 15% ad valorem rate are from Proclamation 11052;");
  console.log(" entered value is the reader's input)\n");

  for (const c of CASES) {
    const r = mipDuty(c);
    console.log(c.label);
    console.log(`  Entered value ............ ${money(c.enteredValue)}`);
    console.log(`  Specific tariff .......... ${money(r.specificTariff)}`);
    console.log(`  Ad valorem (15%) ......... ${money(r.adValorem)}`);
    console.log(`  Total duty ............... ${money(r.totalDuty)}`);
    console.log(`  Landed ................... ${money(r.landed)}`);
    console.log(`  Effective duty rate ...... ${(r.effectiveRate * 100).toFixed(2)}% of entered value`);
    console.log("");
  }

  const cheap = mipDuty({ enteredValue: 12, mip: 21, adValoremRate: AD_VALOREM, documented: true });
  const floor = mipDuty({ enteredValue: 21, mip: 21, adValoremRate: AD_VALOREM, documented: true });
  console.log("The inversion");
  console.log(`  Bought at $12/kg, documented ... landed ${money(cheap.landed)}, effective duty ${(cheap.effectiveRate * 100).toFixed(1)}%`);
  console.log(`  Bought at $21/kg, documented ... landed ${money(floor.landed)}, effective duty ${(floor.effectiveRate * 100).toFixed(1)}%`);
  console.log(`  Cheaper invoice, higher effective rate: the gap is ${(((cheap.effectiveRate - floor.effectiveRate)) * 100).toFixed(1)} points.`);
  console.log("");
}
