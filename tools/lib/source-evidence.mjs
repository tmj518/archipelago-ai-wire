import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";

const normalized = (value) => String(value ?? "")
  .replace(/<script[\s\S]*?<\/script>/gi, " ")
  .replace(/<style[\s\S]*?<\/style>/gi, " ")
  .replace(/<[^>]+>/g, " ")
  .replace(/&nbsp;|&#160;|\u00a0/gi, " ")
  .replace(/&amp;/g, "&")
  .replace(/&quot;|&#34;/g, '"')
  .replace(/&#39;|&apos;/g, "'")
  .replace(/&lt;/g, "<")
  .replace(/&gt;/g, ">")
  .replace(/[\u202f\u2009]/g, " ")
  .replace(/\s+/g, " ")
  .trim();

function valueAppears(value, excerpt) {
  const raw = normalized(value);
  const withoutFormatting = raw.replace(/[$,]/g, "").replace(/%$/, "");
  const variants = new Set([raw, withoutFormatting]);
  if (/%$/.test(raw)) variants.add(raw.slice(0, -1));
  if (/^\d+(?:\.\d+)?$/.test(withoutFormatting)) variants.add(withoutFormatting.replace(/\.0+$/, ""));
  return [...variants].some((variant) => variant.length >= 2 && normalized(excerpt).includes(variant));
}

export function loadDirectiveSourceEvidence({ directivePath, root = process.cwd(), readFile = readFileSync, exists = existsSync }) {
  let directive;
  try { directive = JSON.parse(readFile(directivePath, "utf8")); } catch {
    return { ok: false, reason: "research directive is missing or unreadable" };
  }
  if (!Array.isArray(directive?.figures) || directive.figures.length === 0) return { ok: false, reason: "research directive has no source figures" };
  const fetched = new Map((directive._research?.fetched ?? []).map((item) => [item.file, item]));
  const documents = [];
  for (const [index, figure] of directive.figures.entries()) {
    const file = String(figure.evidence_from ?? "").replace(/\\/g, "/");
    if (!file.startsWith("data/sources/") || file.split("/").includes("..") || isAbsolute(file)) {
      return { ok: false, reason: `figure ${index + 1} has no safe archived source path` };
    }
    const absolute = resolve(root, file);
    const rel = relative(resolve(root), absolute);
    if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel) || !exists(absolute)) {
      return { ok: false, reason: `figure ${index + 1} archived source is missing or outside the workspace` };
    }
    if (!figure.value || !figure.source || !figure.evidence || !figure.unit || !figure.period || !figure.retrieved) {
      return { ok: false, reason: `figure ${index + 1} lacks value/source/evidence/unit/period/retrieval metadata` };
    }
    let raw;
    try { raw = readFile(absolute, "latin1"); } catch {
      return { ok: false, reason: `figure ${index + 1} archived source cannot be read` };
    }
    const documentText = normalized(raw);
    const excerpt = normalized(figure.evidence);
    if (!excerpt || !documentText.includes(excerpt) || !valueAppears(figure.value, excerpt)) {
      return { ok: false, reason: `figure ${index + 1} excerpt/value does not match its archived source` };
    }
    const url = fetched.get(file)?.url;
    if (!url || !/^https:\/\//i.test(url)) return { ok: false, reason: `figure ${index + 1} has no HTTPS source URL in research provenance` };
    documents.push({ index, value: String(figure.value), unit: String(figure.unit), period: String(figure.period), source: String(figure.source), retrieved: String(figure.retrieved), url, evidenceFrom: file, excerpt, supportLevel: "archived-excerpt-exact-match" });
  }
  return { ok: true, documents, supportLevel: "archived-excerpt-exact-match" };
}

export function verifyDirectiveSourceChecks(documents, checks) {
  if (!Array.isArray(documents) || !documents.length || !Array.isArray(checks) || checks.length !== documents.length) return false;
  return documents.every((document) => checks.some((check) =>
    Number(check?.evidence_index) === document.index &&
    normalized(check?.figure_value) === normalized(document.value) &&
    normalized(check?.source_url) === normalized(document.url) &&
    normalized(check?.quote) === document.excerpt &&
    check?.supported === true,
  ));
}
