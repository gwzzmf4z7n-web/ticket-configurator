function formatMoney(cents) {
  if (cents == null || Number.isNaN(Number(cents))) {
    return "";
  }

  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD",
    maximumFractionDigits: 0,
  }).format(Number(cents) / 100);
}

function setText(root, selector, value) {
  const node = root.querySelector(selector);
  if (!node || value == null || value === "") {
    return;
  }

  node.textContent = value;
  node.hidden = false;
}

function setHtml(root, selector, html) {
  const node = root.querySelector(selector);
  if (!node || !html) {
    return;
  }

  node.innerHTML = html;
}

function setLink(root, selector, email, fallbackText) {
  const node = root.querySelector(selector);
  if (!node) {
    return;
  }

  if (email) {
    node.innerHTML = `<a href="mailto:${email}">${email}</a>`;
    node.hidden = false;
    return;
  }

  if (fallbackText) {
    node.textContent = fallbackText;
    node.hidden = false;
  }
}

function setInputValue(root, selector, value) {
  const node = root.querySelector(selector);
  if (!node) {
    return;
  }

  node.value = value || "";
}

function formatErrorMessage(payload, fallbackMessage) {
  if (Array.isArray(payload?.details) && payload.details.length) {
    const first = payload.details[0];
    if (typeof first?.message === "string" && first.message) {
      return first.message;
    }
  }

  if (typeof payload?.details === "string" && payload.details) {
    return payload.details;
  }

  if (typeof payload?.details?.message === "string" && payload.details.message) {
    return payload.details.message;
  }

  if (typeof payload?.details?.error_description === "string" && payload.details.error_description) {
    return payload.details.error_description;
  }

  if (payload?.details && typeof payload.details === "object") {
    try {
      return JSON.stringify(payload.details);
    } catch (error) {
      // fall through to the generic error message
    }
  }

  return payload?.error || fallbackMessage;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function updateRewardStatuses(root, creditBalance) {
  if (creditBalance == null) {
    return;
  }

  root.querySelectorAll("[data-portal-reward-card]").forEach((card) => {
    const creditCost = Number(card.dataset.creditCost || 0);
    const status = card.querySelector("[data-portal-reward-status]");
    const redeemButton = card.querySelector("[data-portal-redeem-button]");
    const isAvailable = card.dataset.portalRewardAvailable === "true";
    if (!status || !creditCost) {
      return;
    }

    if (creditBalance >= creditCost && isAvailable) {
      status.textContent = "Enough credits available";
      status.classList.add("portal-shop-card__status--available");
      if (redeemButton && !redeemButton.dataset.portalBusy) {
        redeemButton.disabled = false;
      }
      return;
    }

    status.textContent = isAvailable ? "Additional credits required" : "Currently unavailable";
    status.classList.remove("portal-shop-card__status--available");
    if (redeemButton && !redeemButton.dataset.portalBusy) {
      redeemButton.disabled = true;
    }
  });
}

function showPortalMessage(root, selector, message) {
  const node = root.querySelector(selector);
  if (!node) {
    return;
  }

  node.hidden = false;
  node.textContent = message;
}

function hidePortalMessage(root, selector) {
  const node = root.querySelector(selector);
  if (!node) {
    return;
  }

  node.hidden = true;
  node.textContent = "";
}

function renderHousehold(root, household) {
  const section = root.querySelector("[data-portal-household-section]");
  const list = root.querySelector("[data-portal-household-members]");
  if (!section || !list || !household || !household.members || !household.members.length) {
    return;
  }

  const householdName = root.querySelector("[data-portal-household-name]");
  if (householdName && household.name) {
    householdName.textContent = household.name;
  }

  list.innerHTML = household.members
    .map((member) => {
      const meta = [member.relationship, member.email].filter(Boolean).join(" · ");
      return `
        <article class="portal-dashboard-card">
          <p class="portal-dashboard-card__eyebrow">Household member</p>
          <h3 class="portal-dashboard-card__title h4">${member.name}</h3>
          <div class="portal-dashboard-card__copy">
            <p>${meta || "Connected contact"}</p>
          </div>
        </article>
      `;
    })
    .join("");

  section.hidden = false;
}

function renderTrips(root, trips, advisor) {
  const section = root.querySelector("[data-portal-trips-section]");
  const list = root.querySelector("[data-portal-trips-list]");
  if (!section || !list || !Array.isArray(trips) || !trips.length) {
    return null;
  }

  const tripPageUrl = root.dataset.portalTripPageUrl || "/pages/your-trip";
  list.innerHTML = trips
    .map((trip) => {
      const pills = [
        trip.datesLabel,
        trip.travellerStatus,
        trip.bookingStatus,
        trip.bookingReference ? `Ref ${trip.bookingReference}` : null,
      ]
        .filter(Boolean)
        .map((label) => `<span class="portal-pill">${escapeHtml(label)}</span>`)
        .join("");

      const meta = [trip.supplierOperator, trip.tripType]
        .filter(Boolean)
        .map((value) => escapeHtml(value))
        .join(" · ");

      return `
        <article class="portal-dashboard-card">
          <div class="portal-dashboard-card__top">
            <span class="portal-dashboard-card__icon"></span>
            ${trip.numberOfTravellers ? `<span class="portal-dashboard-card__status">${escapeHtml(`${trip.numberOfTravellers} travellers`)}</span>` : ""}
          </div>
          <p class="portal-dashboard-card__eyebrow">Trip</p>
          <h3 class="portal-dashboard-card__title h4">${escapeHtml(trip.title || "Upcoming trip")}</h3>
          <div class="portal-dashboard-card__copy">
            ${meta ? `<p>${meta}</p>` : ""}
            ${pills ? `<div class="portal-hero-card__pills">${pills}</div>` : ""}
          </div>
          <div class="portal-dashboard-card__actions">
            <a class="portal-text-link" href="${escapeHtml(`${tripPageUrl}?tripTravellerId=${encodeURIComponent(trip.tripTravellerId)}`)}">
              View trip
            </a>
          </div>
        </article>
      `;
    })
    .join("");

  const primaryTrip = trips[0];
  const liveTrip = root.querySelector("[data-portal-live-trip]");
  if (primaryTrip && liveTrip) {
    setText(root, "[data-portal-live-trip-title]", primaryTrip.title);
    setText(root, "[data-portal-live-trip-summary]", primaryTrip.supplierOperator || primaryTrip.tripType);
    setText(root, "[data-portal-live-trip-dates]", primaryTrip.datesLabel);
    setText(
      root,
      "[data-portal-live-trip-status]",
      primaryTrip.bookingStatus || primaryTrip.travellerStatus,
    );
    setLink(
      root,
      "[data-portal-live-trip-support]",
      advisor?.email,
      advisor?.name,
    );
    liveTrip.hidden = false;
    root.querySelectorAll("[data-portal-fallback-trip]").forEach((node) => {
      node.hidden = true;
    });
  }

  section.hidden = false;
  return primaryTrip;
}

function renderTripPage(root, trips, advisor) {
  const section = root.querySelector("[data-portal-trip-page-live]");
  if (!section || !Array.isArray(trips) || !trips.length) {
    return;
  }

  const selectedId = new URLSearchParams(window.location.search).get("tripTravellerId");
  const selectedTrip = trips.find((trip) => trip.tripTravellerId === selectedId) || trips[0];
  if (!selectedTrip) {
    return;
  }

  setText(root, "[data-portal-trip-page-title]", selectedTrip.title);
  setText(root, "[data-portal-trip-page-dates]", selectedTrip.datesLabel);
  setText(
    root,
    "[data-portal-trip-page-booking-status]",
    selectedTrip.bookingStatus || selectedTrip.travellerStatus,
  );
  setLink(root, "[data-portal-trip-page-support]", advisor?.email, advisor?.name);
  setText(root, "[data-portal-trip-page-supplier]", selectedTrip.supplierOperator);
  setText(root, "[data-portal-trip-page-type]", selectedTrip.tripType);
  setText(root, "[data-portal-trip-page-reference]", selectedTrip.bookingReference);
  setText(
    root,
    "[data-portal-trip-page-travellers]",
    selectedTrip.numberOfTravellers != null ? String(selectedTrip.numberOfTravellers) : "",
  );

  section.hidden = false;
  root.querySelectorAll("[data-portal-trip-page-fallback]").forEach((node) => {
    node.hidden = true;
  });
}

function populateProfileForm(root, customer) {
  if (!customer) {
    return;
  }

  const address = customer.address || {};
  setInputValue(root, "[data-portal-profile-first-name]", customer.firstName);
  setInputValue(root, "[data-portal-profile-last-name]", customer.lastName);
  setInputValue(root, "[data-portal-profile-email]", customer.email);
  setInputValue(root, "[data-portal-profile-phone]", customer.phone);
  setInputValue(root, "[data-portal-profile-address1]", address.address1);
  setInputValue(root, "[data-portal-profile-address2]", address.address2);
  setInputValue(root, "[data-portal-profile-city]", address.city);
  setInputValue(root, "[data-portal-profile-state]", address.state);
  setInputValue(root, "[data-portal-profile-postal]", address.postalCode);
  setInputValue(root, "[data-portal-profile-country]", address.country);
}

async function submitProfileForm(root, form, proxyBaseUrl) {
  const status = root.querySelector("[data-portal-profile-status]");
  const submitButton = form.querySelector("button[type='submit']");
  if (submitButton) {
    submitButton.disabled = true;
  }
  if (status) {
    status.hidden = false;
    status.textContent = "Saving your details.";
  }

  const url = new URL(proxyBaseUrl.replace(/\/portal$/, "/profile"), window.location.origin);
  if (root.dataset.portalCustomerId) {
    url.searchParams.set("customer_id", root.dataset.portalCustomerId);
  }

  const body = {
    firstName: form.querySelector("[data-portal-profile-first-name]")?.value || "",
    lastName: form.querySelector("[data-portal-profile-last-name]")?.value || "",
    email: form.querySelector("[data-portal-profile-email]")?.value || "",
    phone: form.querySelector("[data-portal-profile-phone]")?.value || "",
    address1: form.querySelector("[data-portal-profile-address1]")?.value || "",
    address2: form.querySelector("[data-portal-profile-address2]")?.value || "",
    city: form.querySelector("[data-portal-profile-city]")?.value || "",
    state: form.querySelector("[data-portal-profile-state]")?.value || "",
    postalCode: form.querySelector("[data-portal-profile-postal]")?.value || "",
    country: form.querySelector("[data-portal-profile-country]")?.value || "",
  };

  try {
    await addRewardVariantToCart(variantId);

    const response = await fetch(url.toString(), {
      method: "POST",
      credentials: "same-origin",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    const payload = await response.json();
    if (!response.ok || !payload.ok) {
      throw new Error(formatErrorMessage(payload, "Unable to save your details"));
    }

    populateProfileForm(root, payload.customer);
    if (status) {
      status.textContent = payload.warning
        ? `Saved to Salesforce. Shopify mirror warning: ${payload.warning}`
        : "Your details were updated.";
    }
  } catch (error) {
    if (status) {
      status.textContent = error.message;
    }
  } finally {
    if (submitButton) {
      submitButton.disabled = false;
    }
  }
}

async function addRewardVariantToCart(variantId) {
  const response = await fetch("/cart/add.js", {
    method: "POST",
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      items: [
        {
          id: Number(variantId),
          quantity: 1,
        },
      ],
    }),
  });

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(formatErrorMessage(payload, "Unable to add reward to cart"));
  }

  return payload;
}

