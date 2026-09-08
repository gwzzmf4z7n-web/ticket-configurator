(() => {
  if (window.appointmentBookingLoaded) return;
  window.appointmentBookingLoaded = true;
  const root = window.Shopify?.routes?.root || '/';
  const script = document.querySelector('script[data-appointment-booking]');
  const defaultProxy = script?.dataset.proxy || '/apps/appointments';
  const ownerKey = 'destination-appointment-owner';
  const holdsKey = 'destination-appointment-holds';
  const readHolds = () => { try { return JSON.parse(localStorage.getItem(holdsKey) || '{}'); } catch { return {}; } };
  function owner() {
    let value = localStorage.getItem(ownerKey);
    if (!value) { value = crypto.randomUUID().replaceAll('-', ''); localStorage.setItem(ownerKey, value); }
    return value;
  }
  function remember(id, proxy) { const saved = readHolds(); saved[id] = proxy; localStorage.setItem(holdsKey, JSON.stringify(saved)); }
  function forget(id) { const saved = readHolds(); delete saved[id]; localStorage.setItem(holdsKey, JSON.stringify(saved)); }
  async function jsonFetch(url, options = {}) {
    const response = await fetch(url, { credentials: 'same-origin', cache: 'no-store', ...options });
    let result;
    try { result = await response.json(); } catch { throw new Error('The booking service is temporarily unavailable. Please try again.'); }
    if (!response.ok || result.ok === false) throw new Error(result.error || result.description || 'Could not update your appointment. Please try again.');
    return result;
  }
  function api(proxy, body) {
    if (!proxy.startsWith('/') || proxy.startsWith('//')) throw new Error('Invalid booking app path.');
    return jsonFetch(proxy, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, owner: owner() }) });
  }
  class AppointmentProduct extends HTMLElement {
    connectedCallback() {
      if (this.ready) return;
      this.ready = true;
      this.form = this.querySelector('form');
      this.status = this.querySelector('[data-booking-status]');
      this.button = this.querySelector('button[type="submit"]');
      this.proxy = this.dataset.proxy || defaultProxy;
      this.requestVersion = 0;
      this.form.variantId.addEventListener('change', () => this.load());
      this.form.agentId.addEventListener('change', () => this.dates());
      this.form.bookingDate.addEventListener('change', () => this.times());
      this.form.startTime.addEventListener('change', () => { this.button.disabled = !this.form.startTime.value; });
      this.form.addEventListener('submit', event => { event.preventDefault(); this.reserve(); });
      this.load();
    }
    message(text, error = false) { this.status.textContent = text; this.status.dataset.error = String(error); }
    options(field, values, placeholder) {
      const select = this.form.elements.namedItem(field);
      select.replaceChildren(new Option(placeholder, ''));
      for (const item of values) select.add(new Option(item.label, item.value));
      select.disabled = !values.length;
      if (values.length === 1 && field === 'agentId') select.value = values[0].value;
    }
    async load() {
      const version = ++this.requestVersion;
      this.button.disabled = true;
      this.options('agentId', [], 'Loading agents…'); this.options('bookingDate', [], 'Choose an agent first'); this.options('startTime', [], 'Choose a date first');
      this.querySelector('[data-duration]').textContent = '';
      this.message('Checking availability…');
      try {
        const data = await jsonFetch(`${this.proxy}?variant=${encodeURIComponent(this.form.variantId.value)}`);
        if (version !== this.requestVersion) return;
        this.agents = data.agents;
        this.querySelector('[data-duration]').textContent = `${data.service.durationMinutes} minutes`;
        this.options('agentId', data.agents.filter(a => a.dates.length).map(a => ({ value: a.id, label: a.name })), 'Choose your agent');
        this.dates();
        this.message(data.agents.some(a => a.dates.length) ? '' : 'No appointments are currently available for this option. Please choose another option or contact us.');
      } catch (error) { if (version === this.requestVersion) this.message(error.message, true); }
    }
    dates() {
      this.agent = this.agents?.find(a => a.id === this.form.agentId.value);
      this.options('bookingDate', (this.agent?.dates || []).map(d => ({ value: d.date, label: `${d.label} (${d.date})` })), 'Choose a date');
      this.times();
    }
    times() {
      const date = this.agent?.dates.find(d => d.date === this.form.bookingDate.value);
      this.options('startTime', (date?.slots || []).map(s => ({ value: s.startTime, label: `${s.label} – ${s.endTime}` })), 'Choose a time');
      this.button.disabled = true;
    }
    async reserve() {
      if (this.reserving || !this.form.reportValidity()) return;
      this.reserving = true; this.button.disabled = true;
      const selection = Object.fromEntries(new FormData(this.form));
      this.message('Reserving your appointment…');
      let hold;
      try {
        // Verify persistent storage before creating a server-side hold.
        owner(); localStorage.setItem(holdsKey, JSON.stringify(readHolds()));
        ({ hold } = await api(this.proxy, { intent: 'hold', ...selection }));
        // One reservation per line. The unique hold property keeps appointments separate.
        const currentCart = await jsonFetch(`${root}cart.js`);
        if (currentCart.items.some(i => i.properties?._appointment_hold === hold.id)) {
          remember(hold.id, this.proxy); window.location.assign(`${root}cart`); return;
        }
        await jsonFetch(`${root}cart/add.js`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items: [{ id: selection.variantId, quantity: 1, properties: {
          'Appointment date': hold.bookingDate, 'Appointment time': `${hold.startTime}–${hold.endTime} (Melbourne)`, 'Agent': hold.agentName,
          '_appointment_hold': hold.id, '_appointment_expires': hold.expiresAt, '_appointment_proxy': this.proxy,
        } }] }) });
        remember(hold.id, this.proxy);
        window.location.assign(`${root}cart`);
      } catch (error) {
        // A failed response can follow a successful add; keep the hold if the cart contains it.
        if (hold) {
          try {
            const cart = await jsonFetch(`${root}cart.js`);
            if (cart.items.some(i => i.properties?._appointment_hold === hold.id)) { remember(hold.id, this.proxy); window.location.assign(`${root}cart`); return; }
            await api(this.proxy, { intent: 'release', holdId: hold.id }); forget(hold.id);
          } catch { /* An uncertain add retains its bounded hold until expiry. */ }
        }
        this.message(error.message, true);
        this.reserving = false; this.button.disabled = false;
      }
    }
  }
  customElements.define('appointment-product', AppointmentProduct);

  let cartLines = [], refreshing = false, checking = false, checkoutError = '', cartSignature = '';
  function messageBoxes() {
    for (const button of document.querySelectorAll('[name="checkout"], a[href$="/checkout"]')) {
      const parent = button.parentElement;
      if (!parent.querySelector('.appointment-cart-status')) {
        const box = document.createElement('div'); box.className = 'appointment-cart-status'; box.setAttribute('role', 'status'); box.setAttribute('aria-live', 'polite'); parent.prepend(box);
      }
    }
    return document.querySelectorAll('.appointment-cart-status');
  }
  function cartMessage(text, error = false) { for (const box of messageBoxes()) { box.textContent = text; box.dataset.error = String(error); } }
  function countdown() {
    if (checking || !cartLines.length || checkoutError) return;
    const earliest = Math.min(...cartLines.map(i => Date.parse(i.properties._appointment_expires || '')));
    const seconds = Math.max(0, Math.floor((earliest - Date.now()) / 1000));
    if (!Number.isFinite(seconds) || seconds <= 0) cartMessage('Your appointment hold has expired. Remove it and choose a time again before checkout.', true);
    else cartMessage(`Appointment held for ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}. Complete payment before the hold expires.`);
  }
  async function refreshCart() {
    if (refreshing || checking) return;
    refreshing = true;
    try {
      const cart = await jsonFetch(`${root}cart.js`);
      const signature = JSON.stringify(cart.items.map(i => [i.key, i.quantity]));
      if (signature !== cartSignature) { checkoutError = ''; cartSignature = signature; }
      cartLines = cart.items.filter(i => i.properties?._appointment_hold);
      document.documentElement.classList.toggle('has-appointment-cart', cartLines.length > 0);
      const saved = readHolds();
      // Release removed holds only after a fresh cart read. Adding is handled separately.
      for (const [id, proxy] of Object.entries(saved)) {
        if (!cartLines.some(i => i.properties._appointment_hold === id) && !document.querySelector('appointment-product')?.reserving) {
          try { await api(proxy, { intent: 'release', holdId: id }); forget(id); } catch { /* Server expiry is the fallback. */ }
        }
      }
      if (!cartLines.length) cartMessage(''); else countdown();
    } catch { /* A checkout attempt performs a blocking recheck. */ }
    finally { refreshing = false; }
  }
  async function checkout() {
    if (checking) return;
    checking = true;
    try {
      const cart = await jsonFetch(`${root}cart.js`);
      const lines = cart.items.filter(i => i.properties?._appointment_hold);
      if (lines.length) {
        cartMessage('Checking your reserved appointment…');
        const proxies = [...new Set(lines.map(i => i.properties._appointment_proxy || defaultProxy))];
        for (const proxy of proxies) {
          const result = await api(proxy, { intent: 'check', lines: cart.items.map(i => ({ holdId: i.properties?._appointment_hold, variantId: String(i.variant_id), quantity: i.quantity })) });
          if (!result.valid) throw new Error(result.problems.join(' '));
        }
      }
      window.location.assign(`${root}checkout`);
    } catch (error) { checkoutError = error.message; cartMessage(error.message, true); checking = false; }
  }
  document.addEventListener('click', event => {
    const target = event.target.closest?.('[name="checkout"], a[href$="/checkout"]');
    if (!target || target.disabled) return;
    // Leave ordinary carts' checkout handlers unchanged.
    if (!cartLines.length && !document.querySelector('[data-appointment-hold]') && !Object.keys(readHolds()).length) return;
    event.preventDefault(); event.stopImmediatePropagation(); checkout();
  }, true);
  document.addEventListener('submit', event => {
    if (event.submitter?.name !== 'checkout' || (!cartLines.length && !Object.keys(readHolds()).length)) return;
    event.preventDefault(); event.stopImmediatePropagation(); checkout();
  }, true);
  window.addEventListener('pageshow', refreshCart);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshCart(); });
  document.addEventListener('cart:updated', refreshCart);
  window.addEventListener('storage', refreshCart);
  setInterval(() => { if (!document.hidden && (cartLines.length || Object.keys(readHolds()).length)) refreshCart(); }, 5000);
  setInterval(countdown, 1000);
  refreshCart();
})();
