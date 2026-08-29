/* order-history-detail.js - read-only version of order-detail */

(() => {
  const content = document.getElementById("detail-content");
  const params = new URLSearchParams(location.search);
  const orderId = params.get("id");

  function render(order) {
    const paid = order.paymentStatus === "paid" || order.paid;
    const deliveredAt = order.deliveredAt
      ? new Date(order.deliveredAt).toLocaleString(undefined, {
          day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
        })
      : "";

    content.innerHTML = `
      <div class="card">
        <div class="dt-header">
          <div class="dt-name-row">
            <div class="dt-name">${order.customerName || "Customer"}</div>
          </div>
        </div>
        <span class="status-pill delivered">Delivered</span>
        ${deliveredAt ? `<div class="muted" style="font-size:12.5px;margin-top:8px;">Delivered on ${deliveredAt}</div>` : ""}
      </div>

      <div class="card card-hi">
        <div class="dt-address">
          <div class="addr-label">Delivery address</div>
          ${order.addressLine1 ? `<div>${order.addressLine1}</div>` : ""}
          ${order.room ? `<div>Room/Flat: ${order.room}</div>` : ""}
          ${order.apartment ? `<div>${order.apartment}</div>` : ""}
          ${order.landmark ? `<div>Landmark: ${order.landmark}</div>` : ""}
        </div>
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
    `;
  }

  async function load() {
    if (!orderId) {
      content.innerHTML = `<div class="empty-state"><div class="es-title">Order not found</div></div>`;
      return;
    }
    try {
      const res = await orderApi.getById(orderId);
      render(res.order || res);
    } catch (err) {
      handleFetchError(err, "Could not load order.");
      content.innerHTML = `<div class="empty-state"><div class="es-title">Couldn't load order</div></div>`;
    }
  }

  load();
})();
