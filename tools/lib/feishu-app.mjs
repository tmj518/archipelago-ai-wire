/**
 * Feishu (Lark) app messaging: tenant token, then a message.
 *
 * The webhook path in notify-feishu.mjs posts to a group bot. This is the other way in: an app with
 * its own identity, which can target a specific chat and returns a message_id that can be quoted as
 * evidence. Both exist because they fail differently - a webhook cannot tell you which message it
 * sent, and an app cannot work without permissions being granted in the console.
 *
 * Nothing here logs a token, an app secret or a full response body. `redact` exists so a caller that
 * does want to print diagnostics cannot print a credential by accident.
 */

const BASE = "https://open.feishu.cn/open-apis";

export function redact(value) {
  const s = String(value ?? "");
  if (!s) return "";
  return s.length <= 6 ? "***" : s.slice(0, 3) + "***" + s.slice(-2);
}

/**
 * @returns {{ok:boolean, token?:string, error?:string, status?:number}}
 */
export async function tenantToken({ appId, appSecret, fetchImpl = fetch, timeoutMs = 15000 } = {}) {
  if (!appId || !appSecret) return { ok: false, error: "missing app credentials" };
  try {
    const r = await fetchImpl(`${BASE}/auth/v3/tenant_access_token/internal`, {
      method: "POST",
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const j = await r.json().catch(() => null);
    if (!r.ok || !j || j.code !== 0 || !j.tenant_access_token) {
      return { ok: false, status: r.status, error: `token refused (${j?.code ?? r.status}): ${j?.msg ?? "no body"}` };
    }
    return { ok: true, token: j.tenant_access_token, status: r.status };
  } catch (e) {
    return { ok: false, error: `token request failed: ${e.name}` };
  }
}

/** Build the card body. Pure, so the shape is testable without a network. */
export function buildMessage({ receiveId, receiveIdType = "chat_id", title, lines = [], link }) {
  const text = [...lines, link ? `[${title}](${link})` : title].join("\n");
  return {
    receive_id: receiveId,
    msg_type: "text",
    content: JSON.stringify({ text }),
    // receive_id_type travels as a query parameter in the API, kept here so one object describes the call
    __receiveIdType: receiveIdType,
  };
}

/**
 * Send one message, retrying only on 429 and 5xx - a 4xx means the app lacks a permission or the chat
 * id is wrong, and repeating it cannot help.
 *
 * @returns {{ok:boolean, messageId?:string, error?:string, attempts:number}}
 */
export async function sendMessage({ appId, appSecret, receiveId, receiveIdType = "chat_id", title, lines, link, fetchImpl = fetch, retries = 2, timeoutMs = 15000 } = {}) {
  const tok = await tenantToken({ appId, appSecret, fetchImpl, timeoutMs });
  if (!tok.ok) return { ok: false, error: tok.error, attempts: 0 };

  const msg = buildMessage({ receiveId, receiveIdType, title, lines, link });
  const url = `${BASE}/im/v1/messages?receive_id_type=${encodeURIComponent(msg.__receiveIdType)}`;
  let last = "unknown";
  let usedAttempts = 0;

  for (let attempt = 0; attempt <= retries; attempt++) {
    usedAttempts = attempt + 1;
    try {
      const r = await fetchImpl(url, {
        method: "POST",
        headers: { "content-type": "application/json; charset=utf-8", authorization: `Bearer ${tok.token}` },
        body: JSON.stringify({ receive_id: msg.receive_id, msg_type: msg.msg_type, content: msg.content }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      const j = await r.json().catch(() => null);
      if (r.ok && j?.code === 0) return { ok: true, messageId: j?.data?.message_id ?? "", attempts: attempt + 1 };
      last = `send refused (${j?.code ?? r.status}): ${j?.msg ?? "no body"}`;
      if (r.status !== 429 && r.status < 500) break;
    } catch (e) {
      last = `send failed: ${e.name}`;
    }
    if (attempt < retries) await new Promise((res) => setTimeout(res, 800 * (attempt + 1)));
  }
  return { ok: false, error: last, attempts: usedAttempts };
}