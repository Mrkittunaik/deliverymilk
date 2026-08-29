/* home.js */

(() => {
  const poolList = document.getElementById("pool-list");
  const limitBanner = document.getElementById("limit-banner");
  const refreshBtn = document.getElementById("refresh-btn");

  let maxConcurrentOrders = 3; // fallback default, overwritten by server response
  let activeOrderCount = 0;
  let pool = [];

  function orderCardHtml(order) {
    return `
      <div class="order-card" data-id="${order._id || order.id}">
        <div class="oc-top">
          <div>
            <div class="oc-id">#${(order._id || order.id || "").toString().slice(-6).toUpperCase()}</div>
            <div class="oc-area">${order.area || order.locality || "Unknown area"}</div>
          </div>
          <div class="oc-amount">₹${order.amount ?? order.total ?? "--"}</div>
        </div>
        <div class="oc-meta">
          <span>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 1 0-7.78 7.78L12 21.23l8.84-8.84a5.5 5.5 0 0 0 0-7.78z"/></svg>
            ${order.itemCount ?? (order.items ? order.items.length : "--")} items
          </span>
          ${order.distance ? `
          <span>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
            ${order.distance}
          </span>` : ""}
        </div>
        <button class="btn btn-primary accept-btn" data-id="${order._id || order.id}">
          <span class="btn-label">Accept</span>
        </button>
      </div>
    `;
  }

  function renderPool() {
    if (activeOrderCount >= maxConcurrentOrders) {
      limitBanner.classList.remove("hidden");
      poolList.innerHTML = "";
      return;
    }
    limitBanner.classList.add("hidden");

    if (!pool.length) {
      renderEmptyState(poolList, {
        title: "No orders right now",
        subtitle: "New orders will appear here as soon as they come in.",
      });
      return;
    }

    poolList.innerHTML = pool.map(orderCardHtml).join("");
    attachAcceptHandlers();
  }

  function attachAcceptHandlers() {
    document.querySelectorAll(".accept-btn").forEach((btn) => {
      btn.addEventListener("click", () => handleAccept(btn));
    });
  }

  async function handleAccept(btn) {
    const orderId = btn.dataset.id;
    btn.disabled = true;
    btn.innerHTML = `<span class="spinner"></span>`;

    try {
      await orderApi.accept(orderId);
      showToast("Order accepted!", "success");
      activeOrderCount += 1;
      DeliveryLayout.setNavBadge("active", activeOrderCount);
      removeOrderFromPool(orderId);
    } catch (err) {
      if (err.status === 409) {
        showToast("Already accepted by another rider.", "error");
        removeOrderFromPool(orderId);
      } else {
        handleFetchError(err, "Could not accept order.");
        btn.disabled = false;
        btn.innerHTML = `<span class="btn-label">Accept</span>`;
      }
    }
  }

  function removeOrderFromPool(orderId) {
    const card = document.querySelector(`.order-card[data-id="${orderId}"]`);
    if (card) {
      card.classList.add("card-exit");
      setTimeout(() => {
        pool = pool.filter((o) => (o._id || o.id) !== orderId);
        renderPool();
      }, 220);
    } else {
      pool = pool.filter((o) => (o._id || o.id) !== orderId);
      renderPool();
    }
  }

  function addOrderToPool(order) {
    const id = order._id || order.id;
    if (pool.some((o) => (o._id || o.id) === id)) return;
    pool.unshift(order);
    renderPool();
  }

  async function loadPool(showSkeleton = true) {
    if (showSkeleton) renderSkeleton(poolList, 3);
    try {
      const res = await orderApi.getPool();
      pool = res.orders || res || [];
      maxConcurrentOrders = res.maxConcurrentOrders ?? maxConcurrentOrders;
      activeOrderCount = res.activeOrderCount ?? activeOrderCount;
      DeliveryLayout.setNavBadge("home", pool.length);
      DeliveryLayout.setNavBadge("active", activeOrderCount);
      renderPool();
    } catch (err) {
      handleFetchError(err, "Could not load available orders.");
      renderEmptyState(poolList, {
        title: "Couldn't load orders",
        subtitle: "Pull to refresh or tap the refresh icon.",
      });
    }
  }

  refreshBtn.addEventListener("click", () => {
    refreshBtn.classList.add("spinning");
    loadPool(false).finally(() => {
      setTimeout(() => refreshBtn.classList.remove("spinning"), 400);
    });
  });

  // Real-time updates
  DeliverySocket.on("order:new", (order) => {
    if (activeOrderCount < maxConcurrentOrders) {
      addOrderToPool(order);
      DeliveryLayout.flashBellAlert();
      DeliveryLayout.setNavBadge("home", pool.length);
    }
  });

  DeliverySocket.on("order:taken", (payload) => {
    const id = payload._id || payload.id || payload.orderId;
    removeOrderFromPool(id);
    DeliveryLayout.setNavBadge("home", pool.length - 1 < 0 ? 0 : pool.length - 1);
  });

  // Simple pull-to-refresh (touch-based)
  let touchStartY = 0;
  document.addEventListener("touchstart", (e) => {
    if (window.scrollY === 0) touchStartY = e.touches[0].clientY;
  });
  document.addEventListener("touchend", (e) => {
    if (window.scrollY === 0 && touchStartY) {
      const delta = e.changedTouches[0].clientY - touchStartY;
      if (delta > 80) loadPool(false);
      touchStartY = 0;
    }
  });

  loadPool(true);
})();
