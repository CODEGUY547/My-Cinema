import { createServer } from "node:http";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createHmac, randomBytes, randomInt, scryptSync, timingSafeEqual } from "node:crypto";
import { Readable } from "node:stream";
import { resolve } from "node:path";

const host = "127.0.0.1";
const port = Number(process.env.GATEWAY_PORT || 4180);
const secretsPath = resolve(".gateway-secrets.json");
const jellyfinUrl = "http://127.0.0.1:8096";
const attempts = new Map();
let jellyfinSession = null;

function loadLocalEnv() {
  const envPath = resolve(".env.local");
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/i);
    if (!match || match[1] in process.env) continue;
    process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, "$2");
  }
}

function createSecrets() {
  if (existsSync(secretsPath)) {
    console.log("Gateway secrets already exist. Delete .gateway-secrets.json only if you intend to rotate the shared PIN.");
    return;
  }
  const pin = String(randomInt(100000, 1000000));
  const pinSalt = randomBytes(16).toString("hex");
  const secrets = {
    version: 1,
    pinSalt,
    pinHash: scryptSync(pin, pinSalt, 32).toString("hex"),
    signingSecret: randomBytes(32).toString("hex"),
    createdAt: new Date().toISOString()
  };
  writeFileSync(secretsPath, `${JSON.stringify(secrets, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  console.log(`My Cinema shared PIN: ${pin}`);
  console.log("Save this PIN somewhere private. It is stored only as a one-way hash.");
}

if (process.argv.includes("--init")) {
  createSecrets();
  process.exit(0);
}

loadLocalEnv();
if (!existsSync(secretsPath)) {
  console.error("Gateway is not initialized. Run: npm run gateway:init");
  process.exit(1);
}

const secrets = JSON.parse(readFileSync(secretsPath, "utf8"));
const publicBase = (process.env.PUBLIC_GATEWAY_URL || "https://mahad.tailf99850.ts.net").replace(/\/+$/, "");
const guestUsername = process.env.JELLYFIN_GUEST_USERNAME || "Friends";
const guestPassword = process.env.JELLYFIN_GUEST_PASSWORD || "";
const allowedOrigins = new Set((process.env.CINEMA_PUBLIC_ORIGINS || "https://my-cinema-mu.vercel.app,http://localhost:4173").split(",").map(value => value.trim()).filter(Boolean));

function corsHeaders(request) {
  const origin = request.headers.origin;
  if (!origin || !allowedOrigins.has(origin)) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET,HEAD,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Authorization,Content-Type",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin"
  };
}

function sendJson(request, response, status, body, extra = {}) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    ...corsHeaders(request),
    ...extra
  });
  response.end(JSON.stringify(body));
}

function b64url(value) {
  return Buffer.from(value).toString("base64url");
}

function signPayload(payload) {
  const encoded = b64url(JSON.stringify(payload));
  const signature = createHmac("sha256", secrets.signingSecret).update(encoded).digest("base64url");
  return `${encoded}.${signature}`;
}

function verifyToken(token, expectedKind) {
  if (!token || !token.includes(".")) return null;
  const [encoded, signature] = token.split(".");
  const expected = createHmac("sha256", secrets.signingSecret).update(encoded).digest();
  let supplied;
  try { supplied = Buffer.from(signature, "base64url"); } catch { return null; }
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    if (payload.kind !== expectedKind || Number(payload.exp) < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

function bearerToken(request) {
  const match = request.headers.authorization?.match(/^Bearer\s+(.+)$/i);
  return match?.[1] || "";
}

function clientKey(request) {
  return String(request.headers["x-forwarded-for"] || request.socket.remoteAddress || "unknown").split(",")[0].trim();
}

function checkAttemptLimit(request) {
  const key = clientKey(request);
  const now = Date.now();
  const windowMs = 15 * 60 * 1000;
  const entry = attempts.get(key);
  if (!entry || now - entry.startedAt > windowMs) {
    attempts.set(key, { startedAt: now, failures: 0 });
    return { allowed: true, key };
  }
  return { allowed: entry.failures < 5, key, retryAfter: Math.ceil((windowMs - (now - entry.startedAt)) / 1000) };
}

function recordFailure(key) {
  const entry = attempts.get(key) || { startedAt: Date.now(), failures: 0 };
  entry.failures += 1;
  attempts.set(key, entry);
}

function verifyPin(pin) {
  const expected = Buffer.from(secrets.pinHash, "hex");
  const supplied = scryptSync(String(pin || ""), secrets.pinSalt, 32);
  return expected.length === supplied.length && timingSafeEqual(expected, supplied);
}

async function readJson(request) {
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 4096) throw new Error("Request too large");
  }
  return JSON.parse(body || "{}");
}

function jellyfinAuthorization(token = "") {
  return [
    'MediaBrowser Client="My%20Cinema%20Gateway"',
    'Device="Windows%20server"',
    'DeviceId="my-cinema-guest-gateway"',
    'Version="1.0.0"',
    `Token="${encodeURIComponent(token)}"`
  ].join(", ");
}

async function authenticateGuest() {
  const response = await fetch(`${jellyfinUrl}/Users/AuthenticateByName`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": jellyfinAuthorization() },
    body: JSON.stringify({ Username: guestUsername, Pw: guestPassword })
  });
  if (!response.ok) throw new Error(`Guest login returned ${response.status}`);
  const auth = await response.json();
  jellyfinSession = { token: auth.AccessToken, userId: auth.User.Id, savedAt: Date.now() };
  return jellyfinSession;
}

async function getJellyfinSession(force = false) {
  if (!force && jellyfinSession && Date.now() - jellyfinSession.savedAt < 6 * 60 * 60 * 1000) return jellyfinSession;
  return authenticateGuest();
}

function runtime(ticks) {
  if (!ticks) return "";
  const minutes = Math.round(ticks / 600000000);
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;
}

async function jellyfinFetch(path, init = {}, retry = true) {
  const session = await getJellyfinSession();
  const response = await fetch(`${jellyfinUrl}${path}`, {
    ...init,
    headers: { ...(init.headers || {}), "Authorization": jellyfinAuthorization(session.token) }
  });
  if (response.status === 401 && retry) {
    await getJellyfinSession(true);
    return jellyfinFetch(path, init, false);
  }
  return response;
}

async function library(request, response) {
  if (!verifyToken(bearerToken(request), "access")) return sendJson(request, response, 401, { error: "Access expired" });
  try {
    const session = await getJellyfinSession();
    const params = new URLSearchParams({
      Recursive: "true",
      IncludeItemTypes: "Movie",
      Fields: "Overview,Genres,RunTimeTicks,PrimaryImageAspectRatio,ProviderIds,UserData",
      SortBy: "SortName",
      SortOrder: "Ascending"
    });
    const upstream = await jellyfinFetch(`/Users/${session.userId}/Items?${params}`);
    if (!upstream.ok) throw new Error(`Library returned ${upstream.status}`);
    const data = await upstream.json();
    const movies = (data.Items || []).map(item => {
      const streamTicket = signPayload({ kind: "stream", itemId: item.Id, exp: Date.now() + 6 * 60 * 60 * 1000 });
      const imageTicket = signPayload({ kind: "image", itemId: item.Id, exp: Date.now() + 24 * 60 * 60 * 1000 });
      return {
        id: `guest-${item.Id}`,
        jellyfinId: item.Id,
        title: item.Name,
        year: item.ProductionYear || null,
        genre: item.Genres?.[0] || null,
        overview: item.Overview || "",
        providerIds: item.ProviderIds || {},
        runtime: runtime(item.RunTimeTicks),
        progress: item.UserData?.PlayedPercentage ? Math.round(item.UserData.PlayedPercentage) : 0,
        image: item.ImageTags?.Primary ? `${publicBase}/image/${item.Id}?ticket=${encodeURIComponent(imageTicket)}` : "",
        videoUrl: `${publicBase}/stream/${item.Id}?ticket=${encodeURIComponent(streamTicket)}`
      };
    });
    return sendJson(request, response, 200, { movies });
  } catch (error) {
    console.error("Guest library failed:", error.message);
    return sendJson(request, response, 503, { error: "Guest library is not ready" });
  }
}

async function proxyMedia(request, response, url, kind, itemId) {
  const payload = verifyToken(url.searchParams.get("ticket"), kind);
  if (!payload || payload.itemId !== itemId) return sendJson(request, response, 401, { error: "Invalid media ticket" });
  const path = kind === "stream"
    ? `/Videos/${encodeURIComponent(itemId)}/stream?Static=true`
    : `/Items/${encodeURIComponent(itemId)}/Images/Primary?maxWidth=800&quality=88`;
  try {
    const headers = {};
    if (request.headers.range) headers.Range = request.headers.range;
    const upstream = await jellyfinFetch(path, { method: request.method, headers });
    const forwarded = {};
    for (const name of ["content-type", "content-length", "content-range", "accept-ranges", "etag", "last-modified"]) {
      const value = upstream.headers.get(name);
      if (value) forwarded[name] = value;
    }
    response.writeHead(upstream.status, {
      ...forwarded,
      "Cache-Control": kind === "image" ? "private, max-age=3600" : "private, no-store",
      "X-Content-Type-Options": "nosniff",
      ...corsHeaders(request)
    });
    if (request.method === "HEAD" || !upstream.body) return response.end();
    Readable.fromWeb(upstream.body).pipe(response);
  } catch (error) {
    console.error(`${kind} proxy failed:`, error.message);
    if (!response.headersSent) sendJson(request, response, 502, { error: "Media proxy failed" });
    else response.destroy();
  }
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host || `${host}:${port}`}`);
  if (request.method === "OPTIONS") {
    response.writeHead(204, { ...corsHeaders(request), "Cache-Control": "public, max-age=86400" });
    return response.end();
  }
  if (url.pathname === "/health" && request.method === "GET") {
    let guestReady = false;
    try { await getJellyfinSession(); guestReady = true; } catch {}
    return sendJson(request, response, 200, { ok: true, guestReady });
  }
  if (url.pathname === "/access" && request.method === "POST") {
    const limit = checkAttemptLimit(request);
    if (!limit.allowed) return sendJson(request, response, 429, { error: "Too many attempts" }, { "Retry-After": String(limit.retryAfter) });
    try {
      const { pin } = await readJson(request);
      if (!verifyPin(pin)) {
        recordFailure(limit.key);
        return sendJson(request, response, 401, { error: "Incorrect PIN" });
      }
      attempts.delete(limit.key);
      const token = signPayload({ kind: "access", exp: Date.now() + 12 * 60 * 60 * 1000 });
      return sendJson(request, response, 200, { token, expiresIn: 43200 });
    } catch {
      return sendJson(request, response, 400, { error: "Invalid request" });
    }
  }
  if (url.pathname === "/library" && request.method === "GET") return library(request, response);
  const streamMatch = url.pathname.match(/^\/stream\/([a-f0-9]+)$/i);
  if (streamMatch && ["GET", "HEAD"].includes(request.method)) return proxyMedia(request, response, url, "stream", streamMatch[1]);
  const imageMatch = url.pathname.match(/^\/image\/([a-f0-9]+)$/i);
  if (imageMatch && ["GET", "HEAD"].includes(request.method)) return proxyMedia(request, response, url, "image", imageMatch[1]);
  return sendJson(request, response, 404, { error: "Not found" });
});

server.listen(port, host, () => {
  console.log(`My Cinema guest gateway: http://${host}:${port}`);
  console.log(`Allowed origins: ${[...allowedOrigins].join(", ")}`);
});
