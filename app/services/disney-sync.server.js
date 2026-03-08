const DISNEY_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const DEFAULT_AGES = [
  { name: "Adult", min: "10", max: "" },
  { name: "Child", min: "3", max: "9" },
];

const DISNEY_TICKET_TYPES = [
  { slug: "", label: "1 Park Per Day" },
  { slug: "park-hopper", label: "Park Hopper" },
  { slug: "water-park-and-sports", label: "Water Park And Sports" },
  { slug: "park-hopper-plus", label: "Park Hopper Plus" },
];

function asString(value) {
  return String(value || "").trim();
}

function ensureArray(value) {
  return Array.isArray(value) ? value : [];
}

function slugify(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

function plusDays(date, days) {
  const copy = new Date(date);
  copy.setUTCDate(copy.getUTCDate() + days);
  return copy;
}

function ymd(date) {
  return date.toISOString().slice(0, 10);
}

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

function comboDisplayTitle(optionPairs) {
  const title = ensureArray(optionPairs)
    .map((pair) => (pair?.value == null || String(pair.value).trim() === "" ? "" : pair.value))
    .filter(Boolean)
    .join(" / ");
  return title || "Default";
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

function defaultCalendarTemplate(optionGroups) {
  const keys = optionGroups.map((g) => `{${g.name}}`).join(" ");
  return `Choose the Start Date of Your ${keys || "Ticket"} Ticket`;
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

function toTierRows(tiers) {
  return ensureArray(tiers).map((tier) => ({
    id: `tier-${Math.random().toString(36).slice(2, 8)}`,
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

function mergeDateBuckets(dateBuckets) {
  const byDate = new Map();
  ensureArray(dateBuckets).forEach((item) => {
    const date = asString(item?.date);
    if (!date) return;
    byDate.set(date, item);
  });
  return Array.from(byDate.values()).sort((a, b) => String(a.date).localeCompare(String(b.date)));
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

async function fetchDisneyJson(url, headers = {}) {
  const response = await fetch(url, {
    headers: {
      "User-Agent": DISNEY_UA,
      Accept: "application/json",
      ...headers,
    },
  });
  if (!response.ok) throw new Error(`Disney API failed (${response.status}) for ${url}`);
  return response.json();
}

async function getDisneyClientToken() {
  const tokenJson = await fetchDisneyJson(
    "https://disneyworld.disney.go.com/profile-api/authentication/get-client-token/",
  );
  if (!tokenJson?.access_token) throw new Error("Disney token endpoint returned no access token.");
  return String(tokenJson.access_token);
}

async function getDisneyPricingCalendarWindow({ token, numDays, addOn, startDate, endDate }) {
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
  return ensureArray(bucket?.dates);
}

async function getDisneyPricingCalendarMerged({ token, numDays, addOn, startDate, endDate, windowDays }) {
  const windows = buildWindows(new Date(startDate), new Date(endDate), windowDays);
  const allDates = [];
  let successCount = 0;
  for (const window of windows) {
    try {
      const dates = await getDisneyPricingCalendarWindow({
        token,
        numDays,
        addOn,
        startDate: window.startDate,
        endDate: window.endDate,
      });
      allDates.push(...dates);
      successCount += 1;
    } catch {
      // Keep partial data when Disney rejects a later window.
    }
  }
  if (!successCount) return [];
  return disneyTiersFromDates(mergeDateBuckets(allDates));
}

function isThrottledError(payload) {
  const text = String(payload || "").toLowerCase();
  return text.includes("throttled") || text.includes("too many requests") || text.includes("rate limit");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runGraphql(admin, query, variables) {
  const maxAttempts = 7;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await admin.graphql(query, { variables });
      const json = await response.json();
      if (json.errors?.length) {
        const message = json.errors.map((error) => error.message).join("; ");
        if (attempt < maxAttempts && isThrottledError(message)) {
          const delayMs = Math.min(8000, 500 * 2 ** (attempt - 1));
          await sleep(delayMs);
          continue;
        }
        throw new Error(message);
      }
      return json.data;
    } catch (error) {
      if (attempt < maxAttempts && isThrottledError(error?.message || "")) {
        const delayMs = Math.min(8000, 500 * 2 ** (attempt - 1));
        await sleep(delayMs);
        continue;
      }
      throw error;
    }
  }
  throw new Error("GraphQL request failed after retries.");
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
            variants(first: 250) { nodes { id price selectedOptions { name value } } }
          }
          userErrors { field message }
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
            variants(first: 250) { nodes { id price selectedOptions { name value } } }
          }
          userErrors { field message }
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
      mutation createVariants($productId: ID!, $variants: [ProductVariantsBulkInput!]!, $strategy: ProductVariantsBulkCreateStrategy) {
        productVariantsBulkCreate(productId: $productId, variants: $variants, strategy: $strategy) {
          userErrors { field message }
        }
      }`,
    { productId, variants, strategy: removeStandalone ? "REMOVE_STANDALONE_VARIANT" : "DEFAULT" },
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
          userErrors { field message }
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
          userErrors { field message }
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
        mutation createProductOptions($productId: ID!, $options: [OptionCreateInput!]!, $variantStrategy: ProductOptionCreateVariantStrategy) {
          productOptionsCreate(productId: $productId, options: $options, variantStrategy: $variantStrategy) {
            userErrors { field message }
          }
        }`,
      { productId, options, variantStrategy: "LEAVE_AS_IS" },
    );
    const blocking = (data.productOptionsCreate.userErrors || []).filter((error) => !isNonBlockingOptionError(error));
    if (!blocking.length) return { userErrors: [] };
  } catch {
    // fallback below
  }

  const legacy = await updateProduct(admin, { id: productId, options: options.map((option) => option.name) });
  return { userErrors: legacy.userErrors || [] };
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
              userErrors { field message }
            }
          }`,
        { id: inventoryItemId, input: { tracked: false, requiresShipping: false } },
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
  existingVariants.forEach((variant) => existingMap.set(optionKeyFromValues(variant.selectedOptions || []), variant));
  const desiredMap = new Map();
  desiredVariants.forEach((variant) => desiredMap.set(optionKeyFromValues(variant.optionValues || []), variant));

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

async function setMetaobjectActive(admin, id) {
  try {
    const data = await runGraphql(
      admin,
      `#graphql
        mutation setMetaobjectActive($id: ID!, $metaobject: MetaobjectUpdateInput!) {
          metaobjectUpdate(id: $id, metaobject: $metaobject) {
            userErrors { field message }
          }
        }`,
      { id, metaobject: { capabilities: { publishable: { status: "ACTIVE" } } } },
    );
    return { userErrors: data.metaobjectUpdate?.userErrors || [], warning: null };
  } catch (error) {
    return {
      userErrors: [],
      warning: { field: ["metaobject", "capabilities", "publishable"], message: `Could not set ACTIVE publishable status: ${error.message}` },
    };
  }
}

async function upsertMetaobject(admin, type, handle, fields) {
  const filteredFields = fields
    .filter((field) => field.value != null && String(field.value).trim() !== "")
    .map((field) => ({ key: field.key, value: String(field.value) }));

  const data = await runGraphql(
    admin,
    `#graphql
      mutation upsertMetaobject($handle: MetaobjectHandleInput!, $metaobject: MetaobjectUpsertInput!) {
        metaobjectUpsert(handle: $handle, metaobject: $metaobject) {
          metaobject { id handle type }
          userErrors { field message }
        }
      }`,
    { handle: { type, handle }, metaobject: { fields: filteredFields } },
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

async function saveTicketSetup(admin, payload) {
  const park = asString(payload.park);
  const mainProductTitle = asString(payload.mainProductTitle);
  const mainStatus = asString(payload.mainStatus) || "ACTIVE";
  const removeExtraVariants = payload.removeExtraVariants !== false;

  const optionGroups = cleanOptionGroups(payload.optionGroups || []);
  const ages = ensureArray(payload.ageGroups || []).filter((age) => asString(age?.name));
  const tierMode = payload.tierMode === "per_combo" ? "per_combo" : "global";
  const globalTiers = ensureArray(payload.globalTiers || []);
  const perComboTiers = payload.perComboTiers || {};
  const comboPrices = payload.comboPrices || {};

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

  if (!mainProductResult.product?.id) throw new Error("Could not create/update main product.");
  await setInventoryFlags(admin, mainHandle);

  const comboResults = [];
  const comboToProduct = new Map();

  for (const pairs of combinations) {
    const key = comboKey(pairs, optionKeys);
    const childHandle = `${mainHandle}-${comboSlug(pairs)}`;
    const childTitle = `${mainProductTitle} - ${comboDisplayTitle(pairs).replaceAll(" / ", " - ")}`;
    const tiers = tierMode === "per_combo" ? ensureArray(perComboTiers[key]) : globalTiers;
    const variants = buildVariantSpecs({ ages, tiers, pricesByTier: comboPrices[key] || {} });

    const productResult = await upsertProductWithStatusFallback(
      admin,
      { title: childTitle, handle: childHandle, tags: [park] },
      "UNLISTED",
      "DRAFT",
    );

    let variantSync = { userErrors: [], warnings: [] };
    if (productResult.product) {
      variantSync = await syncProductVariants(admin, productResult.product, variants, removeExtraVariants);
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

  const productCreatorResult = await upsertMetaobject(admin, "product_creator", productCreatorHandle, [
    { key: "park", value: park },
    { key: "main_product", value: mainProductResult.product.id },
    { key: "label", value: mainProductTitle },
    { key: "options", value: JSON.stringify(optionsObject) },
    { key: "calendar_title_template", value: defaultCalendarTemplate(optionGroups) },
    { key: "age_groups", value: JSON.stringify(ageObject) },
  ]);

  const tierCreatorResults = [];
  const matrixResults = [];

  for (const pairs of combinations) {
    const key = comboKey(pairs, optionKeys);
    const optionsJson = optionObjectFromPairs(pairs);
    const comboHandleSlug = comboSlug(pairs);
    const tiers = tierMode === "per_combo" ? ensureArray(perComboTiers[key]) : globalTiers;
    const tierObject = tierMapFromRows(tiers);

    const tierResult = await upsertMetaobject(admin, "tier_creator", `${parkSlug}-${comboHandleSlug}-tiers`, [
      { key: "park", value: park },
      { key: "options", value: JSON.stringify(optionsJson) },
      { key: "tier", value: JSON.stringify(tierObject) },
    ]);
    tierCreatorResults.push({
      key,
      handle: `${parkSlug}-${comboHandleSlug}-tiers`,
      id: tierResult.metaobject?.id || null,
      userErrors: tierResult.userErrors || [],
      warnings: tierResult.warnings || [],
    });

    const productId = comboToProduct.get(key);
    if (productId) {
      const matrixResult = await upsertMetaobject(admin, "ticket_matrix", `${parkSlug}-${comboHandleSlug}`, [
        { key: "park", value: park },
        { key: "options", value: JSON.stringify(optionsJson) },
        { key: "product", value: productId },
      ]);
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
}

export async function buildDisneyImportConfig(profile = {}) {
  const park = asString(profile.park || "Walt Disney World");
  const mainProductTitle = asString(profile.mainProductTitle || `${park} Tickets`);
  const startDate = asString(profile.startDate || ymd(new Date()));
  const horizonDays = Number.parseInt(String(profile.horizonDays || process.env.DISNEY_HORIZON_DAYS || "365"), 10);
  const safeHorizonDays = Number.isFinite(horizonDays) && horizonDays > 0 ? horizonDays : 365;
  const endDate = asString(profile.endDate || ymd(plusDays(new Date(startDate), safeHorizonDays)));
  const windowDays = Number.parseInt(String(profile.windowDays || process.env.DISNEY_WINDOW_DAYS || "120"), 10);
  const safeWindowDays = Number.isFinite(windowDays) && windowDays > 0 ? windowDays : 120;
  const maxDays = Number.parseInt(String(profile.maxDays || 10), 10);
  const safeMaxDays = Number.isFinite(maxDays) && maxDays > 0 ? maxDays : 10;

  const token = await getDisneyClientToken();
  const dayValues = [];
  const perComboTiers = {};
  const comboPrices = {};
  const optionKeys = ["duration", "ticket_type"];
  const warnings = [];

  for (let day = 1; day <= safeMaxDays; day += 1) {
    const dayString = String(day);
    let dayHasAnyData = false;
    for (const ticketType of DISNEY_TICKET_TYPES) {
      try {
        const tiers = await getDisneyPricingCalendarMerged({
          token,
          numDays: day,
          addOn: ticketType.slug,
          startDate,
          endDate,
          windowDays: safeWindowDays,
        });
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

  if (!dayValues.length) throw new Error("Disney pricing returned no day/ticket type combinations.");

  return {
    park,
    mainProductTitle,
    mainStatus: asString(profile.mainStatus || "ACTIVE"),
    removeExtraVariants: profile.removeExtraVariants !== false,
    ageGroups: DEFAULT_AGES,
    optionGroups: [
      { name: "duration", valuesText: dayValues.join("\n") },
      { name: "ticket_type", valuesText: DISNEY_TICKET_TYPES.map((item) => item.label).join("\n") },
    ],
    tierMode: "per_combo",
    globalTiers: [],
    perComboTiers,
    comboPrices,
    debug: {
      source: "disney_import_full",
      startDate,
      endDate,
      windowDays: safeWindowDays,
      maxDays: safeMaxDays,
      dayValues,
      comboCount: Object.keys(perComboTiers).length,
      warnings,
    },
  };
}

export async function runDisneyProfileSync(admin, profile = {}) {
  const config = await buildDisneyImportConfig(profile);
  const save = await saveTicketSetup(admin, config);
  return { configDebug: config.debug, save };
}
