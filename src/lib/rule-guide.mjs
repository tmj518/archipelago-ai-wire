/**
 * What each blocking rule wants, and how to satisfy it.
 *
 * ## Why this exists
 *
 * Every gate on this site reported what was wrong and stopped there. `substantive figures >= 2 · only 0 figures in
 * frontmatter` is accurate and useless to whoever has to fix it: it does not say what a figure record needs, it
 * does not say where the records go, and it does not say what a passing one looks like. The writer was left to
 * infer the structure from the failure text, and a model inferring a structure from an error message is how you
 * get three revision attempts that each fix one thing and break another.
 *
 * So every rule carries three things beyond its verdict:
 *
 *   want     the structure the rule is checking for, stated as a shape
 *   how      the concrete edit that satisfies it, in the order to do it
 *   example  a passing fragment, small enough to copy
 *
 * ## Why a table rather than a fourth argument to every add()
 *
 * Twenty-one blocking rules are defined across eight hundred lines of qa-check.mjs. A guidance object passed at
 * every call site would be a second thing to keep in sync with the check, and the drift would be invisible -
 * guidance that describes the old rule is worse than none. One table keyed on the rule name means a rule that
 * gains guidance shows up in one diff, and a rule that has none is reported as missing rather than silently
 * unguided.
 *
 * ## The one structural rule that matters most
 *
 * A failing article is not rewritten from scratch. It is edited against the list, in the order the list is
 * given, and re-checked. The guidance is written for that loop, which is why `how` is imperative and why every
 * entry names the smallest edit that clears the rule.
 */

