/**
 * Per-item charge model — flat charges that scale with item count, not value.
 *
 * The problem it solves: a flat charge per item inverts the usual relationship
 * between basket value and cost. A percentage duty falls hardest on expensive
 * goods; a per-item charge falls hardest on cheap, multi-item baskets. On a
 * ten-euro parcel holding three items, the charges exceed the goods.
 *
 *   total charge   = items x (duty per item + fee per item)
 *   effective rate = total charge / consignment value
 *
 * Charge amounts are the published figures for the EU measures. Item count,
 * item value and any VAT rate are the reader's inputs.
 *
 * Run:  node tools/per-item-charge.mjs
 */

/**
 * @param {{ items: number, itemValue: number, dutyPerItem?: number, feePerItem?: number, vatRate?: number, aboveReliefThreshold?: boolean }} s
 */
export function perItemCharge(s) {
  const {
    items,
    itemValue,
    dutyPerItem = 3,
    feePerItem = 2,
    vatRate = 0,
    aboveReliefThreshold = false,
  } = s;

  // The EUR 3 duty replaces the relief that only existed up to EUR 150, so a
  // consignment above that threshold is outside it. The handling fee is not
  // value-conditioned and applies either way.
  const duty = aboveReliefThreshold ? 0 : items * dutyPerItem;
  const fee = items * feePerItem;
  const value = items * itemValue;
  const vat = value * vatRate;
  const total = duty + fee + vat;

  return {
    value,
    duty,
    fee,
    vat,
    total,
    effectiveRate: value === 0 ? Infinity : total / value,
    chargeOnlyRate: value === 0 ? Infinity : (duty + fee) / value,
  };
}

const money = (n) => "€" + n.toFixed(2);

const CASES = [
  { label: "Ten-euro parcel, three items (the Irish Revenue example)", items: 3, itemValue: 10 / 3, dutyPerItem: 3, feePerItem: 2 },
  { label: "Forty-euro parcel, two items", items: 2, itemValue: 20, dutyPerItem: 3, feePerItem: 2 },
  { label: "One hundred and forty euro, single item", items: 1, itemValue: 140, dutyPerItem: 3, feePerItem: 2 },
  { label: "Three hundred euro, single item (above the relief threshold)", items: 1, itemValue: 300, dutyPerItem: 3, feePerItem: 2, aboveReliefThreshold: true },
  { label: "Three hundred euro, ten items (above the relief threshold)", items: 10, itemValue: 30, dutyPerItem: 3, feePerItem: 2, aboveReliefThreshold: true },
];

if (process.argv[1]?.endsWith("per-item-charge.mjs")) {
  console.log("Per-item charges: how the flat rate scales against basket value");
  console.log("(EUR 3 duty and EUR 2 handling fee are the published amounts; item count and value are inputs;");
  console.log(" VAT excluded from these figures — add your own rate)\n");

  for (const c of CASES) {
    const r = perItemCharge(c);
    console.log(c.label);
    console.log(`  Consignment value ........ ${money(r.value)}`);
    console.log(`  Duty (EUR 3 per item) .... ${money(r.duty)}`);
    console.log(`  Handling fee (EUR 2/item)  ${money(r.fee)}`);
    console.log(`  Total charge ............. ${money(r.total)}`);
    console.log(`  As a share of value ...... ${(r.chargeOnlyRate * 100).toFixed(1)}%`);
    console.log("");
  }

  console.log("The inversion");
  const cheap = perItemCharge({ items: 3, itemValue: 10 / 3 });
  const dear = perItemCharge({ items: 1, itemValue: 140 });
  console.log(`  A €10 basket of three items pays ${money(cheap.total)} in charges: ${(cheap.chargeOnlyRate * 100).toFixed(0)}% of the goods.`);
  console.log(`  A €140 single item pays ${money(dear.total)}: ${(dear.chargeOnlyRate * 100).toFixed(1)}% of the goods.`);
  console.log(`  Fourteen times the value, one fifteenth of the charge ratio.`);
  console.log("");
}
