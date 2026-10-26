/**
 * Page metadata, fitted to what a search result actually shows.
 *
 * ## Why this is a module rather than a helper inside one layout
 *
 * Three separate places build a title and two build a description, and they had drifted: titles ran to
 * 121 characters, descriptions to 290, and four instrument pages were titled "European Commission"
 * because the part that distinguished them had been truncated away as "detail". None of it was caught,
 * because nothing looked at the metadata of the built pages - the existing gates check structure,
 * policy, links and layout, not whether two pages claim the same name or whether the name fits.
 *
 * So the rules live here, are used by every page type, and are checked against the built output by
 * tools/check-meta.mjs. The limits below are the ones that checker enforces.
 *
 * ## The numbers
 *
 * A result title survives about 60 characters of Latin text; past that the engine rewrites it from
 * page content and takes control of the one line that decides whether anyone clicks. A description
 * survives roughly 155 to 160. These are the practical thresholds rather than a specification, and
 * they differ by script - the limits below count CJK as two characters, because a title that is 60
 * characters of Chinese is twice the width of 60 of English and will be cut.
 *
 * ## The tension, stated plainly
 *
 * Truncating a title can remove the part that makes it different from another page, which is how the
 * "European Commission" collision happened. Brevity and uniqueness pull in opposite directions, so
 * neither is decided here in isolation: callers pass a `qualifier` - an announcement number, a month,
 * an annex - which is appended *outside* the truncation and therefore never the part that is cut.
 */

/** CJK and fullwidth characters occupy about two Latin character widths in a result snippet. */
export function displayWidth(s) {
  let w = 0;
  for (const ch of String(s)) {
    const c = ch.codePointAt(0);
    w +=
      (c >= 0x1100 && c <= 0x115f) ||
      (c >= 0x2e80 && c <= 0xa4cf) ||
      (c >= 0xac00 && c <= 0xd7a3) ||
      (c >= 0xf900 && c <= 0xfaff) ||
      (c >= 0xfe30 && c <= 0xfe6f) ||
      (c >= 0xff00 && c <= 0xff60) ||
      (c >= 0xffe0 && c <= 0xffe6)
        ? 2
        : 1;
  }
  return w;
}

/** Cut to a display width on a word boundary, with an ellipsis. Never returns a half word. */
function truncate(s, limit) {
  const str = String(s).replace(/\s+/g, " ").trim();
  if (displayWidth(str) <= limit) return str;
  let out = "";
  for (const word of str.split(" ")) {
    const next = out ? `${out} ${word}` : word;
    /* +2: the space this word introduces, and the ellipsis appended after the loop. */
    if (displayWidth(next) + 2 > limit) break;
    out = next;
  }
  /*
   * No word fitted: cut by display width, one character at a time.
   *
   * This was `str.slice(0, limit - 1)`, which counts characters - right for Latin text, wrong by a factor of
   * two for Chinese, where a 38-column budget produced a 76-column title. A single unbroken token reaches
   * here, and a Chinese sentence is one token because it has no spaces.
   */
  if (!out) {
    let grown = "";
    for (const ch of str) {
      if (displayWidth(grown + ch) + 1 > limit) break;
      grown += ch;
    }
    out = grown || [...str][0] || "";
  }
  return out.replace(/[,;:.\-–—\s]+$/, "") + "…";
}

/**
 * A title that fits, with the qualifier outside the budget.
 *
 * `qualifier` is the most distinguishing part of an instrument's identity and is deliberately not
 * truncated. `siteName` is appended by the layout and is subtracted here so the total is what fits.
 *
 * The default is 60 rather than a round number above it: 60 display columns is where a result truncates,
 * and the checker that enforces it uses the same figure. Two numbers for one limit is how a title ends up
 * one column over the line, which is what happened.
 */
export function fitTitle(name, qualifier, siteName, limit = 60) {
  const suffix = siteName ? ` — ${siteName}` : "";
  const fullTail = qualifier ? ` (${qualifier})` : "";

  /*
   * The qualifier is dropped when it does not fit.
   *
   * This used to floor the room at eighteen columns and keep the qualifier regardless, which produced titles
   * over the limit whenever a document carried a long period - "Producer prices... (September 2026, October 2026)
   * - the site name" measured sixty-one. The floor is what to blame, not the qualifier: the name is worth more
   * than a parenthetical nobody reads in a result snippet, and a title one column over fails the check that
   * exists to keep it inside the snippet.
   */
  const roomForFull = limit - displayWidth(suffix) - displayWidth(fullTail);
  if (roomForFull >= 18) return truncate(name, roomForFull) + fullTail;

  const roomForName = limit - displayWidth(suffix);
  return truncate(name, Math.max(18, roomForName));
}

/**
 * A description that fits in the space a result will show.
 *
 * Cuts on a sentence boundary when one falls late enough to keep the result informative, and on a word
 * boundary otherwise. A description that is silently halved mid-clause is worse than a shorter one that
 * ends: the reader's decision happens in those 155 characters, which is why the default is 155 and not the
 * 158 that was here - the checker measures against 155, and a limit one above the rule is a rule that fails.
 */
export function fitDescription(text, limit = 155) {
  const str = String(text).replace(/\s+/g, " ").trim();
  if (displayWidth(str) <= limit) return str;
  const floor = Math.floor(limit * 0.62);
  let best = -1;
  for (let i = 0; i < str.length; i++) {
    if (/[.!?]/.test(str[i]) && /[\s"']/.test(str[i + 1] ?? " ")) {
      if (displayWidth(str.slice(0, i + 1)) <= limit) best = i + 1;
    }
  }
  if (best > 0 && displayWidth(str.slice(0, best)) >= floor) return str.slice(0, best).trim();
  return truncate(str, limit - 1) + ".";
}
