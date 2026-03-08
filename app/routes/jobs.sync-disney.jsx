import { unauthenticated } from "../shopify.server";
import { DISNEY_SYNC_PROFILES } from "../config/disney-sync-profiles.server";
import { runDisneyProfileSync } from "../services/disney-sync.server";

const LOCK_KEY = "__ticketSyncLock";

function acquireLock(ttlMs = 50 * 60 * 1000) {
  const now = Date.now();
  const existing = global[LOCK_KEY];
  if (existing && existing.expiresAt > now) return false;
  global[LOCK_KEY] = { expiresAt: now + ttlMs };
  return true;
}

function releaseLock() {
  delete global[LOCK_KEY];
}

function isAuthorized(request) {
  // eslint-disable-next-line no-undef
  const expected = process.env.SYNC_JOB_SECRET;
  if (!expected) return false;
  const url = new URL(request.url);
  const queryToken = url.searchParams.get("token");
  const headerToken = request.headers.get("x-sync-token");
  return queryToken === expected || headerToken === expected;
}

function resolveShop(request) {
  const url = new URL(request.url);
  const queryShop = url.searchParams.get("shop");
  // eslint-disable-next-line no-undef
  return queryShop || process.env.SYNC_DEFAULT_SHOP || "";
}

function resolveRequestedProfiles(request) {
  const url = new URL(request.url);
  const profileParam = url.searchParams.get("profile");
  if (!profileParam || profileParam === "all") {
    return DISNEY_SYNC_PROFILES.filter((profile) => profile.enabled !== false);
  }
  return DISNEY_SYNC_PROFILES.filter((profile) => profile.enabled !== false && profile.key === profileParam);
}

async function runSync(request) {
  if (!isAuthorized(request)) {
    return new Response(JSON.stringify({ ok: false, error: "Unauthorized" }, null, 2), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  }

  const lockAcquired = acquireLock();
  if (!lockAcquired) {
    return new Response(JSON.stringify({ ok: false, error: "Sync already running" }, null, 2), {
      status: 409,
      headers: { "content-type": "application/json" },
    });
  }

  try {
  const shop = resolveShop(request);
  if (!shop) {
    return new Response(JSON.stringify({ ok: false, error: "Missing shop query param or SYNC_DEFAULT_SHOP env" }, null, 2), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }

  const profiles = resolveRequestedProfiles(request);
  if (!profiles.length) {
    return new Response(JSON.stringify({ ok: false, error: "No enabled profiles matched." }, null, 2), {
      status: 404,
      headers: { "content-type": "application/json" },
    });
  }

  const { admin } = await unauthenticated.admin(shop);
  const startedAt = new Date().toISOString();
  const results = [];

  for (const profile of profiles) {
    const profileStart = Date.now();
    try {
      const result = await runDisneyProfileSync(admin, profile);
      results.push({
        key: profile.key,
        ok: true,
        durationMs: Date.now() - profileStart,
        ...result,
      });
    } catch (error) {
      results.push({
        key: profile.key,
        ok: false,
        durationMs: Date.now() - profileStart,
        error: error.message,
      });
    }
  }

  const okCount = results.filter((result) => result.ok).length;
  const status = okCount === results.length ? 200 : 207;
  return new Response(
    JSON.stringify(
      {
        ok: okCount > 0,
        shop,
        startedAt,
        finishedAt: new Date().toISOString(),
        requestedProfiles: profiles.map((profile) => profile.key),
        successCount: okCount,
        failureCount: results.length - okCount,
        results,
      },
      null,
      2,
    ),
    {
      status,
      headers: { "content-type": "application/json" },
    },
  );
  } finally {
    releaseLock();
  }
}

export const loader = async ({ request }) => runSync(request);
export const action = async ({ request }) => runSync(request);
