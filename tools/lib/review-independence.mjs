/*
 * Run-time reviewer identity policy shared by A and B.
 *
 * Minimum publishable independence is provider-level or model-level. A different credential
 * on the same provider/model is recorded as credential-only by lib-llm's resolver, but is not
 * a second opinion and never authorizes publication.
 */
const known = (value) => typeof value === "string" && value.trim() !== "" && value.trim().toLowerCase() !== "unknown";

export function reviewIndependenceLevel(writer, reviewer) {
  if (!known(writer?.provider) || !known(writer?.model) || !known(reviewer?.provider) || !known(reviewer?.model)) return "unknown";
  if (writer.provider !== reviewer.provider) return "provider";
  if (writer.model !== reviewer.model) return "model";
  return "same-model";
}

export function isAcceptableReviewIndependence(level) {
  return level === "provider" || level === "model";
}

export function verifyClaimEvidence({ article, sourceDocuments = [], factChecks = [] }) {
  const text = String(article ?? "")
    .replace(/<\/(?:p|li|td|th|h[1-6]|tr|div|section)>/gi, ". ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ");
  const critical = text.split(/(?<=[.!?])\s+/).filter((sentence) =>
    /\b(?:revenue|ARR|MRR|users?|customers?|subscribers?|price|pricing|cost|sales|income|profit|gross margin|valuation)\b/i.test(sentence) &&
    /\b\d[\d,.]*(?:\s?(?:million|billion|thousand|%|users?|customers?|per month|per year|annually))?\b|(?:RM|US\$|\$|€|£)\s?\d/i.test(sentence),
  );
  if (!critical.length) return { pass: true, criticalClaims: [], reason: "no material numeric business claims detected" };
  if (!Array.isArray(sourceDocuments) || !Array.isArray(factChecks)) return { pass: false, criticalClaims: critical, reason: "source documents or fact-check map are missing" };

  const verified = critical.every((claim) => factChecks.some((check) => {
    if (typeof check?.claim !== "string" || !claim.toLowerCase().includes(check.claim.toLowerCase().trim())) return false;
    if (check.source_type !== "primary" || typeof check.quote !== "string" || !check.quote.trim()) return false;
    const doc = sourceDocuments.find((item) => item?.primary === true && item.url === check.source_url);
    if (!doc || !String(doc.body ?? "").toLowerCase().includes(check.quote.trim().toLowerCase())) return false;
    return true;
  }));
  return verified
    ? { pass: true, criticalClaims: critical, reason: "every detected material numeric business claim is mapped to a quote in a curated primary-source document" }
    : { pass: false, criticalClaims: critical, reason: "a material numeric business claim lacks a matching quote from a curated primary-source document" };
}
