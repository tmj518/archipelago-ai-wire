/**
 * Deposit-risk model — when is a supplier check worth paying for?
 *
 * The problem it solves: supplier verification advice is usually delivered as
 * a list of things to do, with no answer to the only question a buyer actually
 * has, which is whether the check is worth its cost.
 *
 * The arithmetic is a break-even, and it needs no assumptions about how often
 * suppliers lie:
 *
 *   money exposed   = order value x deposit percentage
 *   break-even risk = verification cost / money exposed
 *
 * Read the break-even as: "if the chance this registration is not what it
 * claims is higher than this, the check pays for itself." The buyer supplies
 * every input; nothing here is a claim about fraud rates, which nobody
 * publishes reliably.
 *
 * Run:  node tools/deposit-risk.mjs
 */

/**
 * @param {{ orderValue: number, depositPct: number, verificationCost: number }} s
 */
export function depositRisk(s) {
  const { orderValue, depositPct, verificationCost } = s;
  const exposed = orderValue * depositPct;
  const breakEvenRisk = exposed === 0 ? Infinity : verificationCost / exposed;
  return {
    exposed,
    breakEvenRisk,
    /** One in N orders: an easier way to read a small probability. */
    oneInN: breakEvenRisk === 0 ? Infinity : 1 / breakEvenRisk,
  };
}

const money = (n) =>
  "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct = (n) => (n * 100).toFixed(2) + "%";

const CASES = [
  { label: "Trial order, $8,000 at 30% deposit", orderValue: 8000, depositPct: 0.3, verificationCost: 150 },
  { label: "First container, $60,000 at 30% deposit", orderValue: 60000, depositPct: 0.3, verificationCost: 150 },
  { label: "First container, $60,000 at 50% deposit", orderValue: 60000, depositPct: 0.5, verificationCost: 150 },
  { label: "Production run, $250,000 at 30% deposit", orderValue: 250000, depositPct: 0.3, verificationCost: 400 },
];

if (process.argv[1]?.endsWith("deposit-risk.mjs")) {
  console.log("Break-even risk: when a supplier check pays for itself");
  console.log("(order value, deposit percentage and verification cost are reader inputs)\n");

  for (const c of CASES) {
    const r = depositRisk(c);
    console.log(c.label);
    console.log(`  Deposit exposed .......... ${money(r.exposed)}`);
    console.log(`  Verification cost ........ ${money(c.verificationCost)}`);
    console.log(`  Break-even risk .......... ${pct(r.breakEvenRisk)}  (about 1 in ${r.oneInN.toFixed(0)} orders)`);
    console.log("");
  }
}
