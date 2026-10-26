/**
 * Loading and validating the C line's subject queue.
 *
 * ## Why this is a module rather than three lines in the orchestrator
 *
 * The orchestrator used to do this:
 *
 *     const queue = JSON.parse(readFileSync(QUEUE_FILE, "utf8"));
 *     const topics = Array.isArray(queue.topics) ? queue.topics : [];
 *
 * Three failure modes, all of which the 2026-10-26 data audit found live at once:
 *
 *   the file is missing      `readFileSync` throws ENOENT and the run dies with a stack trace instead
 *                            of a verdict, so nothing is written to the run record
 *   the JSON is malformed    same, with a SyntaxError
 *   `topics` is not an array it silently becomes `[]`, which the orchestrator reports as NO-SUBJECT with
 *                            exit 0 - a missing queue that looks like a successful quiet day
 *
 * The third is the dangerous one: a success verdict for a run that never had any work to do. And because
 * the queue is the only thing that selects subjects, "empty" and "broken" must not be the same value.
 *
 * So the rules are explicit here, the orchestrator maps them to distinct exit paths, and
 * tests/run-fixtures.mjs exercises all four cases without needing an API key, a network or a run.
 *
 * ## Why it validates the vocabulary
 *
 * A queue restored from the previous project carries `topic: "work-visa"` and five other guide topics
 * that no longer exist. Loading it would produce topics that generate against a schema that rejects
 * them, four steps downstream. Checking against src/lib/taxonomy.json here means an old queue fails at
 * the front door with the reason, instead of being quietly written with a status line.
 */
import { existsSync, readFileSync } from "node:fs";
import { GUIDE_TOPIC_SLUGS, AUDIENCE_VALUES } from "./taxonomy.mjs";

/** Kebab-case, because the slug becomes a URL segment. */
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const fail = (kind, detail) => ({ ok: false, kind, detail });

/**
 * Parse queue text. Separated from the file read so a test can exercise it without touching disk.
 *
 * @param {string} text
 * @returns {{ok: true, queue: any, topics: any[]} | {ok: false, kind: string, detail: string}}
 */
export function parseGuideQueue(text) {
  let queue;
  try {
    queue = JSON.parse(text);
  } catch (e) {
    return fail("invalid-json", `the queue is not valid JSON: ${e.message}`);
  }

  if (!queue || typeof queue !== "object" || Array.isArray(queue)) {
    return fail("invalid-structure", "the queue must be a JSON object with a `topics` array");
  }
  if (!Array.isArray(queue.topics)) {
    /*
     * Not treated as an empty queue. An absent key is a broken file, not a quiet day: the orchestrator
     * writes a status back into this structure, and a file without `topics` is one it would corrupt.
     */
    return fail("invalid-structure", "the queue has no `topics` array - a missing key is not an empty queue");
  }

  const seen = new Set();
  for (let i = 0; i < queue.topics.length; i++) {
    const t = queue.topics[i];
    const at = `topics[${i}]`;
    if (!t || typeof t !== "object" || Array.isArray(t)) return fail("invalid-structure", `${at} is not an object`);

    if (typeof t.slug !== "string" || !SLUG.test(t.slug)) {
      return fail("invalid-structure", `${at}.slug must be kebab-case, got ${JSON.stringify(t.slug ?? null)}`);
    }
    if (seen.has(t.slug)) return fail("invalid-structure", `duplicate slug "${t.slug}"`);
    seen.add(t.slug);

    if (typeof t.title !== "string" || !t.title.trim()) {
      return fail("invalid-structure", `${at} ("${t.slug}") has no title`);
    }
    if (typeof t.unit !== "string" || !t.unit.trim()) {
      return fail("invalid-structure", `${at} ("${t.slug}") has no unit - the guide schema requires one`);
    }
    if (!Array.isArray(t.audience) || !t.audience.length) {
      return fail("invalid-structure", `${at} ("${t.slug}") has no audience - the guide schema requires at least one`);
    }
    const badAudience = t.audience.filter((a) => !AUDIENCE_VALUES.includes(a));
    if (badAudience.length) {
      return fail(
        "invalid-structure",
        `${at} ("${t.slug}") names audience ${badAudience.map((a) => `"${a}"`).join(", ")}, not one of ${AUDIENCE_VALUES.join(", ")}`,
      );
    }
    if (!GUIDE_TOPIC_SLUGS.includes(t.topic)) {
      return fail(
        "invalid-structure",
        `${at} ("${t.slug}") names topic ${JSON.stringify(t.topic ?? null)}, not one of ${GUIDE_TOPIC_SLUGS.join(", ")}`,
      );
    }
  }

  return { ok: true, queue, topics: queue.topics };
}

/**
 * Read the queue from disk and validate it.
 *
 * @param {string} file absolute path
 */
export function loadGuideQueue(file) {
  if (!existsSync(file)) {
    return fail("missing", `no queue at ${file}. The C line does not invent subjects: add a Malaysian queue, or run tools/plan-guides.mjs to build one.`);
  }
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch (e) {
    return fail("unreadable", `the queue at ${file} could not be read: ${e.message}`);
  }
  return parseGuideQueue(text);
}
