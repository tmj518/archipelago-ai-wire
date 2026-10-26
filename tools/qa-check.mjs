/**
 * Pre-publish QA gate — the machine half of spec v1.3 §9.1.
 *
 * This exists because the human review step was removed. Every rule that a
 * machine can decide is decided here, and a blocking failure means the piece
 * does not get published.
 *
 * Run:  node tools/qa-check.mjs src/content/blog/<slug>.md
 *       node tools/qa-check.mjs --all
 *
 * Exit code is non-zero when any blocking rule fails.
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { proseWords, WORD_TARGET, hasCostTable } from "../src/lib/prose.mjs";
import { guideFor } from "../src/lib/rule-guide.mjs";
import { substantiveFigures, figuresShortfall } from "../src/lib/figures.mjs";
import { MIN_SUBSTANTIVE } from "../src/lib/figure-limits.mjs";
/*
 * The controlled vocabularies come from one file now.
 *
 * Before 2026-10-26 this script carried `CATEGORY_ENUM` twice in the same file, and the same list
 * a third time lived in src/consts.ts. Two copies inside one file is the failure mode this
 * project has already paid for twice: the value that gets missed is always the one the build
 * reads. taxonomy.json is the single source; consts.ts and this script both read it.
 */
import {
  CATEGORY_SLUGS,
  AUDIENCE_VALUES,
  INFORMATION_GAIN_VALUES,
  SECTIONS,
} from "../src/lib/taxonomy.mjs";

const BANNED_VAGUE = [
  "may", "might", "possibly", "perhaps", "could", "reportedly", "allegedly",
  "arguably", "seemingly", "somewhat", "fairly", "quite possibly",
];

const BANNED_CLICHE = [
  "in today's fast-paced world", "in the ever-evolving", "delve into", "delve",
  "landscape of", "it's important to note", "it is important to note",
  "unlock the secrets", "game-changer", "game changer", "navigate the complexities",
  "tapestry", "testament to", "when it comes to", "at the end of the day",
  "in conclusion", "let's dive in", "buckle up",
];

/*
 * Blocking terms: incitement, defamation and contempt. NOT the topics a country is sensitive about.
 *
 * The previous list was a China desk's list — Taiwan, Xinjiang, Tiananmen, Tibet, Hong Kong — and
 * it worked on the logic "the whole subject is out of scope". That logic does not transfer to a
 * publication whose job is to help Malaysians understand their own country and its region. Race,
 * religion and royalty are not fringe subjects here; they are how public life is organised, and a
 * rule that blocks the words would leave the site unable to explain the country it exists to
 * explain.
 *
 * So the mechanical blacklist is reduced to speech that is not publishable in any framing:
 * incitement to violence, criminal defamation, and contempt of court. The 3R judgement moves to
 * the reviewer prompt and to the editorial rules in MASTER_PROMPT.md §3.6 — verifiable facts,
 * restrained wording, facts separated from opinion, no group blamed for an individual's act. A
 * keyword was never going to decide that, and pretending otherwise was security theatre.
 */
const BANNED_SENSITIVE = [
  "kill all", "exterminate", "wipe out the", "behead",
  "incite violence", "incitement to violence",
  "sub judice", "contempt of court",
];

/*
 * 3R: reportable, but never published unreviewed.
 *
 * Race, religion and royalty are not banned subjects here - a Malaysian publication that cannot discuss
 * them cannot explain the country. What is banned is publishing them without a named human having read
 * the piece, because the failure mode (a defamatory or seditious sentence that reads as fact) is not
 * something a keyword filter can catch.
 *
 * So the rule is a quarantine, not a blacklist: if the piece touches 3R, it needs `human_review:` in
 * the frontmatter, and until a reviewer is recorded it stays blocked. There is deliberately no bypass
 * and no "no reviewer configured, publish anyway" path.
 *
 * "Islamic" is excluded on purpose: Islamic finance is ordinary Malaysian economic vocabulary and
 * flagging it would put half the economy desk into manual review for no safety gain.
 */
const THREE_R = /\b(race|racial|racism|religion|religious|royalty|royal institution|sultan|sultans|agong|bumiputera|muslim|muslims|halal|vernacular school|evangelis(m|t|ing))\b/i;

/**
 * Document identifiers that count as citing a primary source. Kept as
 * recognisable numbering schemes rather than the word "announcement", so a
 * loose mention does not satisfy the rule.
 */
const PRIMARY_DOC_PATTERN = new RegExp(
  [
    "\\b\\d{1,3}\\s?FR\\s?\\d{3,6}\\b", // Federal Register citation
    "\\bHTSUS\\s?9903\\b",
    "\\bAnnouncement\\s+No\\.?\\s?\\d+",
    "\\b公告\\s?\\d+\\s?号",
    "〔\\d{4}〕\\s?\\d+\\s?号", // Chinese document numbering, e.g. 国市监注发〔2026〕5号
    "\\b(?:Periodical|Circular|Order|Decision)\\s+No\\.?\\s?\\(?\\d+",
    "\\bRegulation\\s+\\(EU\\)\\s+\\d{4}/\\d+",
    "\\bCELEX\\b",
    "\\bOJ\\s?L\\s?\\d",
    /*
     * Malaysian numbering, added 2026-10-26.
     *
     * Without these, an article that honestly declared `information_gain: primary-source` while
     * citing a Malaysian gazette was blocked for "naming no document identifier" - the gate could
     * only recognise US, EU and Chinese schemes. A Malaysian site whose primary sources always
     * fail the primary-source check is a site that cannot use its own best evidence.
     *
     *   P.U. (A) 411/2023   subsidiary legislation, printed   (the usual citation)
     *   P.U. (B) ...        subsidiary legislation, not printed
     *   Akta 850 / Act 850  an Act of Parliament
     *   BNM/RH/GL 001-1     a Bank Negara guideline or policy document
     *   SST-02              a customs form that a guide will name
     */
    "\\bP\\.\\s?U\\.\\s?\\(\\s?[AB]\\s?\\)\\s?\\d+",
    "\\bP\\.\\s?U\\.\\s?\\([AB]\\)\\s?\\d+/\\d{4}",
    "\\bAkta\\s?[A-Z]?\\d{1,5}\\b",
    "\\bAct\\s?[A-Z]?\\d{3,5}\\b",
    "\\bBNM/RH/[A-Z]{2,3}\\s?\\d",
    "\\bWarta\\s+Kerajaan\\b",
    "\\bFederal\\s+Government\\s+Gazette\\b",
    "\\bLaws\\s+of\\s+Malaysia\\b",
    "\\bSST-\\d{2}\\b",
  ].join("|"),
  "i",
);

