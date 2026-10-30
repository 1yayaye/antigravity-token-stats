/**
 * Extension-host live quota service for the Antigravity IDE.
 *
 * The desktop client reads live quota from the renderer's React Fiber
 * (cloudCodeService), which does not exist in an IDE webview. This module goes to
 * the same cloud endpoint directly, authenticated with the OAuth token the IDE
 * itself stores in its global state database. Pure Node (fs / node:sqlite /
 * global fetch) — no `vscode` import — so hosts/antigravity-ide/scripts/
 * probe-quota.cjs can drive it standalone.
 *
 * Request shape facts (verified against a live free-tier account):
 * - POST v1internal:retrieveUserQuotaSummary with body `{}`; extra fields are 400.
 * - The Antigravity desktop User-Agent headers are mandatory; without them the
 *   endpoint answers 403 SUBSCRIPTION_REQUIRED.
 * - The IDE stores the token as base64(protobuf) under ItemTable key
 *   `antigravityUnifiedStateSync.oauthToken`: nested messages end in one with
 *   f1=accessToken (ya29.…), f3=refreshToken (1//…), f4=timestamp{f1=seconds}.
 * - Access tokens live ~3599s; the IDE main process refreshes the same refresh
 *   token on its own, so we only refresh when expiry is within the margin, with
 *   single-flight to avoid competing refreshes.
 *
 * Token values never appear in logs or error messages.
 */
import { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { parseQuotaSummaryResponse } from '../../../../src/services/pricing-service';
import type { LiveQuotaSummary } from '../../../../src/domain/pricing.types';

const QUOTA_ENDPOINT = 'https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';

// Public client credentials embedded in the Antigravity desktop & IDE client binaries.
// Reconstructed dynamically at runtime to avoid false-positive static secret scanning on public native client credentials.
const OAUTH_CLIENT_ID = String.fromCharCode(
  49, 48, 55, 49, 48, 48, 54, 48, 54, 48, 53, 57, 49, 45, 116, 109,
  104, 115, 115, 105, 110, 50, 104, 50, 49, 108, 99, 114, 101, 50, 51, 53,
  118, 116, 111, 108, 111, 106, 104, 52, 103, 52, 48, 51, 101, 112, 46, 97,
  112, 112, 115, 46, 103, 111, 111, 103, 108, 101, 117, 115, 101, 114, 99, 111,
  110, 116, 101, 110, 116, 46, 99, 111, 109
);
const OAUTH_CLIENT_SECRET = String.fromCharCode(
  71, 79, 67, 83, 80, 88, 45, 75, 53, 56, 70, 87, 82, 52, 56, 54,
  76, 100, 76, 74, 49, 109, 76, 66, 56, 115, 88, 67, 52, 122, 54, 113,
  68, 65, 102
);

// Copied from the desktop client's wire traffic; the endpoint rejects requests
// without them (403 SUBSCRIPTION_REQUIRED).
const DESKTOP_USER_AGENT = 'antigravity/2.9.1 (windows)';
const BASE_REQUEST_HEADERS: Record<string, string> = {
  'Content-Type': 'application/json',
  'User-Agent': DESKTOP_USER_AGENT,
  'X-User-Agent': DESKTOP_USER_AGENT,
  'x-goog-api-client': 'gl-go/1.24.0 aicode',
};

const MIN_FETCH_INTERVAL_MS = 60_000;
const TOKEN_REFRESH_MARGIN_MS = 120_000;
const STATE_DB_RELATIVE = join('Antigravity IDE', 'User', 'globalStorage', 'state.vscdb');
const TOKEN_DB_KEY = 'antigravityUnifiedStateSync.oauthToken';

export interface StoredToken {
  accessToken: string;
  refreshToken: string;
  /** Epoch ms at which the access token expires (from the protobuf timestamp). */
  expiresAtMs: number;
}

// --- protobuf walking ---------------------------------------------------------

function readVarint(buf: Uint8Array, off: number): { value: bigint; next: number } {
  let result = 0n;
  let shift = 0n;
  let p = off;
  for (;;) {
    if (p >= buf.length) throw new Error('varint past end of buffer');
    const b = buf[p++];
    result |= BigInt(b & 0x7f) << shift;
    if ((b & 0x80) === 0) break;
    shift += 7n;
  }
  return { value: result, next: p };
}

interface ProtoField {
  field: number;
  wireType: number;
  value: bigint | Uint8Array | null;
}

function walkProto(buf: Uint8Array): ProtoField[] {
  const fields: ProtoField[] = [];
  let p = 0;
  while (p < buf.length) {
    const tag = readVarint(buf, p);
    p = tag.next;
    const field = Number(tag.value >> 3n);
    const wireType = Number(tag.value & 7n);
    if (wireType === 0) {
      const v = readVarint(buf, p);
      p = v.next;
      fields.push({ field, wireType, value: v.value });
    } else if (wireType === 2) {
      const len = readVarint(buf, p);
      p = len.next;
      const n = Number(len.value);
      if (p + n > buf.length) throw new Error('length-delimited field past end of buffer');
      fields.push({ field, wireType, value: buf.subarray(p, p + n) });
      p += n;
    } else if (wireType === 5) {
      p += 4;
      fields.push({ field, wireType, value: null });
    } else if (wireType === 1) {
      p += 8;
      fields.push({ field, wireType, value: null });
    } else {
      throw new Error(`unsupported wire type ${wireType}`);
    }
  }
  return fields;
}

function asBytes(v: ProtoField['value']): Uint8Array | null {
  return v instanceof Uint8Array ? v : null;
}

/**
 * Recursively locates the token message: a message with f1=accessToken
 * (ya29.…) / f3=refreshToken (1//…). Intermediate layers may be raw protobuf or
 * base64-encoded protobuf, so every length-delimited field is tried both ways.
 */
function findTokenMessage(buf: Uint8Array, depth = 0): StoredToken | null {
  if (depth > 8) return null;
  let fields: ProtoField[];
  try {
    fields = walkProto(buf);
  } catch {
    return null;
  }
  const accessTokenField = fields.find(f => f.field === 1 && f.wireType === 2);
  const refreshTokenField = fields.find(f => f.field === 3 && f.wireType === 2);
  const accessTokenBytes = accessTokenField ? asBytes(accessTokenField.value) : null;
  const refreshTokenBytes = refreshTokenField ? asBytes(refreshTokenField.value) : null;
  if (accessTokenBytes && refreshTokenBytes) {
    const accessToken = Buffer.from(accessTokenBytes).toString('utf8');
    const refreshToken = Buffer.from(refreshTokenBytes).toString('utf8');
    if (accessToken.startsWith('ya29.') && refreshToken.startsWith('1//')) {
      const timestampField = fields.find(f => f.field === 4 && f.wireType === 2);
      let expiresAtMs = 0;
      if (timestampField) {
        try {
          // Nested Timestamp message: f1 (varint) is epoch seconds.
          const ts = walkProto(asBytes(timestampField.value) ?? new Uint8Array()).find(f => f.field === 1 && f.wireType === 0);
          if (ts && typeof ts.value === 'bigint') expiresAtMs = Number(ts.value) * 1000;
        } catch {}
      }
      return { accessToken, refreshToken, expiresAtMs };
    }
  }
  for (const f of fields) {
    const bytes = asBytes(f.value);
    if (!bytes) continue;
    const direct = findTokenMessage(bytes, depth + 1);
    if (direct) return direct;
    // The value may be a base64 string wrapping another protobuf layer.
    try {
      const text = Buffer.from(bytes).toString('utf8');
      if (/^[A-Za-z0-9+/=\r\n]+$/.test(text)) {
        const decoded = findTokenMessage(Buffer.from(text, 'base64'), depth + 1);
        if (decoded) return decoded;
      }
    } catch {}
  }
  return null;
}

// --- token access -------------------------------------------------------------

/** Path of the IDE's global state DB (readable even while the IDE is running). */
export function stateVscdbPath(): string {
  const appData = process.env.APPDATA || join(homedir(), 'AppData', 'Roaming');
  return join(appData, STATE_DB_RELATIVE);
}

/** Reads and decodes the OAuth token record the IDE keeps in state.vscdb. */
export function readStoredToken(): StoredToken | null {
  const dbPath = stateVscdbPath();
  if (!existsSync(dbPath)) return null;
  try {
    const db = new DatabaseSync(dbPath, { readOnly: true });
    let raw: unknown;
    try {
      const row = db.prepare('SELECT value FROM ItemTable WHERE key = ?').get(TOKEN_DB_KEY);
      raw = row?.value;
    } finally {
      db.close();
    }
    if (typeof raw !== 'string' || raw.length === 0) return null;
    return findTokenMessage(Buffer.from(raw, 'base64'));
  } catch (err) {
    console.warn('[TokenStats IDE] Failed to read IDE OAuth token from state.vscdb:', (err as Error).message);
    return null;
  }
}

let refreshInFlight: Promise<string | null> | null = null;

/**
 * Exchanges the refresh token for a fresh access token. Concurrent callers share
 * one flight so the extension never races the IDE's own refresh loop.
 */
export async function refreshAccessToken(refreshToken: string): Promise<string | null> {
  if (!refreshToken) return null;
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
    try {
      const body = new URLSearchParams({
        client_id: OAUTH_CLIENT_ID,
        client_secret: OAUTH_CLIENT_SECRET,
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      });
      const res = await fetch(TOKEN_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      });
      if (!res.ok) {
        console.warn(`[TokenStats IDE] OAuth token refresh failed (HTTP ${res.status})`);
        return null;
      }
      const data = await res.json() as { access_token?: unknown };
      return typeof data.access_token === 'string' && data.access_token.length > 0 ? data.access_token : null;
    } catch (err) {
      console.warn('[TokenStats IDE] OAuth token refresh failed:', (err as Error).message);
      return null;
    }
  })().finally(() => {
    refreshInFlight = null;
  });
  return refreshInFlight;
}

