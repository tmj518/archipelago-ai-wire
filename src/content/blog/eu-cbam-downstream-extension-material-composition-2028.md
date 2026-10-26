---
title: "CBAM Is Moving From Goods That Are Steel to Goods That Contain It"
subtitle: "The proposed CBAM extension would charge downstream goods on their steel and aluminium content from 2028. A 40 kg content in a EUR 400 appliance pays EUR 6.54"
description: "CBAM today covers goods that are steel or aluminium. The proposed extension from 1 January 2028 covers goods that contain them, charged on the metal content under an ex-code mechanism, and it adds a material-composition reporting duty that nobody currently holds."
publishDate: 2026-10-07
reviewBy: 2027-01-31
stakes: priced
category: "trade-policy"
audience: "importer"
tags: ["cbam", "downstream goods", "ex-codes", "material composition", "cbam extension", "steel content"]
priority: "P0"
featured: false
draft: false
articleNumber: 20
target_keyword: "CBAM downstream extension 2028 ex-codes material composition"
search_intent: "informational"
information_gain: "custom-calculation"
figures:
  - value: "1 January 2028"
    unit: "the date the proposed extension of Annex I and the new precursor annex would apply from"
    period: "proposed; the Council reached its negotiating position on 12 June 2026 and trilogue with the European Parliament follows"
    source: "Council of the EU, general approach on the CBAM extension, document ST 10423/2026, 12 June 2026"
    retrieved: "2026-10-07"
  - value: "180"
    unit: "downstream steel- and aluminium-intensive products the extension would bring into scope, by one trade-compliance account"
    period: "proposed, applying from 1 January 2028"
    source: "secondary trade-compliance analysis of the Commission proposal, September 2026; not read from the legislative text"
    retrieved: "2026-10-07"
  - value: "6.54"
    unit: "EUR per unit — CBAM at the Q1 2026 certificate price on a 40 kg steel content"
    period: "2026 certificate price of EUR 75.36 per tCO2e, applied to an illustrative 40 kg"
    source: "Landed Math CBAM model, steel line CN 7208, applied to a stated metal content"
    retrieved: "2026-10-07"
  - value: "163.53"
    unit: "EUR per tonne — CBAM on Chinese hot-rolled coil, the rate a tonne of steel carries when it arrives as steel"
    period: "2026 declaration year, Q1 2026 certificate price"
    source: "Landed Math CBAM model, corrected Annex I to Regulation (EU) 2026/1740"
    retrieved: "2026-10-07"
  - value: "981.88"
    unit: "EUR per tonne — CBAM on Chinese unwrought aluminium, the rate a tonne of aluminium carries"
    period: "2026 declaration year, Q1 2026 certificate price"
    source: "Landed Math CBAM model"
    retrieved: "2026-10-07"
  - value: "2.45"
    unit: "per cent of the good's value — the charge on a 60 kg steel content in a EUR 400 appliance at the Q1 2026 price"
    period: "2026 certificate price, illustrative metal content"
    source: "Landed Math CBAM model applied to a stated metal content and CIF"
    retrieved: "2026-10-07"
  - value: "23.4"
    unit: "per cent of the good's value — what the same steel pays when it arrives as hot-rolled coil at CIF EUR 700"
    period: "2026"
    source: "Landed Math CBAM model against a stated CIF value"
    retrieved: "2026-10-07"
  - value: "7308, 7318"
    unit: "CN headings for steel structures and for screws, bolts and nuts — already inside the current Annex I, not part of the extension"
    period: "in force since 1 January 2026"
    source: "Regulation (EU) 2023/956, Annex I, and the corrected default values in Regulation (EU) 2026/1740"
    retrieved: "2026-10-07"
sources:
  - "Council of the EU, general approach on extending the CBAM to downstream goods, document ST 10423/2026, 12 June 2026"
  - "European Parliament, plenary document A-10-2026-0201, the committee report on the amending proposal"
  - "European Parliament written question P-002207/2026, answer given by Mr Hoekstra on behalf of the Commission, 21 August 2026"
  - "Regulation (EU) 2023/956, Annex I, the goods in scope today"
  - "Commission Implementing Regulation (EU) 2026/1740, corrected Annex I, China default values"
  - "European Commission, DG TAXUD, Price of CBAM certificates, retrieved 3 October 2026"
  - "Landed Math CBAM model, src/lib/cbam.mjs"
---

## AI Summary

CBAM today covers goods that are steel or aluminium. The proposed extension would cover goods that contain them, charged on the metal content alone from 1 January 2028. Because metal is a small share of a finished good's value, the per-unit charge is small: a 40 kg steel content in a EUR 400 appliance is EUR 6.54.

## What happened

**On 12 June 2026 the Council of the EU reached a general approach on extending CBAM to downstream goods.** A general approach is the Council's negotiating position, not law: the proposal still goes to trilogue with the European Parliament, and the extension would apply from **1 January 2028**.

