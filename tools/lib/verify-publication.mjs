const xmlLocs = (xml, tag) => [...String(xml).matchAll(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "gi"))]
  .map((match) => match[1].replace(/<!\[CDATA\[|\]\]>/g, "").replace(/&amp;/g, "&").trim())
  .filter(Boolean);

const normalizedUrl = (value) => {
  const url = new URL(value);
  if (url.pathname !== "/") url.pathname = url.pathname.replace(/\/+$/, "");
  return `${url.origin}${url.pathname}${url.search}`;
};

const visibleText = (value) => String(value ?? "")
  .replace(/<script[\s\S]*?<\/script>/gi, " ")
  .replace(/<style[\s\S]*?<\/style>/gi, " ")
  .replace(/<[^>]+>/g, " ")
  .replace(/&nbsp;|&#160;|&#xA0;/gi, " ")
  .replace(/&amp;/gi, "&")
  .replace(/&quot;|&#34;|&#x22;/gi, '"')
  .replace(/&apos;|&#39;|&#x27;/gi, "'")
  .replace(/&lt;/gi, "<")
  .replace(/&gt;/gi, ">")
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
  .replace(/&#x([\da-f]+);/gi, (_, n) => String.fromCodePoint(Number.parseInt(n, 16)))
  .normalize("NFKC")
  .replace(/[\u2009\u202f]/g, " ")
  .replace(/\s+/g, " ")
  .trim();

const markdownText = (value) => String(value ?? "")
  .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
  .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
  .replace(/<https?:\/\/[^>]+>/g, "")
  .replace(/<[^>]+>/g, " ")
  .replace(/(^|\s)[>#*-]+\s/g, "$1")
  .replace(/`{1,3}([^`]+)`{1,3}/g, "$1")
  .replace(/(\*\*|__|~~|\*|_)/g, "")
  .replace(/\\([\\`*_{}\[\]()#+.!-])/g, "$1")
  .replace(/&amp;/gi, "&")
  .replace(/&quot;/gi, '"')
  .normalize("NFKC")
  .replace(/\s+/g, " ")
  .trim();

export function expectedArticleIdentity(markdown) {
  const source = String(markdown ?? "");
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(source);
  if (!match) throw new Error("article markdown has no frontmatter block");
  const titleLine = /^title:\s*(.*?)\s*$/m.exec(match[1]);
  if (!titleLine || !titleLine[1] || titleLine[1] === "|" || titleLine[1] === ">") throw new Error("article frontmatter has no single-line title");
  let title = titleLine[1];
  if (title.startsWith('"') && title.endsWith('"')) {
    try { title = JSON.parse(title); } catch { throw new Error("article title is not valid quoted YAML text"); }
  } else if (title.startsWith("'") && title.endsWith("'")) {
    title = title.slice(1, -1).replace(/''/g, "'");
  }
  title = visibleText(title);
  if (!title) throw new Error("article title is empty");

  const body = source.slice(match[0].length);
  const paragraphs = body.split(/\r?\n\s*\r?\n/).map(markdownText).filter((text) => text.length >= 40);
  if (!paragraphs.length) throw new Error("article has no sufficiently distinct body paragraph for live verification");
  return { title, bodyEvidence: paragraphs[0].slice(0, 180) };
}

async function read200(url, origin, fetchFn) {
  const parsed = new URL(url);
  if (parsed.origin !== origin) throw new Error(`refusing off-origin publication artifact URL: ${parsed.origin}`);
  const response = await fetchFn(parsed.href, { redirect: "follow", signal: AbortSignal.timeout(20000) });
  const finalUrl = response.url || parsed.href;
  if (new URL(finalUrl).origin !== origin) throw new Error(`publication artifact redirected off-origin: ${finalUrl}`);
  if (response.status !== 200) throw new Error(`${parsed.pathname} returned HTTP ${response.status}`);
  return response.text();
}

export async function verifyPublication({ slug, expectedTitle, bodyEvidence, baseUrl = "https://www.ghiblistyled.com", fetchFn = fetch }) {
  if (!/^[a-z0-9]+(?:[a-z0-9-]*[a-z0-9])?$/.test(String(slug ?? ""))) throw new Error("invalid article slug");
  const wantedTitle = visibleText(expectedTitle);
  const wantedBody = visibleText(bodyEvidence);
  if (!wantedTitle) throw new Error("expected article title is required");
  if (wantedBody.length < 40) throw new Error("expected article body evidence must contain at least 40 visible characters");
  const base = new URL(baseUrl);
  if (base.protocol !== "https:") throw new Error("production base URL must use HTTPS");
  const origin = base.origin;
  const articleUrl = new URL(`/blog/${slug}/`, base).href;
  const article = await read200(articleUrl, origin, fetchFn);
  const canonical = /<link\b[^>]*rel=["']canonical["'][^>]*href=["']([^"']+)["'][^>]*>/i.exec(article)?.[1]
    ?? /<link\b[^>]*href=["']([^"']+)["'][^>]*rel=["']canonical["'][^>]*>/i.exec(article)?.[1]
    ?? "";
  if (!canonical || normalizedUrl(new URL(canonical, base).href) !== normalizedUrl(articleUrl)) throw new Error("article HTTP 200 did not contain the expected canonical URL");
  const h1 = /<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(article)?.[1] ?? "";
  if (!h1 || visibleText(h1) !== wantedTitle) throw new Error("article h1 does not match the generated article title");
  if (!visibleText(article).includes(wantedBody)) throw new Error("article page is missing the generated article body evidence");

  const indexUrl = new URL("/sitemap-index.xml", base).href;
  const index = await read200(indexUrl, origin, fetchFn);
  if (!/<sitemapindex\b/i.test(index)) throw new Error("sitemap-index.xml is not a sitemap index");
  const childUrls = xmlLocs(index, "loc").map((loc) => new URL(loc, base).href);
  if (!childUrls.length || childUrls.length > 100) throw new Error(`sitemap index has unsupported child count: ${childUrls.length}`);
  let childCount = 0;
  let sitemapHasArticle = false;
  for (const childUrl of childUrls) {
    const child = await read200(childUrl, origin, fetchFn);
    if (!/<urlset\b/i.test(child)) throw new Error(`sitemap child is not a urlset: ${childUrl}`);
    childCount++;
    if (xmlLocs(child, "loc").some((loc) => normalizedUrl(new URL(loc, base).href) === normalizedUrl(articleUrl))) sitemapHasArticle = true;
  }
  if (!sitemapHasArticle) throw new Error("no fetched sitemap child contains the expected article URL");

  const rssUrl = new URL("/rss.xml", base).href;
  const rss = await read200(rssUrl, origin, fetchFn);
  if (!/<rss\b/i.test(rss)) throw new Error("rss.xml is not an RSS feed");
  const items = [...rss.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)].map((match) => match[1]);
  const rssHasArticle = items.some((item) => xmlLocs(item, "link").some((link) => normalizedUrl(new URL(link, base).href) === normalizedUrl(articleUrl)));
  if (!rssHasArticle) throw new Error("RSS has no item for the expected article URL");

  return { ok: true, slug, articleUrl, expectedTitle: wantedTitle, bodyEvidenceMatched: true, canonicalUrl: new URL(canonical, base).href, sitemapIndexUrl: indexUrl, sitemapChildCount: childCount, rssUrl, checks: { article: 200, canonical: true, titleMatchesH1: true, bodyEvidence: true, sitemapIndex: 200, sitemapChildContainsArticle: true, rssContainsArticle: true } };
}

export async function verifyPublicationWithRetries({ attempts = 6, delayMs = 15000, sleepFn = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), ...options }) {
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const result = await verifyPublication(options);
      return { ...result, attempt };
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await sleepFn(delayMs);
    }
  }
  return { ok: false, attempts, error: String(lastError?.message ?? lastError ?? "publication verification failed") };
}

export { normalizedUrl as normalizePublicationUrl };
