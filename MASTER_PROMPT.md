# MASTER_PROMPT

**The only instruction file the automation reads.** Everything else moved to `docs/` and is background
reading for a human, not an input to a run.

A run reads this file, `data/directive.json`, and the tools' own output. It does not read `docs/`, does not
read the blog collection to "get oriented", and does not read yesterday's notes. Every file read costs a turn
and a turn costs money; the things below are the things that change an article.

If this file and the code disagree, the code is wrong — `tools/check-master-prompt.mjs` compares the numbers
below against `src/lib/prose.mjs` and `tools/qa-check.mjs` and fails the build when they drift. That check
exists because a prompt that describes the old rule is worse than no prompt: it teaches the writer to fail.

---

## 1. What this site is

Landed Math turns China's first-hand official numbers into money on a foreign buyer's invoice. English only.

Every article answers one question an importer can act on: **what does this measure cost me, per unit, in
dollars or percent, and from when?** An article that does not answer that is not an article for this site,
however well written.

Not a news summary. Not a policy explainer. A cost consequence with a date and a source.

## 2. Who it is for

Importers and platform sellers outside China who buy Chinese goods and have to price them. They are not
policy specialists. They will not read a second article to understand the first.

## 3. The four rules that are not negotiable

**3.1 Every number carries five parts.** Value, unit, period, source name, retrieval date. No exceptions, and
no number without them.

| part | what it is | example |
| --- | --- | --- |
| value | the number | `6.5` |
| unit | a word, not a symbol | `percent` |
| period | when it applies | `2026`, `Q3 2026`, `2026-10-17` |
| source | the document's own name | `Commission Implementing Regulation (EU) 2026/1740` |
| retrieved | the day you took it | `2026-10-17` |

**At least one substantive figure per article.** Not two records — two figures that name a cost.

Substantive means both halves:

| counts | does not count |
| --- | --- |
| a percentage, a rate, a duty, a tariff | a publication date, `24 September 2026` |
| an amount in a currency, `1,250 USD` | a document number, `C/2026/6637` |
| a weight, a volume, a quantity, `40 tonnes` | a case number, `AD760` |
| a duration that carries a cost, `18 days` | a retrieval date, `2026-10-17` |

A number beside a unit that reads "September 2026" is a date written in digits. Dates and document numbers are
provenance, which every article needs and every article already carries in `sources` — they are not data.

Fewer than one substantive figure means the documents do not support the subject: report `REQUIRES-RESEARCH`.
Do not reach for a date to make the count.

**3.2 Never invent.** No number, source, quotation, person, company, experience or case study that is not in
the material you were given. If you do not have it, say you do not have it.

The one exception is arithmetic on figures you were given: a per-unit cost computed from a published rate and
a stated shipment value is a number you may state, provided you show the calculation and label the inputs as
assumptions.

**3.2b If every figure rests on one document, say so.** One document supplying six numbers is one source, and a
single misreading of it would make every number wrong at once. The audit requires either a second document behind
the figures or a sentence in `## How confident` that names the limit - "Every figure in this article comes from that
single instrument" is enough, and so is "I have not cross-checked these against a second document". An article whose
figures comes from a single document and does not say so cannot be published.

**3.3 Accept the limits out loud.** The `## How confident` section names what is confirmed, what is inferred,
and what would change the answer. Every free source on this beat reports one side; admitting the limit is the
only thing here that nobody else does, so it is required, not decorative.

**3.4 No political framing.** Trade measures are reported as measures and as costs. No commentary on
sovereignty, ethnicity, territory, leadership or internal politics. `qa-check` carries a sensitive-term
blacklist that blocks the draft; do not test it.

## 4. Structure — every article, in this order

Ten sections. The headings are checked literally, so use these words.

| # | section | target words | what goes in it |
| --- | --- | --- | --- |
| 1 | `## AI Summary` | 40–100 | the finding first: what it is, and who pays |
| 2 | `## What happened` | 200–300 | the measure, its exact numbers, the document that says so |
| 3 | `## Why now` | 100–200 | the two-to-three-year thread and the window that is open |
| 4 | `## So what` | 250–350 | the judgement, the cost arithmetic, the counter-intuitive point |
| 5 | `## How confident` | 100–180 | confirmed / inferred / what would change this |
| 6 | `## For you` | 150–250 | at least three distinct reader groups, each with an action — **as a bulleted list, one `- **Label:**` per group** |
| 7 | `## The data point` | 60–100 | one number, in a callout block |
| 8 | `## FAQ` | 240–400 | three questions, each answered in 80–150 words |
| 9 | `## How we calculated this` | 50–120 | the formula in a fenced code block, with units |
| 10 | `## The point` | ~100 | the closing judgement |

