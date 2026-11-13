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
  const projects = await getJson(api("/pages/projects"));
  const project = (projects ?? []).find((p) => (p.domains ?? []).some((d) => String(d).includes("ghiblistyled")));
  if (!project) throw new Error("no Pages project serving ghiblistyled.com");

  const deployments = await getJson(api(`/pages/projects/${project.name}/deployments`));
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

  /*
   * The two SHAs will almost never be equal, and that is not a fault.
   *
   * Every run commits its own record at the end, so main is always one commit ahead of whatever
   * Cloudflare last built - those commits change data/, not the site. What matters is whether anything
   * under src/ changed between the deployed commit and this one: if nothing did, the reader is looking
   * at the current site.
   */
  try {
    const { execFileSync } = await import("node:child_process");
    const changed = execFileSync("git", ["diff", "--name-only", deployedSha, want, "--", "src/"], {
      encoding: "utf8",
    }).trim();
    if (!changed) {
      console.log("  result     : MATCH - the site is serving this commit; nothing under src/ changed since");
      process.exit(0);
    }
    console.log("  result     : MISMATCH - src/ changed since the deployed commit:");
    for (const line of changed.split("\n").slice(0, 8)) console.log(`      ${line}`);
    process.exit(1);
  } catch (e) {
    console.log(`  result     : UNKNOWN - could not compare histories (${String(e.message).slice(0, 80)})`);
    process.exit(0);
  }
  console.log("  result     : MISMATCH - the site is serving a different commit than this run built");
  process.exit(1);
} catch (e) {
  console.log(`  deploy     : UNKNOWN - ${String(e.message).slice(0, 160)}`);
  process.exit(0);
}
