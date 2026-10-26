#!/usr/bin/env node
/**
 * Upload a rendered article video to YouTube, then print the video id.
 *
 * This exists because YouTube has no desktop client and no server-side upload
 * without OAuth. Manual upload works (and is what Y1 planned), but it does not
 * scale to the video pipeline: every video would need a browser, a metadata
 * copy-paste and a manual frontmatter edit. This does all three from a slug.
 *
 * WHAT IT RUNS
 *   node tools/youtube-upload.mjs <slug> [--privacy=private|unlisted|public]
 *                                       [--thumbnail] [--captions] [--dry-run]
 *
 *   build/video/<slug>.mp4              required
 *   build/video/<slug>-thumb.png        optional, 1280x720
 *   build/video/<slug>.srt              optional, uploaded as an English track
 *   build/video/<slug>-youtube.txt      required, written by tools/make-video.py
 *
 * CREDENTIALS — both files stay outside the repository, because either one is
 * equivalent to an account password:
 *
 *   %LOCALAPPDATA%\Programs\n8n\youtube-oauth.json   OAuth client (desktop app)
 *   %LOCALAPPDATA%\Programs\n8n\youtube-token.json   written by this script on
 *                                                    first run, then refreshed
 *
 * First run prints a URL, opens nothing, and waits: open the URL, sign in as
 * the account that owns the target channel, approve, and the browser lands on
 * 127.0.0.1:8765 where this script catches the code. The refresh token is
 * cached, so later runs need no browser.
 *
 * WHY private IS THE DEFAULT
 * The YouTube Data API uploads as soon as it is called. The default here is
 * `private` so a first run can be reviewed in Studio before anything is public
 * — an API upload that quietly publishes is not a mistake worth risking to save
 * one click.
 *
 * WHY selfDeclaredMadeForKids IS SENT EXPLICITLY
 * Since the FTC settlement, every upload carries a made-for-kids declaration
 * and an upload that omits it is held for review. This content is trade-policy
 * analysis for importers, so the answer is false, and the script says so rather
 * than leaving the field to the API's default.
 */
import { createServer } from "node:http";
import { createReadStream, existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

const SCOPES = [
  "https://www.googleapis.com/auth/youtube.upload",
  "https://www.googleapis.com/auth/youtube.force-ssl",
];

const CRED_DIR = join(process.env.LOCALAPPDATA ?? ".", "Programs", "n8n");
const CLIENT_FILE = join(CRED_DIR, "youtube-oauth.json");
const TOKEN_FILE = join(CRED_DIR, "youtube-token.json");

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const UPLOAD_URL = "https://www.googleapis.com/upload/youtube/v3/videos";
const API = "https://www.googleapis.com/youtube/v3";

const REDIRECT_PORT = 8765;
const REDIRECT_URI = `http://127.0.0.1:${REDIRECT_PORT}/`;

// ------------------------------------------------------------------ helpers

const die = (msg) => {
  console.error(`\n✗ ${msg}\n`);
  process.exit(1);
};

const log = (msg) => console.log(msg);

const arg = (name, fallback = undefined) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split("=").slice(1).join("=") : fallback;
};
const flag = (name) => process.argv.includes(`--${name}`);

const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));

/** Parse build/video/<slug>-youtube.txt, the file make-video.py writes. */
function readMetadata(path) {
  const raw = readFileSync(path, "utf8");
  const lines = raw.split(/\r?\n/);

  const title = (lines.find((l) => l.startsWith("# ")) ?? "").replace(/^#\s*/, "").trim();
  const tagsLine = lines.find((l) => /^Tags:\s*/.test(l)) ?? "";
  const tags = tagsLine
    .replace(/^Tags:\s*/, "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);

  // Everything between the title and the trailing housekeeping lines is the
  // description: the article link, the summary paragraph and the sourcing note.
  const stop = lines.findIndex((l) => /^Runtime:\s*/.test(l));
  const start = 1;
  const description = lines
    .slice(start, stop === -1 ? lines.length : stop)
    .join("\n")
    .replace(/---[\s\S]*$/, "")
    .trim();

  return { title, description, tags };
}

// ---------------------------------------------------------------- OAuth flow

function loadClient() {
  if (!existsSync(CLIENT_FILE)) {
    die(
      `OAuth client not found at:\n  ${CLIENT_FILE}\n\n` +
        `Create it once:\n` +
        `  1. https://console.cloud.google.com/ → new project, e.g. landed-math\n` +
        `  2. APIs & Services → Library → enable "YouTube Data API v3"\n` +
        `  3. OAuth consent screen → External → add yourself as a test user\n` +
        `  4. Credentials → Create credentials → OAuth client ID → Desktop app\n` +
        `  5. Download the JSON and save it to the path above\n\n` +
        `The file is a credential. It is gitignored and must stay outside the repo.`,
    );
  }
  const raw = readJson(CLIENT_FILE);
  const c = raw.installed ?? raw.web ?? raw;
  if (!c.client_id || !c.client_secret) {
    die(`${CLIENT_FILE} has no client_id / client_secret — is it the right JSON?`);
  }
  return { clientId: c.client_id, clientSecret: c.client_secret };
}

async function exchange(params) {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params),
  });
  const body = await res.json();
  if (!res.ok) die(`token endpoint ${res.status}: ${JSON.stringify(body)}`);
  return body;
}

