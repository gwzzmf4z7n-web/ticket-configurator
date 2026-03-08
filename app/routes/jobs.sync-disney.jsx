import { unauthenticated } from "../shopify.server";
import { DISNEY_SYNC_PROFILES } from "../config/disney-sync-profiles.server";
import { runDisneyProfileSync } from "../services/disney-sync.server";

const LOCK_KEY = "__ticketSyncLock";
const STATUS_KEY = "__ticketSyncStatus";

function acquireLock(ttlMs = 15 * 60 * 1000) {
  const now = Date.now();
  const existing = global[LOCK_KEY];
  if (existing && existing.expiresAt > now) return false;
  global[LOCK_KEY] = { expiresAt: now + ttlMs };
  return true;
}

function releaseLock() {
  delete global[LOCK_KEY];
}

function getStatus() {
  return (
    global[STATUS_KEY] || {
      running: false,
      startedAt: null,
      finishedAt: null,
      lastResult: null,
      lastError: null,
    }
  );
}

function setStatus(next) {
  global[STATUS_KEY] = { ...getStatus(), ...next };
}

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload, null, 2), {
    status,
    headers: { "content-type": "application/json" },
  });
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

function isForceRequested(request) {
  const url = new URL(request.url);
  const force = String(url.searchParams.get("force") || "").toLowerCase();
  return force === "1" || force === "true" || force === "yes";
}

function isSyncModeRequested(request) {
  const url = new URL(request.url);
  const mode = String(url.searchParams.get("mode") || "").toLowerCase();
  return mode === "sync";
}

async function runSyncJob({ shop, profiles }) {
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
  return {
    ok: okCount > 0,
    shop,
    startedAt,
    finishedAt: new Date().toISOString(),
    requestedProfiles: profiles.map((profile) => profile.key),
    successCount: okCount,
    failureCount: results.length - okCount,
    results,
  };
}

async function executeJob({ shop, profiles }) {
  setStatus({ running: true, startedAt: new Date().toISOString(), finishedAt: null, lastError: null });
  try {
    const result = await runSyncJob({ shop, profiles });
    setStatus({ running: false, finishedAt: new Date().toISOString(), lastResult: result, lastError: null });
    return result;
  } catch (error) {
    const lastError = { message: error?.message || "Unexpected sync error", name: error?.name || "Error" };
    setStatus({ running: false, finishedAt: new Date().toISOString(), lastError });
    throw error;
  } finally {
    releaseLock();
  }
}

async function runSync(request) {
  try {
    if (!isAuthorized(request)) return jsonResponse({ ok: false, error: "Unauthorized" }, 401);

    const shop = resolveShop(request);
    if (!shop) return jsonResponse({ ok: false, error: "Missing shop query param or SYNC_DEFAULT_SHOP env" }, 400);

    const profiles = resolveRequestedProfiles(request);
    if (!profiles.length) return jsonResponse({ ok: false, error: "No enabled profiles matched." }, 404);

    if (isForceRequested(request)) {
      releaseLock();
      setStatus({ running: false });
    }

    if (!acquireLock()) {
      return jsonResponse({ ok: false, error: "Sync already running", status: getStatus() }, 409);
    }

    if (isSyncModeRequested(request)) {
      const result = await executeJob({ shop, profiles });
      return jsonResponse(result, result.ok ? 200 : 207);
    }

    // Default mode: async trigger. Avoids Render request timeout (502) for long jobs.
    setTimeout(() => {
      executeJob({ shop, profiles }).catch((error) => {
        console.error("Background Disney sync failed:", error);
      });
    }, 0);

    return jsonResponse(
      {
        ok: true,
        accepted: true,
        mode: "async",
        shop,
        requestedProfiles: profiles.map((profile) => profile.key),
        status: getStatus(),
      },
      202,
    );
  } catch (error) {
    releaseLock();
    return jsonResponse(
      {
        ok: false,
        error: error?.message || "Unexpected sync error",
        name: error?.name || "Error",
      },
      500,
    );
  }
}

export const loader = async ({ request }) => {
  const url = new URL(request.url);
  const action = String(url.searchParams.get("action") || "").toLowerCase();
  if (action === "status") {
    return jsonResponse({ ok: true, status: getStatus() });
  }
  return runSync(request);
};

export const action = async ({ request }) => runSync(request);

