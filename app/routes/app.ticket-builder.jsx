import { useEffect, useMemo, useState } from "react";
import { useFetcher, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";

const DEFAULT_AGES = [
  { id: "adult", name: "Adult", min: "10", max: "" },
  { id: "child", name: "Child", min: "3", max: "9" },
];

const DEFAULT_GLOBAL_TIERS = [
  { id: "tier-1", name: "Tier 1", start: "2026-01-01", end: "2026-02-15" },
  { id: "tier-2", name: "Tier 2", start: "2026-02-16", end: "2026-05-15" },
];

function slugify(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

function asString(value) {
  return String(value || "").trim();
}

function ensureArray(value) {
  return Array.isArray(value) ? value : [];
}

function safeJsonParse(value, fallback) {
  try {
    const parsed = JSON.parse(String(value || "").trim());
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

function cleanOptionGroups(rawGroups) {
  return ensureArray(rawGroups)
    .map((group) => {
      const name = asString(group?.name);
      const values = String(group?.valuesText || "")
        .split(/\n|,/)
        .map((v) => v.trim())
        .filter(Boolean);
      return { name, values };
    })
    .filter((group) => group.name && group.values.length > 0);
}

function cartesianOptions(optionGroups) {
  if (!optionGroups.length) return [[]];
  const walk = (index, acc, out) => {
    if (index >= optionGroups.length) {
      out.push(acc);
      return;
    }
    const values = ensureArray(optionGroups[index].values);
    const expandedValues = values.length === 1 ? [null, values[0]] : values;
    expandedValues.forEach((value) => {
      walk(index + 1, [...acc, { name: optionGroups[index].name, value }], out);
    });
  };
  const out = [];
  walk(0, [], out);
  return out;
}

function comboKey(optionPairs, orderedKeys) {
  const keyOrder = ensureArray(orderedKeys).length
    ? orderedKeys
    : ensureArray(optionPairs).map((pair) => pair.name);
  if (!keyOrder.length) return "__default__";
  const byName = {};
  ensureArray(optionPairs).forEach((pair) => {
    byName[pair.name] = pair.value;
  });
  return keyOrder.map((key) => `${key}=${byName[key] || ""}`).join(" | ");
}

function comboSlug(optionPairs) {
  const slug = ensureArray(optionPairs)
    .map((pair) => {
      const nameSlug = slugify(pair.name);
      const value = pair?.value;
      if (value == null || String(value).trim() === "") return "";
      return `${nameSlug}-${slugify(value)}`;
    })
    .filter(Boolean)
    .join("-");
  return slug || "default";
}

function optionObjectFromPairs(pairs) {
  const out = {};
  ensureArray(pairs).forEach((pair) => {
    if (!pair?.name) return;
    if (pair.value == null || String(pair.value).trim() === "") return;
    out[pair.name] = pair.value;
  });
  return out;
}

function optionPairsFromObject(obj, orderedKeys) {
  const keys = ensureArray(orderedKeys).length ? orderedKeys : Object.keys(obj || {});
  return keys.map((key) => ({ name: key, value: asString(obj?.[key]) }));
}

function valueToPrice(value) {
  if (value == null || value === "") return "0.00";
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return "0.00";
  return parsed.toFixed(2);
}

function tierMapFromRows(rows) {
  const out = {};
  ensureArray(rows).forEach((tier) => {
    const name = asString(tier?.name);
    const start = asString(tier?.start);
    const end = asString(tier?.end);
    if (!name || !start || !end) return;
    if (!out[name]) out[name] = [];
    out[name].push({ start, end });
  });
  return out;
}

function tierRowsFromMap(tierMap) {
  const rows = [];
  Object.entries(tierMap || {}).forEach(([name, ranges]) => {
    ensureArray(ranges).forEach((range) => {
      rows.push({
        id: `${slugify(name)}-${slugify(range?.start)}-${slugify(range?.end)}-${Math.random().toString(36).slice(2, 6)}`,
        name,
        start: asString(range?.start),
        end: asString(range?.end),
      });
    });
  });
  return rows;
}

function ageGroupsObject(rows) {
  const out = {};
  ensureArray(rows).forEach((age) => {
    const name = asString(age?.name);
    if (!name) return;
    const min = Number(age?.min);
    const max = Number(age?.max);
    const key = slugify(name).replace(/-/g, "_") || name.toLowerCase();
    const item = {};
    if (Number.isFinite(min)) item.min = min;
    if (Number.isFinite(max)) item.max = max;
    out[key] = item;
  });
  return out;
}

function ageRowsFromObject(obj) {
  const rows = [];
  Object.entries(obj || {}).forEach(([key, value]) => {
    const display = String(value?.display_name || key)
      .replace(/_/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase());
    rows.push({
      id: `${slugify(key)}-${Math.random().toString(36).slice(2, 6)}`,
      name: display,
      min: value?.min != null ? String(value.min) : "",
      max: value?.max != null ? String(value.max) : "",
    });
  });
  return rows.length ? rows : DEFAULT_AGES;
}

function defaultCalendarTemplate(optionGroups) {
  const keys = optionGroups.map((g) => `{${g.name}}`).join(" ");
  return `Choose the Start Date of Your ${keys || "Ticket"} Ticket`;
}

function comboDisplayTitle(optionPairs) {
  const title = ensureArray(optionPairs)
    .map((pair) => (pair?.value == null || String(pair.value).trim() === "" ? "" : pair.value))
    .filter(Boolean)
    .join(" / ");
  return title || "Default";
}

function makeId(prefix) {
  return `${prefix}-${Math.random().toString(36).slice(2, 8)}`;
}

const DISNEY_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

function mergeTags(...tagLists) {
  const seen = new Set();
  const tags = [];
  tagLists.forEach((list) => {
    ensureArray(list).forEach((tag) => {
      const clean = asString(tag);
      if (!clean) return;
      const key = clean.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      tags.push(clean);
    });
  });
  return tags;
}

function normalizeTierRows(rows) {
  return ensureArray(rows)
    .map((tier) => ({
      id: tier?.id || makeId("tier"),
      name: asString(tier?.name),
      start: asString(tier?.start),
      end: asString(tier?.end),
    }))
    .filter((tier) => tier.name || tier.start || tier.end);
}

function tierRowsFromJsonText(text, fallback = []) {
  const parsed = safeJsonParse(text, null);
  if (!parsed || typeof parsed !== "object") return fallback;
  return tierRowsFromMap(parsed);
}

function tierRowsToJsonText(rows) {
  return JSON.stringify(tierMapFromRows(rows), null, 2);
}

function plusDays(date, days) {
  const copy = new Date(date);
  copy.setUTCDate(copy.getUTCDate() + days);
  return copy;
}

function ymd(date) {
  return date.toISOString().slice(0, 10);
}

function lowestDisneyPriceByAge(pricingRows, ageGroup) {
  const rows = ensureArray(pricingRows);
  let min = null;
  rows.forEach((row) => {
    if (String(row?.ageGroup || "").toLowerCase() !== String(ageGroup || "").toLowerCase()) return;
    const value = Number.parseFloat(String(row?.subtotal || ""));
    if (!Number.isFinite(value)) return;
    if (min == null || value < min) min = value;
  });
  return min;
}

function disneyTiersFromDates(dates) {
  const points = [];
  ensureArray(dates).forEach((item) => {
    const date = asString(item?.date);
    if (!date) return;
    const adult = lowestDisneyPriceByAge(item?.pricing, "adult");
    const child = lowestDisneyPriceByAge(item?.pricing, "child");
    if (adult == null && child == null) return;
    points.push({ date, adult, child });
  });

  points.sort((a, b) => a.date.localeCompare(b.date));

  const groups = [];
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
    groups.push(current);
    current = { key, start: point.date, end: point.date, adult: point.adult, child: point.child };
  });
  if (current) groups.push(current);

  return groups.map((group, index) => ({
    name: `Tier ${index + 1}`,
    start: group.start,
    end: group.end,
    prices: { Adult: group.adult, Child: group.child },
  }));
}

const DISNEY_TICKET_TYPES = [
  { slug: "", label: "1 Park Per Day" },
  { slug: "park-hopper", label: "Park Hopper" },
  { slug: "water-park-and-sports", label: "Water Park And Sports" },
  { slug: "park-hopper-plus", label: "Park Hopper Plus" },
];

async function fetchDisneyJson(url, headers = {}) {
  const response = await fetch(url, {
    headers: {
      "User-Agent": DISNEY_UA,
      Accept: "application/json",
      ...headers,
    },
  });

  if (!response.ok) {
    throw new Error(`Disney API failed (${response.status}) for ${url}`);
  }

  return response.json();
}

async function getDisneyClientToken() {
  const tokenJson = await fetchDisneyJson(
    "https://disneyworld.disney.go.com/profile-api/authentication/get-client-token/",
  );
  if (!tokenJson?.access_token) throw new Error("Disney token endpoint returned no access token.");
  return String(tokenJson.access_token);
}

async function getDisneyPricingCalendar({ token, numDays, addOn }) {
  const startDate = ymd(new Date());
  const endDate = ymd(plusDays(new Date(), 120));
  const params = new URLSearchParams({
    storeId: "wdw",
    discountGroup: "std-gst",
    startDate,
    endDate,
    numDays: String(numDays),
  });
  if (addOn) params.set("addOn", addOn);

  const url = `https://disneyworld.disney.go.com/api/lexicon-view-assembler-service/wdw/tickets/product-types/theme-parks/prices?${params.toString()}`;
  const json = await fetchDisneyJson(url, { Authorization: `BEARER ${token}` });
  const bucket = ensureArray(json?.pricingCalendar).find((item) => Number(item?.numDays) === Number(numDays));
  return disneyTiersFromDates(bucket?.dates || []);
}

function toTierRows(tiers) {
  return ensureArray(tiers).map((tier) => ({
    id: makeId("tier"),
    name: asString(tier.name),
    start: asString(tier.start),
    end: asString(tier.end),
  }));
}

function toTierPrices(tiers) {
  const byTier = {};
  ensureArray(tiers).forEach((tier) => {
    const name = asString(tier.name);
    if (!name) return;
    byTier[name] = {
      Adult: tier?.prices?.Adult != null ? String(tier.prices.Adult) : "",
      Child: tier?.prices?.Child != null ? String(tier.prices.Child) : "",
    };
  });
  return byTier;
}

async function runGraphql(admin, query, variables) {
  const response = await admin.graphql(query, { variables });
  const json = await response.json();
  if (json.errors?.length) {
    throw new Error(json.errors.map((error) => error.message).join("; "));
  }
  return json.data;
}

async function getProductByHandle(admin, handle) {
  const data = await runGraphql(
    admin,
    `#graphql
      query productByHandle($query: String!) {
        products(first: 1, query: $query) {
          nodes {
            id
            title
            handle
            status
            tags
            templateSuffix
            variants(first: 250) {
              nodes {
                id
                price
                inventoryItem {
                  id
                  tracked
                  requiresShipping
                }
                selectedOptions {
                  name
                  value
                }
              }
            }
          }
        }
      }`,
    { query: `handle:${handle}` },
  );
  return data.products.nodes[0] || null;
}

async function createProduct(admin, input) {
  const data = await runGraphql(
    admin,
    `#graphql
      mutation createProduct($product: ProductCreateInput!) {
        productCreate(product: $product) {
          product {
            id
            title
            handle
            status
            variants(first: 250) {
              nodes {
                id
                price
                selectedOptions {
                  name
                  value
                }
              }
            }
          }
          userErrors {
            field
            message
          }
        }
      }`,
    { product: input },
  );
  return data.productCreate;
}

async function updateProduct(admin, input) {
  const data = await runGraphql(
    admin,
    `#graphql
      mutation updateProduct($product: ProductUpdateInput!) {
        productUpdate(product: $product) {
          product {
            id
            title
            handle
            status
            variants(first: 250) {
              nodes {
                id
                price
                selectedOptions {
                  name
                  value
                }
              }
            }
          }
          userErrors {
            field
            message
          }
        }
      }`,
    { product: input },
  );
  return data.productUpdate;
}

async function bulkCreateVariants(admin, productId, variants, removeStandalone = false) {
  if (!variants.length) return { userErrors: [] };
  const data = await runGraphql(
    admin,
    `#graphql
      mutation createVariants(
        $productId: ID!
        $variants: [ProductVariantsBulkInput!]!
        $strategy: ProductVariantsBulkCreateStrategy
      ) {
        productVariantsBulkCreate(
          productId: $productId
          variants: $variants
          strategy: $strategy
        ) {
          userErrors {
            field
            message
          }
        }
      }`,
    {
      productId,
      variants,
      strategy: removeStandalone ? "REMOVE_STANDALONE_VARIANT" : "DEFAULT",
    },
  );
  return data.productVariantsBulkCreate;
}

async function bulkUpdateVariants(admin, productId, variants) {
  if (!variants.length) return { userErrors: [] };
  const data = await runGraphql(
    admin,
    `#graphql
      mutation updateVariants($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
        productVariantsBulkUpdate(productId: $productId, variants: $variants) {
          userErrors {
            field
            message
          }
        }
      }`,
    { productId, variants },
  );
  return data.productVariantsBulkUpdate;
}

async function bulkDeleteVariants(admin, productId, variantIds) {
  if (!variantIds.length) return { userErrors: [] };
  const data = await runGraphql(
    admin,
    `#graphql
      mutation deleteVariants($productId: ID!, $variantsIds: [ID!]!) {
        productVariantsBulkDelete(productId: $productId, variantsIds: $variantsIds) {
          userErrors {
            field
            message
          }
        }
      }`,
    { productId, variantsIds: variantIds },
  );
  return data.productVariantsBulkDelete;
}

function optionKeyFromValues(selectedOptions) {
  return ensureArray(selectedOptions)
    .filter((opt) => opt?.name && String(opt.name).toLowerCase() !== "title")
    .map((opt) => `${String(opt.name).toLowerCase()}=${String(opt.value || "").toLowerCase()}`)
    .sort()
    .join("|");
}

function desiredOptionStructure(desiredVariants) {
  const map = new Map();
  ensureArray(desiredVariants).forEach((variant) => {
    ensureArray(variant.optionValues).forEach((option) => {
      const optionName = asString(option.optionName);
      const name = asString(option.name);
      if (!optionName || !name) return;
      if (!map.has(optionName)) map.set(optionName, new Set());
      map.get(optionName).add(name);
    });
  });

  return Array.from(map.entries()).map(([name, values]) => ({
    name,
    values: Array.from(values).map((value) => ({ name: value })),
  }));
}

function isNonBlockingOptionError(error) {
  const message = String(error?.message || "").toLowerCase();
  return message.includes("already exists") || message.includes("already taken") || message.includes("has already been taken");
}

async function ensureProductOptions(admin, productId, desiredVariants) {
  const options = desiredOptionStructure(desiredVariants);
  if (!options.length) return { userErrors: [] };

  try {
    const data = await runGraphql(
      admin,
      `#graphql
        mutation createProductOptions(
          $productId: ID!
          $options: [OptionCreateInput!]!
          $variantStrategy: ProductOptionCreateVariantStrategy
        ) {
          productOptionsCreate(
            productId: $productId
            options: $options
            variantStrategy: $variantStrategy
          ) {
            userErrors {
              field
              message
            }
          }
        }`,
      {
        productId,
        options,
        variantStrategy: "LEAVE_AS_IS",
      },
    );

    const blocking = (data.productOptionsCreate.userErrors || []).filter((error) => !isNonBlockingOptionError(error));
    if (!blocking.length) return { userErrors: [] };
  } catch {
    // fallback below
  }

  try {
    const legacy = await updateProduct(admin, {
      id: productId,
      options: options.map((option) => option.name),
    });
    return { userErrors: legacy.userErrors || [] };
  } catch (error) {
    return {
      userErrors: [{ field: ["options"], message: `Could not set product options: ${error.message}` }],
    };
  }
}

async function setInventoryFlags(admin, productHandle) {
  const product = await getProductByHandle(admin, productHandle);
  if (!product) return { userErrors: [], warnings: [] };

  const userErrors = [];
  const warnings = [];

  for (const variant of ensureArray(product.variants?.nodes)) {
    const inventoryItemId = variant?.inventoryItem?.id;
    if (!inventoryItemId) continue;

    try {
      const data = await runGraphql(
        admin,
        `#graphql
          mutation updateInventoryItem($id: ID!, $input: InventoryItemInput!) {
            inventoryItemUpdate(id: $id, input: $input) {
              inventoryItem {
                id
                tracked
                requiresShipping
              }
              userErrors {
                field
                message
              }
            }
          }`,
        {
          id: inventoryItemId,
          input: {
            tracked: false,
            requiresShipping: false,
          },
        },
      );
      userErrors.push(...(data.inventoryItemUpdate.userErrors || []));
    } catch (error) {
      const message = String(error?.message || "").toLowerCase();
      if (message.includes("access denied") && message.includes("write_inventory")) {
        warnings.push({ field: ["inventory"], message: "Skipped inventory update: missing write_inventory scope." });
        break;
      }
      userErrors.push({ field: ["inventory"], message: `Inventory update failed: ${error.message}` });
    }
  }

  return { userErrors, warnings };
}

function buildVariantSpecs({ ages, tiers, pricesByTier }) {
  const ageNames = ensureArray(ages).map((age) => asString(age.name)).filter(Boolean);
  const cleanTiers = ensureArray(tiers)
    .map((tier) => ({ name: asString(tier.name), start: asString(tier.start), end: asString(tier.end) }))
    .filter((tier) => tier.name);

  if (!ageNames.length) return [];

  if (!cleanTiers.length) {
    return ageNames.map((ageName) => ({
      price: valueToPrice(pricesByTier?.default?.[ageName]),
      taxable: false,
      optionValues: [{ optionName: "Age", name: ageName }],
    }));
  }

  const variants = [];
  cleanTiers.forEach((tier) => {
    ageNames.forEach((ageName) => {
      variants.push({
        price: valueToPrice(pricesByTier?.[tier.name]?.[ageName]),
        taxable: false,
        optionValues: [
          { optionName: "Age", name: ageName },
          { optionName: "Tier", name: tier.name },
        ],
      });
    });
  });

  return variants;
}

async function syncProductVariants(admin, product, desiredVariants, removeExtras = true) {
  const optionResult = await ensureProductOptions(admin, product.id, desiredVariants);
  const refreshed = (await getProductByHandle(admin, product.handle)) || product;

  const existingVariants = ensureArray(refreshed?.variants?.nodes);
  const existingMap = new Map();
  existingVariants.forEach((variant) => {
    existingMap.set(optionKeyFromValues(variant.selectedOptions || []), variant);
  });

  const desiredMap = new Map();
  desiredVariants.forEach((variant) => {
    desiredMap.set(optionKeyFromValues(variant.optionValues || []), variant);
  });

  const toCreate = [];
  const toUpdate = [];
  const toDelete = [];

  desiredMap.forEach((variant, key) => {
    const existing = existingMap.get(key);
    if (!existing) {
      toCreate.push(variant);
      return;
    }
    const nextPrice = valueToPrice(variant.price);
    if (valueToPrice(existing.price) !== nextPrice) {
      toUpdate.push({ id: existing.id, price: nextPrice, taxable: false });
    }
  });

  if (removeExtras) {
    existingMap.forEach((variant, key) => {
      if (!key) return;
      if (!desiredMap.has(key)) toDelete.push(variant.id);
    });
  }

  const createResult = await bulkCreateVariants(admin, product.id, toCreate, true);
  const updateResult = await bulkUpdateVariants(admin, product.id, toUpdate);
  const deleteResult = await bulkDeleteVariants(admin, product.id, toDelete);
  const inventoryResult = await setInventoryFlags(admin, product.handle);

  return {
    created: toCreate.length,
    updated: toUpdate.length,
    deleted: toDelete.length,
    warnings: [...(inventoryResult.warnings || [])],
    userErrors: [
      ...(optionResult.userErrors || []),
      ...(createResult.userErrors || []),
      ...(updateResult.userErrors || []),
      ...(deleteResult.userErrors || []),
      ...(inventoryResult.userErrors || []),
    ],
  };
}

async function upsertMetaobject(admin, type, handle, fields) {
  const filteredFields = fields
    .filter((field) => field.value != null && String(field.value).trim() !== "")
    .map((field) => ({ key: field.key, value: String(field.value) }));

  const data = await runGraphql(
    admin,
    `#graphql
      mutation upsertMetaobject(
        $handle: MetaobjectHandleInput!
        $metaobject: MetaobjectUpsertInput!
      ) {
        metaobjectUpsert(handle: $handle, metaobject: $metaobject) {
          metaobject {
            id
            handle
            type
          }
          userErrors {
            field
            message
          }
        }
      }`,
    {
      handle: { type, handle },
      metaobject: { fields: filteredFields },
    },
  );

  const result = data.metaobjectUpsert;
  const warnings = [];

  if (result.metaobject?.id) {
    const activeResult = await setMetaobjectActive(admin, result.metaobject.id);
    if (activeResult.warning) warnings.push(activeResult.warning);
    result.userErrors = [...(result.userErrors || []), ...(activeResult.userErrors || [])];
  }

  return { ...result, warnings };
}

async function upsertProduct(admin, config) {
  const existing = await getProductByHandle(admin, config.handle);
  let action = "updated";
  let product;
  let userErrors = [];
  const requestedTags = mergeTags(config.tags || []);
  const existingTags = mergeTags(existing?.tags || []);
  const mergedTags = mergeTags(existingTags, requestedTags);

  if (!existing) {
    const created = await createProduct(admin, {
      title: config.title,
      handle: config.handle,
      status: config.status,
      tags: requestedTags,
      templateSuffix: "ticket-configurator",
    });
    product = created.product;
    userErrors = created.userErrors || [];
    action = "created";
  } else {
    const updated = await updateProduct(admin, {
      id: existing.id,
      title: config.title,
      status: config.status,
      tags: mergedTags,
      templateSuffix: "ticket-configurator",
    });
    product = updated.product;
    userErrors = updated.userErrors || [];
  }

  if (!product) {
    return { action, product: null, userErrors };
  }

  return { action, product, userErrors };
}

function hasStatusError(userErrors, statusValue) {
  const needle = String(statusValue || "").toLowerCase();
  return ensureArray(userErrors).some((error) => {
    const msg = String(error?.message || "").toLowerCase();
    const field = ensureArray(error?.field).join(".").toLowerCase();
    return (msg.includes("status") || field.includes("status")) && (msg.includes(needle) || msg.includes("invalid") || msg.includes("not"));
  });
}

function statusLikelyUnsupported(error, statusValue) {
  const message = String(error?.message || "").toLowerCase();
  const needle = String(statusValue || "").toLowerCase();
  return message.includes(needle) && (message.includes("enum") || message.includes("invalid") || message.includes("expected"));
}

async function upsertProductWithStatusFallback(admin, config, preferredStatus, fallbackStatus) {
  try {
    const primary = await upsertProduct(admin, { ...config, status: preferredStatus });
    if (preferredStatus !== fallbackStatus && hasStatusError(primary.userErrors, preferredStatus)) {
      const fallback = await upsertProduct(admin, { ...config, status: fallbackStatus });
      return { ...fallback, usedStatus: fallbackStatus, statusFallback: true };
    }
    return { ...primary, usedStatus: preferredStatus, statusFallback: false };
  } catch (error) {
    if (preferredStatus !== fallbackStatus && statusLikelyUnsupported(error, preferredStatus)) {
      const fallback = await upsertProduct(admin, { ...config, status: fallbackStatus });
      return { ...fallback, usedStatus: fallbackStatus, statusFallback: true };
    }
    throw error;
  }
}

async function setMetaobjectActive(admin, id) {
  try {
    const data = await runGraphql(
      admin,
      `#graphql
        mutation setMetaobjectActive($id: ID!, $metaobject: MetaobjectUpdateInput!) {
          metaobjectUpdate(id: $id, metaobject: $metaobject) {
            userErrors {
              field
              message
            }
          }
        }`,
      {
        id,
        metaobject: {
          capabilities: {
            publishable: {
              status: "ACTIVE",
            },
          },
        },
      },
    );

    return { userErrors: data.metaobjectUpdate?.userErrors || [], warning: null };
  } catch (error) {
    return {
      userErrors: [],
      warning: {
        field: ["metaobject", "capabilities", "publishable"],
        message: `Could not set ACTIVE publishable status: ${error.message}`,
      },
    };
  }
}

function loadConfigFromMetaobjects(productCreators, tierCreators, ticketMatrix) {
  const configs = [];

  ensureArray(productCreators).forEach((creator) => {
    const park = asString(creator.park?.value);
    const mainProduct = creator.mainProduct?.reference || null;
    const optionsObject = safeJsonParse(creator.options?.value, {});
    const ageObject = safeJsonParse(creator.ageGroups?.value, {});
    const optionKeys = Object.keys(optionsObject || {});
    const optionGroups = optionKeys.map((key) => ({
      id: makeId("opt"),
      name: key,
      valuesText: ensureArray(optionsObject[key]).join("\n"),
    }));

    const combinations = cartesianOptions(
      optionKeys.map((key) => ({ name: key, values: ensureArray(optionsObject[key]) })),
    );

    const matrixForPark = ensureArray(ticketMatrix).filter(
      (entry) => asString(entry.park?.value).toLowerCase() === park.toLowerCase(),
    );
    const tiersForPark = ensureArray(tierCreators).filter(
      (entry) => asString(entry.park?.value).toLowerCase() === park.toLowerCase(),
    );

    const perComboTiers = {};
    let firstTierJson = null;
    let sameTierForAll = true;

    combinations.forEach((pairs) => {
      const key = comboKey(pairs, optionKeys);

      const tierMatch = tiersForPark.find((tierEntry) => {
        const tierOptions = safeJsonParse(tierEntry.options?.value, {});
        return comboKey(optionPairsFromObject(tierOptions, optionKeys), optionKeys) === key;
      });

      const tierJson = safeJsonParse(tierMatch?.tier?.value, {});
      perComboTiers[key] = tierRowsFromMap(tierJson);

      if (firstTierJson == null) firstTierJson = JSON.stringify(tierJson);
      else if (firstTierJson !== JSON.stringify(tierJson)) sameTierForAll = false;

      const matrixMatch = matrixForPark.find((matrixEntry) => {
        const matrixOptions = safeJsonParse(matrixEntry.options?.value, {});
        return comboKey(optionPairsFromObject(matrixOptions, optionKeys), optionKeys) === key;
      });

      if (matrixMatch?.product?.reference?.id) {
        // carry product refs in map for list view
      }
    });

    const globalTierRows = sameTierForAll
      ? tierRowsFromMap(safeJsonParse(firstTierJson, {}))
      : DEFAULT_GLOBAL_TIERS;

    const childProducts = combinations
      .map((pairs) => {
        const key = comboKey(pairs, optionKeys);
        const matrixMatch = matrixForPark.find((matrixEntry) => {
          const matrixOptions = safeJsonParse(matrixEntry.options?.value, {});
          return comboKey(optionPairsFromObject(matrixOptions, optionKeys), optionKeys) === key;
        });
        return {
          key,
          title: comboDisplayTitle(pairs),
          id: matrixMatch?.product?.reference?.id || null,
          handle: matrixMatch?.product?.reference?.handle || null,
        };
      })
      .filter((item) => item.id);

    configs.push({
      id: creator.id,
      park,
      configHandle: creator.handle,
      mainProduct,
      label: asString(creator.label?.value),
      optionGroups,
      ageGroups: ageRowsFromObject(ageObject),
      tierMode: sameTierForAll ? "global" : "per_combo",
      globalTiers: globalTierRows,
      perComboTiers,
      comboPrices: {},
      childProducts,
    });
  });

  return configs;
}

export const loader = async ({ request }) => {
  const { admin } = await authenticate.admin(request);

  const data = await runGraphql(
    admin,
    `#graphql
      query ticketBuilderMetaobjects {
        productCreators: metaobjects(type: "product_creator", first: 100) {
          nodes {
            id
            handle
            park: field(key: "park") { value }
            label: field(key: "label") { value }
            options: field(key: "options") { value }
            ageGroups: field(key: "age_groups") { value }
            mainProduct: field(key: "main_product") {
              reference {
                ... on Product {
                  id
                  title
                  handle
                  status
                }
              }
            }
          }
        }
        tierCreators: metaobjects(type: "tier_creator", first: 250) {
          nodes {
            id
            handle
            park: field(key: "park") { value }
            options: field(key: "options") { value }
            tier: field(key: "tier") { value }
          }
        }
        ticketMatrix: metaobjects(type: "ticket_matrix", first: 250) {
          nodes {
            id
            handle
            park: field(key: "park") { value }
            options: field(key: "options") { value }
            product: field(key: "product") {
              reference {
                ... on Product {
                  id
                  title
                  handle
                  status
                }
              }
            }
          }
        }
      }`,
  );

  const configs = loadConfigFromMetaobjects(
    data.productCreators?.nodes || [],
    data.tierCreators?.nodes || [],
    data.ticketMatrix?.nodes || [],
  );

  return { configs };
};

export const action = async ({ request }) => {
  const { admin } = await authenticate.admin(request);
  const form = await request.formData();

  try {
    const actionType = asString(form.get("actionType")) || "save_ticket_setup";

    if (actionType === "import_disney_full") {
      const park = asString(form.get("park")) || "Walt Disney World";
      const mainProductTitle = asString(form.get("mainProductTitle"));
      const token = await getDisneyClientToken();
      const dayValues = [];
      const perComboTiers = {};
      const comboPrices = {};
      const optionKeys = ["duration", "ticket_type"];
      const warnings = [];

      for (let day = 1; day <= 10; day += 1) {
        const dayString = String(day);
        let dayHasAnyData = false;

        for (const ticketType of DISNEY_TICKET_TYPES) {
          try {
            const tiers = await getDisneyPricingCalendar({ token, numDays: day, addOn: ticketType.slug });
            if (!tiers.length) continue;
            dayHasAnyData = true;

            const key = comboKey(
              [
                { name: "duration", value: dayString },
                { name: "ticket_type", value: ticketType.label },
              ],
              optionKeys,
            );
            perComboTiers[key] = toTierRows(tiers);
            comboPrices[key] = toTierPrices(tiers);
          } catch (error) {
            warnings.push(`Skipped ${dayString} day / ${ticketType.label}: ${error.message}`);
          }
        }

        if (dayHasAnyData) dayValues.push(dayString);
      }

      if (!dayValues.length) {
        throw new Error("Disney pricing returned no day/ticket type combinations.");
      }

      const ageGroups = DEFAULT_AGES.map((age) => ({ ...age }));
      const importConfig = {
        park,
        mainProductTitle: mainProductTitle || `${park} Tickets`,
        ageGroups,
        optionGroups: [
          { id: makeId("opt"), name: "duration", valuesText: dayValues.join("\n") },
          { id: makeId("opt"), name: "ticket_type", valuesText: DISNEY_TICKET_TYPES.map((item) => item.label).join("\n") },
        ],
        tierMode: "per_combo",
        globalTiers: [],
        perComboTiers,
        comboPrices,
      };

      return {
        ok: true,
        actionType,
        importConfig,
        debug: {
          source: "disney_import_full",
          inputs: { park, mainProductTitle, daysTried: 10, ticketTypes: DISNEY_TICKET_TYPES },
          optionKeys,
          dayValues,
          comboCount: Object.keys(perComboTiers).length,
          warnings,
        },
      };
    }

    const park = asString(form.get("park"));
    const mainProductTitle = asString(form.get("mainProductTitle"));
    const mainStatus = asString(form.get("mainStatus")) || "ACTIVE";
    const removeExtraVariants = form.get("removeExtraVariants") === "on";

    const rawConfig = asString(form.get("builderConfig"));
    const config = safeJsonParse(rawConfig, {});

    const optionGroups = cleanOptionGroups(config.optionGroups || []);
    const ages = ensureArray(config.ageGroups || []).filter((age) => asString(age?.name));
    const tierMode = config.tierMode === "per_combo" ? "per_combo" : "global";
    const globalTiers = ensureArray(config.globalTiers || []);
    const perComboTiers = config.perComboTiers || {};
    const comboPrices = config.comboPrices || {};

    if (!park) throw new Error("Park is required.");
    if (!mainProductTitle) throw new Error("Main product name is required.");
    if (!ages.length) throw new Error("Add at least one age group.");

    const combinations = cartesianOptions(optionGroups);
    if (!combinations.length) throw new Error("No combinations generated from option groups.");

    const optionKeys = optionGroups.map((group) => group.name);
    const mainHandle = slugify(mainProductTitle);

    const mainProductResult = await upsertProduct(admin, {
      title: mainProductTitle,
      handle: mainHandle,
      status: mainStatus,
      tags: [park],
    });

    if (!mainProductResult.product?.id) {
      throw new Error("Could not create/update main product.");
    }

    await setInventoryFlags(admin, mainHandle);

    const comboResults = [];
    const comboToProduct = new Map();

    for (const pairs of combinations) {
      const key = comboKey(pairs, optionKeys);
      const childHandle = `${mainHandle}-${comboSlug(pairs)}`;
      const childTitle = `${mainProductTitle} - ${comboDisplayTitle(pairs).replaceAll(" / ", " - ")}`;
      const tiers = tierMode === "per_combo" ? ensureArray(perComboTiers[key]) : globalTiers;
      const variants = buildVariantSpecs({
        ages,
        tiers,
        pricesByTier: comboPrices[key] || {},
      });

      const productResult = await upsertProductWithStatusFallback(
        admin,
        {
          title: childTitle,
          handle: childHandle,
          tags: [park],
        },
        "UNLISTED",
        "DRAFT",
      );

      let variantSync = { userErrors: [], warnings: [] };
      if (productResult.product) {
        variantSync = await syncProductVariants(
          admin,
          productResult.product,
          variants,
          removeExtraVariants,
        );
      }

      comboResults.push({
        key,
        title: childTitle,
        handle: childHandle,
        status: productResult.usedStatus,
        action: productResult.action,
        statusFallback: productResult.statusFallback,
        productId: productResult.product?.id || null,
        userErrors: [...(productResult.userErrors || []), ...(variantSync.userErrors || [])],
        warnings: [...(variantSync.warnings || [])],
      });

      if (productResult.product?.id) comboToProduct.set(key, productResult.product.id);
    }

    const parkSlug = slugify(park);
    const productCreatorHandle = `${parkSlug}-config`;

    const optionsObject = {};
    optionGroups.forEach((group) => {
      optionsObject[group.name] = group.values;
    });

    const ageObject = ageGroupsObject(ages);

    const productCreatorResult = await upsertMetaobject(
      admin,
      "product_creator",
      productCreatorHandle,
      [
        { key: "park", value: park },
        { key: "main_product", value: mainProductResult.product.id },
        { key: "label", value: mainProductTitle },
        { key: "options", value: JSON.stringify(optionsObject) },
        { key: "calendar_title_template", value: defaultCalendarTemplate(optionGroups) },
        { key: "age_groups", value: JSON.stringify(ageObject) },
      ],
    );

    const tierCreatorResults = [];
    const matrixResults = [];

    for (const pairs of combinations) {
      const key = comboKey(pairs, optionKeys);
      const optionsJson = optionObjectFromPairs(pairs);
      const comboHandleSlug = comboSlug(pairs);
      const tiers = tierMode === "per_combo" ? ensureArray(perComboTiers[key]) : globalTiers;
      const tierObject = tierMapFromRows(tiers);

      const tierResult = await upsertMetaobject(
        admin,
        "tier_creator",
        `${parkSlug}-${comboHandleSlug}-tiers`,
        [
          { key: "park", value: park },
          { key: "options", value: JSON.stringify(optionsJson) },
          { key: "tier", value: JSON.stringify(tierObject) },
        ],
      );
      tierCreatorResults.push({
        key,
        handle: `${parkSlug}-${comboHandleSlug}-tiers`,
        id: tierResult.metaobject?.id || null,
        userErrors: tierResult.userErrors || [],
        warnings: tierResult.warnings || [],
      });

      const productId = comboToProduct.get(key);
      if (productId) {
        const matrixResult = await upsertMetaobject(
          admin,
          "ticket_matrix",
          `${parkSlug}-${comboHandleSlug}`,
          [
            { key: "park", value: park },
            { key: "options", value: JSON.stringify(optionsJson) },
            { key: "product", value: productId },
          ],
        );
        matrixResults.push({
          key,
          handle: `${parkSlug}-${comboHandleSlug}`,
          id: matrixResult.metaobject?.id || null,
          productId,
          userErrors: matrixResult.userErrors || [],
          warnings: matrixResult.warnings || [],
        });
      }
    }

    return {
      ok: true,
      summary: {
        park,
        mainProductTitle,
        mainProductHandle: mainHandle,
        comboCount: combinations.length,
      },
      mainProduct: {
        id: mainProductResult.product.id,
        title: mainProductTitle,
        handle: mainHandle,
        status: mainStatus,
        userErrors: mainProductResult.userErrors || [],
      },
      products: comboResults,
      metaobjects: {
        productCreator: {
          handle: productCreatorHandle,
          id: productCreatorResult.metaobject?.id || null,
          userErrors: productCreatorResult.userErrors || [],
          warnings: productCreatorResult.warnings || [],
        },
        tierCreators: tierCreatorResults,
        ticketMatrix: matrixResults,
      },
    };
  } catch (error) {
    return {
      ok: false,
      error: error.message || "Unknown error",
    };
  }
};

export default function TicketBuilderPage() {
  const { configs } = useLoaderData();
  const saveFetcher = useFetcher();
  const importFetcher = useFetcher();
  const shopify = useAppBridge();

  const isLoading = ["loading", "submitting"].includes(saveFetcher.state) && saveFetcher.formMethod === "POST";
  const isImporting = ["loading", "submitting"].includes(importFetcher.state) && importFetcher.formMethod === "POST";

  const [park, setPark] = useState("");
  const [mainProductTitle, setMainProductTitle] = useState("");
  const [mainStatus, setMainStatus] = useState("ACTIVE");
  const [removeExtraVariants, setRemoveExtraVariants] = useState(true);

  const [optionGroups, setOptionGroups] = useState([]);
  const [ageGroups, setAgeGroups] = useState(DEFAULT_AGES);
  const [tierMode, setTierMode] = useState("global");
  const [globalTiers, setGlobalTiers] = useState(DEFAULT_GLOBAL_TIERS);
  const [perComboTiers, setPerComboTiers] = useState({});
  const [tierInputMode, setTierInputMode] = useState("calendar");
  const [globalTiersJson, setGlobalTiersJson] = useState(tierRowsToJsonText(DEFAULT_GLOBAL_TIERS));
  const [perComboTiersJson, setPerComboTiersJson] = useState({});
  const [comboPrices, setComboPrices] = useState({});
  const [selectedConfigKey, setSelectedConfigKey] = useState("new");
  const [editorMode, setEditorMode] = useState("menu");
  const [showDebug, setShowDebug] = useState(false);

  const resetBuilder = () => {
    setPark("");
    setMainProductTitle("");
    setMainStatus("ACTIVE");
    setRemoveExtraVariants(true);
    setOptionGroups([]);
    setAgeGroups(DEFAULT_AGES);
    setTierMode("global");
    setGlobalTiers(DEFAULT_GLOBAL_TIERS);
    setPerComboTiers({});
    setTierInputMode("calendar");
    setGlobalTiersJson(tierRowsToJsonText(DEFAULT_GLOBAL_TIERS));
    setPerComboTiersJson({});
    setComboPrices({});
  };

  const loadExisting = (config) => {
    setPark(config.park || "");
    setMainProductTitle(config.mainProduct?.title || config.label || "");
    setMainStatus(config.mainProduct?.status || "ACTIVE");
    setRemoveExtraVariants(true);
    setOptionGroups(config.optionGroups || []);
    setAgeGroups(config.ageGroups?.length ? config.ageGroups : DEFAULT_AGES);
    setTierMode(config.tierMode || "global");
    setGlobalTiers(normalizeTierRows(config.globalTiers || []));
    setPerComboTiers(config.perComboTiers || {});
    setTierInputMode(config.tierInputMode === "json" ? "json" : "calendar");
    setGlobalTiersJson(tierRowsToJsonText(config.globalTiers || []));
    setPerComboTiersJson({});
    setComboPrices({});
  };

  const availableConfigs = useMemo(() => ensureArray(configs), [configs]);

  useEffect(() => {
    if (selectedConfigKey === "new") return;
    if (!availableConfigs.find((config) => config.id === selectedConfigKey)) {
      setSelectedConfigKey("new");
    }
  }, [availableConfigs, selectedConfigKey]);

  const getOptionGroupValues = (group) =>
    String(group?.valuesText || "")
      .split("\n")
      .map((v) => String(v));

  const setOptionGroupValues = (groupIndex, values) => {
    const next = [...optionGroups];
    next[groupIndex] = { ...next[groupIndex], valuesText: ensureArray(values).map((v) => String(v || "")).join("\n") };
    setOptionGroups(next);
  };

  const cleanGroups = useMemo(() => cleanOptionGroups(optionGroups), [optionGroups]);
  const optionKeys = useMemo(() => cleanGroups.map((group) => group.name), [cleanGroups]);

  const combinations = useMemo(() => {
    const combos = cartesianOptions(cleanGroups);
    return combos.map((pairs) => ({
      id: comboKey(pairs, optionKeys),
      pairs,
      title: comboDisplayTitle(pairs),
      slug: comboSlug(pairs),
    }));
  }, [cleanGroups, optionKeys]);

  const effectiveGlobalTiers = useMemo(() => {
    if (tierInputMode !== "json") return globalTiers;
    return tierRowsFromJsonText(globalTiersJson, []);
  }, [globalTiers, globalTiersJson, tierInputMode]);

  const effectivePerComboTiers = useMemo(() => {
    if (tierInputMode !== "json") return perComboTiers;
    const next = {};
    combinations.forEach((combo) => {
      next[combo.id] = tierRowsFromJsonText(perComboTiersJson[combo.id], []);
    });
    return next;
  }, [combinations, perComboTiers, perComboTiersJson, tierInputMode]);

  useEffect(() => {
    if (tierInputMode !== "json") return;
    setGlobalTiersJson(tierRowsToJsonText(globalTiers));
    setPerComboTiersJson((prev) => {
      const next = { ...prev };
      combinations.forEach((combo) => {
        if (!next[combo.id]) {
          next[combo.id] = tierRowsToJsonText(ensureArray(perComboTiers[combo.id]));
        }
      });
      Object.keys(next).forEach((comboId) => {
        if (!combinations.find((combo) => combo.id === comboId)) delete next[comboId];
      });
      return next;
    });
  }, [tierInputMode, globalTiers, perComboTiers, combinations]);

  const ageNames = useMemo(
    () => ageGroups.map((age) => asString(age.name)).filter(Boolean),
    [ageGroups],
  );

  useEffect(() => {
    setComboPrices((prev) => {
      const next = { ...prev };

      combinations.forEach((combo) => {
        if (!next[combo.id]) next[combo.id] = {};
        const tierRows = tierMode === "per_combo" ? ensureArray(effectivePerComboTiers[combo.id]) : effectiveGlobalTiers;
        const tierNames = tierRows.map((tier) => asString(tier.name)).filter(Boolean);

        if (!tierNames.length) {
          if (!next[combo.id].default) next[combo.id].default = {};
          ageNames.forEach((ageName) => {
            if (next[combo.id].default[ageName] == null) next[combo.id].default[ageName] = "";
          });
          Object.keys(next[combo.id]).forEach((tierName) => {
            if (tierName !== "default") delete next[combo.id][tierName];
          });
          return;
        }

        tierNames.forEach((tierName) => {
          if (!next[combo.id][tierName]) next[combo.id][tierName] = {};
          ageNames.forEach((ageName) => {
            if (next[combo.id][tierName][ageName] == null) next[combo.id][tierName][ageName] = "";
          });
        });

        Object.keys(next[combo.id]).forEach((tierName) => {
          if (!tierNames.includes(tierName)) delete next[combo.id][tierName];
        });
      });

      Object.keys(next).forEach((comboId) => {
        if (!combinations.find((combo) => combo.id === comboId)) delete next[comboId];
      });

      return next;
    });
  }, [ageNames, combinations, effectiveGlobalTiers, effectivePerComboTiers, tierMode]);

  useEffect(() => {
    if (!saveFetcher.data) return;
    if (saveFetcher.data.ok) shopify.toast.show("Ticket setup saved");
    else shopify.toast.show(saveFetcher.data.error || "Ticket setup failed");
  }, [saveFetcher.data, shopify]);

  useEffect(() => {
    if (!importFetcher.data) return;
    if (!importFetcher.data.ok) {
      shopify.toast.show(importFetcher.data.error || "Disney import failed");
      return;
    }
    if (importFetcher.data.actionType !== "import_disney_full") return;
    const imported = importFetcher.data.importConfig || {};
    setPark((prev) => imported.park || prev);
    setMainProductTitle((prev) => imported.mainProductTitle || prev);
    setOptionGroups(imported.optionGroups || []);
    setAgeGroups(imported.ageGroups?.length ? imported.ageGroups : DEFAULT_AGES);
    setTierMode(imported.tierMode === "per_combo" ? "per_combo" : "global");
    setTierInputMode("calendar");
    setGlobalTiers(normalizeTierRows(imported.globalTiers || []));
    setPerComboTiers(imported.perComboTiers || {});
    setGlobalTiersJson(tierRowsToJsonText(imported.globalTiers || []));
    setPerComboTiersJson({});
    setComboPrices(imported.comboPrices || {});
    shopify.toast.show("Disney prices imported");
  }, [importFetcher.data, shopify]);

  const builderConfig = useMemo(
    () =>
      JSON.stringify({
        optionGroups,
        ageGroups,
        tierMode,
        tierInputMode,
        globalTiers: effectiveGlobalTiers,
        perComboTiers: effectivePerComboTiers,
        comboPrices,
      }),
    [ageGroups, comboPrices, effectiveGlobalTiers, effectivePerComboTiers, optionGroups, tierInputMode, tierMode],
  );

  const debugPayload = useMemo(
    () => ({
      importResponse: importFetcher.data || null,
      cleanedOptionGroups: cleanGroups,
      optionKeys,
      combinations,
      tierMode,
      tierInputMode,
      effectiveGlobalTiers,
      effectivePerComboTiers,
      comboPrices,
      builderConfig: safeJsonParse(builderConfig, {}),
    }),
    [
      builderConfig,
      cleanGroups,
      comboPrices,
      combinations,
      effectiveGlobalTiers,
      effectivePerComboTiers,
      importFetcher.data,
      optionKeys,
      tierInputMode,
      tierMode,
    ],
  );

  return (
    <s-page heading="Ticket Builder">
      <style>{`
        .tb-wrap { display: grid; gap: 16px; }
        .tb-menu-grid { display: grid; grid-template-columns: repeat(2, minmax(260px, 1fr)); gap: 12px; }
        .tb-editor-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; }
        .tb-grid-2 { display: grid; grid-template-columns: repeat(2, minmax(260px, 1fr)); gap: 12px; }
        .tb-card { border: 1px solid #e5e7eb; border-radius: 10px; padding: 12px; background: #fff; display: grid; gap: 10px; }
        .tb-title { font-size: 14px; font-weight: 800; color: #111827; }
        .tb-label { font-size: 12px; font-weight: 700; color: #334155; }
        .tb-hint { font-size: 12px; color: #64748b; }
        .tb-input, .tb-select, .tb-textarea { width: 100%; border: 1px solid #cbd5e1; border-radius: 8px; padding: 9px 11px; font-size: 14px; background: #fff; }
        .tb-textarea { min-height: 86px; resize: vertical; }
        .tb-row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
        .tb-btn { border: 1px solid #cbd5e1; background: #f8fafc; border-radius: 8px; padding: 7px 10px; font-weight: 700; cursor: pointer; }
        .tb-btn-danger { border-color: #fecaca; color: #b91c1c; background: #fff; }
        .tb-btn-primary { border: 0; background: #111827; color: #fff; border-radius: 10px; padding: 10px 14px; font-weight: 800; cursor: pointer; }
        .tb-pill { font-size: 11px; font-weight: 800; background: #e2e8f0; color: #0f172a; border-radius: 999px; padding: 3px 7px; }
        .tb-sticky { position: sticky; bottom: 8px; display: flex; justify-content: flex-end; }
        .tb-combo { border: 1px solid #e5e7eb; border-radius: 10px; padding: 10px; background: #fcfcfd; display: grid; gap: 8px; }
        .tb-price-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(130px, 1fr)); gap: 8px; }
        .tb-result { margin: 0; padding: 12px; border-radius: 8px; border: 1px solid #cbd5e1; background: #f8fafc; max-height: 260px; overflow: auto; }
        .tb-product-card { border: 1px solid #e5e7eb; border-radius: 10px; padding: 10px; background: #fff; display: grid; gap: 8px; }
        .tb-value-row { display: grid; grid-template-columns: minmax(180px, 1fr) auto; gap: 8px; align-items: center; }
        @media (max-width: 980px) {
          .tb-menu-grid { grid-template-columns: 1fr; }
          .tb-grid-2 { grid-template-columns: 1fr; }
          .tb-value-row { grid-template-columns: 1fr; }
        }
      `}</style>

      <div className="tb-wrap">
        {editorMode === "menu" ? (
          <s-section heading="Products">
            <div className="tb-menu-grid">
              {availableConfigs.map((config) => (
                <div key={config.id} className="tb-product-card">
                  <div className="tb-row" style={{ justifyContent: "space-between" }}>
                    <div className="tb-title">{config.mainProduct?.title || config.label || "Untitled"}</div>
                    <span className="tb-pill">{config.park || "-"}</span>
                  </div>
                  <div className="tb-hint">Config handle: {config.configHandle}</div>
                  <div className="tb-hint">Main handle: {config.mainProduct?.handle || "-"}</div>
                  <div className="tb-hint">Combo products: {config.childProducts?.length || 0}</div>
                  <div className="tb-row">
                    <button
                      type="button"
                      className="tb-btn"
                      onClick={() => {
                        setSelectedConfigKey(config.id);
                        loadExisting(config);
                        setEditorMode("edit");
                      }}
                    >
                      Edit product
                    </button>
                    {config.mainProduct?.id && (
                      <button
                        type="button"
                        className="tb-btn"
                        onClick={() => {
                          shopify.intents.invoke?.("edit:shopify/Product", {
                            value: config.mainProduct.id,
                          });
                        }}
                      >
                        Open in Shopify
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
            <div className="tb-row">
              <button
                type="button"
                className="tb-btn tb-btn-primary"
                onClick={() => {
                  setSelectedConfigKey("new");
                  resetBuilder();
                  setEditorMode("edit");
                }}
              >
                Add New Product
              </button>
            </div>
          </s-section>
        ) : (
          <>
            <s-section heading={selectedConfigKey === "new" ? "Add Product" : "Edit Product"}>
              <div className="tb-editor-head">
                <div className="tb-row">
                  <button type="button" className="tb-btn" onClick={() => setEditorMode("menu")}>
                    Back to Products
                  </button>
                  <span className="tb-hint">
                    {selectedConfigKey === "new" ? "Creating a new product setup" : "Editing existing setup"}
                  </span>
                </div>
                <button
                  type="button"
                  className="tb-btn"
                  onClick={() => {
                    setSelectedConfigKey("new");
                    resetBuilder();
                  }}
                >
                  Add New Product
                </button>
                <button type="button" className="tb-btn" onClick={() => setShowDebug((prev) => !prev)}>
                  {showDebug ? "Hide Debug" : "Show Debug"}
                </button>
              </div>

              <importFetcher.Form method="POST" className="tb-card">
                <input type="hidden" name="actionType" value="import_disney_full" />
                <input type="hidden" name="park" value={park} />
                <input type="hidden" name="mainProductTitle" value={mainProductTitle} />
                <div className="tb-title">Import Disney Full Matrix</div>
                <div className="tb-hint">Pull days + all ticket types into one product creator config.</div>
                <div className="tb-row">
                  <button type="submit" className="tb-btn" disabled={isImporting}>
                    {isImporting ? "Importing..." : "Import All Disney Prices"}
                  </button>
                </div>
              </importFetcher.Form>

              {showDebug && (
                <div className="tb-card">
                  <div className="tb-title">Debug: Raw Import + Computed Builder State</div>
                  <pre className="tb-result">
                    <code>{JSON.stringify(debugPayload, null, 2)}</code>
                  </pre>
                </div>
              )}

              <saveFetcher.Form method="POST" className="tb-wrap">
                <div className="tb-card">
                  <div className="tb-grid-2">
                    <label>
                      <div className="tb-label">Park</div>
                      <input className="tb-input" name="park" value={park} onChange={(e) => setPark(e.target.value)} required />
                    </label>
                    <label>
                      <div className="tb-label">Main Product Name</div>
                      <input
                        className="tb-input"
                        name="mainProductTitle"
                        value={mainProductTitle}
                        onChange={(e) => setMainProductTitle(e.target.value)}
                        required
                      />
                      <div className="tb-hint">Main handle auto-generated: {slugify(mainProductTitle) || "-"}</div>
                    </label>
                  </div>
                  <div className="tb-row">
                    <label>
                      <div className="tb-label">Main Product Status</div>
                      <select className="tb-select" name="mainStatus" value={mainStatus} onChange={(e) => setMainStatus(e.target.value)}>
                        <option value="ACTIVE">ACTIVE</option>
                        <option value="DRAFT">DRAFT</option>
                        <option value="ARCHIVED">ARCHIVED</option>
                      </select>
                    </label>
                    <label className="tb-row" style={{ marginTop: 20 }}>
                      <input
                        type="checkbox"
                        name="removeExtraVariants"
                        checked={removeExtraVariants}
                        onChange={(e) => setRemoveExtraVariants(e.target.checked)}
                      />
                      <span className="tb-label">Remove variants not in current setup</span>
                    </label>
                  </div>
                </div>

                <div className="tb-card">
                  <div className="tb-title">Option Groups</div>
                  <div className="tb-hint">Single-value groups are treated as toggle options and generate OFF + ON combo products.</div>
                  {optionGroups.map((group, idx) => {
                    const groupValues = getOptionGroupValues(group);
                    return (
                      <div key={group.id} className="tb-card" style={{ padding: 10 }}>
                        <label>
                          <div className="tb-label">Option Name</div>
                          <input
                            className="tb-input"
                            value={group.name}
                            onChange={(e) => {
                              const next = [...optionGroups];
                              next[idx] = { ...group, name: e.target.value };
                              setOptionGroups(next);
                            }}
                          />
                        </label>
                        <div className="tb-label">Values</div>
                        {groupValues.map((value, valueIdx) => (
                          <div key={`${group.id}-value-${valueIdx}`} className="tb-value-row">
                            <input
                              className="tb-input"
                              value={value}
                              onChange={(e) => {
                                const nextValues = [...groupValues];
                                nextValues[valueIdx] = e.target.value;
                                setOptionGroupValues(idx, nextValues);
                              }}
                            />
                            <button
                              type="button"
                              className="tb-btn tb-btn-danger"
                              onClick={() => setOptionGroupValues(idx, groupValues.filter((_, i) => i !== valueIdx))}
                            >
                              Remove
                            </button>
                          </div>
                        ))}
                        <div className="tb-row">
                          <button
                            type="button"
                            className="tb-btn"
                            onClick={() => setOptionGroupValues(idx, [...groupValues, ""])}
                          >
                            Add value
                          </button>
                          <button
                            type="button"
                            className="tb-btn tb-btn-danger"
                            onClick={() => setOptionGroups(optionGroups.filter((opt) => opt.id !== group.id))}
                          >
                            Remove group
                          </button>
                        </div>
                      </div>
                    );
                  })}
                  <div>
                    <button
                      type="button"
                      className="tb-btn"
                      onClick={() => setOptionGroups([...optionGroups, { id: makeId("opt"), name: "", valuesText: "" }])}
                    >
                      Add option group
                    </button>
                  </div>
                </div>

                <div className="tb-card">
                  <div className="tb-title">Age Groups</div>
                  {ageGroups.map((age, idx) => (
                    <div key={age.id} className="tb-row">
                      <label>
                        <div className="tb-label">Name</div>
                        <input
                          className="tb-input"
                          value={age.name}
                          onChange={(e) => {
                            const next = [...ageGroups];
                            next[idx] = { ...age, name: e.target.value };
                            setAgeGroups(next);
                          }}
                        />
                      </label>
                      <label>
                        <div className="tb-label">Min</div>
                        <input
                          className="tb-input"
                          value={age.min}
                          onChange={(e) => {
                            const next = [...ageGroups];
                            next[idx] = { ...age, min: e.target.value };
                            setAgeGroups(next);
                          }}
                        />
                      </label>
                      <label>
                        <div className="tb-label">Max</div>
                        <input
                          className="tb-input"
                          value={age.max}
                          onChange={(e) => {
                            const next = [...ageGroups];
                            next[idx] = { ...age, max: e.target.value };
                            setAgeGroups(next);
                          }}
                        />
                      </label>
                      <button
                        type="button"
                        className="tb-btn tb-btn-danger"
                        onClick={() => setAgeGroups(ageGroups.filter((g) => g.id !== age.id))}
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                  <div>
                    <button
                      type="button"
                      className="tb-btn"
                      onClick={() => setAgeGroups([...ageGroups, { id: makeId("age"), name: "", min: "", max: "" }])}
                    >
                      Add age group
                    </button>
                  </div>
                </div>

                <div className="tb-card">
                  <div className="tb-title">Tier Setup</div>
                  <div className="tb-row">
                    <label className="tb-row">
                      <input type="radio" checked={tierMode === "global"} onChange={() => setTierMode("global")} />
                      <span className="tb-label">Same tiers for all combos</span>
                    </label>
                    <label className="tb-row">
                      <input type="radio" checked={tierMode === "per_combo"} onChange={() => setTierMode("per_combo")} />
                      <span className="tb-label">Different tiers per combo</span>
                    </label>
                  </div>
                  <div className="tb-row">
                    <label className="tb-row">
                      <input type="radio" checked={tierInputMode === "calendar"} onChange={() => setTierInputMode("calendar")} />
                      <span className="tb-label">Edit with calendar dates</span>
                    </label>
                    <label className="tb-row">
                      <input type="radio" checked={tierInputMode === "json"} onChange={() => setTierInputMode("json")} />
                      <span className="tb-label">Edit as JSON</span>
                    </label>
                  </div>

                  {tierMode === "global" && (
                    <div className="tb-card" style={{ padding: 10 }}>
                      {tierInputMode === "calendar" ? (
                        <>
                          {globalTiers.map((tier, idx) => (
                            <div key={tier.id} className="tb-row">
                              <label>
                                <div className="tb-label">Tier</div>
                                <input
                                  className="tb-input"
                                  value={tier.name}
                                  onChange={(e) => {
                                    const next = [...globalTiers];
                                    next[idx] = { ...tier, name: e.target.value };
                                    setGlobalTiers(next);
                                  }}
                                />
                              </label>
                              <label>
                                <div className="tb-label">Start</div>
                                <input
                                  className="tb-input"
                                  type="date"
                                  value={tier.start}
                                  onChange={(e) => {
                                    const next = [...globalTiers];
                                    next[idx] = { ...tier, start: e.target.value };
                                    setGlobalTiers(next);
                                  }}
                                />
                              </label>
                              <label>
                                <div className="tb-label">End</div>
                                <input
                                  className="tb-input"
                                  type="date"
                                  value={tier.end}
                                  onChange={(e) => {
                                    const next = [...globalTiers];
                                    next[idx] = { ...tier, end: e.target.value };
                                    setGlobalTiers(next);
                                  }}
                                />
                              </label>
                              <button
                                type="button"
                                className="tb-btn tb-btn-danger"
                                onClick={() => setGlobalTiers(globalTiers.filter((item) => item.id !== tier.id))}
                              >
                                Remove tier
                              </button>
                            </div>
                          ))}
                          <button
                            type="button"
                            className="tb-btn"
                            onClick={() => setGlobalTiers([...globalTiers, { id: makeId("tier"), name: "", start: "", end: "" }])}
                          >
                            Add tier
                          </button>
                        </>
                      ) : (
                        <label>
                          <div className="tb-label">Tiers JSON</div>
                          <textarea
                            className="tb-textarea"
                            value={globalTiersJson}
                            onChange={(e) => setGlobalTiersJson(e.target.value)}
                            placeholder={`{\n  "Tier 1": [{ "start": "2026-01-01", "end": "2026-02-15" }]\n}`}
                          />
                        </label>
                      )}
                    </div>
                  )}
                </div>

                <div className="tb-card">
                  <div className="tb-title">Combinations and Prices</div>
                  <div className="tb-hint">Main product is standalone. Every combo below is generated as an UNLISTED product (fallback: DRAFT) and mapped via ticket_matrix.</div>
                  {combinations.map((combo) => {
                    const tiers = tierMode === "per_combo" ? ensureArray(effectivePerComboTiers[combo.id]) : effectiveGlobalTiers;
                    const tierNames = tiers.map((tier) => asString(tier.name)).filter(Boolean);
                    const noTier = tierNames.length === 0;

                    return (
                      <div key={combo.id} className="tb-combo">
                        <div className="tb-row" style={{ justifyContent: "space-between" }}>
                          <strong>{combo.title}</strong>
                          <span className="tb-pill">Unlisted combo</span>
                        </div>
                        <div className="tb-hint">Handle: {`${slugify(mainProductTitle)}-${combo.slug}`}</div>

                        {tierMode === "per_combo" && (
                          <div className="tb-card" style={{ padding: 10 }}>
                            <div className="tb-label">Tiers for this combo</div>
                            {tierInputMode === "calendar" ? (
                              <>
                                {ensureArray(perComboTiers[combo.id]).map((tier, idx) => (
                                  <div key={tier.id || idx} className="tb-row">
                                    <input
                                      className="tb-input"
                                      placeholder="Tier name"
                                      value={tier.name || ""}
                                      onChange={(e) => {
                                        const list = ensureArray(perComboTiers[combo.id]);
                                        const next = [...list];
                                        next[idx] = { ...tier, name: e.target.value };
                                        setPerComboTiers({ ...perComboTiers, [combo.id]: next });
                                      }}
                                    />
                                    <input
                                      className="tb-input"
                                      type="date"
                                      value={tier.start || ""}
                                      onChange={(e) => {
                                        const list = ensureArray(perComboTiers[combo.id]);
                                        const next = [...list];
                                        next[idx] = { ...tier, start: e.target.value };
                                        setPerComboTiers({ ...perComboTiers, [combo.id]: next });
                                      }}
                                    />
                                    <input
                                      className="tb-input"
                                      type="date"
                                      value={tier.end || ""}
                                      onChange={(e) => {
                                        const list = ensureArray(perComboTiers[combo.id]);
                                        const next = [...list];
                                        next[idx] = { ...tier, end: e.target.value };
                                        setPerComboTiers({ ...perComboTiers, [combo.id]: next });
                                      }}
                                    />
                                    <button
                                      type="button"
                                      className="tb-btn tb-btn-danger"
                                      onClick={() => {
                                        const list = ensureArray(perComboTiers[combo.id]);
                                        setPerComboTiers({
                                          ...perComboTiers,
                                          [combo.id]: list.filter((_, i) => i !== idx),
                                        });
                                      }}
                                    >
                                      Remove
                                    </button>
                                  </div>
                                ))}
                                <button
                                  type="button"
                                  className="tb-btn"
                                  onClick={() => {
                                    const list = ensureArray(perComboTiers[combo.id]);
                                    setPerComboTiers({
                                      ...perComboTiers,
                                      [combo.id]: [...list, { id: makeId("tier"), name: "", start: "", end: "" }],
                                    });
                                  }}
                                >
                                  Add tier for combo
                                </button>
                              </>
                            ) : (
                              <label>
                                <div className="tb-label">Combo Tiers JSON</div>
                                <textarea
                                  className="tb-textarea"
                                  value={perComboTiersJson[combo.id] || tierRowsToJsonText(ensureArray(perComboTiers[combo.id]))}
                                  onChange={(e) => {
                                    setPerComboTiersJson({
                                      ...perComboTiersJson,
                                      [combo.id]: e.target.value,
                                    });
                                  }}
                                  placeholder={`{\n  "Tier 1": [{ "start": "2026-01-01", "end": "2026-02-15" }]\n}`}
                                />
                              </label>
                            )}
                          </div>
                        )}

                        {noTier ? (
                          <div className="tb-price-grid">
                            {ageNames.map((ageName) => (
                              <label key={ageName}>
                                <div className="tb-label">{ageName}</div>
                                <input
                                  className="tb-input"
                                  value={comboPrices?.[combo.id]?.default?.[ageName] || ""}
                                  onChange={(e) => {
                                    const next = { ...comboPrices };
                                    if (!next[combo.id]) next[combo.id] = {};
                                    if (!next[combo.id].default) next[combo.id].default = {};
                                    next[combo.id].default[ageName] = e.target.value;
                                    setComboPrices(next);
                                  }}
                                />
                              </label>
                            ))}
                          </div>
                        ) : (
                          tierNames.map((tierName) => (
                            <div key={tierName} className="tb-card" style={{ padding: 10 }}>
                              <div className="tb-label">{tierName}</div>
                              <div className="tb-price-grid">
                                {ageNames.map((ageName) => (
                                  <label key={`${tierName}-${ageName}`}>
                                    <div className="tb-label">{ageName}</div>
                                    <input
                                      className="tb-input"
                                      value={comboPrices?.[combo.id]?.[tierName]?.[ageName] || ""}
                                      onChange={(e) => {
                                        const next = { ...comboPrices };
                                        if (!next[combo.id]) next[combo.id] = {};
                                        if (!next[combo.id][tierName]) next[combo.id][tierName] = {};
                                        next[combo.id][tierName][ageName] = e.target.value;
                                        setComboPrices(next);
                                      }}
                                    />
                                  </label>
                                ))}
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    );
                  })}
                </div>

                <input type="hidden" name="actionType" value="save_ticket_setup" />
                <input type="hidden" name="builderConfig" value={builderConfig} />

                <div className="tb-sticky">
                  <button type="submit" className="tb-btn-primary" disabled={isLoading}>
                    {isLoading ? "Saving..." : "Create / Update Ticket Setup"}
                  </button>
                </div>
              </saveFetcher.Form>
            </s-section>

            {saveFetcher.data && (
              <s-section heading="Result">
                {saveFetcher.data.mainProduct?.id && (
                  <div className="tb-row" style={{ marginBottom: 8 }}>
                    <strong>Main Product:</strong>
                    <span>{saveFetcher.data.mainProduct.title}</span>
                    <button
                      type="button"
                      className="tb-btn"
                      onClick={() => {
                        shopify.intents.invoke?.("edit:shopify/Product", {
                          value: saveFetcher.data.mainProduct.id,
                        });
                      }}
                    >
                      Edit main product
                    </button>
                  </div>
                )}
                {!!saveFetcher.data?.products?.length && (
                  <div className="tb-grid-2" style={{ marginBottom: 8 }}>
                    {saveFetcher.data.products.map((product) => (
                      <div key={product.key} className="tb-product-card">
                        <div className="tb-title">{product.title}</div>
                        <div className="tb-hint">{product.handle}</div>
                        <div className="tb-hint">Status: {product.status}</div>
                        {!!product.userErrors?.length && (
                          <div className="tb-hint" style={{ color: "#b91c1c" }}>
                            {product.userErrors.map((error) => error.message).join(" | ")}
                          </div>
                        )}
                        {product.productId && (
                          <button
                            type="button"
                            className="tb-btn"
                            onClick={() => {
                              shopify.intents.invoke?.("edit:shopify/Product", {
                                value: product.productId,
                              });
                            }}
                          >
                            Edit combo product
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
                <pre className="tb-result">
                  <code>{JSON.stringify(saveFetcher.data, null, 2)}</code>
                </pre>
              </s-section>
            )}
          </>
        )}
      </div>
    </s-page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