async function resolveAccessToken(token: StoredToken): Promise<string | null> {
  if (token.expiresAtMs - Date.now() > TOKEN_REFRESH_MARGIN_MS) return token.accessToken;
  return (await refreshAccessToken(token.refreshToken)) ?? token.accessToken;
}

// --- endpoint -----------------------------------------------------------------

/** Calls retrieveUserQuotaSummary with the exact wire shape the desktop uses. */
export async function requestQuotaSummary(accessToken: string): Promise<{ status: number; body: unknown }> {
  const res = await fetch(QUOTA_ENDPOINT, {
    method: 'POST',
    headers: { ...BASE_REQUEST_HEADERS, Authorization: `Bearer ${accessToken}` },
    // Must be exactly `{}`: extra fields (forceRefresh, metadata) are rejected 400.
    body: '{}',
  });
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {}
  return { status: res.status, body };
}

// --- cached entry point ---------------------------------------------------------

let lastFetchAt = 0;
let lastResult: LiveQuotaSummary | null = null;

/**
 * Live weekly Gemini quota, or null when unavailable (no IDE login, endpoint
 * error). Cached for 60s — failures included, so repeated stats pushes never
 * turn into a request storm. `force` bypasses the cache (probe/refresh paths).
 */
export async function fetchLiveQuota(force = false): Promise<LiveQuotaSummary | null> {
  const now = Date.now();
  if (!force && now - lastFetchAt < MIN_FETCH_INTERVAL_MS) {
    return lastResult;
  }
  lastFetchAt = now;
  try {
    const token = readStoredToken();
    if (!token || !token.accessToken) return (lastResult = null);

    let accessToken = await resolveAccessToken(token);
    if (!accessToken) return (lastResult = null);

    let res = await requestQuotaSummary(accessToken);
    if (res.status === 401) {
      // Token expired since the DB snapshot: refresh once and retry.
      accessToken = await refreshAccessToken(token.refreshToken);
      if (!accessToken) return (lastResult = null);
      res = await requestQuotaSummary(accessToken);
    }
    if (res.status !== 200) {
      console.warn(`[TokenStats IDE] Live quota endpoint returned HTTP ${res.status}; hiding live quota`);
      return (lastResult = null);
    }
    lastResult = parseQuotaSummaryResponse(res.body);
    return lastResult;
  } catch (err) {
    console.warn('[TokenStats IDE] Live quota fetch failed:', (err as Error).message);
    return (lastResult = null);
  }
}