**The change is not that processed steel becomes covered.** Steel structures under CN 7308 and screws, bolts and nuts under CN 7318 are already inside the current Annex I, and [this site's CBAM model](/blog/eu-cbam-cost-per-tonne-chinese-steel-aluminium-2026/) prices them. What the extension adds is a different kind of entry.

**It adds ex-codes.** An ex-code captures only the steel or aluminium content of a good rather than the whole good. So the embedded emissions of a covered downstream product are calculated from the metal it contains, and the material composition of each good has to be reported. The categories reported to be affected run from engines, pumps and vehicle parts to refrigerators, washing machines, furniture and prefabricated buildings.

> **That is the substance of the change: CBAM would stop asking "is this good steel?" and start asking "how much steel is in this good, and where did it come from?"** The second question cannot be answered from a customs declaration.

## Why now

Because the arithmetic per unit is small and the arithmetic in aggregate is not, and the two point in opposite directions about how urgent this is.

**Metal is a small share of a finished good's value, so the charge on any one unit is small.** At the Q1 2026 certificate price, a tonne of steel carries EUR 163.53 of CBAM and a tonne of aluminium carries EUR 981.88. Put that metal inside a product and the charge follows the metal, not the product.

| Good, illustrative CIF | Metal content | CBAM per unit | As a share of value |
| --- | --- | --- | --- |
| Washing machine, EUR 400 | 40 kg steel | EUR 6.54 | 1.64% |
| Refrigerator, EUR 500 | 50 kg steel | EUR 8.18 | 1.64% |
| Steel shelving, EUR 120 | 25 kg steel | EUR 4.09 | 3.41% |
| Aluminium ladder, EUR 90 | 7 kg aluminium | EUR 6.87 | 7.64% |
| Bicycle frame, EUR 220 | 3.5 kg aluminium | EUR 1.96 | 1.56% |
| Diesel engine, EUR 4,500 | 500 kg steel | EUR 81.77 | 1.82% |

**And the same metal costs proportionally far less once it is inside something else.** A tonne of hot-rolled coil at CIF EUR 700 pays EUR 163.53, which is 23.4 per cent of its value. Forty kilograms of the same steel inside a EUR 400 appliance pays EUR 6.54, which is 1.64 per cent of that appliance's value. The carbon charge has not changed; the denominator has.

**So the risk is not the per-unit number, it is the number of units and the data behind them.** One million appliances at EUR 6.54 is EUR 6,540,000. And every one of those units requires a material-composition figure with an origin attached, which is a fact most importers do not currently hold for their suppliers' products.

**The other part of the timing is that the annexes would change twice.** The extension applies from 1 January 2028, and the same proposal brings pre-consumer scrap into scope as a precursor with emissions where it currently counts as zero — so the emissions of material that is scrap today would enter the calculation. Anyone building a composition dataset for 2028 needs to know which of their inputs would be treated as precursor.

## So what

Three things follow, and the first one inverts the usual reading of an extension.

**Perversely, the downstream mechanism is proportionally lighter than the upstream one.** The extension reaches goods whose metal content is a fraction of their value, so a EUR 6.54 charge on a EUR 400 appliance is a smaller percentage than a EUR 163.53 charge on a EUR 700 tonne of coil. A supplier who is already exporting steel to the EU is facing a heavier relative burden than a supplier who exports appliances containing it. That is a real feature of charging on metal content rather than on value.

**But the compliance burden lands on a different population, and that is the harder half.** Under the current Annex I, an importer can determine scope from a customs declaration: the CN code either is on the list or is not. Under an ex-code, scope depends on whether the good contains steel or aluminium, how much, and from where. That is a bill-of-materials question, and it has to be answered per SKU per supplier.

**And the emergency mechanism is not a planning assumption.** The proposal carries a provision allowing the Commission to exempt goods temporarily where inclusion severely harms the internal market, cited in one secondary account as a sustained price increase above 50 per cent. That is a relief valve, not a route to plan on.

> Also read: [The EU Registered Your Cellulose Ether Imports, and the Duty Comes Later](/blog/eu-cellulose-ethers-duty-timeline/)

> Also read: [China Dropped Tariffs to Zero on 1,344 Farm and Food Lines for 20 African Countries](/blog/china-zero-tariff-20-african-countries-2026/)

> Work it out: [the landed cost calculator](/calculator/)

> Different question, same method: [the step-by-step guides](/guide/)

## For you

- **If you import machinery, appliances, vehicles or parts containing steel or aluminium into the EU:** the practical first step is not a cost estimate, it is to find out how much metal is in each SKU. Ask your supplier for the steel and aluminium mass per unit, per material, with the origin of each. That figure does not exist in most product documentation today, and it is the input everything else depends on.
- **If you already import steel or aluminium as material:** you are inside the current scope, and your exposure per unit is proportionally larger than the downstream goods the extension reaches. The extension does not lighten the upstream position.
- **If your product is aluminium-intensive rather than steel-intensive:** the per-unit charge is roughly six times higher per kilogram of metal. An aluminium ladder at 7 kg carries EUR 6.87 against EUR 4.09 for a steel shelving unit at 25 kg. Aluminium content is where a small mass becomes a visible number.
- **If your supplier also ships to the EU as material and as a component:** expect them to price the two differently, because the burden is different. Do not assume a component quote carries the same carbon cost as the equivalent metal.
- **Anyone planning 2028 now:** the annexes and the precursor list are in trilogue, so the lists will move. What will not move is the requirement to know your material composition, so that is the work that is safe to start.

## The data point

<div class="callout">
<span class="callout-label">Data point</span>

**EUR 6.54 against 23.4 per cent.** A 40 kg steel content in a EUR 400 appliance carries **EUR 6.54** of CBAM, or **1.64 per cent** of the good's value. The same steel arriving as hot-rolled coil at CIF EUR 700 carries **EUR 163.53**, or **23.4 per cent**. Same metal, same carbon price, fourteen times the relative burden — because the appliance's value is not made of steel.

</div>

## How we calculated this

The carbon charge per tonne of metal comes from the published model. The metal content per unit is a fact about your product, so it is stated as an assumption in every line above.

```text
CBAM per unit = (metal content in kg / 1000) x CBAM per tonne of that metal

6.54 EUR  = (40 kg / 1000) x 163.53 EUR/t        (steel, CN 7208)
6.87 EUR  = ( 7 kg / 1000) x 981.88 EUR/t        (aluminium, CN 7601)
1.64%     = 6.54 / 400                            (share of a EUR 400 appliance)

as a share of metal value instead:
23.4%     = 163.53 / 700                          (the same steel at CIF EUR 700/t)
```

Substitute your own metal content and your own CIF. The carbon rate is published and fixed for the year at a given certificate price; the metal content is the input that determines whether the answer is a rounding error or a material cost.

## The point

CBAM is being extended from goods that are steel to goods that contain it, and the mechanism — an ex-code charged on metal content — means the per-unit charge is small and the aggregate is not. Forty kilograms of steel in an appliance costs EUR 6.54; a million appliances cost EUR 6.5 million. Neither number is the one that matters most.

What matters most is that the new scope cannot be determined from a customs declaration. Today an importer reads a CN code and knows whether CBAM applies. Under an ex-code, scope turns on how much steel or aluminium a product contains and where that metal came from, which is a bill-of-materials question. That is a reporting duty dressed as a carbon charge, and it applies from 1 January 2028 to a population of goods that mostly has no material-composition data today.

## FAQ

### Is CBAM extending to downstream products?

Yes, and the process is under way rather than finished. The Council of the EU reached a general approach on extending CBAM to downstream steel and aluminium goods on 12 June 2026, which is the Council's negotiating position rather than adopted law. The European Parliament's position follows, and the extension would apply from 1 January 2028. Because it is still in trilogue, the lists and the mechanism can both still change, so anything here should be read as the direction of travel rather than as a settled list of codes.

### What is an ex-code and why does it change who is covered?

An ex-code is a tariff entry that captures only part of a good rather than the whole of it. In the proposed CBAM extension it captures only the steel or aluminium content of a downstream product, so the embedded emissions of a covered good are calculated from the metal inside it. That changes who is covered in a way a CN code list cannot express: under the current Annex I, a good either is on the list or is not, and an importer can tell from the customs declaration. Under an ex-code the question becomes how much metal the good contains and where that metal came from, which is a question about the product's bill of materials rather than about its classification. That is why the reporting duty, and not the charge, is the harder half of the extension.

### How much would the charge be on a typical appliance?

It depends on the metal content and barely on anything else, since the charge follows the metal rather than the good's value. At the Q1 2026 certificate price of EUR 75.36 per tonne of CO2e, a tonne of steel carries EUR 163.53 and a tonne of aluminium EUR 981.88. So a washing machine containing 40 kg of steel carries EUR 6.54, which is 1.64 per cent of a EUR 400 appliance, and a refrigerator containing 50 kg carries EUR 8.18, also 1.64 per cent of EUR 500. The percentage stays low because appliances contain little metal relative to what they cost. A 40 kg steel content figure is illustrative; the real number is a fact about your product that your supplier has to confirm.

### Does the extension mean steel imports get cheaper or lighter?

No, and the direction is the opposite of what a downstream extension suggests. Goods that arrive as steel are already inside the current Annex I, so a tonne of hot-rolled coil at CIF EUR 700 pays EUR 163.53, which is 23.4 per cent of its value. The extension brings in goods whose metal content is a smaller share of their value, so the new entrants face a proportionally lighter charge than the existing ones. Nothing in the extension reduces the burden on material imports; it widens the population rather than redistributing the cost.

### Why is material composition the hard part?

Because it is a fact that customs data does not contain, and that most product documentation does not either. An import declaration states a classification, a value and an origin for the good as a whole. The extension requires the mass of steel and of aluminium separately, and the origin of each, because the embedded emissions are calculated from the metal. For a simple steel article that is nearly the same thing. For a machine with a steel frame, aluminium castings, and bought-in components of unknown provenance, it is a new dataset, built per SKU and per supplier, and it has to be in place before the first 2028 declaration rather than on it.
