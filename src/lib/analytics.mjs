/**
 * Should this build emit Google Analytics at all?
 *
 * ## Why a switch and not just an id
 *
 * The previous project's GA4 property id was still present in the environment, and the build silently
 * picked it up: the new site rendered the old site's measurement tag, so two publications would have
 * reported into one property. Nobody would have noticed from the pages - a working tag looks exactly
 * like a working tag - and the damage is retrospective and unfixable: analytics cannot be re-attributed
 * afterwards.
 *
 * Setting the variable to empty is not a safe way to disable it, because the wrong value is exactly
 * what a stale environment provides. So there are two independent conditions, and both must hold:
 *
 *   PUBLIC_GA_ENABLED=true        an explicit, per-deployment decision. Off unless someone says on.
 *   PUBLIC_GA_MEASUREMENT_ID      an id in GA4's own format, G- followed by ten characters.
 *
 * A missing id, a malformed id, an inherited value, or a switch that was never set all produce the same
 * result: no tag, no meta, nothing in the HTML. Silence is the failure mode this function chooses,
 * because the alternative - emitting a plausible-looking tag - is indistinguishable from success.
 */

/** GA4 measurement ids are G- plus ten uppercase alphanumerics. */
const GA_ID = /^G-[A-Z0-9]{10}$/;

/**
 * @param {{enabled?: unknown, id?: unknown}} input
 * @returns {string|null} the id to emit, or null for "render nothing"
 */
export function gaMeasurementId({ enabled, id } = {}) {
  const on = String(enabled ?? "").trim().toLowerCase() === "true";
  if (!on) return null;
  const value = String(id ?? "").trim().toUpperCase();
  if (!GA_ID.test(value)) return null;
  return value;
}
