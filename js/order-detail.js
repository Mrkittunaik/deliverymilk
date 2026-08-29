/* order-detail.js */

(() => {
  const content = document.getElementById("detail-content");
  const params = new URLSearchParams(location.search);
  const orderId = params.get("id");

  let order = null;

  function statusLabel(status) {
    if (status === "accepted") return "Accepted";
    if (status === "out_for_delivery") return "Out for delivery";
    if (status === "delivered") return "Delivered";
    return status;
  }

  function mapsUrl(order) {
    const lat = order.lat || (order.location && order.location.lat);
    const lng = order.lng || (order.location && order.location.lng);
    if (lat && lng) return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
    const q = encodeURIComponent(order.addressFull || order.addressPreview || "");
    return `https://www.google.com/maps/search/?api=1&query=${q}`;
  }

  function primaryActionLabel(status) {
    if (status === "accepted") return "Start delivery";
    if (status === "out_for_delivery") return "Mark delivered";
    return null;
  }

  function render() {
    const paid = order.paymentStatus === "paid" || order.paid;
    const actionLabel = primaryActionLabel(order.status);

    content.innerHTML = `
      <div class="card">
        <div class="dt-header">
          <div class="dt-name-row">
            <div class="dt-name">${order.customerName || "Customer"}</div>
          </div>
          <button class="call-btn" id="call-btn" data-phone="${order.customerPhone || ""}" aria-label="Call customer">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
          </button>
        </div>
        <span class="status-pill ${order.status}">${statusLabel(order.status)}</span>
      </div>

      <div class="card card-hi">
        <div class="dt-address">
          <div class="addr-label">Delivery address</div>
          ${order.addressLine1 ? `<div>${order.addressLine1}</div>` : ""}
          ${order.room ? `<div>Room/Flat: ${order.room}</div>` : ""}
          ${order.apartment ? `<div>${order.apartment}</div>` : ""}
          ${order.landmark ? `<div>Landmark: ${order.landmark}</div>` : ""}
        </div>
        <button class="btn btn-outline map-btn" id="map-btn" style="margin-top:12px;">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
          <span>View on map</span>
        </button>
      </div>

      <div class="card">
        <div class="section-title" style="font-size:14px;">Items</div>
        <div class="dt-items">
          ${(order.items || []).map(item => `
            <div class="dt-item-row">
              <span><span class="dt-item-qty">${item.qty || item.quantity || 1}x</span>${item.name}</span>
              <span>₹${item.price ?? "--"}</span>
            </div>
          `).join("")}
        </div>
        <div class="dt-amount-row total">
          <span>Total</span>
          <span>₹${order.amount ?? order.total ?? "--"}</span>
        </div>
        <div class="dt-amount-row">
          <span class="muted">Payment</span>
          <span class="badge ${paid ? "badge-paid" : "badge-cod"}">${paid ? "Paid" : "COD"}</span>
        </div>
      </div>

      <div class="dt-actions">
        ${actionLabel ? `<button class="btn btn-primary" id="primary-action-btn"><span class="btn-label">${actionLabel}</span></button>` : ""}
      </div>
    `;

    document.getElementById("call-btn").addEventListener("click", () => {
      const phone = document.getElementById("call-btn").dataset.phone;
      if (phone) window.location.href = `tel:${phone}`;
    });

    document.getElementById("map-btn").addEventListener("click", () => {
      window.open(mapsUrl(order), "_blank");
    });

    const actionBtn = document.getElementById("primary-action-btn");
    if (actionBtn) {
      actionBtn.addEventListener("click", () => handlePrimaryAction(actionBtn));
    }
  }

  async function handlePrimaryAction(btn) {
    if (order.status === "accepted") {
      // Start delivery
      btn.disabled = true;
      btn.innerHTML = `<span class="spinner"></span>`;
      try {
        await orderApi.startDelivery(orderId);
        order.status = "out_for_delivery";
        showToast("Delivery started", "success");
        render();
      } catch (err) {
        handleFetchError(err, "Could not start delivery.");
        btn.disabled = false;
        btn.innerHTML = `<span class="btn-label">Start delivery</span>`;
      }
    } else if (order.status === "out_for_delivery") {
      openModal({
        title: "Mark as delivered?",
        body: "Confirm that this order has been delivered to the customer.",
        confirmText: "Confirm delivery",
        onConfirm: async () => {
          closeModal();
          btn.disabled = true;
          btn.innerHTML = `<span class="spinner"></span>`;
          try {
            await orderApi.markDelivered(orderId, {});
            showToast("Order delivered!", "success");
            setTimeout(() => (location.href = "active-orders.html"), 500);
          } catch (err) {
            handleFetchError(err, "Could not mark as delivered.");
            btn.disabled = false;
            btn.innerHTML = `<span class="btn-label">Mark delivered</span>`;
          }
        },
      });
    }
  }

  async function load() {
    if (!orderId) {
      content.innerHTML = `<div class="empty-state"><div class="es-title">Order not found</div></div>`;
      return;
    }
    try {
      const res = await orderApi.getById(orderId);
      order = res.order || res;
      render();
    } catch (err) {
      handleFetchError(err, "Could not load order.");
      content.innerHTML = `<div class="empty-state"><div class="es-title">Couldn't load order</div></div>`;
    }
  }

  load();
})();