async function redeemReward(root, card, button, baseUrl) {
  const variantId = card.dataset.portalRewardVariantId;
  const creditCost = Number(card.dataset.creditCost || 0);
  if (!variantId || !creditCost) {
    throw new Error("Reward is missing variant or credit information");
  }

  const status = card.querySelector("[data-portal-reward-status]");
  const originalLabel = button.textContent;
  button.dataset.portalBusy = "true";
  button.disabled = true;
  button.textContent = "Applying reward...";
  hidePortalMessage(root, "[data-portal-error]");

  if (status) {
    status.textContent = "Creating checkout reward...";
  }

  const url = new URL(baseUrl.replace(/\/portal$/, "/redeem-reward"), window.location.origin);
  if (root.dataset.portalCustomerId) {
    url.searchParams.set("customer_id", root.dataset.portalCustomerId);
  }

  try {
    const response = await fetch(url.toString(), {
      method: "POST",
      credentials: "same-origin",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        variantId,
      }),
    });

    const payload = await response.json();
    if (!response.ok || !payload.ok) {
      throw new Error(formatErrorMessage(payload, "Unable to redeem reward"));
    }

    if (payload.commerce?.creditBalance != null) {
      setText(root, "[data-portal-credit-balance]", String(payload.commerce.creditBalance));
      setText(root, "[data-portal-credit-value]", formatMoney(payload.commerce.creditValueCents));
      updateRewardStatuses(root, payload.commerce.creditBalance);
    }

    window.location.href = payload.discount?.shareableUrl || "/checkout";
  } catch (error) {
    if (status) {
      status.textContent = error.message;
      status.classList.remove("portal-shop-card__status--available");
    }
    showPortalMessage(root, "[data-portal-error]", error.message);
    button.disabled = false;
    button.textContent = originalLabel;
  } finally {
    delete button.dataset.portalBusy;
  }
}

