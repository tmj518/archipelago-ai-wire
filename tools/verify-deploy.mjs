#!/usr/bin/env node
/**
 * Prove that what Cloudflare is serving is the commit GitHub just pushed.
 *
 * Four layers used to be three: local, GitHub, Actions. The site is the fourth, and twice a deployment
 * stopped while every log stayed green - the article existed in main and answered 404. This asks
 * Cloudflare which commit its latest production deployment came from and compares it with the commit
 * this run built.
 *
 *   node tools/verify-deploy.mjs [--sha=<commit>]
 *
 * Needs CLOUDFLARE_API_TOKEN (Pages: Read) and CLOUDFLARE_ACCOUNT_ID. Without them it reports UNKNOWN
 * and exits 0 rather than pretending.
 */
const token = process.env.CLOUDFLARE_API_TOKEN ?? "";
const account = process.env.CLOUDFLARE_ACCOUNT_ID ?? "";
const want = (process.argv.find((a) => a.startsWith("--sha="))?.slice(6) ?? process.env.GITHUB_SHA ?? "").slice(0, 40);

if (!token || !account) {
  console.log("  deploy     : UNKNOWN - CLOUDFLARE_API_TOKEN or CLOUDFLARE_ACCOUNT_ID is not set");
  process.exit(0);
}

const api = (path) => `https://api.cloudflare.com/client/v4/accounts/${account}${path}`;
const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };

async function getJson(url) {
  const res = await fetch(url, { headers });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.success === false) {
    const why = body.errors?.map((e) => e.message).join("; ") ?? `HTTP ${res.status}`;
    throw new Error(why);
  }
  return body.result;
}

try {
  /* The project is found by the domain it serves, not by a name guessed here. */
  const projects = await getJson(api("/pages/projects?per_page=100"));
  const project = (projects ?? []).find((p) => (p.domains ?? []).some((d) => String(d).includes("ghiblistyled")));
  if (!project) throw new Error("no Pages project serving ghiblistyled.com");

  const deployments = await getJson(api(`/pages/projects/${project.name}/deployments?per_page=5`));
  const live = (deployments ?? []).find((d) => (d.environment ?? d.latest_stage?.name) === "production") ?? deployments?.[0];
  if (!live) throw new Error(`no deployments for ${project.name}`);

  const deployedSha = String(live.deployment_trigger?.metadata?.commit_hash ?? "").slice(0, 40);
  const url = live.url ?? "";

  console.log(`  project    : ${project.name}`);
  console.log(`  deployment : ${live.short_id ?? live.id}  ${url}`);
  console.log(`  env        : ${live.environment ?? "?"}  created ${live.created_on ?? "?"}`);
  console.log(`  sha        : ${deployedSha || "(none recorded)"}`);
  console.log(`  expected   : ${want || "(no expected sha)"}`);

  if (!want) {
    console.log("  result     : UNKNOWN - no expected sha in this context");
    process.exit(0);
  }
  if (!deployedSha) {
    console.log("  result     : UNKNOWN - the deployment records no commit hash");
    process.exit(0);
  }
  if (want.startsWith(deployedSha) || deployedSha.startsWith(want)) {
    console.log("  result     : MATCH - the site is serving this commit");
    process.exit(0);
  }
  console.log("  result     : MISMATCH - the site is serving a different commit than this run built");
  process.exit(1);
} catch (e) {
  console.log(`  deploy     : UNKNOWN - ${String(e.message).slice(0, 160)}`);
  process.exit(0);
}
