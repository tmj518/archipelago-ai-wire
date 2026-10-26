/**
 * Sources, as the layout needs them: a name to print, and optionally a link to click.
 *
 * ## Why the model accepts both shapes
 *
 * `sources` used to be an array of strings - the document's name, nothing else. That is honest and it
 * is not enough: a reader who wants to check a figure has no way to reach the document, and "verify it
 * yourself" is the whole promise the site makes. So an entry may now also be an object with a name and
 * a URL.
 *
 * Both shapes are accepted for good reasons. Every article written before the change is a list of
 * strings, and a schema that rejected them would have made the new field a migration project instead of
 * an addition. Plain strings also remain the right answer for a source that has no URL - a printed
 * gazette, a document read at a counter, an institution that publishes nothing on the web. In that case
 * the name is printed and no link is invented.
 *
 * ## Why the URL is not validated by the schema
 *
 * `z.string().url()` would make one malformed URL fail the whole build, hours after the draft was
 * written, and it would still not answer the question that matters here: is this string safe to put in
 * an href. So the schema accepts a string and this module decides. Anything that is not an absolute
 * http(s) URL becomes no link at all. That covers the empty string, a relative path, a typo with no
 * scheme, and the shapes that are dangerous in an href rather than merely wrong: `javascript:`,
 * `data:`, `vbscript:`, and the `\\host` protocol-relative form.
 */

/** Absolute http/https only. Everything else returns null, and the caller prints a name. */
export function safeSourceUrl(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  /*
   * Reject before parsing. `new URL("javascript:alert(1)")` parses happily, which is exactly why the
   * protocol check below is the load-bearing one rather than a try/catch.
   *
   * The host check is part of the same guard, because `new URL("http:///path")` does not fail: it
   * normalises the empty authority away and yields a URL whose host is the first path segment. A URL
   * with nothing between the slashes and the path is a typo, not a source.
   */
  if (!/^https?:\/\/[^/\s]+/i.test(raw)) return null;
  let url;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  /* A host is required: "http:///path" parses with an empty hostname. */
  if (!url.hostname) return null;
  return url.href;
}

/**
 * Normalise a frontmatter `sources` list into printable entries.
 *
 * @param {unknown} list
 * @returns {{name: string, href: string|null}[]}
 */
export function toSourceEntries(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const entry of list) {
    if (typeof entry === "string") {
      const name = entry.trim();
      if (name) out.push({ name, href: null });
      continue;
    }
    if (entry && typeof entry === "object") {
      const name = String(entry.name ?? "").trim();
      const href = safeSourceUrl(entry.url);
      /* An object with only a URL still has something to show; use the URL as its name. */
      if (!name && !href) continue;
      out.push({ name: name || href, href });
    }
  }
  return out;
}
