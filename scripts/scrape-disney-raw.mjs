#!/usr/bin/env node

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

async function fetchJson(url, headers = {}) {
  const response = await fetch(url, {
    headers: {
      "User-Agent": UA,
      Accept: "application/json",
      ...headers,
    },
  });
  if (!response.ok) {
    throw new Error(`Failed ${url} (${response.status})`);
  }
  return response.json();
}

function plusDays(date, days) {
  const copy = new Date(date);
  copy.setUTCDate(copy.getUTCDate() + days);
  return copy;
}

function parseYmd(value) {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const parsed = new Date(`${match[1]}-${match[2]}-${match[3]}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function ymd(date) {
  return date.toISOString().slice(0, 10);
}

function buildWindows(startDate, endDate, windowDays) {
  const windows = [];
  let cursor = new Date(startDate);
  while (cursor <= endDate) {
    const end = plusDays(cursor, windowDays - 1);
    const boundedEnd = end <= endDate ? end : endDate;
    windows.push({ startDate: ymd(cursor), endDate: ymd(boundedEnd) });
    cursor = plusDays(boundedEnd, 1);
  }
  return windows;
}

function toApiDiscountGroup(value) {
  return String(value || "").toLowerCase().replace(/_/g, "-");
}

async function getClientToken() {
  const json = await fetchJson("https://disneyworld.disney.go.com/profile-api/authentication/get-client-token/");
  if (!json?.access_token) throw new Error("No access token returned by Disney client token endpoint.");
  return String(json.access_token);
}

async function getProductListing(token) {
  const listingUrl =
    "https://disneyworld.disney.go.com/api/lexicon-view-assembler-service/wdw/tickets/product-listing?storeId=wdw&affiliations=STD_GST";
  const listing = await fetchJson(listingUrl, { Authorization: `BEARER ${token}` });
  return { listingUrl, listing };
}

async function getPricingCalendar(token, { productType, discountGroup, addOn, startDate, endDate, numDays }) {
  const params = new URLSearchParams({
    storeId: "wdw",
    discountGroup,
    startDate,
    endDate,
    numDays: String(numDays),
  });
  if (addOn) params.set("addOn", addOn);

  const url = `https://disneyworld.disney.go.com/api/lexicon-view-assembler-service/wdw/tickets/product-types/${encodeURIComponent(productType)}/prices?${params.toString()}`;
  const response = await fetchJson(url, { Authorization: `BEARER ${token}` });
  return { url, response };
}

async function buildRawOutput() {
  const generatedAt = new Date().toISOString();
  const requestedStart = parseYmd(process.env.START_DATE) || new Date();
  const horizonDays = Number.parseInt(process.env.HORIZON_DAYS || "365", 10);
  const safeHorizonDays = Number.isFinite(horizonDays) && horizonDays > 0 ? horizonDays : 365;
  const requestedEnd = parseYmd(process.env.END_DATE) || plusDays(requestedStart, safeHorizonDays);
  const windowDays = Number.parseInt(process.env.WINDOW_DAYS || "120", 10);
  const safeWindowDays = Number.isFinite(windowDays) && windowDays > 0 ? windowDays : 120;

  const startDate = ymd(requestedStart);
  const endDate = ymd(requestedEnd);
  const windows = buildWindows(requestedStart, requestedEnd, safeWindowDays);
  const token = await getClientToken();

  const { listingUrl, listing } = await getProductListing(token);
  const calls = [];
  const discountGroups = listing?.discountGroups || {};

  for (const [discountGroupKey, group] of Object.entries(discountGroups)) {
    const products = group?.products || {};
    for (const [productKey, product] of Object.entries(products)) {
      const productType = String(product?.productKey?.productType || "");
      const addOn = String(product?.productKey?.addOn || "");
      const ticketDays = Array.isArray(product?.ticketDays?.adult) ? product.ticketDays.adult : [];

      for (const dayEntry of ticketDays) {
        const numDays = Number(dayEntry?.numDays);
        if (!Number.isFinite(numDays)) continue;
        const discountGroup = toApiDiscountGroup(discountGroupKey);
        for (const window of windows) {
          const { url, response } = await getPricingCalendar(token, {
            productType,
            discountGroup,
            addOn,
            startDate: window.startDate,
            endDate: window.endDate,
            numDays,
          });
          calls.push({
            request: {
              productKey,
              productType,
              addOn,
              discountGroupKey,
              discountGroup,
              numDays,
              startDate: window.startDate,
              endDate: window.endDate,
              url,
            },
            response,
          });
        }
      }
    }
  }

  return {
    generatedAt,
    source: {
      token: "https://disneyworld.disney.go.com/profile-api/authentication/get-client-token/",
      listing: listingUrl,
      pricesTemplate:
        "https://disneyworld.disney.go.com/api/lexicon-view-assembler-service/wdw/tickets/product-types/{productType}/prices",
    },
    requestConfig: {
      startDate,
      endDate,
      windowDays: safeWindowDays,
      windowCount: windows.length,
    },
    windows,
    window: { startDate, endDate },
    listingRaw: listing,
    pricingCallsRaw: calls,
    pricingCallCount: calls.length,
  };
}

async function main() {
  const outArg = process.argv[2];
  const outputPath = resolve(outArg || "tmp/disney-raw.json");
  await mkdir(dirname(outputPath), { recursive: true });

  const payload = await buildRawOutput();
  await writeFile(outputPath, JSON.stringify(payload, null, 2), "utf8");

  console.log(
    JSON.stringify(
      {
        ok: true,
        outputPath,
        pricingCallCount: payload.pricingCallCount,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error.message }, null, 2));
  process.exit(1);
});
