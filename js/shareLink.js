// Encodes/decodes a shareable subset of app state into the URL's #fragment,
// so a link fully reproduces a specific train/route/physics config for
// whoever opens it. Deliberately narrower than the full state persisted to
// localStorage (see storage.js) — display preferences (chip view, table
// grouping, etc.) aren't part of "the config," and always carrying them
// would let a shared link silently override things the recipient already
// set up their own way, not just import the config being shared. Only
// activeTab is included, and only as an optional hint (present -> switch
// to it, absent -> leave whatever tab the recipient already has open) —
// see extractShareableState.
//
// The #fragment (not a query param) never reaches server logs/analytics
// and doesn't count as "navigation" the way a query-param change can.
// Payload is gzip-compressed (native CompressionStream — no dependency)
// then base64url-encoded, since even a couple of trains plus a
// multi-station route adds up in raw JSON.

const HASH_PREFIX = "s=";

// Fields that fully define a specific train/route/physics config — see the
// module comment above for what's deliberately left out and why.
const SHAREABLE_FIELDS = [
  "trains",
  "route",
  "trackSpeedLimit_kmh",
  "brakingDeceleration_ms2",
  "difficultyKey",
  "includeStopsInFinancials",
  "selectedLegIndex",
];

/** @param {boolean} includeActiveTab defaults to true — see module comment on why it's optional. */
export function extractShareableState(state, includeActiveTab = true) {
  const shared = {};
  for (const key of SHAREABLE_FIELDS) shared[key] = state[key];
  if (includeActiveTab) shared.activeTab = state.activeTab;
  return shared;
}

/** Builds the full shareable URL (current origin/path + encoded hash) for the given state. */
export async function buildShareUrl(state, includeActiveTab = true) {
  const hash = await encodeShareHash(extractShareableState(state, includeActiveTab));
  const url = new URL(location.href);
  url.hash = hash;
  return url.toString();
}

async function encodeShareHash(payload) {
  const compressed = await gzip(JSON.stringify(payload));
  return HASH_PREFIX + toBase64Url(compressed);
}

/** @returns {object|null} the decoded payload (still unvalidated — see storage.js's validateState), or null if `hash` isn't a share payload at all. */
export async function decodeShareHash(hash) {
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  if (!raw.startsWith(HASH_PREFIX)) return null;
  const json = await gunzip(fromBase64Url(raw.slice(HASH_PREFIX.length)));
  return JSON.parse(json);
}

async function gzip(text) {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function gunzip(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new TextDecoder().decode(await new Response(stream).arrayBuffer());
}

function toBase64Url(bytes) {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(str) {
  const padded = str.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (str.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
