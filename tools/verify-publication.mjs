#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expectedArticleIdentity, verifyPublicationWithRetries } from "./lib/verify-publication.mjs";

const flag = (name, fallback = "") => {
  const value = process.argv.find((item) => item.startsWith(`--${name}=`));
  return value ? value.slice(name.length + 3) : fallback;
};

const slug = flag("slug");
if (!/^[a-z0-9]+(?:[a-z0-9-]*[a-z0-9])?$/.test(slug)) {
  console.error("publication verification failed: invalid article slug");
  process.exit(1);
}
const articlePath = join(process.cwd(), "src", "content", "blog", `${slug}.md`);
let identity;
try {
  identity = expectedArticleIdentity(readFileSync(articlePath, "utf8"));
} catch (error) {
  console.error(`publication verification failed: cannot load expected article identity: ${String(error?.message ?? error)}`);
  process.exit(1);
}

const result = await verifyPublicationWithRetries({
  slug,
  ...identity,
  baseUrl: process.env.SITE_URL || "https://www.ghiblistyled.com",
  attempts: Math.max(1, Number(process.env.VERIFY_ATTEMPTS || 6)),
  delayMs: Math.max(0, Number(process.env.VERIFY_DELAY_MS || 15000)),
});

if (!result.ok) {
  console.error(`publication verification failed after ${result.attempts} attempt(s): ${result.error}`);
  process.exit(1);
}
console.log(JSON.stringify(result));
