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

function updateRewardStatuses(root, creditBalance) {
  if (creditBalance == null) {
    return;
  }

  root.querySelectorAll("[data-portal-reward-card]").forEach((card) => {
    const creditCost = Number(card.dataset.creditCost || 0);
    const status = card.querySelector("[data-portal-reward-status]");
    if (!status || !creditCost) {
      return;
    }

    if (creditBalance >= creditCost) {
      status.textContent = "Enough credits available";
      status.classList.add("portal-shop-card__status--available");
      return;
    }

    status.textContent = "Additional credits required";
    status.classList.remove("portal-shop-card__status--available");
  });
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

async function loadPortalData(root) {
  const url = root.dataset.portalProxyUrl;
  if (!url) {
    return;
  }

  const loading = root.querySelector("[data-portal-loading]");
  const error = root.querySelector("[data-portal-error]");

  if (loading) {
    loading.hidden = false;
  }

  try {
    const response = await fetch(url, {
      credentials: "same-origin",
      headers: {
        Accept: "application/json",
      },
    });

    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || "Unable to load portal data");
    }

    if (loading) {
      loading.hidden = true;
    }

    const liveTrip = root.querySelector("[data-portal-live-trip]");
    if (payload.trip && (payload.trip.title || payload.trip.summary || payload.trip.bookingStatus)) {
      setText(root, "[data-portal-live-trip-title]", payload.trip.title);
      setText(root, "[data-portal-live-trip-summary]", payload.trip.summary);
      setText(root, "[data-portal-live-trip-dates]", payload.trip.datesLabel);
      setText(root, "[data-portal-live-trip-status]", payload.trip.bookingStatus);
      setLink(root, "[data-portal-live-trip-support]", payload.trip.supportEmail, payload.trip.advisorName);

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

    renderHousehold(root, payload.household);
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
