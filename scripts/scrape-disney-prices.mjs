#!/usr/bin/env node

/**
 * Disney World ticket price data pull (guest token + public Disney API surface).
 *
 * Source flow:
 * 1) GET /profile-api/authentication/get-client-token/
 * 2) GET /api/lexicon-view-assembler-service/wdw/tickets/product-listing
 * 3) GET /api/lexicon-view-assembler-service/wdw/tickets/product-types/{type}/prices
 */

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

function lowestByAge(pricingRows, ageGroup) {
  const rows = Array.isArray(pricingRows) ? pricingRows : [];
  let min = null;
  rows.forEach((row) => {
    if (String(row?.ageGroup || "").toLowerCase() !== ageGroup) return;
    const raw = Number.parseFloat(String(row?.subtotal || ""));
    if (!Number.isFinite(raw)) return;
    if (min == null || raw < min) min = raw;
  });
  return min;
}

function buildTiersFromCalendar(calendarDates) {
  const points = [];
  (Array.isArray(calendarDates) ? calendarDates : []).forEach((item) => {
    const date = String(item?.date || "");
    if (!date) return;
    const adult = lowestByAge(item?.pricing, "adult");
    const child = lowestByAge(item?.pricing, "child");
    if (adult == null && child == null) return;
    points.push({ date, adult, child });
  });
  points.sort((a, b) => a.date.localeCompare(b.date));

  const tiers = [];
  let current = null;
  points.forEach((point) => {
    const key = `${point.adult ?? ""}|${point.child ?? ""}`;
    if (!current) {
      current = { key, start: point.date, end: point.date, adult: point.adult, child: point.child };
      return;
    }
    if (current.key === key) {
      current.end = point.date;
      return;
    }
    tiers.push(current);
    current = { key, start: point.date, end: point.date, adult: point.adult, child: point.child };
  });
  if (current) tiers.push(current);

  return tiers.map((tier, index) => ({
    name: `Tier ${index + 1}`,
    start: tier.start,
    end: tier.end,
    prices: {
      adult: tier.adult,
      child: tier.child,
    },
  }));
}

function cleanOptionLabel(option) {
  const raw = String(option || "").trim();
  if (!raw || raw === "0") return "";
  return raw.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
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
  return fetchJson(
    "https://disneyworld.disney.go.com/api/lexicon-view-assembler-service/wdw/tickets/product-listing?storeId=wdw&affiliations=STD_GST",
    { Authorization: `BEARER ${token}` },
  );
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
  return fetchJson(url, { Authorization: `BEARER ${token}` });
}

function mergeDateBuckets(dateBuckets) {
  const byDate = new Map();
  (Array.isArray(dateBuckets) ? dateBuckets : []).forEach((item) => {
    const date = String(item?.date || "");
    if (!date) return;
    byDate.set(date, item);
  });
  return Array.from(byDate.values()).sort((a, b) => String(a.date).localeCompare(String(b.date)));
}

async function getMergedPricingDates(token, params, windows) {
  const allDates = [];
  for (const window of windows) {
    const calendar = await getPricingCalendar(token, {
      ...params,
      startDate: window.startDate,
      endDate: window.endDate,
    });
    const bucket = Array.isArray(calendar?.pricingCalendar)
      ? calendar.pricingCalendar.find((entry) => Number(entry?.numDays) === Number(params.numDays))
      : null;
    allDates.push(...(Array.isArray(bucket?.dates) ? bucket.dates : []));
  }
  return mergeDateBuckets(allDates);
}

async function buildOutput() {
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
  const listing = await getProductListing(token);

  const products = [];
  const discountGroups = listing?.discountGroups || {};

  for (const [discountGroupKey, group] of Object.entries(discountGroups)) {
    const items = group?.products || {};
    for (const [productKey, product] of Object.entries(items)) {
      const productType = String(product?.productKey?.productType || "");
      const addOn = String(product?.productKey?.addOn || "");
      const ticketDays = Array.isArray(product?.ticketDays?.adult) ? product.ticketDays.adult : [];

      for (const dayEntry of ticketDays) {
        const numDays = Number(dayEntry?.numDays);
        if (!Number.isFinite(numDays)) continue;

        const dateBuckets = await getMergedPricingDates(
          token,
          {
            productType,
            discountGroup: toApiDiscountGroup(discountGroupKey),
            addOn,
            numDays,
          },
          windows,
        );

        products.push({
          productKey,
          productType,
          numDays,
          option: cleanOptionLabel(addOn),
          discountGroup: discountGroupKey,
          tiers: buildTiersFromCalendar(dateBuckets),
          sampleDateCount: dateBuckets.length,
        });
      }
    }
  }

  return {
    generatedAt,
    source: {
      listing:
        "https://disneyworld.disney.go.com/api/lexicon-view-assembler-service/wdw/tickets/product-listing",
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
    productCount: products.length,
    products,
  };
}

async function main() {
  const outArg = process.argv[2];
  const outputPath = resolve(outArg || "tmp/disney-prices.json");
  await mkdir(dirname(outputPath), { recursive: true });

  const payload = await buildOutput();
  await writeFile(outputPath, JSON.stringify(payload, null, 2), "utf8");

  // Keep a clean stdout summary for cron logs.
  console.log(
    JSON.stringify(
      {
        ok: true,
        outputPath,
        productCount: payload.productCount,
        window: payload.window,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(
    JSON.stringify(
      {
        ok: false,
        error: error.message,
      },
      null,
      2,
    ),
  );
  process.exit(1);
});