/** `key` is the rule name as it appears in a qa-check result. Entries may be partially interpolated. */
export const RULE_GUIDE = {
  /*
   * The audit's L3, not a structural rule: it runs in preflight rather than in the draft loop, but it is the one
   * that failed a freshly published article and would have turned the next run red. It belongs here so the phrase
   * it looks for is written down where the writer-facing guidance lives.
   */
  "single-source disclosure": {
    want: "When every figure traces to one document, \"## How confident\" says so in one sentence.",
    how: [
      "Count the distinct documents behind the figures. If it is one, the article rests on a single reading.",
      "Add a sentence to ## How confident naming that limit - for example: \"Every figure in this article comes from that single instrument.\"",
      "The audit accepts: single source, sole source, single document, single notice, single instrument, one document, not cross-checked, no second source.",
      "A second document behind at least one figure satisfies the rule without a sentence, but the sentence is the honest version.",
    ],
    example: "**Confirmed.** ... Every figure in this article comes from that single instrument.",
  },

  "text encoding": {
    want: "A UTF-8 file whose curly quotes and em dashes are the real characters, not replacement glyphs.",
    how: [
      "Do not rewrite the whole file through a shell or PowerShell redirect - that is what corrupts it.",
      "Replace each U+FFFD with the character it stood for: “ ” for quotes, — for a dash, ’ for an apostrophe.",
      "Write the file with an explicit UTF-8 encoding, and re-check that no U+FFFD remains.",
    ],
    example: "the duty is 6.5% — not \"6.5%\" with a mangled glyph",
  },

  "substantive figures >= 2": {
    want: "At least two figures that name a cost: a number, and a unit that says what it measures.",
    how: [
      "A date (\"24 September 2026\"), a document number (\"C/2026/6637\") or case number is NOT a figure here.",
      "What counts: a percentage, a rate, a duty, a tariff, an amount in a currency, a weight, a quantity, or a",
      "duration that carries a cost - days of delay, months of retroactivity.",
      "Check the unit, not only the value. A number whose unit reads \"September 2026\" is a date written in digits.",
      "If the documents hold fewer than two cost figures between them, the subject is not ready: report",
      "REQUIRES-RESEARCH. Do not reach for a date to make the count.",
    ],
    example: "figures:\n  - value: \"6.5\"\n    unit: \"percent\"\n    period: \"2026\"\n    source: \"Commission Implementing Regulation (EU) 2026/1740\"\n    retrieved: \"2026-10-17\"",
  },

  "figure five-part records": {
    want: "Every figure carries value, unit, period, source and retrieved - all five, no exceptions.",
    how: [
      "For each record, check the five keys are present and non-empty.",
      "`unit` is a word: percent, USD, days, tonnes. Not a symbol.",
      "`period` is when the number applies: 2026, Q3 2026, or a date.",
      "`source` is the document's own name, not a URL and not \"official data\".",
      "`retrieved` is the date you took it, as YYYY-MM-DD.",
    ],
    example: "  - value: \"12.23\"\n    unit: \"percent\"\n    period: \"2026\"\n    source: \"Eurasian Economic Commission Decision No. 74/2026\"\n    retrieved: \"2026-10-17\"",
  },

  "information_gain declared": {
    want: "A value for `information_gain:` naming what this piece adds that a search result does not.",
    how: [
      "Choose one of the allowed values - the schema's enum is the list.",
      "`custom-calculation` when you compute a per-unit cost from published figures.",
      "`primary-source-analysis` when you read the document itself rather than coverage of it.",
      "Do not leave it empty and do not invent a new value; the build rejects an unknown enum member.",
    ],
    example: "information_gain: custom-calculation",
  },

  "primary-source cited": {
    want: "If `information_gain` claims primary-source analysis, name the document identifier in the frontmatter.",
    how: [
      "Add the document's own identifier to the source string: a regulation number, a notice number, a case number.",
      "A URL is not an identifier. \"The Commission\" is not an identifier.",
      "If there is no identifier because you did not read a primary document, change `information_gain` instead of inventing one.",
    ],
    example: "sources:\n  - \"Commission Implementing Regulation (EU) 2026/1740, Art. 7(1)\"",
  },

  "3R review": {
    want:
      "A piece touching race, religion or royalty needs a named human reviewer recorded in the frontmatter before it can publish.",
    how: [
      "Add a `human_review:` block with the reviewer's name and the date they read it.",
      "Do not remove the subject to get past the gate: these are reportable topics and the site exists to explain them.",
      "Do not invent a reviewer. If nobody has read it, the piece waits — a quarantined piece is a correct outcome.",
      "The record travels with the article on purpose, so the review cannot be separated from the text it covered.",
    ],
    example:
      "human_review:\n  reviewer: \"Nurul Aina binti Rahman\"\n  date: 2026-10-26\n  note: \"Checked attribution and legal risk; no allegations against named persons.\"",
  },

  "target_keyword declared": {
    want: "The phrase a reader would search for, in `target_keyword:`.",
    how: [
      "Use the exact phrase, lower case, no punctuation.",
      "Two to five words. A sentence is not a keyword.",
      "It must appear in the title or the first paragraph, or the page competes for a phrase it never says.",
    ],
    example: "target_keyword: cellulose ethers anti-dumping duty",
  },

  "reviewBy declared": {
    want: "A `reviewBy:` date after which the article should be re-read.",
    how: [
      "Pick the date the underlying facts change, not an arbitrary three months.",
      "Provisional duty dates, comment deadlines and decision dates are the natural anchors.",
      "Format YYYY-MM-DD. A date without hyphens fails the same rule.",
    ],
    example: "reviewBy: 2027-04-24",
  },

  "calculation shown to reader": {
    want: "A `## How we calculated this` section containing a fenced code block with the formula.",
    how: [
      "Add the section if it is missing - it is one of the required headings.",
      "Inside it, put the arithmetic in a fenced block (three backticks), not in prose.",
      "Write the formula with the real numbers from your figures, and state each unit.",
    ],
    example: "```\nduty = CIF value x rate\n25,000 = 50,000 x 0.50\n```",
  },

  "AI summary 40-100 words": {
    want: "A `## AI Summary` of 40 to 100 words: the finding, the number, and who it lands on.",
    how: [
      "Count the words under the heading, up to the next `##`.",
      "Over 100: cut background first, keep the number and the consequence.",
      "Under 40: add the figure and its unit, and the one sentence on who pays.",
    ],
    example: "## AI Summary\n\nCase AD760 opened on 24 September 2026 against cellulose ethers from China and Korea. No duty exists today. The earliest provisional duty is 24 April 2027 and the investigation closes by 24 November 2027. The cost sits in the gap: registration can be ordered while nothing is payable, and a later rate is collected on volume registered from that date.",
  },

  "V6.2 sections": {
    want: "Ten sections in this order: AI Summary, What happened, Why now, So what, How confident, For you, The data point, FAQ, How we calculated this, The point.",
    how: [
      "Compare your `##` headings against the list and add whichever are missing, in this order.",
      "The wording is checked, so use these headings rather than synonyms.",
      "Do not delete existing sections to make room; the piece needs all ten.",
    ],
    example: "## AI Summary\n## What happened\n## Why now\n## So what\n## How confident\n## For you\n## The data point\n## FAQ\n## How we calculated this\n## The point",
  },

  "How confident section present": {
    want: "A `## How confident` section. It is required on every article from 2026-10-15 onward.",
    how: [
      "Add the heading if it is missing.",
      "Inside it, be explicit about what rests on a single document and what is inferred.",
      "Do not claim more certainty than the figures support - the reviewer checks this against the prose.",
    ],
    example: "## How confident\n\n**Confirmed.** The case number, the opening date and the scope are in the notice itself.\n\n**Inferred.** The rate range rests on two concluded cases with published duties; AD760 has set no rate.",
  },

  "How confident has all three parts": {
    want: "The confidence section must say what is confirmed, what is inferred, and what would change the answer.",
    how: [
      "Add the missing part as its own short paragraph, in that order.",
      "\"What would change this\" is the part most often left out: name the event or figure that would move the conclusion.",
      "Use the same three labels each time so a reader can find them.",
    ],
    example: "**Confirmed.** ...\n\n**Inferred.** ...\n\n**What would change this.** A provisional rate above 18% would move the exposure past the range priced here.",
  },

  "FAQ 3-5 questions, 80-150 word answers": {
    want: "Three to five questions, each answered in 80 to 150 words.",
    how: [
      "Write each question as a bold line ending in a question mark, on its own line, then the answer as a paragraph.",
      "A `### heading` also works - the check accepts both, but the question mark is what makes a bold line count.",
      "Count each answer's words. Under 80: add the number and its consequence. Over 150: cut background.",
      "Do not repeat the same question in different words; the check counts them, the reader notices.",
    ],
    example: "**Is there a duty right now?**\nNo. Case AD760 opened on 24 September 2026 and no duty exists on the date of writing. The earliest a provisional duty can be imposed is 24 April 2027, seven months from publication, and the outer limit is 24 May 2027 at eight months under Article 7(1) of Regulation (EU) 2016/1036.",
  },

  "comparison table present": {
    want: "At least four rows of a markdown table, comparing the options or the rates.",
    how: [
      "A table row is a line starting and ending with a pipe that is not the header separator.",
      "The natural table for this site is rate against cost on a stated shipment.",
      "Every cell holding a number must trace to a figure record.",
    ],
    example: "| Duty rate | Cost on a 50,000-dollar container |\n| --- | --- |\n| 10% | 5,000 |\n| 20% | 10,000 |\n| 30% | 15,000 |",
  },

  "definition block present": {
    want: "At least one blockquote - a quoted definition from the document, set apart.",
    how: [
      "Quote the operative words from the source, in quotation marks, as a `>` block.",
      "Attribute it on the same line: the regulation, the article, the date.",
      "One is enough. Do not pad with quotes that carry no definition.",
    ],
    example: "> \"A provisional duty may be imposed no earlier than 60 days from the initiation of the investigation.\"\n> — Regulation (EU) 2016/1036, Article 7(3)",
  },

  "audience segments >= 3": {
    want: "At least three distinct groups of readers named and told what to do.",
    how: [
      "In `## For you`, write one bolded segment per line, then its instruction.",
      "Three segments means three different situations, not three names for importers.",
      "Each line should end in an action: pass the cost on, reprice, pull volume forward, ask for a certificate.",
    ],
    example: "- **Importers of cellulose ethers from China:** treat the registration order as the trigger date.\n- **Buyers whose grade sits near the scope edge:** the CAS numbers are the test, not the trade name.\n- **Forwarders quoting on CIF:** the duty lands on the CIF value, so a higher freight quote raises it.",
  },

  "no URLs in body": {
    want: "No URLs in the prose. Sources are named, not linked.",
    how: [
      "Remove the URL and name the document instead: its number, its article, its date.",
      "The frontmatter `sources:` list is where provenance lives; the body does not need to repeat it.",
      "An internal link to another article on this site is fine - it is a path, not a URL to a third party.",
    ],
    example: "under Article 7(1) of Regulation (EU) 2016/1036  -  not https://eur-lex.europa.eu/...",
  },

  "no hedging words": {
    want: "No hedging: might, may, could, possibly, arguably, it seems, perhaps.",
    how: [
      "Replace the hedge with the condition that makes it true: \"may rise\" becomes \"rises if the rate exceeds 18%\".",
      "Where the documents genuinely do not say, say that instead of hedging: \"the notice sets no rate\".",
      "Keep `may` only when quoting a regulation that uses it.",
    ],
    example: "\"the duty rises to 18% if the Commission sets the higher rate\"  -  not \"the duty may rise\"",
  },

  "no AI cliches": {
    want: "No phrases that mark the text as machine-written: \"it is important to note\", \"in today's fast-paced\", \"delve\", \"landscape\", \"unlock\", \"seamless\".",
    how: [
      "Delete the phrase and start with the fact. Most of these are throat-clearing before the first real sentence.",
      "If a sentence only exists to introduce the next one, cut it entirely.",
      "Check the first sentence of every section - that is where they accumulate.",
    ],
    example: "\"The scope is six CAS numbers.\"  -  not \"It is important to note that the scope encompasses six CAS numbers.\"",
  },

  "schema string limits": {
    want: "title <= 120 characters, subtitle <= 160, description <= 300 - and inside the tighter targets the writer is given.",
    how: [
      "Run node tools/trim-draft.mjs <draft> --write. It shortens an over-long value on a word boundary and changes nothing else.",
      "If you are editing by hand, shorten the tail - the end of a subtitle is where the filler lives.",
      "Do not shorten a title by deleting the distinguishing noun; cut the clause after it instead.",
      "check_draft already runs the trim, so a remaining failure means the value is over the hard schema limit rather than the target.",
    ],
    example: "a subtitle at 194 characters trims to 155 without losing the date or the duty",
  },
  "revisions consistent": {
    want: "The revision record and the dates agree: if revisions is non-empty, updatedDate is set and is not older than the newest revision.",
    how: [
      "Add updatedDate: YYYY-MM-DD to the frontmatter, matching the newest revision date.",
      "If the piece was never revised, remove the revisions block rather than leaving an empty one.",
      "The dates must be the real dates of the edits, not the publish date copied across.",
    ],
    example: "revisions: one entry dated 2026-10-17, and updatedDate: 2026-10-17 above it",
  },
  "sensitive-term screen": {
    want: "No terms on the site's sensitive list, in a piece about trade policy.",
    how: [
      "Read the failing term and decide whether the sentence needs it at all.",
      "Usually it does not: the trade consequence can be stated without it.",
      "If it is a quotation from the document, paraphrase the operative words instead of quoting the phrase.",
    ],
    example: "state the measure and the cost, not the political framing around it",
  },
};

/**
 * The guidance for a rule, or null.
 *
 * Rule names are interpolated in some checks (`prose ${min}-${max} words (${tier})`), so an exact match is tried
 * first and then a prefix match on the stable part.
 */
export function guideFor(rule) {
  if (!rule) return null;
  if (RULE_GUIDE[rule]) return RULE_GUIDE[rule];
  /* "prose 1800-2200 words (standard)" -> the prose tier rule. */
  if (/^prose \d+-\d+ words/.test(rule)) {
    return {
      want: "The body must fall inside the word band for the article's tier.",
      how: [
        "Count the words under the frontmatter, excluding headings and tables.",
        "Over the band: cut the least load-bearing paragraph - usually the second half of `## What happened`.",
        "Under the band: add the arithmetic in `## How we calculated this`, or one more audience segment.",
        "Do not pad with background; the band exists because a thin piece and a bloated one both read as filler.",
      ],
      example: "standard tier: 1,800 to 2,200 words of prose",
    };
  }
  return null;
}

/** Every rule name that has guidance, for the check that verifies coverage. */
export function guidedRules() {
  return Object.keys(RULE_GUIDE);
}