function saveToken(tok) {
  writeFileSync(
    TOKEN_FILE,
    JSON.stringify({ ...tok, _obtained: new Date().toISOString() }, null, 2),
    "utf8",
  );
}

/** Return a usable access token, doing the browser dance only when needed. */
async function accessToken(client) {
  if (existsSync(TOKEN_FILE)) {
    const tok = readJson(TOKEN_FILE);
    if (tok.refresh_token) {
      const fresh = await exchange({
        client_id: client.clientId,
        client_secret: client.clientSecret,
        refresh_token: tok.refresh_token,
        grant_type: "refresh_token",
      });
      if (fresh.access_token) {
        saveToken({ ...tok, ...fresh });
        log("  token refreshed from cache (no browser needed)");
        return fresh.access_token;
      }
      log("  cached refresh token was rejected — re-authorising");
    }
  }

  const auth = new URL(AUTH_URL);
  auth.searchParams.set("client_id", client.clientId);
  auth.searchParams.set("redirect_uri", REDIRECT_URI);
  auth.searchParams.set("response_type", "code");
  auth.searchParams.set("scope", SCOPES.join(" "));
  // offline + consent is what actually returns a refresh_token; without
  // prompt=consent Google omits it on repeat authorisations.
  auth.searchParams.set("access_type", "offline");
  auth.searchParams.set("prompt", "consent");

  const code = await new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const u = new URL(req.url, REDIRECT_URI);
      const c = u.searchParams.get("code");
      const err = u.searchParams.get("error");
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(
        c
          ? "<h2>Authorised.</h2><p>You can close this tab and return to the terminal.</p>"
          : `<h2>Not authorised.</h2><p>${err ?? "no code returned"}</p>`,
      );
      server.close();
      c ? resolve(c) : reject(new Error(err ?? "no code in redirect"));
    });
    server.on("error", reject);
    server.listen(REDIRECT_PORT, "127.0.0.1", () => {
      log("\n  Open this URL, sign in as the account that owns the channel, approve:\n");
      log("  " + auth.toString() + "\n");
      log(`  Waiting for the redirect on ${REDIRECT_URI} ...`);
    });
  });

  const tok = await exchange({
    client_id: client.clientId,
    client_secret: client.clientSecret,
    code,
    grant_type: "authorization_code",
    redirect_uri: REDIRECT_URI,
  });
  if (!tok.refresh_token) {
    log("  warning: Google returned no refresh_token — the next run will need the browser again");
  }
  saveToken(tok);
  log(`  token cached at ${TOKEN_FILE}`);
  return tok.access_token;
}

// ------------------------------------------------------------------- upload

/**
 * Resumable upload. A 3.5 MB file would fit in one simple-upload request, but
 * resumable is the only form that also carries the snippet and status in the
 * same call, so it is one round trip either way and it survives a dropped
 * connection without re-sending the payload.
 */
async function uploadVideo({ token, file, meta, privacy }) {
  const size = statSync(file).size;

  const init = await fetch(`${UPLOAD_URL}?uploadType=resumable&part=snippet,status`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json; charset=UTF-8",
      "x-upload-content-length": String(size),
      "x-upload-content-type": "video/mp4",
    },
    body: JSON.stringify({
      snippet: {
        title: meta.title.slice(0, 100),
        description: meta.description.slice(0, 5000),
        tags: meta.tags.slice(0, 15),
        categoryId: "22", // People & Blogs is wrong for this; 22 is the closest
        // widely-available default. "News & Politics" (25) misreads as politics
        // and "Education" (27) undersells it, so this is a deliberate choice.
        defaultLanguage: "en",
        defaultAudioLanguage: "en",
      },
      status: {
        privacyStatus: privacy,
        selfDeclaredMadeForKids: false,
      },
    }),
  });

  if (!init.ok) {
    die(`upload init failed ${init.status}: ${(await init.text()).slice(0, 500)}`);
  }
  const session = init.headers.get("location");
  if (!session) die("upload init returned no resumable session URL");

  log(`  streaming ${(size / 1024 / 1024).toFixed(1)} MB ...`);
  const put = await fetch(session, {
    method: "PUT",
    headers: {
      "content-type": "video/mp4",
      "content-length": String(size),
    },
    body: createReadStream(file),
    duplex: "half",
  });

  const body = await put.json().catch(() => ({}));
  if (!put.ok) die(`upload failed ${put.status}: ${JSON.stringify(body).slice(0, 500)}`);
  return body;
}