async function loadPortalData(root) {
  const baseUrl = root.dataset.portalProxyUrl;
  if (!baseUrl) {
    return;
  }

  const url = new URL(baseUrl, window.location.origin);
  if (root.dataset.portalCustomerId) {
    url.searchParams.set("customer_id", root.dataset.portalCustomerId);
  }

  const loading = root.querySelector("[data-portal-loading]");
  const error = root.querySelector("[data-portal-error]");

  if (loading) {
    loading.hidden = false;
  }

  try {
    const response = await fetch(url.toString(), {
      credentials: "same-origin",
      headers: {
        Accept: "application/json",
      },
    });

    const text = await response.text();
    let payload = {};
    try {
      payload = text ? JSON.parse(text) : {};
    } catch (parseError) {
      throw new Error(text.includes("<!doctype") ? "Proxy returned HTML instead of JSON" : "Portal response was not valid JSON");
    }

    if (!response.ok) {
      throw new Error(payload.error || "Unable to load portal data");
    }

    if (loading) {
      loading.hidden = true;
    }

    const primaryTripFromCollection = renderTrips(root, payload.trips, payload.advisor);

    const liveTrip = root.querySelector("[data-portal-live-trip]");
    if (
      !primaryTripFromCollection &&
      payload.trip &&
      (payload.trip.title || payload.trip.summary || payload.trip.bookingStatus)
    ) {
      setText(root, "[data-portal-live-trip-title]", payload.trip.title);
      setText(root, "[data-portal-live-trip-summary]", payload.trip.summary);
      setText(root, "[data-portal-live-trip-dates]", payload.trip.datesLabel);
      setText(root, "[data-portal-live-trip-status]", payload.trip.bookingStatus);
      setLink(
        root,
        "[data-portal-live-trip-support]",
        payload.advisor?.email || payload.trip.supportEmail,
        payload.advisor?.name || payload.trip.advisorName,
      );

      if (liveTrip) {
        liveTrip.hidden = false;
      }

      root.querySelectorAll("[data-portal-fallback-trip]").forEach((node) => {
        node.hidden = true;
      });
    }

    if (payload.commerce) {
      if (payload.commerce.creditBalance != null) {
        setText(root, "[data-portal-credit-balance]", String(payload.commerce.creditBalance));
        setText(
          root,
          "[data-portal-credit-value]",
          formatMoney(payload.commerce.creditValueCents),
        );
        updateRewardStatuses(root, payload.commerce.creditBalance);
      }

      if (payload.commerce.discountPercent != null) {
        setText(root, "[data-portal-discount-percent]", `${payload.commerce.discountPercent}%`);
      }
    }

    if (payload.advisor) {
      setLink(root, "[data-portal-live-trip-support]", payload.advisor.email, payload.advisor.name);
    }

    populateProfileForm(root, payload.customer);
    renderTripPage(root, payload.trips, payload.advisor);
    renderHousehold(root, payload.household);

    const profileForm = root.querySelector("[data-portal-profile-form]");
    if (profileForm && !profileForm.dataset.portalBound) {
      profileForm.dataset.portalBound = "true";
      profileForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        await submitProfileForm(root, profileForm, baseUrl);
      });
    }

    root.querySelectorAll("[data-portal-redeem-button]").forEach((button) => {
      if (button.dataset.portalBound) {
        return;
      }

      button.dataset.portalBound = "true";
      button.addEventListener("click", async () => {
        await redeemReward(root, button.closest("[data-portal-reward-card]"), button, baseUrl);
      });
    });
  } catch (loadError) {
    if (loading) {
      loading.hidden = true;
    }

    if (error) {
      error.hidden = false;
      error.textContent = loadError.message;
    }
  }
}

document.addEventListener("DOMContentLoaded", () => {
  document.querySelectorAll("[data-portal-root]").forEach((root) => {
    loadPortalData(root);
  });
});