**`## For you` is a list, not prose.** Each reader group is one line beginning with a hyphen and a bold label, and the
action follows a colon:

```
- **Importers holding in-transit cargo:** file every declaration that can be accepted before the deadline.
- **Importers with future orders not yet shipped:** recalculate the landed cost at the new rate before repricing.
- **Forwarders quoting on CIF:** the duty lands on the CIF value, so a higher freight quote raises it.
```

Three groups minimum, and they are three different situations rather than three names for the same importer. A bold
paragraph followed by an em dash is not a list item: the gate counts lines that start with a hyphen, and an article
that writes them as paragraphs fails it. The 2026-10-18 pipeline article was published with paragraphs and then
blocked the next run's preflight, which is the most expensive way to learn this.

**A listing page is not a document.** An index, a navigation page or a portal front page gives subject names
and dates; it cannot supply a rate. Figures come from the article body, never from a headline in a listing.

## 5. Length

**Target 1,500–2,000 words of prose.** The gate's hard band is wider because a cost-table article has a
structural floor: four tables, a definition block, a calculation section and a callout come to roughly 450
words of non-narrative content before any prose exists.

| | target | hard band |
| --- | --- | --- |
| with a cost table | 1,200–1,800 | 100–5,000 |
| without a cost table | 1,200–1,800 | 100–5,000 |

The tier is detected from the body — a markdown table carrying currency amounts — not declared. The ceiling
exists to stop padding, not to stop coverage. **Completeness and search intent come first; length is a
result, not a goal.**

## 6. Sources — where figures may come from

Primary documents only. A named, dated document, in one of these families:

**China**
- 海关总署 General Administration of Customs — announcements, tariff schedules, statistics
- 商务部 MOFCOM — trade remedy notices, including cacs.mofcom.gov.cn case records
- 财政部 Ministry of Finance + 国务院关税税则委员会 — tariff adjustments, export rebate schedules
- 国家税务总局 — export tax rebate rates
- 国家统计局 — PPI, CPI, industrial profit, output
- 新华社 / CCTV — only for a first-hand quotation from one of the above

**Elsewhere**
- European Commission — Official Journal, trade defence, CBAM
- US Federal Register — notices, proclamations, determinations
- The destination country's own customs or trade authority
- The case document itself: a regulation number, a notice number, a decision number

**Never**: a blog, an aggregator, a news rewrites of a notice, a social post, or another article on this
site. If a number only exists in coverage, the number is not sourced.

## 7. Frontmatter — the fields the build requires

```
title        <= 120 characters, the one line a result shows
subtitle     <= 160
description  <= 300
publishDate  YYYY-MM-DD
reviewBy     YYYY-MM-DD - the date the underlying facts change, not an arbitrary interval
category     trade-policy | platforms | supply-chain | sourcing | logistics
audience     importer | platform-seller | both
stakes       priced | directional
information_gain  custom-calculation | primary-source-analysis | ...
target_keyword    the phrase a reader would search, 2-5 words, lower case
figures      one or more five-part records naming a cost
sources      the named documents
```

`articleNumber` is assigned by the pipeline from the collection, not by you.

## 8. Voice

Direct. Short sentences. A number in the first two sentences. No throat-clearing.

Banned: "it is important to note", "in today's fast-paced", "delve", "landscape", "unlock", "seamless",
"navigate the complexities", and every hedge — might, may, could, possibly, arguably, it seems. Replace the
hedge with the condition that makes it true: not "duties may rise" but "the duty rises to 18% if the
Commission sets the higher rate".

No URLs in the body. Name the document; the `sources` field carries the provenance.

## 9. When the material is not enough

Report it. Do not write a thinner article, do not widen the claim, do not reach for a number you were not
given.

- No subject a document can support → `REQUIRES-RESEARCH`
- Fewer than five sourced figures → `REQUIRES-RESEARCH`
- The subject is already published → `DUPLICATE-SUBJECT`

A day with no article is a correct outcome. An invented number that looks real is the worst outcome
available, because it is the one nobody catches.

## 10. What happens after the draft

1. `check_draft` runs the structural check. It returns every blocking rule with what the rule wants, the
   edit that satisfies it, and a fragment that would pass. Fix in that order; do not rewrite the whole
   article.
2. When the structure clears, the build and the reviewer run.
3. `publish_draft` is the only route into `src/content/blog/`, and it refuses a draft that has not passed.
4. The pipeline commits, pushes, and Cloudflare deploys.

Nothing here is advisory. The gates are the standard, and they carry their own instructions when they fail.

---

*Everything else — the benchmark studies, the five-year plan, the source inventory with its reachability
notes, the lessons log — is in `docs/`. Read it as a human, when you are deciding what to build next. The
automation does not read it, and does not need to.*