async function setThumbnail(token, videoId, png) {
  const res = await fetch(`${API}/thumbnails/set?videoId=${videoId}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "image/png",
      "content-length": String(statSync(png).size),
    },
    body: createReadStream(png),
    duplex: "half",
  });
  if (!res.ok) {
    log(`  ! thumbnail rejected (${res.status}): ${(await res.text()).slice(0, 200)}`);
    log("    a channel needs to be verified for a custom thumbnail — upload continues");
    return false;
  }
  log("  thumbnail set");
  return true;
}

async function setCaptions(token, videoId, srt) {
  const body = readFileSync(srt);
  const boundary = "landedmath" + Date.now();
  const meta = JSON.stringify({ snippet: { videoId, language: "en", name: "English" } });

  const parts = [
    `--${boundary}\r\ncontent-type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n`,
    `--${boundary}\r\ncontent-type: application/octet-stream\r\n\r\n`,
  ];
  const buf = Buffer.concat([
    Buffer.from(parts[0], "utf8"),
    Buffer.from(parts[1], "utf8"),
    body,
    Buffer.from(`\r\n--${boundary}--\r\n`, "utf8"),
  ]);

  const res = await fetch(`${API}/captions?part=snippet&uploadType=multipart`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": `multipart/related; boundary=${boundary}`,
      "content-length": String(buf.length),
    },
    body: buf,
  });
  if (!res.ok) {
    log(`  ! captions rejected (${res.status}): ${(await res.text()).slice(0, 200)}`);
    return false;
  }
  log("  captions attached as an English track");
  return true;
}

// --------------------------------------------------------------------- main

const slug = process.argv.slice(2).find((a) => !a.startsWith("--"));
if (!slug) die("usage: node tools/youtube-upload.mjs <slug> [--privacy=private] [--dry-run]");

const privacy = arg("privacy", "private");
if (!["private", "unlisted", "public"].includes(privacy)) {
  die(`--privacy must be private, unlisted or public (got "${privacy}")`);
}

const dir = join("build", "video");
const video = join(dir, `${slug}.mp4`);
const thumb = join(dir, `${slug}-thumb.png`);
const srt = join(dir, `${slug}.srt`);
const metaFile = join(dir, `${slug}-youtube.txt`);

if (!existsSync(video)) die(`no video at ${video} — render it first:\n  python tools/make-video.py ${slug}`);
if (!existsSync(metaFile)) die(`no metadata at ${metaFile} — it comes from make-video.py`);

const meta = readMetadata(metaFile);

log(`\nYouTube upload — ${slug}`);
log(`  video     : ${video} (${(statSync(video).size / 1024 / 1024).toFixed(1)} MB)`);
log(`  thumbnail : ${existsSync(thumb) ? basename(thumb) : "(none)"}`);
log(`  captions  : ${existsSync(srt) ? basename(srt) : "(none)"}`);
log(`  privacy   : ${privacy}`);
log(`\n  title:\n    ${meta.title}`);
log(`\n  description:\n${meta.description.split("\n").map((l) => "    " + l).join("\n")}`);
log(`\n  tags: ${meta.tags.join(", ")}`);

if (flag("dry-run")) {
  log("\n--dry-run: nothing uploaded.\n");
  process.exit(0);
}

const client = loadClient();
log("\nAuthorising ...");
const token = await accessToken(client);

log("\nUploading ...");
const video_ = await uploadVideo({ token, file: video, meta, privacy });
const videoId = video_?.id;
if (!videoId) die(`upload returned no video id: ${JSON.stringify(video_).slice(0, 400)}`);

log(`  uploaded: ${videoId}  (${video_?.status?.uploadStatus ?? "status unknown"})`);

if (existsSync(thumb) && !flag("no-thumbnail")) await setThumbnail(token, videoId, thumb);
if (existsSync(srt) && !flag("no-captions")) await setCaptions(token, videoId, srt);

log(`\n✓ https://www.youtube.com/watch?v=${videoId}\n`);
log("Paste this into the article frontmatter:\n");
log(`  youtube_id: "${videoId}"\n`);
log("Then the ArticleVideo component renders the player and VideoObject data.\n");
