/* active-orders.js */

(() => {
  const list = document.getElementById("active-list");

  function statusLabel(status) {
    if (status === "accepted") return "Accepted";
    if (status === "out_for_delivery") return "Out for delivery";
    return status;
  }

  function cardHtml(order) {
    const id = order._id || order.id;
    const paid = order.paymentStatus === "paid" || order.paid;
    return `
      <div class="order-card active-card" data-id="${id}">
        <div class="ac-info">
          <div class="ac-top-row">
            <span class="ac-name">${order.customerName || "Customer"}</span>
            <button class="call-btn" data-phone="${order.customerPhone || ""}" aria-label="Call customer">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
            </button>
          </div>
          <div class="ac-addr">${order.addressPreview || order.area || "Address unavailable"}</div>
          <div class="ac-bottom-row">
            <span class="badge ${paid ? "badge-paid" : "badge-cod"}">${paid ? "Paid" : "COD"}</span>
            <span class="status-pill ${order.status}">${statusLabel(order.status)}</span>
          </div>
        </div>
      </div>
    `;
  }

  function render(orders) {
    if (!orders.length) {
      renderEmptyState(list, {
        title: "No active orders",
        subtitle: "Accept an order from Home to see it here.",
        icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="7" width="18" height="13" rx="2"></rect><path d="M8 7V5a4 4 0 0 1 8 0v2"></path></svg>`,
      });
      return;
    }
    list.innerHTML = orders.map(cardHtml).join("");

    document.querySelectorAll(".active-card").forEach((card) => {
      card.addEventListener("click", (e) => {
        if (e.target.closest(".call-btn")) return;
        window.appNavigate(`order-detail.html?id=${card.dataset.id}`);
      });
    });

    document.querySelectorAll(".call-btn").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const phone = btn.dataset.phone;
        if (phone) window.location.href = `tel:${phone}`;
      });
    });
  }

  async function load() {
    renderSkeleton(list, 2);
    try {
      const res = await orderApi.getActive();
      const orders = res.orders || res || [];
      DeliveryLayout.setNavBadge("active", orders.length);
      render(orders);
    } catch (err) {
      handleFetchError(err, "Could not load active orders.");
      renderEmptyState(list, {
        title: err && err.apiNotConfigured ? "Backend not connected" : "Couldn't load orders",
        subtitle: err && err.apiNotConfigured ? "This app isn't linked to a backend yet." : "Pull to refresh.",
      });
    }
  }

  DeliverySocket.on("order:taken", () => load());

  load();
})();