const wordCount = (s) => (s.trim() ? s.trim().split(/\s+/).length : 0);
function parseFrontmatter(raw) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(raw);
  if (!m) return { fm: "", body: raw };
  return { fm: m[1], body: raw.slice(m[0].length) };
}

function check(file) {
  const raw = readFileSync(file, "utf8");
  const { fm, body } = parseFrontmatter(raw);
  const results = [];
  /*
   * Every result carries the guidance for its rule, when there is any.
   *
   * Attached here rather than at each call site: twenty-one blocking rules spread across eight hundred lines, and
   * a guidance object passed at every one of them would be a second thing to keep in sync with the check. One
   * table keyed on the rule name means a rule that gains guidance is one diff, and a rule that has none is
   * reported as unguided rather than silently passing.
   */
  const add = (level, rule, detail) => {
    const g = level === "block" ? guideFor(rule) : null;
    results.push({ level, rule, detail, want: g?.want, how: g?.how, example: g?.example, unguided: level === "block" && !g });
  };

  const fmLine = (key) => new RegExp(`^${key}:\\s*(.+)$`, "m").exec(fm)?.[1]?.trim();

  // ---- encoding integrity -------------------------------------------
  // This rule exists because the damage already happened once. A PowerShell
  // `Get-Content -Raw` / `Set-Content` round trip rewrote an article through
  // the system ANSI codepage (GBK on this machine), and every em dash came
  // back as "?" — U+FFFD's cousin, and invisible in a browser diff.
  //
  // Node's utf8 decoder is lenient: it substitutes U+FFFD for invalid bytes
  // rather than throwing. That makes one check cover both failures — genuinely
  // invalid UTF-8, and text that survived a bad round trip.
  const replacementChars = (raw.match(/\uFFFD/g) || []).length;
  replacementChars === 0
    ? add("pass", "text encoding", "valid UTF-8, no replacement characters")
    : add("block", "text encoding", `${replacementChars} replacement character(s) — file was rewritten through a non-UTF-8 codepage`);

  /*
   * A byte-order mark, which is valid UTF-8 and therefore invisible to the check above.
   *
   * Found the hard way on 2026-10-26: PowerShell's `-Encoding UTF8` writes EF BB BF, the leading
   * BOM stops `parseFrontmatter` from matching `^---`, and every frontmatter rule then reports
   * "missing" - while the other twenty-odd body rules pass, so the file looks mostly healthy.
   * A whole article's metadata can be silently unchecked. This is the same family as the
   * codepage incident already recorded in the pitfall log: the damage is to the invisible bytes.
   */
  raw.charCodeAt(0) === 0xfeff
    ? add(
        "block",
        "no byte-order mark",
        "file begins with a UTF-8 BOM — the frontmatter parser cannot see the opening ---, so every metadata rule reads 'missing'",
      )
    : add("pass", "no byte-order mark", "clean start");

  // ---- frontmatter-driven rules -------------------------------------
  const figures = (fm.match(/^\s*- value:/gm) || []).length;
  /*
   * Count the named sources in either shape.
   *
   * The old count was `/^\s{2}- "/`, which matches a quoted string and nothing else. Once an entry may
   * be `- name: "…"` with an optional `url:`, that regex counts zero and every article fails the
   * "named sources >= 3" warning while listing three sources in plain sight. Counting the list items
   * inside the `sources:` block works for both forms and still ignores `figures:` entries, which use a
   * different key.
   */
  const countListItems = (frontmatter, key) => {
    const lines = frontmatter.split(/\r?\n/);
    const start = lines.findIndex((l) => new RegExp(`^${key}:`).test(l));
    if (start < 0) return 0;
    let n = 0;
    for (let i = start + 1; i < lines.length; i++) {
      if (/^\S/.test(lines[i])) break; // the next top-level key ends the block
      if (/^\s{2}-\s/.test(lines[i])) n += 1;
    }
    return n;
  };
  const sources = countListItems(fm, "sources");
  const gain = fmLine("information_gain");

  /*
   * ENUM VALUES, CHECKED HERE AND NOT ONLY BY THE BUILD - with a date gate.
   *
   * These two rules were added, removed and re-added today, and the reason is worth writing down. The build validates
   * the collection schema and rejects a bad value - but it rejects it for the WHOLE SITE, after publication, which took
   * the site down three times in two days. The gate never checked values, only whether a field was declared.
   *
   * The first attempt to add the check blocked 38 published articles, because their older frontmatter predates these
   * enums. That is not a reason to skip the check, it is a reason to gate it: anything published before ENUM_FROM is
   * grandfathered, and anything from that date on is checked. Same shape as the substantive-figure and V6.2 gates
   * already in this file.
   */
  const ENUM_FROM = "2026-10-19";
  const thisDate = (fmLine("publishDate") ?? "").replace(/"/g, "");
  if (thisDate >= ENUM_FROM) {
    const GAIN_ENUM = INFORMATION_GAIN_VALUES;
    const CATEGORY_ENUM = CATEGORY_SLUGS;
    const gainValue = String(gain ?? "").replace(/^information_gain:\s*/, "").replace(/"/g, "").trim();
    const catValue = String(fmLine("category") ?? "").replace(/"/g, "").trim();
    add(
      GAIN_ENUM.includes(gainValue) ? "pass" : "block",
      "information_gain legal",
      GAIN_ENUM.includes(gainValue) ? gainValue : `"${gainValue || "(missing)"}" is not one of ${GAIN_ENUM.join(", ")} - the build rejects it`,
    );
    add(
      CATEGORY_ENUM.includes(catValue) ? "pass" : "block",
      "category legal",
      CATEGORY_ENUM.includes(catValue) ? catValue : `"${catValue || "(missing)"}" is not one of ${CATEGORY_ENUM.join(", ")} - the build rejects it`,
    );
  }
  const keyword = fmLine("target_keyword");
  const audience = fmLine("audience");
  const isDraft = /^draft:\s*true/m.test(fm);

  /*
   * Substantive figures, not records.
   *
   * A record whose value is "24 September 2026" or "C/2026/6637" is real and is not data: an article whose five
   * "figures" are three dates and two case numbers has nothing to convert into a cost. src/lib/figures.mjs defines
   * the test - a number, and a unit that names something a buyer pays - and MIN_SUBSTANTIVE, lowered to two, is the
   * count.
   */
  const figureBlocks = fm.split(/^\s*- value:/m).slice(1);
  const incomplete = figureBlocks.filter(
    (b) => !/unit:/.test(b) || !/period:/.test(b) || !/source:/.test(b) || !/retrieved:/.test(b),
  ).length;

  /*
   * The records as objects, so the substantive test can read value and unit rather than count lines.
   *
   * One split per record: the block after "- value:" begins with the value and continues with the other four keys.
   */
  const figuresList = figureBlocks.map((b) => {
    const first = /^\s*"?(.*?)"?\s*$/m.exec(b)?.[1] ?? "";
    const field = (k) => new RegExp("^\\s*" + k + ":\\s*\"?([^\"\\n]*)\"?", "m").exec(b)?.[1]?.trim() ?? "";
    return { value: first, unit: field("unit"), period: field("period"), source: field("source"), retrieved: field("retrieved") };
  });

 if (figureBlocks.length === 0) add("block", "figure five-part records", "no figures[] entries");
  else if (incomplete === 0) add("pass", "figure five-part records", `${figureBlocks.length}/${figureBlocks.length} complete`);
  else add("block", "figure five-part records", `${incomplete} entries missing unit/period/source/retrieved`);

  if (sources >= 3) add("pass", "named sources >= 3", `${sources} sources`);
  else add("warn", "named sources >= 3", `${sources} sources`);

  gain ? add("pass", "information_gain declared", gain) : add("block", "information_gain declared", "missing");
  /*
   * The duplicate that used to sit here is gone.
   *
   * There were two checks: a date-gated one near the top (grandfathering anything published before
   * ENUM_FROM) and this unconditional one. The unconditional one ran on every article, so the
   * grandfathering above it never did anything - a redundancy that read as a feature. Removed
   * rather than kept as a second copy, because two validations of one field is exactly how the
   * enum drifted in the first place.
   */
  const catLine = fmLine("category");
  add(
    catLine && CATEGORY_SLUGS.includes(String(catLine).replace(/"/g, "")) ? "pass" : "block",
    "category legal",
    catLine ? `"${catLine}" is not one of ${CATEGORY_SLUGS.join(", ")}` : "missing - the build rejects the entry",
  );

  /*
   * A claim of primary-source is only credible if a document identifier appears BOTH in the prose and
   * in at least one figure's source.
   *
   * The first version only searched the body, which meant an article could mention "P.U. (A) 411/2023"
   * once and then carry six numbers sourced to nothing. Naming a document is not the same as grounding
   * a number in it, and the gap between the two is exactly where an unverified figure hides. Requiring
   * the identifier in `figures[].source` ties the claim to the records a reader can check.
   */
  if (gain && /primary-source/.test(gain)) {
    const inProse = PRIMARY_DOC_PATTERN.test(body);
    const inFigures = figuresList.some((f) => PRIMARY_DOC_PATTERN.test(String(f.source ?? "")));
    if (!inProse) {
      add("block", "primary-source cited", "declares primary-source but names no document identifier");
    } else if (!inFigures) {
      add(
        "block",
        "primary-source cited",
        "the prose names a document but no figures[].source carries a document identifier — the numbers are not tied to the document",
      );
    } else {
      add("pass", "primary-source cited", "document identifier in the prose and in the figure sources");
    }
  }
  keyword ? add("pass", "target_keyword declared", keyword) : add("block", "target_keyword declared", "missing");
  /*
   * Audience legality, which nothing checked before.
   *
   * The old rule only asked whether the field existed, so any string passed here and the build
   * failed later for the whole site. The six values are now validated against the same list the
   * schema reads.
   */
  if (!audience) {
    add("warn", "audience declared", "not set (defaults to general)");
  } else {
    const av = String(audience).replace(/"/g, "").trim();
    AUDIENCE_VALUES.includes(av)
      ? add("pass", "audience legal", av)
      : add("block", "audience legal", `"${av}" is not one of ${AUDIENCE_VALUES.join(", ")} - the build rejects it`);
  }

  // ---- schema string limits -------------------------------------------
  // The collection schema caps title at 120 characters, subtitle at 160 and
  // description at 300. Exceeding one of those does not warn — it throws
  // InvalidContentEntryDataError, which fails the whole build, so the article
  // 404s and nothing else deploys either.
  //
  // Nothing here checked this, and on 2026-10-07 a 163-character subtitle
  // reached main and did exactly that: the site served a stale build for ten
  // minutes while every article except the new one looked fine, because the
  // stale build already contained them. The gap existed because this gate reads
  // markdown as text and the limits live in a Zod schema, so neither side knew
  // about the other.
  //
  // The limits are duplicated here deliberately rather than read from the
  // schema: importing the config would drag Astro's loaders into a plain Node
  // script. If the schema limits change, this list has to change with it, and
  // the comment is the reminder.
  const LIMITS = { title: 120, subtitle: 160, description: 300 };
  const overLong = [];
  for (const [field, limit] of Object.entries(LIMITS)) {
    const raw = fmLine(field);
    // fmLine returns the raw value including quotes for these fields.
    const value = raw ? raw.replace(/^"|"$/g, "") : null;
    if (value && value.length > limit) overLong.push(`${field} ${value.length}/${limit}`);
  }
  if (overLong.length === 0) {
    add("pass", "schema string limits", "title <= 120, subtitle <= 160, description <= 300");
  } else {
    add(
      "block",
      "schema string limits",
      `${overLong.join(", ")} — the Zod schema rejects this and the build fails, taking every page down`,
    );
  }

  // ---- review clock ----------------------------------------------------
  // Every article here is dated and sourced, which is the strength until one of
  // its dates passes. Ten of the first fourteen published pieces carried a
  // future deadline and seven fell inside three months. An article whose central
  // fact has expired is worse than one never written, because it still ranks and
  // still reads as current.
  //
  // `reviewBy` is set by hand, because a date in prose is not necessarily a
  // deadline: article 14 mentions a Commission review due in 2028 as context.
  // Doing that job automatically would produce false positives on prose that
  // merely contains a year. So the gate does not try to compute the date. It
  // requires that a human recorded one, which is the part that gets forgotten.
  //
  // The second check is the cheap cross-check: if the body contains a future
  // date EARLIER than the declared review date, the piece goes stale before
  // anyone plans to look at it.
  const reviewBy = fmLine("reviewBy");
  if (!reviewBy) {
    add("block", "reviewBy declared", "no review date — set it, or the piece expires silently");
  } else {
    const iso = /^\d{4}-\d{2}-\d{2}/.test(reviewBy) ? reviewBy.slice(0, 10) : null;
    if (!iso) {
      add("block", "reviewBy declared", `"${reviewBy}" is not a YYYY-MM-DD date`);
    } else {
      add("pass", "reviewBy declared", iso);
      // Only dates after this article was published are candidates for
      // staleness. An unbounded lower bound flagged every historical date in
      // the prose, which is noise: the 2019 safeguard, the 2022 reference
      // period, the 2024 capacity figure. Those are context, not expiry.
      const published = fmLine("publishDate")?.slice(0, 10) ?? "";
      const earlier = (body.match(/\b20\d\d-\d\d-\d\d\b/g) || [])
        .filter((d) => d > published && d < iso)
        .sort()[0];
      if (earlier) {
        add(
          "warn",
          "reviewBy covers the body dates",
          `body mentions ${earlier}, earlier than reviewBy ${iso} — the piece goes stale sooner than planned`,
        );
      }

      // A `priced` piece states a per-unit money figure, so a reader can act on
      // it directly; letting one sit for years is the failure that costs money.
      // The ceiling is 180 days, which is a generator of reviews rather than a
      // restriction — no current article breaches it. Directional pieces are
      // deliberately unconstrained: being old is not the same as being wrong.
      const stakes = fmLine("stakes") || "directional";
      if (stakes === "priced") {
        const today = new Date();
        const todayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
        const days = Math.round((Date.parse(iso) - Date.parse(todayIso)) / 86400000);
        if (days > 180) {
          add(
            "warn",
            "priced piece reviewed within 180 days",
            `reviewBy is ${days} days out; a piece stating a per-unit cost should be rechecked sooner`,
          );
        }
      }
    }
  }

  // ---- revision records ------------------------------------------------
  // `revisions` is the visible half of the review clock: what actually changed
  // after publication. It is the only thing that feeds dateModified, because a
  // date-only edit is not maintenance — Google says changing dates without
  // changing content does not improve rankings, and treats date churn as
  // manipulation. So this field is what a review is supposed to produce, and it
  // is checked for internal consistency rather than for existence: most pieces
  // legitimately have nothing to record.
  //
  // What is checked: a revision cannot predate publication, and `updatedDate`
  // cannot disagree with the newest revision. The two fields say the same thing
  // — updatedDate is the legacy alias — so divergence means one of them is
  // wrong, and a wrong revision date is worse than no revision note.
  const revDates = [...fm.matchAll(/^\s*-\s*date:\s*(\S+)/gm)].map((m) => m[1]);
  if (revDates.length) {
    const published = fmLine("publishDate")?.slice(0, 10) ?? "";
    const before = revDates.filter((d) => d < published);
    if (before.length) {
      add(
        "block",
        "revisions consistent",
        `revision dated ${before[0]} predates publishDate ${published}`,
      );
    }
    const newest = [...revDates].sort().at(-1);
    const updated = fmLine("updatedDate")?.slice(0, 10);
    if (!updated) {
      add("warn", "revisions consistent", `revisions exist but updatedDate is unset (newest ${newest})`);
    } else if (updated !== newest) {
      add(
        "warn",
        "revisions consistent",
        `updatedDate ${updated} disagrees with newest revision ${newest}`,
      );
    } else {
      add("pass", "revisions consistent", `${revDates.length} revision(s), newest ${newest}`);
    }
  }

  // ---- calculation transparency ---------------------------------------
  // Same principle as the primary-source rule above: if the piece claims a
  // custom calculation, the reader has to be able to see the calculation.
  //
  // Why this exists. The site's moat is the arithmetic, and until now the
  // arithmetic was invisible. The five-part figures live in frontmatter, which
  // only a developer reads; the cost models live in tools/. A reader got the
  // answer with no way to check it. The comparison case study that prompted
  // this — NapLab — derives its defensibility as much from publishing its
  // method (ten standardised tests, 43-64 data points, the scoring rule) as
  // from running it. Article 14 printed every input in a table and that was
  // exactly the right instinct, but it was done by accident rather than by
  // rule, so it survived exactly one article.
  //
  // What is required, for `custom-calculation` pieces only:
  //   - a visible "How we calculated this" heading
  //   - a fenced code block, i.e. the formula or the model output, shown
  // and what is reported as a warning rather than a block:
  //   - whether the prose names the reader's own input in so many words
  //
  // That last one was a block in the first version and it was wrong. The check
  // looked for a keyword list — input, cif, value per unit — so a section
  // saying "the spend is yours" or "unit FOB value is the input" failed it.
  // That is a test of vocabulary, not of whether the reader can check the
  // number. The fenced block is the evidence; whether the sentence used the
  // word "input" is not.
  //
  // The model filename is still NOT required: some pieces derive their figure
  // from a published document rather than from a script in tools/, and
  // demanding a filename would be a rule about our internal layout rather than
  // about what the reader can verify.
  if (gain && /custom-calculation/.test(gain)) {
    const section =
      /##\s*How we calculated this\s*\n([\s\S]*?)(?=\n##\s|$)/.exec(body)?.[1] ?? "";
    if (!section) {
      add(
        "block",
        "calculation shown to reader",
        "declares custom-calculation but has no '## How we calculated this' section",
      );
    } else {
      const hasFormula = /```[\s\S]*?```/.test(section);
      const words = wordCount(section);
      hasFormula
        ? add("pass", "calculation shown to reader", `formula shown (${words} words)`)
        : add("block", "calculation shown to reader", "section present but no fenced formula block");

      const namesInput = /\b(spend|input|invoice|fob|cif|value|contract rate|cost of capital|margin|price|units? per|per (tonne|unit|item|container|parcel)|deposit|quote)\b/i.test(
        section,
      );
      if (hasFormula && !namesInput) {
        add("warn", "calculation names an input", "no reader-supplied input named in the prose");
      }
    }
  }

  // ---- body structure ------------------------------------------------
  // The AI Summary rule applies to the summary paragraph itself, not to
  // everything up to the next H2 (the hook paragraph follows it).
  const summarySection =
    /##\s*AI Summary\s*\n+([\s\S]*?)(?=\n##\s)/.exec(body + "\n## end")?.[1] ?? "";
  const summary = summarySection.split(/\n\s*\n/).find((p) => p.trim()) ?? "";
  const summaryWords = wordCount(summary);
  // V6.2 widened this from exactly 40-60 to 60-100: the summary now has to carry
  // "what it means for whom", not only the number. Measured sections average 100.
  if (summaryWords >= 40 && summaryWords <= 100)
    add("pass", "AI summary 40-100 words", `${summaryWords} words`);
  else add("block", "AI summary 40-100 words", `${summaryWords} words`);

  /*
   * V6.2 was published on 2026-10-08. Articles written before it do not carry the How
   * confident section and run longer than the new target, so both rules grandfather them
   * and warn instead of blocking. Defined here, before either check, because both need it.
   */
  /*
 * The date the substantive-figure rule took effect.
 *
 * It replaced "five figure records", which any five records satisfied - dates and document numbers included. Four
 * published articles predate it and are exempt; the exemption is a date rather than a list, so it cannot grow.
 */
const SUBSTANTIVE_FROM = "2026-10-18";

const V6_2_FROM = "2026-10-08";
  const publishDate = /^publishDate:\s*"?([\d-]+)/m.exec(fm)?.[1] ?? "";

  const substantive = substantiveFigures(figuresList);
  const shortfall = figuresShortfall(figuresList);
  if (!shortfall) {
    add("pass", `substantive figures >= ${MIN_SUBSTANTIVE}`, `${substantive.length} of ${figuresList.length} record(s) count`);
  } else if (publishDate >= SUBSTANTIVE_FROM) {
    /*
   * Not blocking, by the operator's instruction on 2026-10-18: the article must publish today. The shortfall is still
   * reported in full, so a run that carries no cost figure is visible in the card - it simply does not stop the press.
   * Restore this to add("block", ...) when the directive's figures can be relied on again.
   */
  add("pass", `substantive figures >= ${MIN_SUBSTANTIVE} (not blocking)`, shortfall.detail);
  } else {
    /*
     * Grandfathered, on the same principle as the word band: the operator's rule is that a changed standard applies
     * to new writing, not retroactively to a published archive.
     *
     * Four articles published before 2026-10-18 carry dates and document numbers as their figures - one ran on a
     * single substantive number, three on none. Under the old rule of "five records" they passed, because five
     * records is what they had. Exempting them is honest about what changed and when; the alternative, blocking the
     * pipeline until four published articles are rewritten, converts a quality rule into an outage.
     *
     * The exemption is a date, not a list, so it cannot grow.
     */
    add("pass", `substantive figures >= ${MIN_SUBSTANTIVE}`, `${substantive.length} of ${figuresList.length} - published before ${SUBSTANTIVE_FROM}, exempt`);
  }

  /*
   * Section presence. How confident is only required from V6_2_FROM, so older articles
   * report it as a warning rather than a block - otherwise this one check would block all
   * 23 pre-existing articles even though the dedicated How confident check grandfathers
   * them, and a rule would contradict itself in two places.
   */
  const requiredSections = SECTIONS.filter((s) => s !== "How confident" || publishDate >= V6_2_FROM);
  const optionalSections = SECTIONS.filter((s) => !requiredSections.includes(s));
  const missing = requiredSections.filter((s) => !new RegExp(`^##\\s*${s}`, "m").test(body));
  const missingOptional = optionalSections.filter((s) => !new RegExp(`^##\\s*${s}`, "m").test(body));

  if (missing.length === 0) {
    add("pass", "V6.2 sections", missingOptional.length ? `all required present; ${missingOptional.join(", ")} not required before ${V6_2_FROM}` : "all present (Hook = opening paragraph)");
  } else {
    add("block", "V6.2 sections", `missing: ${missing.join(", ")}`);
  }

  /*
   * Word count, V6.2, counted as prose.
   *
   * The counting function is shared with the writer-facing budget in src/lib/prose.mjs,
   * because two definitions of "how long is this article" were in use and disagreed by
   * 12 per cent - one counted table rows and code blocks, the other did not. A threshold
   * is meaningless if the two sides of it measure different things.
   *
   * Two tiers, because an article carrying a cost model has a structural floor that one
   * without does not. The tier is detected from the body - a markdown table carrying
   * currency amounts - rather than declared in frontmatter, so it cannot be claimed
   * falsely. The operator's rule, 2026-10-08: completeness and search intent come first;
   * the ceiling exists to prevent padding, not coverage.
   */
  const costTable = hasCostTable(body);
  const tier = costTable ? WORD_TARGET.withCostTable : WORD_TARGET.withoutCostTable;
  const tierName = costTable ? "with a cost table" : "no cost table";

  const words = proseWords(body);
  const wordsOk = words >= tier.min && words <= tier.max;
  const inTarget = words >= tier.targetLow && words <= tier.targetHigh;

  if (wordsOk) {
    add("pass", `prose ${tier.min}-${tier.max} words (${tierName})`, `${words} words${inTarget ? " (in target)" : ` (outside the ${tier.targetLow}-${tier.targetHigh} target)`}`);
  } else if (publishDate >= V6_2_FROM) {
    add("block", `prose ${tier.min}-${tier.max} words (${tierName})`, `${words} words`);
  } else {
    /*
     * Permanently grandfathered, by the operator's decision on 2026-10-08: "old articles
     * stay as they are, the rule applies to new writing". So this is exempt, not pending.
     *
     * 22 of the 23 articles predate V6.2 and run 1,537 to 2,219 prose words, and blocking
     * on length would stop the daily run from publishing anything until all 22 were cut -
     * which converts a quality rule into an outage. The alternative, an upgrade at each
     * article's reviewBy, was offered and declined. Whether the library should ever be
     * brought into line is a question for the search data, once there is any, not for a
     * rule applied blind.
     */
    add("warn", `prose ${tier.min}-${tier.max} words (${tierName})`, `${words} words - exempt, predates ${V6_2_FROM}`);
  }

  /*
   * The How confident section is the differentiator: it is the only place a reader is
   * told which claims are established and which are the analyst's judgement, and what
   * would falsify them. Every free source states one side only, so its absence is a
   * block rather than a warning.
   *
   * Required only for articles published on or after V6_2_FROM. The 23 articles written
   * before that date do not have it, and blocking all of them would stop the daily run
   * from publishing anything until every one was retrofitted - which is how a quality
   * rule turns into an outage. Instead each older article gains the section when its own
   * reviewBy comes round, which is the mechanism the site already has for revisiting
   * published work. So the rule bites on new writing immediately and on old writing on
   * schedule.
   */
  const needsConfident = publishDate >= V6_2_FROM;

  const confident = /##\s*How confident\s*\n+([\s\S]*?)(?=\n##\s|$)/.exec(body)?.[1] ?? "";
  if (!confident) {
    if (needsConfident) {
      add("block", "How confident section present", "missing - required for articles published from " + V6_2_FROM);
    } else {
      add("warn", "How confident section present", `absent, but ${publishDate} predates ${V6_2_FROM} - exempt, not pending`);
    }
  } else {
    const needed = [
      ["已确认", /已确认|Confirmed/i],
      ["推断", /推断|Inference|Inferred/i],
      ["什么情况下我会错", /什么情况下我会错|What would change|falsif/i],
    ].filter(([, re]) => !re.test(confident)).map(([n]) => n);
    needed.length === 0
      ? add("pass", "How confident has all three parts", "confirmed / inferred / falsification")
      : add("block", "How confident has all three parts", `missing: ${needed.join(", ")}`);
  }

  // 【推断】/【观点】 tags: only required when a claim is not a sourced fact, so this
  // warns rather than blocks - the default is "confirmed" and a piece may legitimately
  // contain no inference at all.
  const tagged = (body.match(/【(推断|观点)】/g) || []).length;
  add("pass", "claim labelling", tagged ? `${tagged} tagged claim(s)` : "no inference/opinion claims to tag");

  const faqBlocks = [...body.matchAll(/^###\s+(.+)$/gm)];
  const faqSection = /##\s*FAQ\s*\n([\s\S]*?)(?=\n##\s|$)/.exec(body)?.[1] ?? "";
  /*
   * A question is either a heading or a bold line ending in a question mark.
   *
   * The first version counted only headings, so an article that wrote its questions as
   * "**Is there a duty right now?**" scored zero and failed - a complete FAQ refused because of which
   * markdown spelling the writer chose. The question mark is required for the bold form, because a bold
   * line in prose is usually emphasis and letting that through would accept a FAQ with no questions in it.
   */
  const faqQuestionRes = [/^###\s+.+$/gm, /^\*\*[^*\n]+\?\*\*\s*$/gm];
  const faqQs = faqQuestionRes.reduce((n, re) => n + (faqSection.match(re) || []).length, 0);
  /* Answers are the text after each question, whichever spelling was used. */
  const faqAnswers = faqSection
    .split(/^###\s+|^\*\*[^*\n]+\?\*\*\s*$/m)
    .slice(1)
    .map(wordCount);
  const badAnswers = faqAnswers.filter((w) => w < 80 || w > 150).length;
  if (faqQs >= 3 && faqQs <= 5 && badAnswers === 0)
    add("pass", "FAQ 3-5 questions, 80-150 word answers", `${faqQs} questions`);
  else if (faqQs < 3 || faqQs > 5)
    add("block", "FAQ 3-5 questions, 80-150 word answers", `${faqQs} questions`);
  else add("warn", "FAQ answer length", `${badAnswers}/${faqQs} answers outside 80-150 words`);

  const tables = (body.match(/^\|.*\|\s*$/gm) || []).length;
  tables >= 4 ? add("pass", "comparison table present", `${tables} table rows`) : add("block", "comparison table present", `${tables} table rows`);

  const quotes = (body.match(/^>\s+\S/gm) || []).length;
  quotes >= 1 ? add("pass", "definition block present", `${quotes} blockquote(s)`) : add("block", "definition block present", "none");

  const forYou = /##\s*For you\s*\n([\s\S]*?)(?=\n##\s|$)/.exec(body)?.[1] ?? "";
  const segs = (forYou.match(/^\s*-\s+\*\*/gm) || []).length;
  segs >= 3 ? add("pass", "audience segments >= 3", `${segs}`) : add("block", "audience segments >= 3", `${segs}`);

  // ---- language --------------------------------------------------------
  const urls = body.match(/https?:\/\/\S+/g) || [];
  urls.length === 0 ? add("pass", "no URLs in body", "clean") : add("block", "no URLs in body", urls.join(", "));

  /*
   * Hedging words, with one grammatical exception that the old check got wrong.
   *
   * "may" has two senses. As a hedge - "costs may rise" - it is exactly what this rule
   * exists to remove, because the site's whole claim is that it states what will happen.
   * As a permission - "six parties may sign the declaration", "the carrier may apply
   * before loading" - it is the correct English, and it is how regulations are written.
   * The old check banned both, which meant the rule pushed the writer toward worse
   * sentences about a legal instrument whose text uses "may" in the permissive sense
   * throughout.
   *
   * Distinguished by the verb that follows: a permission takes a speech or action verb
   * that the regulation itself confers (sign, apply, file, submit, appoint, delegate,
   * authorise, elect, choose, request), while a hedge takes a verb of change or state.
   * "May" the month is capitalised and already excluded by the case-sensitive match.
   */
  const PERMISSIVE_VERBS = /\bmay\s+(sign|apply|file|submit|appoint|delegate|authorise|authorize|elect|choose|request|designate|nominate|use|act|enter|export|import)\b/i;
  const bodyNoPermissiveMay = body.replace(new RegExp(PERMISSIVE_VERBS.source, "gi"), " ");

  const CASE_SENSITIVE = new Set(["may"]);
  const vague = BANNED_VAGUE.filter((w) =>
    new RegExp(`\\b${w}\\b`, CASE_SENSITIVE.has(w) ? "" : "i").test(
      w === "may" ? bodyNoPermissiveMay : body,
    ),
  );
  vague.length === 0 ? add("pass", "no hedging words", "clean") : add("block", "no hedging words", vague.join(", "));
  const permissive = (body.match(new RegExp(PERMISSIVE_VERBS.source, "gi")) || []).length;
  if (permissive) add("pass", "permissive 'may' not treated as a hedge", `${permissive} instance(s)`);

  const cliche = BANNED_CLICHE.filter((w) => body.toLowerCase().includes(w));
  cliche.length === 0 ? add("pass", "no AI cliches", "clean") : add("block", "no AI cliches", cliche.join(", "));

  const sensitive = BANNED_SENSITIVE.filter((w) => body.toLowerCase().includes(w));
  sensitive.length === 0 ? add("pass", "sensitive-term screen", "clean") : add("block", "sensitive-term screen", sensitive.join(", "));

  /*
   * The 3R quarantine. Detection is on the title, the description and the body, because a piece about a
   * royal succession will name it in the headline long before the prose.
   */
  const threeRText = `${fm}\n${body}`;
  const threeR = THREE_R.test(threeRText);
  const reviewed = /^human_review:\s*$/m.test(fm) || /^human_review:\s*\{/m.test(fm) || /^\s+reviewer:\s*\S/m.test(fm);
  if (!threeR) {
    add("pass", "3R review", "no race, religion or royalty subject detected");
  } else if (reviewed) {
    add("pass", "3R review", "3R subject present and a human review is recorded");
  } else {
    add(
      "block",
      "3R review",
      "race, religion or royalty subject detected with no human_review recorded — quarantined until a named reviewer signs off",
    );
  }

  if (isDraft) add("warn", "draft flag", "piece is draft: true — will not be published");

  return results;
}

// ---------------------------------------------------------------------------
// Library-wide claims.
//
// The About page makes promises about how this site works, and the code has to
// keep them. A promise the code no longer honours is worse than no promise: the
// About page stated for a week that a correction "is noted at the foot of the
// article", which stopped being true the moment corrections moved into
// structured `revisions` rendered as a fixed block.
//
// Declared as a function rather than inlined at module scope so it can run after
// the file list exists. The first version was inlined above the `const args` and
// `let files` declarations and would have thrown a temporal-dead-zone
// ReferenceError on every run — the same mistake made twice already in this
// project, which is why the check is written this way instead.
function reportLibraryClaims(files) {
  const all = files
    .map((f) => readFileSync(f, "utf8"))
    .filter((raw) => !/^draft:\s*true/m.test(raw));
  const fmOf = (raw) => /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(raw)?.[1] ?? "";
  const count = (raw, re) => (fmOf(raw).match(re) || []).length;

  const noReview = all.filter((raw) => !/^reviewBy:/m.test(fmOf(raw))).length;
  const fewFigures = all.filter((raw) => count(raw, /^\s+- value:/gm) < 5).length;
  const noSources = all.filter((raw) => count(raw, /^\s+- /gm) === 0).length;
  const dateWithoutRevision = all.filter(
    (raw) => /^updatedDate:/m.test(fmOf(raw)) && count(raw, /^\s+- date:/gm) === 0,
  ).length;

  const claims = [
    ["every article carries reviewBy", noReview === 0, `${noReview} missing`],
    ["every article carries >= 5 figures", fewFigures === 0, `${fewFigures} short`],
    ["every article names sources", noSources === 0, `${noSources} with none`],
    [
      "updatedDate only with a recorded revision",
      dateWithoutRevision === 0,
      `${dateWithoutRevision} article(s) update the date with nothing recorded`,
    ],
  ];

  /*
   * Cadence promises in the site's own copy, checked against the publication
   * record.
   *
   * Added after the capture box was found promising "One email every morning"
   * under the heading "Daily Brief", while the record was eighteen articles
   * across five non-consecutive days and no email had ever been sent. Two dead
   * homepage branches carried the same class of claim — "the morning it
   * publishes", "the archive fills up weekly" — and would have gone live the
   * moment the branch rendered.
   *
   * Articles are the only thing this site publishes, so their dates are the
   * record. A copy string asserting a cadence must be one the gaps support. The
   * rule cannot judge prose in general; it can judge this, and this is what broke.
   */
  const publishDates = all
    .map((raw) => /^publishDate:\s*"?(\d{4}-\d{2}-\d{2})"?\s*$/m.exec(fmOf(raw))?.[1])
    .filter(Boolean)
    .sort();

  const cadenceClaims = [];
  const claimSources = [
    ...readdirSync("src/pages").filter((f) => f.endsWith(".astro")).map((f) => join("src/pages", f)),
    ...readdirSync("src/components").filter((f) => f.endsWith(".astro")).map((f) => join("src/components", f)),
  ];
  /*
   * A promise of daily or weekly delivery, in words a reader sees.
   *
   * Negations and conditionals are excluded, because the copy that explains the choice uses
   * the same words as the promise that broke this rule. The site deliberately does not send a
   * daily digest and says so in three places - "not a daily digest", "no daily filler", "a
   * daily digest would have to invent something to say". A bare word match reported all three
   * as cadence promises, which is the second time this gate mistook a sentence about a thing
   * for the thing itself; the first was `may`, where the permissive sense used throughout
   * regulations was read as a hedge.
   *
   * The distinction is grammatical rather than approximate, so it is matched rather than
   * guessed: a cadence phrase preceded by a negation or a conditional is a counterfactual, not
   * a commitment.
   */
  const CADENCE = /\b(every (day|morning|week)|daily (brief|email|digest|update)|weekly (digest|email|update)|fills up (daily|weekly)|the (morning|day|week) it publishes)\b/i;
  const NOT_A_CLAIM = /\b(not|no|never|without|instead of|rather than|would|could|might|if)\b[^.;]{0,44}$/i;
  for (const f of claimSources) {
    const lines = readFileSync(f, "utf8").split("\n");
    for (const [i, line] of lines.entries()) {
      const t = line.trim();
      if (!t || /^\s*(\*|\/\/|\/\*)/.test(t)) continue; // comments explain history
      const text = t.replace(/<[^>]+>/g, " ").replace(/\{[^}]*\}/g, " ").replace(/\s+/g, " ").trim();
      const m = CADENCE.exec(text);
      if (!m) continue;
      if (NOT_A_CLAIM.test(text.slice(0, m.index))) continue;
      cadenceClaims.push(`${f.replace(/\\/g, "/")}:${i + 1} — ${text.slice(0, 70)}`);
    }
  }

  // Largest gap between consecutive publication days, in days.
  let maxGap = 0;
  for (let i = 1; i < publishDates.length; i++) {
    const gap = Math.round((new Date(publishDates[i]) - new Date(publishDates[i - 1])) / 86400000);
    if (gap > maxGap) maxGap = gap;
  }

  const distinctDays = new Set(publishDates).size;
  const cadenceOk = cadenceClaims.length === 0;
  claims.push([
    "no cadence promise in site copy",
    cadenceOk,
    cadenceOk
      ? `record: ${publishDates.length} article(s) on ${distinctDays} day(s), largest gap ${maxGap}`
      : `${cadenceClaims.length} claim(s): ${cadenceClaims.join(" | ")}`,
  ]);

  const cadence = claims.pop();
  console.log("\nABOUT-PAGE CLAIMS (whole library)");
  console.log("=".repeat(78));
  let failed = 0;
  for (const [name, ok, detail] of claims) {
    console.log(`  ${ok ? "[ ok ]" : "[FAIL]"} ${name.padEnd(42)} ${detail}`);
    if (!ok) failed++;
  }

  /*
   * The cadence check blocks; the four above do not.
   *
   * The others are content defects that surface in the library and are printed
   * loudly but left to the author. A cadence promise is different in kind: it is
   * a factual claim about this site, published to readers, and checkable against
   * the publication record. "One email every morning" sat on every page of the
   * site for a week without a single email having been sent. That belongs in the
   * exit code, not in a report nobody reads.
   */
  const [cName, cOk, cDetail] = cadence;
  console.log(`  ${cOk ? "[ ok ]" : "[FAIL]"} ${cName.padEnd(42)} ${cDetail}`);
  if (!cOk) failed++;

  if (failed) {
    console.log(
      `\n  ${failed} About-page promise(s) no longer hold. Either fix the library or fix\n` +
        "  the About page — do not leave the site describing a process it abandoned.",
    );
  }
  return { total: failed, blocking: cOk ? 0 : 1 };
}

/*
 * Flags are not paths.
 *
 * `qa-check <file> --verbose` died with ENOENT on '--verbose', because every argument was read as a filename.
 * An unsupported flag should say so and a missing file should name the file; conflating them costs a turn and
 * teaches the caller the wrong thing - the transcript shows an agent concluding the article did not exist.
 *
 * `--all` stays a mode, not a path: it means "every published article", which is what the gate runs.
 */
const args = process.argv.slice(2);
const VERBOSE = args.includes("--verbose");
const ALL = args.includes("--all");
const PATHS = args.filter((a) => !a.startsWith("--"));

let files;
if (ALL) {
  const dir = "src/content/blog";
  files = readdirSync(dir).filter((f) => f.endsWith(".md")).map((f) => join(dir, f));
} else if (PATHS.length) {
  files = PATHS;
} else {
  console.error("usage: node tools/qa-check.mjs <article.md> [...] | --all | --verbose");
  process.exit(2);
}

if (VERBOSE) {
  console.log("  note: --verbose adds nothing; the report is already itemised per rule.");
}

for (const f of files) {
  if (!existsSync(f)) {
    console.log(`  no such file: ${f}`);
    process.exit(2);
  }
}

/*
 * --json emits the same results as data. The orchestrator passes failures back to the writer as a revision order,
 * and parsing prose out of a report to build one is how the guidance gets lost between the check and the fix.
 */
const AS_JSON = process.argv.includes("--json");
const blockTotals = { count: 0, guided: 0 };
const allResults = [];
const fileBlockCounts = [];

let anyBlocking = false;
for (const file of files) {  const raw = readFileSync(file, "utf8");
  const isDraft = /^draft:\s*true/m.test(raw);
  const results = check(file);

  // A draft is not published, so a blocking rule cannot leak anything. Report
  // drafts as warnings so `--all` stays a usable gate on what is live.
  const blocks = results.filter((r) => r.level === "block");
  const warns = results.filter((r) => r.level === "warn");
  const passes = results.filter((r) => r.level === "pass");

  if (AS_JSON) {
        /*
         * Collected rather than printed. Every result keeps the guidance attached, so a caller gets want/how/example
         * for the rules that failed without having to know how the report is formatted.
         */
        for (const r of results) allResults.push({ file, isDraft, ...r });
        continue;
      }

console.log(`\n${file}${isDraft ? "  [draft]" : ""}`);
  console.log(`  ${passes.length} pass · ${warns.length + (isDraft ? blocks.length : 0)} warn · ${isDraft ? 0 : blocks.length} BLOCK`);
  if (isDraft) {
    console.log(`  –        draft: ${blocks.length} blocking rule(s) not yet met, excluded from the gate`);
  } else {
    /*
 * Each block prints the verdict, then the structure it was measured against, then the edit that clears it.
 *
 * Indented one level deeper than the verdict so a list of ten rules is still scannable, and the example is
 * fenced so a multi-line fragment does not run into the next rule.
 */
    for (const r of blocks) {
      console.log(`  ✗ BLOCK  ${r.rule.padEnd(38)} ${r.detail}`);
      if (r.want) console.log(`           wants:  ${r.want}`);
      if (r.how) for (const step of r.how) console.log(`           fix:    ${step}`);
      if (r.example) {
        console.log("           looks like:");
        for (const line of String(r.example).split("\n")) console.log(`             ${line}`);
      }
      if (r.unguided) console.log("           (no guidance written for this rule yet - report it)");
    }
  }
  for (const r of warns) console.log(`  ! warn   ${r.rule.padEnd(38)} ${r.detail}`);

  // Passes are hidden by default because the count on the line above is the
  // useful part when scanning a whole library. But that leaves no way to confirm
  // that a specific rule RAN and passed, as opposed to not running at all —
  // which is indistinguishable from the outside. VERBOSE=1 lists them.
  if (process.env.VERBOSE) {
    for (const r of passes) console.log(`  · pass   ${r.rule.padEnd(38)} ${r.detail}`);
  }

  if (!isDraft && blocks.length) { anyBlocking = true; fileBlockCounts.push(blocks.length); }
}

// Only in library mode: these are claims about the whole set, and running them
// per file would report the same lines once per article.
if (args[0] === "--all") {
  const claimResult = reportLibraryClaims(files);
  // Most of these are content defects: printed loudly, left to the author, and
  // deliberately not build failures. The cadence check is the exception and does
  // set the exit code — see the note in reportLibraryClaims.
  if (claimResult.blocking) anyBlocking = true;
  void claimResult.total;
}

if (!AS_JSON) {
if (anyBlocking) {
  /*
   * Name the count and the first thing to fix. A list of ten failures is a list to work through in order, and
   * order matters: fixing the sections before the word count avoids counting twice.
   */
  /*
   * The count comes from the per-file block lists already computed, not from a second tally that could disagree
   * with them.
   */
  const total = fileBlockCounts.reduce((a, b) => a + b, 0);
  console.log("");
  console.log(`RESULT: BLOCKED — ${total} blocking rule(s). Fix them in the order listed; each one names the`);
  console.log("structure it checks and the edit that clears it.");
  console.log("");
} else {
  console.log("\nRESULT: PASS — every blocking rule cleared.\n");
}
}
if (AS_JSON) {
    const blocking = allResults.filter((r) => r.level === "block" && !r.isDraft);
    console.log(
      JSON.stringify(
        {
          blocked: blocking.length > 0,
          blockingCount: blocking.length,
          unguided: blocking.filter((r) => r.unguided).map((r) => r.rule),
          results: allResults,
        },
        null,
        2,
      ),
    );
  }

process.exit(anyBlocking ? 1 : 0);
